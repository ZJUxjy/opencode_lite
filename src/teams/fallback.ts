/**
 * Agent Teams - Fallback Handler
 *
 * Handles degradation from Team mode to single Agent execution.
 * Ensures task continuity when Team fails or budget is exceeded.
 */

import type { TaskContract, WorkArtifact, ReviewArtifact } from "./contracts.js"
import type { TeamStatus } from "./types.js"

// ============================================================================
// Fallback Types
// ============================================================================

export interface TeamFailureReport {
  teamId: string
  reason: "failed" | "timeout" | "budget_exceeded" | "circuit_open" | "cancelled"
  message: string
  completedArtifacts: WorkArtifact[]
  pendingTasks: string[]
  timestamp: number
}

export interface FallbackContext {
  executionMode: "fallback-single-agent"
  originalContract: TaskContract
  accumulatedArtifacts: WorkArtifact[]
  finalReview: ReviewArtifact | null
  failureReport: TeamFailureReport
}

export interface FallbackAgentInput {
  systemPrompt: string
  taskContract: TaskContract
  workContext: string
  reviewFeedback: string
  mode: "fallback-single-agent"
  failureReport: TeamFailureReport
}

// ============================================================================
// Fallback Handler
// ============================================================================

export class TeamFallbackHandler {
  private teamId: string
  private contract: TaskContract
  private artifacts: WorkArtifact[] = []
  private reviews: Map<string, ReviewArtifact> = new Map()

  constructor(teamId: string, contract: TaskContract) {
    this.teamId = teamId
    this.contract = contract
  }

  /**
   * Record a work artifact during team execution
   */
  recordArtifact(artifact: WorkArtifact): void {
    this.artifacts.push(artifact)
  }

  /**
   * Record a review artifact during team execution
   */
  recordReview(agentId: string, review: ReviewArtifact): void {
    this.reviews.set(agentId, review)
  }

  /**
   * Generate failure report when team execution fails
   */
  generateFailureReport(
    status: TeamStatus,
    error?: Error,
    circuitBreakerReason?: string | null
  ): TeamFailureReport {
    // Determine failure reason
    let reason: TeamFailureReport["reason"]
    let message: string

    switch (status) {
      case "failed":
        reason = "failed"
        message = error?.message || "Team execution failed"
        break
      case "timeout":
        reason = "timeout"
        message = "Team execution timed out"
        break
      case "cancelled":
        reason = "cancelled"
        message = "Team execution was cancelled"
        break
      default:
        if (circuitBreakerReason) {
          reason = "circuit_open"
          message = circuitBreakerReason
        } else {
          reason = "failed"
          message = "Unknown failure"
        }
    }

    return {
      teamId: this.teamId,
      reason,
      message,
      completedArtifacts: [...this.artifacts],
      pendingTasks: this.extractPendingTasks(),
      timestamp: Date.now(),
    }
  }

  /**
   * Generate budget exceeded failure report
   */
  generateBudgetExceededReport(budgetStatus: {
    tokens: { used: number; limit: number; percentage: number }
    cost: { used: number; limit: number | null; percentage: number | null }
  }): TeamFailureReport {
    const limit = budgetStatus.tokens.limit
    const used = budgetStatus.tokens.used
    const percentage = budgetStatus.tokens.percentage.toFixed(1)

    return {
      teamId: this.teamId,
      reason: "budget_exceeded",
      message: `Budget exceeded: ${used.toLocaleString()} / ${limit.toLocaleString()} tokens (${percentage}%)`,
      completedArtifacts: [...this.artifacts],
      pendingTasks: this.extractPendingTasks(),
      timestamp: Date.now(),
    }
  }

  /**
   * Create fallback context for single Agent continuation
   */
  createFallbackContext(failureReport: TeamFailureReport): FallbackContext {
    // Get the most recent review if available
    const finalReview = this.getMostRecentReview()

    return {
      executionMode: "fallback-single-agent",
      originalContract: this.contract,
      accumulatedArtifacts: [...this.artifacts],
      finalReview,
      failureReport,
    }
  }

  /**
   * Generate single Agent input from fallback context
   */
  generateAgentInput(context: FallbackContext): FallbackAgentInput {
    const { originalContract, accumulatedArtifacts, finalReview, failureReport } = context

    // Build work context summary
    const workSummary = this.summarizeWorkArtifacts(accumulatedArtifacts)

    // Build review feedback
    const reviewFeedback = finalReview
      ? this.formatReviewFeedback(finalReview)
      : "No review feedback available."

    // Generate system prompt for fallback execution
    const systemPrompt = this.generateFallbackSystemPrompt(failureReport)

    return {
      systemPrompt,
      taskContract: originalContract,
      workContext: workSummary,
      reviewFeedback,
      mode: "fallback-single-agent",
      failureReport: context.failureReport,
    }
  }

