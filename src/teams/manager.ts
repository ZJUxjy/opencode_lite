import { EventEmitter } from "events"
import type { TeamMode, TeamConfig, TeamStatus } from "./types.js"
import {
  WorkerReviewerRunner,
  PlannerExecutorReviewerRunner,
  LeaderWorkersRunner,
  HotfixGuardrailRunner,
  CouncilRunner,
} from "./modes/index.js"
import type { TaskContract, WorkArtifact, ReviewArtifact, PlanningArtifact, DecisionArtifact } from "./contracts.js"
import type { LeaderPlan } from "./modes/leader-workers.js"
import type { HotfixArtifact } from "./modes/hotfix-guardrail.js"
import type { TeamRunStats, PlannerExecutorReviewerStats, LeaderWorkersStats, HotfixGuardrailStats, CouncilStats } from "./modes/index.js"
import { CheckpointStore } from "./checkpoint-store.js"

// ============================================================================
// TeamManager - 团队管理器
// ============================================================================

/**
 * TeamManager - 统一团队运行入口
 *
 * 职责：
 * - 统一的团队模式启动入口
 * - 生命周期管理
 * - 降级处理
 * - 指标收集
 */
export class TeamManager extends EventEmitter {
  private config: TeamConfig
  private status: TeamStatus = "initializing"
  private checkpointStore?: CheckpointStore

  // 指标收集
  private metrics: TeamMetrics = {
    startTime: 0,
    endTime: 0,
    totalCost: 0,
    totalTokens: 0,
    iterations: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
  }

  constructor(config: TeamConfig) {
    super()
    this.config = config

    // 初始化检查点存储
    if (config.checkpointEnabled) {
      this.checkpointStore = new CheckpointStore(config.checkpointDir || ".agent-teams/checkpoints")
    }
  }

