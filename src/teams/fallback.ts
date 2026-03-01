import type { TeamStatus, TeamConfig } from "./types.js"
import type { TaskContract, WorkArtifact, ReviewArtifact, PlanningArtifact } from "./contracts.js"

// ============================================================================
// TeamFailureReport - Team失败报告
// ============================================================================

/**
 * Team 失败报告
 * 当Team模式失败时，生成此报告用于降级到单Agent
 */
export interface TeamFailureReport {
  teamId: string
  reason: TeamFailureReason
  completedTasks: string[]
  pendingTasks: string[]
  lastArtifact?: WorkArtifact
  lastReview?: ReviewArtifact
  recoveryPrompt: string
}

export type TeamFailureReason =
  | "failed"
  | "timeout"
  | "budget_exceeded"
  | "circuit_open"
  | "cancelled"

// ============================================================================
// FallbackExecutor - 降级执行器
// ============================================================================

/**
 * FallbackExecutor - Team降级到单Agent执行器
 *
 * 职责：
 * - 生成降级提示词
 * - 汇总已完成的工作
 * - 继续单Agent执行
 */
export class FallbackExecutor {
  private teamId: string

  constructor(teamId: string) {
    this.teamId = teamId
  }

  /**
   * 生成失败报告
   */
  generateFailureReport(params: {
    status: TeamStatus
    completedTasks: TaskContract[]
    pendingTasks: TaskContract[]
    lastArtifact?: WorkArtifact
    lastReview?: ReviewArtifact
    currentObjective: string
  }): TeamFailureReport {
    const { status, completedTasks, pendingTasks, lastArtifact, lastReview, currentObjective } = params

    const reason = this.statusToReason(status)
    const completedTaskIds = completedTasks.map((t) => t.taskId)
    const pendingTaskIds = pendingTasks.map((t) => t.taskId)

    return {
      teamId: this.teamId,
      reason,
      completedTasks: completedTaskIds,
      pendingTasks: pendingTaskIds,
      lastArtifact,
      lastReview,
      recoveryPrompt: this.generateRecoveryPrompt({
        completedTasks,
        pendingTasks,
        lastArtifact,
        lastReview,
        currentObjective,
        reason,
      }),
    }
  }

  /**
   * 状态转换为失败原因
   */
  private statusToReason(status: TeamStatus): TeamFailureReason {
    switch (status) {
      case "failed":
        return "failed"
      case "timeout":
        return "timeout"
      case "cancelled":
        return "cancelled"
      default:
        return "failed"
    }
  }

  /**
   * 生成恢复提示词
   */
  private generateRecoveryPrompt(params: {
    completedTasks: TaskContract[]
    pendingTasks: TaskContract[]
    lastArtifact?: WorkArtifact
    lastReview?: ReviewArtifact
    currentObjective: string
    reason: TeamFailureReason
  }): string {
    const { completedTasks, pendingTasks, lastArtifact, lastReview, currentObjective, reason } = params

    const lines: string[] = []

    lines.push(`# Team执行失败，需要降级到单Agent继续`)
    lines.push(``)
    lines.push(`**失败原因**: ${reason}`)
    lines.push(``)

    // 已完成的任务
    if (completedTasks.length > 0) {
      lines.push(`## 已完成任务 (${completedTasks.length})`)
      lines.push(``)
      for (const task of completedTasks) {
        lines.push(`- ${task.taskId}: ${task.objective}`)
      }
      lines.push(``)
    }

    // 待完成的任务
    if (pendingTasks.length > 0) {
      lines.push(`## 待完成任务 (${pendingTasks.length})`)
      lines.push(``)
      for (const task of pendingTasks) {
        lines.push(`- ${task.taskId}: ${task.objective}`)
        lines.push(`  允许修改: ${task.fileScope.join(", ")}`)
      }
      lines.push(``)
    }

    // 最后的工作产物
    if (lastArtifact) {
      lines.push(`## 最后工作产物`)
      lines.push(``)
      lines.push(`**摘要**: ${lastArtifact.summary}`)
      lines.push(``)
      lines.push(`**修改文件**: ${lastArtifact.changedFiles.join(", ")}`)
      lines.push(``)

      if (lastArtifact.risks.length > 0) {
        lines.push(`**风险**: ${lastArtifact.risks.join(", ")}`)
        lines.push(``)
      }
    }

    // 最后的Review
    if (lastReview) {
      lines.push(`## 最后Review结果`)
      lines.push(``)
      lines.push(`**状态**: ${lastReview.status}`)
      lines.push(`**严重程度**: ${lastReview.severity}`)
      lines.push(``)

      if (lastReview.mustFix.length > 0) {
        lines.push(`**必须修复**: ${lastReview.mustFix.join(", ")}`)
        lines.push(``)
      }

      if (lastReview.suggestions.length > 0) {
        lines.push(`**建议**: ${lastReview.suggestions.join(", ")}`)
        lines.push(``)
      }
    }

    // 原始目标
    lines.push(`## 原始目标`)
    lines.push(``)
    lines.push(currentObjective)
    lines.push(``)

    // 继续执行的指示
    lines.push(`## 继续执行`)
    lines.push(``)
    lines.push(`请作为单Agent继续完成上述待完成任务。`)
    lines.push(`如果存在未修复的问题，请先修复后再继续。`)
    lines.push(`已完成的工作已记录在上方，请不要重复实现。`)

    return lines.join("\n")
  }

  /**
   * 创建降级后的Agent输入上下文
   */
  createFallbackContext(report: TeamFailureReport): FallbackContext {
    return {
      teamId: this.teamId,
      reason: report.reason,
      completedTasks: report.completedTasks,
      pendingTasks: report.pendingTasks,
      recoveryPrompt: report.recoveryPrompt,
      executionMode: "fallback-single-agent",
      shouldResume: report.pendingTasks.length > 0,
    }
  }

  /**
   * 检查是否可以降级
   */
  canFallback(report: TeamFailureReport): boolean {
    // 如果没有待完成任务，不需要降级
    if (report.pendingTasks.length === 0) {
      return false
    }

    // 预算超限也不应该继续
    if (report.reason === "budget_exceeded") {
      return false
    }

    return true
  }
}

// ============================================================================
// 类型定义
// ============================================================================

export interface FallbackContext {
  teamId: string
  reason: TeamFailureReason
  completedTasks: string[]
  pendingTasks: string[]
  recoveryPrompt: string
  executionMode: "fallback-single-agent"
  shouldResume: boolean
}

/**
 * 降级结果
 */
export interface FallbackResult {
  success: boolean
  context: FallbackContext
  report: TeamFailureReport
}