  /**
   * Execute fallback to single Agent
   * This is called by TeamManager when team fails
   */
  async executeFallback(
    status: TeamStatus,
    options: {
      error?: Error
      circuitBreakerReason?: string | null
      budgetStatus?: { tokens: { used: number; limit: number; percentage: number }; cost: { used: number; limit: number | null; percentage: number | null } }
    } = {}
  ): Promise<FallbackAgentInput> {
    // Generate failure report
    const failureReport = options.budgetStatus
      ? this.generateBudgetExceededReport(options.budgetStatus)
      : this.generateFailureReport(status, options.error, options.circuitBreakerReason)

    // Create fallback context
    const context = this.createFallbackContext(failureReport)

    // Generate agent input
    return this.generateAgentInput(context)
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private extractPendingTasks(): string[] {
    // Extract pending tasks from contract acceptance checks
    const pending: string[] = []

    for (const check of this.contract.acceptanceChecks) {
      // Check if this acceptance check is covered by any artifact
      const isCovered = this.artifacts.some((artifact) =>
        artifact.testResults.some((tr) => tr.command === check && tr.passed)
      )

      if (!isCovered) {
        pending.push(check)
      }
    }

    return pending
  }

  private getMostRecentReview(): ReviewArtifact | null {
    // Return the most recent review artifact
    const reviews = Array.from(this.reviews.values())
    if (reviews.length === 0) return null

    // Prefer the most recent changes_requested review, otherwise any review
    const changesRequested = reviews.find((r) => r.status === "changes_requested")
    return changesRequested || reviews[reviews.length - 1]
  }

  private summarizeWorkArtifacts(artifacts: WorkArtifact[]): string {
    if (artifacts.length === 0) {
      return "No work artifacts were completed before the failure."
    }

    const lines: string[] = []
    lines.push(`## Completed Work (${artifacts.length} artifacts)`)
    lines.push("")

    for (const artifact of artifacts) {
      lines.push(`### ${artifact.taskId}`)
      lines.push(`Summary: ${artifact.summary}`)
      lines.push(`Changed files: ${artifact.changedFiles.join(", ") || "None"}`)

      if (artifact.testResults.length > 0) {
        const passed = artifact.testResults.filter((t) => t.passed).length
        const total = artifact.testResults.length
        lines.push(`Tests: ${passed}/${total} passed`)
      }

      if (artifact.risks.length > 0) {
        lines.push(`Risks: ${artifact.risks.join("; ")}`)
      }

      lines.push("")
    }

    return lines.join("\n")
  }

  private formatReviewFeedback(review: ReviewArtifact): string {
    const lines: string[] = []

    lines.push(`## Review Status: ${review.status.toUpperCase()}`)
    lines.push(`Severity: ${review.severity}`)

    if (review.mustFix.length > 0) {
      lines.push("\n### Must Fix")
      for (const item of review.mustFix) {
        lines.push(`- ${item}`)
      }
    }

    if (review.suggestions.length > 0) {
      lines.push("\n### Suggestions")
      for (const item of review.suggestions) {
        lines.push(`- ${item}`)
      }
    }

    return lines.join("\n")
  }

  private generateFallbackSystemPrompt(failureReport: TeamFailureReport): string {
    return `You are continuing a task that was originally handled by an Agent Team but encountered an issue.

## Failure Context
Reason: ${failureReport.reason}
Message: ${failureReport.message}
Time: ${new Date(failureReport.timestamp).toISOString()}

## Your Role
You are now in FALLBACK mode - completing the task as a single Agent.
You must:
1. Review the accumulated work context and review feedback below
2. Complete the remaining tasks from the original objective
3. Address any "must fix" issues from the review
4. Execute the acceptance checks specified in the task contract

## Important
- You have access to all previous work artifacts
- Focus on completing the objective efficiently
- Pay special attention to any risks or assumptions noted in the work artifacts`
  }

  /**
   * Get all recorded artifacts
   */
  getArtifacts(): WorkArtifact[] {
    return [...this.artifacts]
  }

  /**
   * Get all recorded reviews
   */
  getReviews(): Map<string, ReviewArtifact> {
    return new Map(this.reviews)
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createFallbackHandler(teamId: string, contract: TaskContract): TeamFallbackHandler {
  return new TeamFallbackHandler(teamId, contract)
}