  /**
   * 从检查点恢复执行
   *
   * 恢复策略:
   * - restart-task: 重新执行失败的任务
   * - continue-iteration: 继续当前迭代
   * - skip-completed: 跳过已完成的任务
   */
  async resumeFromCheckpoint(
    checkpointId: string,
    strategy: "restart-task" | "continue-iteration" | "skip-completed" = "skip-completed"
  ): Promise<TeamRunResult> {
    if (!this.checkpointStore) {
      throw new Error("Checkpoint store is not initialized. Set checkpointEnabled: true in config.")
    }

    const checkpoint = this.checkpointStore.getCheckpoint(checkpointId)
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`)
    }

    this.status = "running"
    this.metrics.startTime = Date.now()

    try {
      // 从检查点恢复上下文
      const resumeContext = this.buildResumeContext(checkpoint, strategy)

      // 过滤待执行任务
      const pendingTasks = this.filterPendingTasks(checkpoint, strategy)

      if (pendingTasks.length === 0) {
        this.status = "completed"
        this.metrics.endTime = Date.now()
        return {
          success: true,
          mode: this.config.mode,
          artifact: undefined,
        }
      }

      // 继续执行
      const result = await this.executeWithResume(resumeContext, pendingTasks)

      this.status = "completed"
      this.metrics.endTime = Date.now()
      this.emit("completed", result)

      return result
    } catch (error) {
      this.status = "failed"
      this.metrics.endTime = Date.now()
      this.emit("error", { error })

      return {
        success: false,
        mode: this.config.mode,
        error: String(error),
      }
    }
  }

  /**
   * 构建恢复上下文
   */
  private buildResumeContext(
    checkpoint: { blackboardSnapshot?: string; artifactRefs?: string[] },
    _strategy: string
  ): ResumeContext {
    return {
      blackboardSnapshot: checkpoint.blackboardSnapshot,
      artifactRefs: checkpoint.artifactRefs || [],
      previousIteration: true,
    }
  }

  /**
   * 过滤待执行任务
   */
  private filterPendingTasks(
    checkpoint: { metadata?: Record<string, unknown> },
    strategy: "restart-task" | "continue-iteration" | "skip-completed"
  ): TaskContract[] {
    const taskMetadata = checkpoint.metadata?.tasks as Record<string, string> | undefined

    if (!taskMetadata) {
      return []
    }

    switch (strategy) {
      case "skip-completed":
        // 只返回未完成的任务
        return Object.entries(taskMetadata)
          .filter(([, status]) => status !== "completed")
          .map(([taskId]) => ({
            taskId,
            objective: "",
            fileScope: [],
            acceptanceChecks: [],
          }))

      case "restart-task":
        // 重新执行所有任务
        return Object.keys(taskMetadata).map((taskId) => ({
          taskId,
          objective: "",
          fileScope: [],
          acceptanceChecks: [],
        }))

      case "continue-iteration":
      default:
        // 返回当前迭代未完成的任务
        return Object.entries(taskMetadata)
          .filter(([, status]) => status === "in_progress" || status === "pending")
          .map(([taskId]) => ({
            taskId,
            objective: "",
            fileScope: [],
            acceptanceChecks: [],
          }))
    }
  }

  /**
   * 使用恢复上下文执行任务
   */
  private async executeWithResume(context: ResumeContext, _tasks: TaskContract[]): Promise<TeamRunResult> {
    // 恢复黑板快照
    if (context.blackboardSnapshot) {
      // TODO: 恢复黑板状态
      this.emit("context-restored", context.blackboardSnapshot)
    }

    // 恢复产物引用
    if (context.artifactRefs.length > 0) {
      // TODO: 重新加载产物
      this.emit("artifacts-restored", context.artifactRefs)
    }

    // 继续执行（这里简化处理，实际需要根据模式执行）
    return {
      success: true,
      mode: this.config.mode,
    }
  }

  // ========================================================================
  // 公开 API
  // ========================================================================

  /**
   * 执行任务 - 统一入口
   */
  async run(objective: string, task?: TaskContract): Promise<TeamRunResult> {
    this.status = "running"
    this.metrics.startTime = Date.now()

    try {
      let result: TeamRunResult

      switch (this.config.mode) {
        case "worker-reviewer":
          result = await this.runWorkerReviewer(objective, task!)
          break
        case "planner-executor-reviewer":
          result = await this.runPlannerExecutorReviewer(objective)
          break
        case "leader-workers":
          result = await this.runLeaderWorkers(objective)
          break
        case "hotfix-guardrail":
          result = await this.runHotfixGuardrail(task!)
          break
        case "council":
          result = await this.runCouncil(objective)
          break
        default:
          throw new Error(`Unknown mode: ${this.config.mode}`)
      }

      this.status = "completed"
      this.metrics.endTime = Date.now()
      this.emit("completed", result)

      return result
    } catch (error) {
      this.status = "failed"
      this.metrics.endTime = Date.now()
      this.emit("error", { error })

      return {
        success: false,
        mode: this.config.mode,
        error: String(error),
      }
    }
  }

  /**
   * 取消执行
   */
  cancel(): void {
    this.status = "cancelled"
    this.emit("cancelled")
  }

  /**
   * 获取状态
   */
  getStatus(): TeamStatus {
    return this.status
  }

  /**
   * 获取指标
   */
  getMetrics(): TeamMetrics {
    return { ...this.metrics }
  }

  // ========================================================================
  // 模式执行 (简化版，需要外部注入执行器)
  // ========================================================================

  /**
   * Worker-Reviewer 模式
   */
  private async runWorkerReviewer(objective: string, task: TaskContract): Promise<TeamRunResult> {
    // 简化实现：需要外部提供执行器
    return {
      success: false,
      mode: "worker-reviewer",
      error: "Worker-Reviewer requires executor injection",
    }
  }

  /**
   * Planner-Executor-Reviewer 模式
   */
  private async runPlannerExecutorReviewer(objective: string): Promise<TeamRunResult> {
    return {
      success: false,
      mode: "planner-executor-reviewer",
      error: "Planner-Executor-Reviewer requires executor injection",
    }
  }

  /**
   * Leader-Workers 模式
   */
  private async runLeaderWorkers(objective: string): Promise<TeamRunResult> {
    return {
      success: false,
      mode: "leader-workers",
      error: "Leader-Workers requires executor injection",
    }
  }

  /**
   * Hotfix-Guardrail 模式
   */
  private async runHotfixGuardrail(task: TaskContract): Promise<TeamRunResult> {
    return {
      success: false,
      mode: "hotfix-guardrail",
      error: "Hotfix-Guardrail requires executor injection",
    }
  }

  /**
   * Council 模式
   */
  private async runCouncil(objective: string): Promise<TeamRunResult> {
    return {
      success: false,
      mode: "council",
      error: "Council requires executor injection",
    }
  }
}

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 团队运行结果
 */
export interface TeamRunResult {
  success: boolean
  mode: TeamMode
  artifact?: WorkArtifact | HotfixArtifact
  artifacts?: WorkArtifact[]
  decision?: DecisionArtifact
  rollbackSteps?: Array<{ order: number; description: string }>
  error?: string
  fallbackPrompt?: string
}

/**
 * 团队指标
 */
export interface TeamMetrics {
  startTime: number
  endTime: number
  totalCost: number
  totalTokens: number
  iterations: number
  tasksCompleted: number
  tasksFailed: number
}

/**
 * 恢复上下文 - 从检查点恢复时使用
 */
export interface ResumeContext {
  blackboardSnapshot?: string
  artifactRefs: string[]
  previousIteration: boolean
}

/**
 * 团队统计
 */
export type TeamStats =
  | TeamRunStats
  | PlannerExecutorReviewerStats
  | LeaderWorkersStats
  | HotfixGuardrailStats
  | CouncilStats
