/**
 * TeamExecutor - Team 模式执行器
 *
 * 负责协调 Team 模式的执行：
 * - 根据配置创建 Team 实例
 * - 管理子 Agent 的生命周期
 * - 跟踪执行状态到 TeamSessionStore
 * - 提供执行进度回调
 */

import type { Agent } from "../agent.js"
import type { TeamConfig, TeamResult, TeamMode, TeamStatus } from "./types.js"
import type { TeamSessionStore, TeamAgentRecord } from "./team-session-store.js"
import { WorkerReviewerTeam } from "./modes/worker-reviewer.js"
import { PlannerExecutorReviewerTeam } from "./modes/planner-executor-reviewer.js"
import { LeaderWorkersTeam } from "./modes/leader-workers.js"
import { HotfixGuardrailTeam } from "./modes/hotfix-guardrail.js"
import { CouncilTeam } from "./modes/council.js"

/**
 * 执行进度事件
 */
export interface TeamExecutionEvents {
  /** 状态变更 */
  onStatusChange?: (status: TeamStatus) => void
  /** 迭代开始 */
  onIterationStart?: (iteration: number, maxIterations: number) => void
  /** 迭代结束 */
  onIterationEnd?: (iteration: number, result: { success: boolean; summary: string }) => void
  /** Agent 活动开始 */
  onAgentStart?: (agentId: string, role: string, task: string) => void
  /** Agent 活动结束 */
  onAgentEnd?: (agentId: string, role: string, result: { summary: string; tokens: number }) => void
  /** 错误 */
  onError?: (error: Error) => void
  /** 完成回调 */
  onComplete?: (result: TeamResult) => void
}

/**
 * Team 执行器配置
 */
export interface TeamExecutorConfig {
  /** 主 Agent 实例 */
  mainAgent: Agent
  /** Team 配置 */
  teamConfig: TeamConfig
  /** 会话 ID */
  sessionId: string
  /** Team 会话存储 */
  teamSessionStore?: TeamSessionStore
  /** 事件回调 */
  events?: TeamExecutionEvents
  /** 调试模式 */
  debug?: boolean
}

/**
 * Team 执行器
 *
 * 统一管理 Team 模式的执行流程
 */
export class TeamExecutor {
  private mainAgent: Agent
  private teamConfig: TeamConfig
  private sessionId: string
  private teamSessionStore?: TeamSessionStore
  private events: TeamExecutionEvents
  private debug: boolean
  private currentStatus: TeamStatus = "initializing"

  constructor(config: TeamExecutorConfig) {
    this.mainAgent = config.mainAgent
    this.teamConfig = config.teamConfig
    this.sessionId = config.sessionId
    this.teamSessionStore = config.teamSessionStore
    this.events = config.events || {}
    this.debug = config.debug || false
  }

  /**
   * 调试日志
   */
  private log(message: string): void {
    if (this.debug) {
      console.log(`[TeamExecutor] ${message}`)
    }
  }

  /**
   * 更新状态
   */
  private updateStatus(status: TeamStatus): void {
    this.currentStatus = status
    this.events.onStatusChange?.(status)
    this.teamSessionStore?.updateTeamSessionStatus(this.sessionId, status)
  }

