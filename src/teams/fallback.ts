/**
 * Team 降级机制
 *
 * 当 Team 模式失败时，自动降级到单 Agent 模式
 * 保持会话连续性，传递已完成的工作产物
 */

import type { Agent } from "../agent.js"
import type { TeamResult, TeamStatus } from "./types.js"
import type { WorkArtifact, ReviewArtifact } from "./contracts.js"

/**
 * Team 失败报告
 *
 * 记录 Team 失败的详细信息，用于生成 recovery prompt
 */
export interface TeamFailureReport {
  /** 团队 ID */
  teamId: string
  /** 失败原因 */
  reason:
    | "failed"
    | "timeout"
    | "budget_exceeded"
    | "circuit_open"
    | "max_iterations"
  /** 原始用户需求 */
  originalRequirement: string
  /** 已完成的工作产物 */
  completedArtifacts: WorkArtifact[]
  /** 最后一次审查结果（如果有） */
  lastReview?: ReviewArtifact
  /** 恢复提示，传递给单 Agent */
  recoveryPrompt: string
  /** 执行统计 */
  stats: {
    duration: number
    iterations: number
    totalCost: number
    totalTokens: number
  }
}

/**
 * 降级配置
 */
export interface FallbackConfig {
  /** 是否启用降级（默认 true） */
  enabled: boolean
  /** 失败时的最大重试次数（传递给单 Agent 的重试） */
  maxRetries?: number
  /** 是否保留 Team 的消息历史 */
  preserveHistory?: boolean
  /** 自定义恢复提示生成器 */
  customRecoveryPromptGenerator?: (
    report: Omit<TeamFailureReport, "recoveryPrompt">
  ) => string
}

/**
 * 降级结果
 */
export interface FallbackResult {
  /** 执行模式 */
  executionMode:
    | "team-success"
    | "fallback-single-agent"
    | "team-failure"
  /** Team 执行结果（如果成功） */
  teamResult?: TeamResult
  /** 失败报告（如果降级） */
  fallbackReport?: TeamFailureReport
  /** 单 Agent 执行结果（如果降级成功） */
  singleAgentResult?: string
  /** 最终摘要 */
  finalSummary: string
}

/**
 * 执行 Team 任务，失败时降级到单 Agent
 *
 * @param teamExecutor Team 执行函数
 * @param singleAgent 单 Agent 实例
 * @param userRequirement 用户需求
 * @param config 降级配置
 * @returns 降级结果
 */
export async function executeWithFallback(
  teamExecutor: () => Promise<TeamResult>,
  singleAgent: Agent,
  userRequirement: string,
  config: FallbackConfig = { enabled: true }
): Promise<FallbackResult> {
  try {
    // 执行 Team 任务
    const teamResult = await teamExecutor()

    // Team 成功
    if (teamResult.status === "success") {
      return {
        executionMode: "team-success",
        teamResult,
        finalSummary: teamResult.summary,
      }
    }

    // Team 失败，检查是否启用降级
    if (!config.enabled) {
      return {
        executionMode: "team-failure",
        teamResult,
        finalSummary: `Team execution failed: ${teamResult.summary}`,
      }
    }

    // 生成失败报告
    const failureReport = createFailureReport(
      teamResult,
      userRequirement,
      config
    )

    // 执行降级
    const singleAgentResult = await executeFallback(
      singleAgent,
      failureReport,
      config
    )

    return {
      executionMode: "fallback-single-agent",
      fallbackReport: failureReport,
      singleAgentResult,
      finalSummary: `Team failed, fallback to single agent completed. ${singleAgentResult?.slice(0, 100)}...`,
    }
  } catch (error) {
    // Team 执行异常
    if (!config.enabled) {
      return {
        executionMode: "team-failure",
        finalSummary: `Team execution error: ${error instanceof Error ? error.message : "Unknown error"}`,
      }
    }

    // 创建异常失败报告
    const failureReport: TeamFailureReport = {
      teamId: "unknown",
      reason: "failed",
      originalRequirement: userRequirement,
      completedArtifacts: [],
      recoveryPrompt: generateRecoveryPrompt({
        teamId: "unknown",
        reason: "failed",
        originalRequirement: userRequirement,
        completedArtifacts: [],
        stats: {
          duration: 0,
          iterations: 0,
          totalCost: 0,
          totalTokens: 0,
        },
      }),
      stats: {
        duration: 0,
        iterations: 0,
        totalCost: 0,
        totalTokens: 0,
      },
    }

    // 执行降级
    const singleAgentResult = await executeFallback(
      singleAgent,
      failureReport,
      config
    )

    return {
      executionMode: "fallback-single-agent",
      fallbackReport: failureReport,
      singleAgentResult,
      finalSummary: `Team error, fallback to single agent. ${singleAgentResult?.slice(0, 100)}...`,
    }
  }
}

