/**
 * Checkpoint Resume - 检查点恢复能力
 *
 * 基于 agent-teams-supplement.md 原则 7: Checkpoint Resume
 *
 * 提供从检查点恢复执行的能力，支持：
 * - restart-task: 重新开始任务
 * - continue-iteration: 继续当前迭代
 * - skip-completed: 跳过已完成的部分
 */

import type { Agent } from "../agent.js"
import type { TeamConfig, TeamResult } from "./types.js"
import type { Checkpoint } from "./checkpoint-store.js"
import type { WorkArtifact } from "./contracts.js"
import { TeamExecutor } from "./team-executor.js"
import { ArtifactStorage } from "./artifact-storage.js"

/**
 * 恢复策略
 */
export type ResumeStrategy = "restart-task" | "continue-iteration" | "skip-completed"

/**
 * 上下文注入配置
 */
export interface ContextInjectionConfig {
  /** 是否包含之前的思考过程 */
  includePreviousThinking: boolean
  /** 是否包含之前的产物 */
  includePreviousArtifacts: boolean
  /** 最大上下文 token 数 */
  maxContextTokens: number
}

/**
 * 恢复配置
 */
export interface CheckpointResumeConfig {
  /** 检查点 ID */
  checkpointId: string
  /** 恢复策略 */
  strategy: ResumeStrategy
  /** 上下文注入配置 */
  contextInjection: ContextInjectionConfig
  /** 最大重试次数 */
  maxRetryAttempts: number
}

/**
 * 恢复上下文
 */
export interface ResumeContext {
  /** 原始需求 */
  originalRequirement: string
  /** 已完成的产物 */
  completedArtifacts: WorkArtifact[]
  /** 最后一次审查结果（如果有） */
  lastReviewSummary?: string
  /** 已执行的迭代次数 */
  iterationsCompleted: number
  /** 失败原因 */
  failureReason?: string
  /** 恢复提示 */
  recoveryPrompt: string
}

/**
 * 检查点恢复管理器
 */
export class CheckpointResumeManager {
  private artifactStorage: ArtifactStorage

  constructor(cwd: string = process.cwd()) {
    this.artifactStorage = new ArtifactStorage({ cwd })
  }

  /**
   * 构建恢复上下文
   */
  buildResumeContext(
    checkpoint: Checkpoint,
    originalRequirement: string,
    previousResult?: TeamResult
  ): ResumeContext {
    const completedArtifacts: WorkArtifact[] = []
    let lastReviewSummary: string | undefined
    let iterationsCompleted = 0

    // 从产物引用中加载产物
    for (const artifactRef of checkpoint.artifactRefs) {
      const content = this.artifactStorage.readArtifact(
        checkpoint.id,
        artifactRef
      )
      if (content) {
        // 简化：将内容作为摘要
        completedArtifacts.push({
          taskId: checkpoint.id,
          agentId: "previous",
          agentRole: "worker",
          summary: content.substring(0, 200),
          changedFiles: [],
          patchRef: "",
          testResults: [],
          risks: [],
          assumptions: [],
          createdAt: checkpoint.timestamp,
        })
      }
    }

    // 从之前的结果中提取信息
    if (previousResult) {
      iterationsCompleted = previousResult.stats.iterations
      if (previousResult.artifacts.length > 0) {
        completedArtifacts.push(...previousResult.artifacts)
      }
      if (!previousResult.summary.includes("success")) {
        lastReviewSummary = previousResult.summary
      }
    }

    // 生成恢复提示
    const recoveryPrompt = this.generateRecoveryPrompt(
      originalRequirement,
      completedArtifacts,
      lastReviewSummary,
      checkpoint.status === "failed"
    )

    return {
      originalRequirement,
      completedArtifacts,
      lastReviewSummary,
      iterationsCompleted,
      failureReason: checkpoint.status === "failed" ? "Checkpoint marked as failed" : undefined,
      recoveryPrompt,
    }
  }