  /**
   * 执行 Team 任务
   */
  async execute(userRequirement: string): Promise<TeamResult> {
    this.log(`Starting execution with mode: ${this.teamConfig.mode}`)
    this.log(`Requirement: ${userRequirement.substring(0, 100)}...`)

    try {
      // 更新状态为 running
      this.updateStatus("running")

      let result: TeamResult

      switch (this.teamConfig.mode) {
        case "worker-reviewer":
          result = await this.executeWorkerReviewer(userRequirement)
          break

        case "planner-executor-reviewer":
          result = await this.executePlannerExecutorReviewer(userRequirement)
          break

        case "leader-workers":
          result = await this.executeLeaderWorkers(userRequirement)
          break

        case "hotfix-guardrail":
          result = await this.executeHotfixGuardrail(userRequirement)
          break

        case "council":
          result = await this.executeCouncil(userRequirement)
          break

        default:
          throw new Error(`Unknown team mode: ${this.teamConfig.mode}`)
      }

      // 更新最终状态
      const finalStatus = result.status === "success" ? "completed" : "failed"
      this.updateStatus(finalStatus)
      this.teamSessionStore?.updateTeamSessionStatus(this.sessionId, finalStatus, result)

      // 触发完成回调
      this.events.onComplete?.(result)

      this.log(`Execution completed with status: ${result.status}`)
      return result

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.log(`Execution failed: ${err.message}`)
      this.updateStatus("failed")
      this.events.onError?.(err)

      const result: TeamResult = {
        status: "failure",
        summary: `Team execution failed: ${err.message}`,
        artifacts: [],
        stats: {
          duration: 0,
          iterations: 0,
          totalCost: 0,
          totalTokens: 0,
        },
      }

      this.teamSessionStore?.updateTeamSessionStatus(this.sessionId, "failed", result)
      return result
    }
  }

  /**
   * 执行 Worker-Reviewer 模式
   */
  private async executeWorkerReviewer(requirement: string): Promise<TeamResult> {
    this.log("Creating Worker-Reviewer team...")

    const team = new WorkerReviewerTeam(
      this.teamConfig,
      this.mainAgent, // worker
      this.mainAgent, // reviewer (复用主 Agent)
      { debug: this.debug }
    )

    // 记录 Agent 活动
    this.events.onAgentStart?.("worker-0", "worker", requirement)

    // 记录消息轨迹
    this.teamSessionStore?.recordMessageTrace({
      teamSessionId: this.sessionId,
      agentId: "worker-0",
      agentRole: "worker",
      type: "task-assign",
      content: { requirement },
      timestamp: Date.now(),
    })

    const result = await team.execute(requirement)

    // 记录完成
    this.events.onAgentEnd?.("worker-0", "worker", {
      summary: result.summary,
      tokens: result.stats.totalTokens,
    })

    this.teamSessionStore?.recordMessageTrace({
      teamSessionId: this.sessionId,
      agentId: "worker-0",
      agentRole: "worker",
      type: "task-result",
      content: { result: result.summary, status: result.status },
      timestamp: Date.now(),
    })

    // 更新 Agent 统计
    this.teamSessionStore?.updateAgentStats(this.sessionId, "worker-0", {
      inputTokens: 0, // 实际值需要从 Agent 获取
      outputTokens: result.stats.totalTokens,
      costUsd: result.stats.totalCost,
      status: result.status === "success" ? "completed" : "failed",
    })

    team.cleanup()
    return result
  }

  /**
   * 执行 Planner-Executor-Reviewer 模式
   */
  private async executePlannerExecutorReviewer(requirement: string): Promise<TeamResult> {
    this.log("Creating Planner-Executor-Reviewer team...")

    const team = new PlannerExecutorReviewerTeam(
      this.teamConfig,
      this.mainAgent, // planner
      this.mainAgent, // executor
      this.mainAgent, // reviewer
      { debug: this.debug }
    )

    // 记录开始
    this.events.onAgentStart?.("planner-0", "planner", "Analyzing requirements")

    this.teamSessionStore?.recordMessageTrace({
      teamSessionId: this.sessionId,
      agentId: "planner-0",
      agentRole: "planner",
      type: "task-assign",
      content: { requirement },
      timestamp: Date.now(),
    })

    const result = await team.execute(requirement)

    // 记录完成
    this.events.onAgentEnd?.("planner-0", "planner", {
      summary: result.summary,
      tokens: result.stats.totalTokens,
    })

    this.teamSessionStore?.updateAgentStats(this.sessionId, "planner-0", {
      inputTokens: 0,
      outputTokens: result.stats.totalTokens,
      costUsd: result.stats.totalCost,
      status: result.status === "success" ? "completed" : "failed",
    })

    team.cleanup()
    return result
  }