/**
 * 创建失败报告
 */
function createFailureReport(
  teamResult: TeamResult,
  userRequirement: string,
  config: FallbackConfig
): TeamFailureReport {
  // 确定失败原因
  const reason = determineFailureReason(teamResult)

  // 提取工作产物
  const completedArtifacts = teamResult.artifacts

  // 提取最后一次审查（如果有）
  const lastReview = extractLastReview(teamResult)

  // 创建基础报告
  const baseReport: Omit<TeamFailureReport, "recoveryPrompt"> = {
    teamId: `team-${Date.now()}`,
    reason,
    originalRequirement: userRequirement,
    completedArtifacts,
    lastReview,
    stats: teamResult.stats,
  }

  // 生成恢复提示
  const recoveryPrompt = config.customRecoveryPromptGenerator
    ? config.customRecoveryPromptGenerator(baseReport)
    : generateRecoveryPrompt(baseReport)

  return {
    ...baseReport,
    recoveryPrompt,
  }
}

/**
 * 确定失败原因
 */
function determineFailureReason(
  teamResult: TeamResult
): TeamFailureReport["reason"] {
  const summary = teamResult.summary.toLowerCase()

  if (summary.includes("timeout")) {
    return "timeout"
  }
  if (summary.includes("budget")) {
    return "budget_exceeded"
  }
  if (summary.includes("circuit")) {
    return "circuit_open"
  }
  if (summary.includes("max iterations") || summary.includes("maximum iterations")) {
    return "max_iterations"
  }

  return "failed"
}

/**
 * 提取最后一次审查结果
 */
function extractLastReview(
  teamResult: TeamResult
): ReviewArtifact | undefined {
  // 从产物中查找 ReviewArtifact
  // 注意：WorkArtifact 和 ReviewArtifact 是不同类型
  // 这里简化处理，返回 undefined
  // 实际实现可能需要从 blackboard 或其他地方获取
  return undefined
}

/**
 * 生成恢复提示
 *
 * 将 Team 的失败信息转换为单 Agent 可以理解的提示
 */