  /**
   * 生成恢复提示
   */
  private generateRecoveryPrompt(
    requirement: string,
    completedArtifacts: WorkArtifact[],
    lastReviewSummary?: string,
    wasFailed?: boolean
  ): string {
    const parts: string[] = []

    parts.push("## 任务恢复上下文")
    parts.push("")
    parts.push("这是一个从检查点恢复的任务。以下是之前的执行状态：")
    parts.push("")

    parts.push("### 原始需求")
    parts.push(requirement)
    parts.push("")

    if (completedArtifacts.length > 0) {
      parts.push("### 已完成的工作")
      for (const artifact of completedArtifacts) {
        parts.push(`- **${artifact.agentRole}**: ${artifact.summary}`)
        if (artifact.changedFiles.length > 0) {
          parts.push(`  修改的文件: ${artifact.changedFiles.join(", ")}`)
        }
      }
      parts.push("")
    }

    if (lastReviewSummary) {
      parts.push("### 上次审查反馈")
      parts.push(lastReviewSummary)
      parts.push("")
    }

    if (wasFailed) {
      parts.push("### ⚠️ 注意")
      parts.push("上次执行失败。请分析失败原因并尝试不同的方法。")
      parts.push("")
    }

    parts.push("### 恢复指导")
    parts.push("1. 回顾之前的工作成果")
    parts.push("2. 确定还需要完成什么")
    parts.push("3. 继续执行任务，避免重复已完成的工作")
    parts.push("4. 如果之前失败，尝试不同的方法")

    return parts.join("\n")
  }

  /**
   * 根据策略构建恢复提示
   */
  buildStrategyPrompt(
    context: ResumeContext,
    strategy: ResumeStrategy
  ): string {
    const basePrompt = context.recoveryPrompt

    switch (strategy) {
      case "restart-task":
        return `${basePrompt}

**策略: 重新开始任务**
忽略之前的所有工作，从零开始执行任务。这可能是因为之前的方向完全错误。`

      case "continue-iteration":
        return `${basePrompt}

**策略: 继续当前迭代**
在当前进度基础上继续工作。已完成 ${context.iterationsCompleted} 次迭代。`

      case "skip-completed":
        return `${basePrompt}

**策略: 跳过已完成部分**
识别并跳过已经完成的工作，专注于剩余的任务。

已完成的工作摘要:
${context.completedArtifacts.map(a => `- ${a.summary}`).join("\n")}`

      default:
        return basePrompt
    }
  }

  /**
   * 从检查点恢复执行
   */
  async resumeFromCheckpoint(
    checkpoint: Checkpoint,
    mainAgent: Agent,
    teamConfig: TeamConfig,
    sessionId: string,
    config: CheckpointResumeConfig,
    originalRequirement: string,
    previousResult?: TeamResult
  ): Promise<TeamResult> {
    // 构建恢复上下文
    const context = this.buildResumeContext(checkpoint, originalRequirement, previousResult)

    // 根据策略构建提示
    const resumePrompt = this.buildStrategyPrompt(context, config.strategy)

    // 创建新的执行器
    const executor = new TeamExecutor({
      mainAgent,
      teamConfig,
      sessionId: `${sessionId}-resume-${Date.now()}`,
      events: {
        onStatusChange: status => {
          console.log(`[Resume] Status: ${status}`)
        },
      },
    })

    // 执行恢复任务
    const result = await executor.execute(resumePrompt)

    return result
  }
}

/**
 * 创建恢复管理器
 */
export function createCheckpointResumeManager(cwd?: string): CheckpointResumeManager {
  return new CheckpointResumeManager(cwd)
}

/**
 * 默认恢复配置
 */
export const DEFAULT_RESUME_CONFIG: CheckpointResumeConfig = {
  checkpointId: "",
  strategy: "continue-iteration",
  contextInjection: {
    includePreviousThinking: true,
    includePreviousArtifacts: true,
    maxContextTokens: 50000,
  },
  maxRetryAttempts: 3,
}