  /**
   * 执行 Leader-Workers 模式
   */
  private async executeLeaderWorkers(requirement: string): Promise<TeamResult> {
    this.log("Creating Leader-Workers team...")

    const team = new LeaderWorkersTeam(
      this.teamConfig,
      this.mainAgent, // leader
      [this.mainAgent], // workers (简化：使用主 Agent)
      { debug: this.debug }
    )

    // 记录开始
    this.events.onAgentStart?.("leader-0", "leader", "Coordinating task execution")

    this.teamSessionStore?.recordMessageTrace({
      teamSessionId: this.sessionId,
      agentId: "leader-0",
      agentRole: "leader",
      type: "task-assign",
      content: { requirement, strategy: this.teamConfig.strategy },
      timestamp: Date.now(),
    })

    const result = await team.execute(requirement)

    // 记录完成
    this.events.onAgentEnd?.("leader-0", "leader", {
      summary: result.summary,
      tokens: result.stats.totalTokens,
    })

    this.teamSessionStore?.updateAgentStats(this.sessionId, "leader-0", {
      inputTokens: 0,
      outputTokens: result.stats.totalTokens,
      costUsd: result.stats.totalCost,
      status: result.status === "success" ? "completed" : "failed",
    })

    team.cleanup()
    return result
  }

  /**
   * 执行 Hotfix Guardrail 模式
   */
  private async executeHotfixGuardrail(requirement: string): Promise<TeamResult> {
    this.log("Creating Hotfix Guardrail team...")

    const team = new HotfixGuardrailTeam(
      this.teamConfig,
      this.mainAgent, // fixer
      this.mainAgent, // safety reviewer
      { debug: this.debug }
    )

    // 记录开始
    this.events.onAgentStart?.("fixer-0", "fixer", "Implementing emergency fix")

    this.teamSessionStore?.recordMessageTrace({
      teamSessionId: this.sessionId,
      agentId: "fixer-0",
      agentRole: "fixer",
      type: "task-assign",
      content: { issue: requirement },
      timestamp: Date.now(),
    })

    const result = await team.execute(requirement)

    // 记录完成
    this.events.onAgentEnd?.("fixer-0", "fixer", {
      summary: result.summary,
      tokens: result.stats.totalTokens,
    })

    this.teamSessionStore?.updateAgentStats(this.sessionId, "fixer-0", {
      inputTokens: 0,
      outputTokens: result.stats.totalTokens,
      costUsd: result.stats.totalCost,
      status: result.status === "success" ? "completed" : "failed",
    })

    team.cleanup()
    return result
  }

  /**
   * 执行 Council 模式
   */
  private async executeCouncil(requirement: string): Promise<TeamResult> {
    this.log("Creating Council team...")

    const team = new CouncilTeam(
      this.teamConfig,
      this.mainAgent, // speaker
      [this.mainAgent, this.mainAgent], // members (简化：复用主 Agent)
      { debug: this.debug }
    )

    // 记录开始
    this.events.onAgentStart?.("speaker-0", "speaker", "Facilitating council discussion")

    this.teamSessionStore?.recordMessageTrace({
      teamSessionId: this.sessionId,
      agentId: "speaker-0",
      agentRole: "speaker",
      type: "task-assign",
      content: { topic: requirement },
      timestamp: Date.now(),
    })

    const result = await team.execute(requirement)

    // 记录完成
    this.events.onAgentEnd?.("speaker-0", "speaker", {
      summary: result.summary,
      tokens: result.stats.totalTokens,
    })

    this.teamSessionStore?.updateAgentStats(this.sessionId, "speaker-0", {
      inputTokens: 0,
      outputTokens: result.stats.totalTokens,
      costUsd: result.stats.totalCost,
      status: result.status === "success" ? "completed" : "failed",
    })

    team.cleanup()
    return result
  }

  /**
   * 获取当前状态
   */
  getStatus(): TeamStatus {
    return this.currentStatus
  }
}

/**
 * 创建 Team 执行器
 */
export function createTeamExecutor(config: TeamExecutorConfig): TeamExecutor {
  return new TeamExecutor(config)
}