export function generateRecoveryPrompt(
  report: Omit<TeamFailureReport, "recoveryPrompt">
): string {
  const lines: string[] = []

  lines.push("# Task Continuation Request")
  lines.push("")
  lines.push("A multi-agent team was previously working on this task but encountered issues.")
  lines.push("Please continue the work as a single agent.")
  lines.push("")

  // 原始需求
  lines.push("## Original Requirement")
  lines.push("")
  lines.push(report.originalRequirement)
  lines.push("")

  // 失败原因
  lines.push("## Previous Attempt Status")
  lines.push("")
  const reasonText = {
    failed: "The team execution failed",
    timeout: "The team execution timed out",
    budget_exceeded: "The team exceeded the budget limit",
    circuit_open: "The team triggered the circuit breaker",
    max_iterations: "The team reached the maximum iteration limit",
  }
  lines.push(`**Reason**: ${reasonText[report.reason]}`)
  lines.push("")

  // 执行统计
  lines.push("## Execution Statistics")
  lines.push("")
  lines.push(`- Duration: ${(report.stats.duration / 1000).toFixed(1)}s`)
  lines.push(`- Iterations: ${report.stats.iterations}`)
  lines.push(`- Cost: $${report.stats.totalCost.toFixed(4)}`)
  lines.push(`- Tokens: ${report.stats.totalTokens}`)
  lines.push("")

  // 已完成的工作
  if (report.completedArtifacts.length > 0) {
    lines.push("## Completed Work")
    lines.push("")
    lines.push("The following work has been completed by the team:")
    lines.push("")

    for (const artifact of report.completedArtifacts) {
      lines.push(`### ${artifact.agentRole} (${artifact.agentId})`)
      lines.push("")
      lines.push(artifact.summary)
      lines.push("")

      if (artifact.changedFiles.length > 0) {
        lines.push("**Changed files:**")
        for (const file of artifact.changedFiles) {
          lines.push(`- ${file}`)
        }
        lines.push("")
      }

      if (artifact.risks.length > 0) {
        lines.push("**Risks:**")
        for (const risk of artifact.risks) {
          lines.push(`- ${risk}`)
        }
        lines.push("")
      }

      if (artifact.assumptions.length > 0) {
        lines.push("**Assumptions:**")
        for (const assumption of artifact.assumptions) {
          lines.push(`- ${assumption}`)
        }
        lines.push("")
      }
    }
  }

  // 最后的审查反馈
  if (report.lastReview) {
    lines.push("## Last Review Feedback")
    lines.push("")
    lines.push(`**Status**: ${report.lastReview.status}`)
    lines.push(`**Severity**: ${report.lastReview.severity}`)
    lines.push("")

    if (report.lastReview.mustFix.length > 0) {
      lines.push("**Must Fix:**")
      for (const comment of report.lastReview.mustFix) {
        lines.push(`- [${comment.category}] ${comment.message}`)
        if (comment.file) {
          lines.push(`  File: ${comment.file}${comment.line ? `:${comment.line}` : ""}`)
        }
      }
      lines.push("")
    }

    if (report.lastReview.suggestions.length > 0) {
      lines.push("**Suggestions:**")
      for (const comment of report.lastReview.suggestions) {
        lines.push(`- ${comment.message}`)
      }
      lines.push("")
    }
  }

  // 行动指引
  lines.push("## Next Steps")
  lines.push("")
  lines.push("Please review the work above and:")
  lines.push("")

  if (report.completedArtifacts.length === 0) {
    lines.push("1. Start fresh with the original requirement")
    lines.push("2. Consider a simpler approach that can be completed by a single agent")
  } else if (report.lastReview?.status === "changes_requested") {
    lines.push("1. Address the review feedback listed above")
    lines.push("2. Focus on the 'Must Fix' items first")
    lines.push("3. Run tests to verify your changes")
  } else {
    lines.push("1. Review the completed work for correctness")
    lines.push("2. Continue from where the team left off")
    lines.push("3. Consider simplifying the remaining work")
  }

  lines.push("")
  lines.push("---")
  lines.push("Continue the task based on the context above.")

  return lines.join("\n")
}

/**
 * 执行降级到单 Agent
 */
async function executeFallback(
  singleAgent: Agent,
  failureReport: TeamFailureReport,
  config: FallbackConfig
): Promise<string> {
  // 使用恢复提示作为输入
  const result = await singleAgent.run(failureReport.recoveryPrompt)
  return result
}

/**
 * 检查 Team 结果是否需要降级
 */
export function shouldFallback(teamResult: TeamResult): boolean {
  return teamResult.status === "failure"
}

/**
 * 格式化失败报告为用户友好的消息
 */
export function formatFailureReport(report: TeamFailureReport): string {
  const lines: string[] = []

  lines.push("⚠️ Team Execution Failed")
  lines.push("")
  lines.push(`**Reason**: ${report.reason}`)
  lines.push(`**Duration**: ${(report.stats.duration / 1000).toFixed(1)}s`)
  lines.push(`**Iterations**: ${report.stats.iterations}`)
  lines.push(`**Cost**: $${report.stats.totalCost.toFixed(4)}`)

  if (report.completedArtifacts.length > 0) {
    lines.push("")
    lines.push(`**Completed Artifacts**: ${report.completedArtifacts.length}`)
    for (const artifact of report.completedArtifacts) {
      lines.push(`  - ${artifact.agentRole}: ${artifact.changedFiles.length} files`)
    }
  }

  lines.push("")
  lines.push("Falling back to single agent mode...")

  return lines.join("\n")
}
