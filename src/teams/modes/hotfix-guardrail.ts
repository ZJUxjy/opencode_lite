/**
 * Agent Teams - Hotfix Guardrail Mode
 *
 * Emergency production fix mode with strict safety constraints.
 * Fixer implements minimal change, Safety-Reviewer validates rollback plan.
 */

import type { ModeRunner, TeamConfig, SharedBlackboard, CostController, ProgressTracker } from "../types.js"
import type { TaskContract, WorkArtifact, ReviewArtifact } from "../contracts.js"
import { createDefaultTaskContract, meetsQualityGate } from "../contracts.js"
import { createAgentLLMClient } from "../llm-client.js"

// ============================================================================
// Hotfix Guardrail Types
// ============================================================================

type HotfixPhase = "idle" | "fixing" | "reviewing" | "completed" | "failed" | "rolled_back"

interface HotfixState {
  phase: HotfixPhase
  incidentId: string
  taskContract?: TaskContract
  workArtifact?: WorkArtifact
  reviewArtifact?: ReviewArtifact
  rollbackPlan?: RollbackPlan
  error?: string
  startTime: number
}

interface RollbackPlan {
  steps: string[]
  estimatedTime: string
  verificationCommand: string
  automated: boolean
}

interface HotfixSafetyRules {
  maxFiles: number
  allowRefactoring: boolean
  requireRollbackPlan: boolean
  requireTests: boolean
}

// ============================================================================
// Hotfix Guardrail Mode Runner
// ============================================================================

export class HotfixGuardrailMode implements ModeRunner {
  readonly mode = "hotfix-guardrail" as const

  private config?: TeamConfig
  private blackboard?: SharedBlackboard
  private costController?: CostController
  private progressTracker?: ProgressTracker
  private state: HotfixState
  private abortController?: AbortController
  private timeoutId?: ReturnType<typeof setTimeout>
  private safetyRules: HotfixSafetyRules

  constructor() {
    this.state = {
      phase: "idle",
      incidentId: `incident-${Date.now()}`,
      startTime: Date.now(),
    }
    // Strict safety rules for hotfixes
    this.safetyRules = {
      maxFiles: 3,
      allowRefactoring: false,
      requireRollbackPlan: true,
      requireTests: true,
    }
  }

  async run(
    config: TeamConfig,
    blackboard: SharedBlackboard,
    costController: CostController,
    progressTracker: ProgressTracker
  ): Promise<WorkArtifact | null> {
    this.config = config
    this.blackboard = blackboard
    this.costController = costController
    this.progressTracker = progressTracker
    this.abortController = new AbortController()

    // Get fixer and safety-reviewer configs
    const fixerConfig = config.agents.find((a) => a.role === "fixer" || a.role === "worker")
    const safetyReviewerConfig = config.agents.find((a) => a.role === "safety-reviewer" || a.role === "reviewer")

    if (!fixerConfig || !safetyReviewerConfig) {
      throw new Error("Hotfix Guardrail mode requires a fixer and a safety-reviewer")
    }

    // Get task from blackboard or create default
    const taskContract = blackboard.getTaskContract() ?? this.createDefaultTask()
    this.state.taskContract = taskContract

    // Validate file scope is within safety limits
    if (taskContract.fileScope.length > this.safetyRules.maxFiles) {
      throw new Error(
        `Hotfix file scope too broad: ${taskContract.fileScope.length} files. ` +
          `Maximum allowed: ${this.safetyRules.maxFiles} files for emergency fixes.`
      )
    }

    blackboard.setTaskContract(taskContract)

    // Set timeout (hotfixes should be quick)
    const hotfixTimeout = Math.min(config.timeoutMs, 300000) // Max 5 minutes for hotfix
    this.timeoutId = setTimeout(() => {
      this.handleTimeout()
    }, hotfixTimeout)

    try {
      blackboard.emit("status-changed", "running", "initializing")

      // Phase 1: Fixer implements minimal fix
      this.state.phase = "fixing"
      blackboard.emit("iteration-started", 1, fixerConfig.role, "fixer")

      const workArtifact = await this.runFixer(fixerConfig.model, taskContract)
      this.state.workArtifact = workArtifact
      blackboard.setWorkArtifact("fixer", workArtifact)

      // Validate fix doesn't violate safety rules
      this.validateSafetyRules(workArtifact)

      // Record progress
      progressTracker.recordCodeChange(workArtifact.changedFiles.length)

      // Phase 2: Safety-Reviewer validates and produces rollback plan
      this.state.phase = "reviewing"
      blackboard.emit("iteration-started", 1, safetyReviewerConfig.role, "safety-reviewer")

      const reviewArtifact = await this.runSafetyReviewer(
        safetyReviewerConfig.model,
        taskContract,
        workArtifact
      )
      this.state.reviewArtifact = reviewArtifact
      blackboard.setReviewArtifact("safety-reviewer", reviewArtifact)

      // Check safety gate (stricter than quality gate)
      const safetyResult = this.checkSafetyGate(reviewArtifact)

      if (!safetyResult.passed) {
        throw new Error(`Safety gate failed: ${safetyResult.reasons.join(", ")}`)
      }

      if (reviewArtifact.status === "approved") {
        this.state.phase = "completed"
        blackboard.emit("progress-detected", "review")
        blackboard.emit("completed", workArtifact)
        return workArtifact
      }

      // Changes requested - hotfix cannot proceed without approval
      throw new Error(
        `Hotfix rejected by safety reviewer: ${reviewArtifact.mustFix.join("; ")}`
      )
    } catch (error) {
      this.state.phase = "failed"
      this.state.error = error instanceof Error ? error.message : String(error)
      blackboard.emit("error", error instanceof Error ? error : new Error(String(error)))

      // Trigger rollback if we have a plan
      if (this.state.rollbackPlan) {
        this.state.phase = "rolled_back"
        blackboard.emit("status-changed", "failed", "running")
      }

      throw error
    } finally {
      if (this.timeoutId) {
        clearTimeout(this.timeoutId)
        this.timeoutId = undefined
      }
    }
  }

  cancel(): void {
    this.abortController?.abort()
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
    }
  }

  /**
   * Get current state
   */
  getState(): HotfixState {
    return { ...this.state }
  }

  /**
   * Get rollback plan
   */
  getRollbackPlan(): RollbackPlan | undefined {
    return this.state.rollbackPlan
  }

  // ========================================================================
  // Private Methods
  // ========================================================================

  private async runFixer(model: string, taskContract: TaskContract): Promise<WorkArtifact> {
    if (!this.blackboard || !this.costController) {
      throw new Error("Not initialized")
    }

    this.blackboard.postMessage(
      {
        type: "task-assign",
        task: taskContract,
      },
      "system",
      "fixer"
    )

    // Create LLM client with hotfix-specific system prompt
    const llmClient = createAgentLLMClient({
      model,
      temperature: 0.1, // Lower temperature for more conservative fixes
    })
    llmClient.setCostController(this.costController)
    llmClient.setBlackboard(this.blackboard)

    // Build hotfix-specific prompt
    const prompt = this.buildFixerPrompt(taskContract)

    // Execute fixer via LLM with custom prompt
    const artifact = await llmClient.executeWorker(taskContract, 1)

    // Enhance artifact with hotfix metadata
    const enhancedArtifact: WorkArtifact = {
      ...artifact,
      summary: `[HOTFIX] ${artifact.summary}`,
      assumptions: [
        ...artifact.assumptions,
        "This is an emergency hotfix - minimal change only",
        "Production impact has been assessed",
      ],
    }

    this.blackboard.postMessage(
      {
        type: "task-result",
        artifact: enhancedArtifact,
      },
      "fixer",
      "system"
    )

    return enhancedArtifact
  }

  private async runSafetyReviewer(
    model: string,
    taskContract: TaskContract,
    workArtifact: WorkArtifact
  ): Promise<ReviewArtifact> {
    if (!this.blackboard || !this.costController) {
      throw new Error("Not initialized")
    }

    this.blackboard.postMessage(
      {
        type: "review-request",
        artifact: workArtifact,
      },
      "system",
      "safety-reviewer"
    )

    // Create LLM client
    const llmClient = createAgentLLMClient({
      model,
      temperature: 0.1,
    })
    llmClient.setCostController(this.costController)
    llmClient.setBlackboard(this.blackboard)

    // Execute reviewer
    const review = await llmClient.executeReviewer(taskContract, workArtifact)

    // Extract rollback plan from review
    this.state.rollbackPlan = this.extractRollbackPlan(review)

    // Enhance review with safety-specific checks
    const enhancedReview: ReviewArtifact = {
      ...review,
      status: review.status,
      severity: review.severity,
      mustFix: [
        ...review.mustFix,
        ...(this.state.rollbackPlan ? [] : ["Rollback plan is required for hotfixes"]),
      ],
      suggestions: [
        ...review.suggestions,
        "Verify monitoring dashboards after deployment",
        "Have rollback command ready before deploying",
      ],
    }

    this.blackboard.postMessage(
      {
        type: "review-result",
        review: enhancedReview,
      },
      "safety-reviewer",
      "system"
    )

    return enhancedReview
  }

  private buildFixerPrompt(taskContract: TaskContract): string {
    return `You are a Fixer agent implementing an EMERGENCY HOTFIX.

## HOTFIX RULES (CRITICAL)

1. **MINIMAL CHANGE ONLY**: Change only what's absolutely necessary to fix the issue
2. **NO REFACTORING**: Do not clean up code, rename variables, or improve structure
3. **MAX ${this.safetyRules.maxFiles} FILES**: You can only modify: ${taskContract.fileScope.join(", ") || "specified files"}
4. **NO NEW DEPENDENCIES**: Do not add new libraries or frameworks
5. **TEST THE FIX**: Verify the fix works before submitting

## Rollback Plan Required

You must provide a rollback plan with:
- Exact steps to revert the change
- Estimated time to rollback
- Verification command to confirm rollback worked

## Task

${taskContract.objective}

Acceptance Checks:
${taskContract.acceptanceChecks.map((c) => `- ${c}`).join("\n")}

Remember: In a hotfix, SAFETY > CLEANLINESS. We can clean up later.`
  }

  private validateSafetyRules(artifact: WorkArtifact): void {
    const violations: string[] = []

    // Check file count
    if (artifact.changedFiles.length > this.safetyRules.maxFiles) {
      violations.push(
        `Changed ${artifact.changedFiles.length} files, max allowed: ${this.safetyRules.maxFiles}`
      )
    }

    // Check for refactoring indicators in summary
    const refactoringKeywords = ["refactor", "cleanup", "reorganize", "rename", "move", "extract"]
    const summary = artifact.summary.toLowerCase()
    for (const keyword of refactoringKeywords) {
      if (summary.includes(keyword)) {
        violations.push(`Possible refactoring detected: "${keyword}" in summary`)
        break
      }
    }

    if (violations.length > 0) {
      throw new Error(`Hotfix safety violation: ${violations.join("; ")}`)
    }
  }

  private checkSafetyGate(review: ReviewArtifact): { passed: boolean; reasons: string[] } {
    const reasons: string[] = []

    // Check for critical severity
    if (review.severity === "P0") {
      reasons.push("P0 issues must be resolved before hotfix")
    }

    // Check for unresolved must-fix items
    if (review.mustFix.length > 0) {
      reasons.push(`Must fix items: ${review.mustFix.join(", ")}`)
    }

    // Check rollback plan exists
    if (this.safetyRules.requireRollbackPlan && !this.state.rollbackPlan) {
      reasons.push("Rollback plan is required")
    }

    return {
      passed: reasons.length === 0,
      reasons,
    }
  }

  private extractRollbackPlan(review: ReviewArtifact): RollbackPlan | undefined {
    // Try to extract rollback plan from review notes or suggestions
    const text = [...review.suggestions, review.mustFix.join(" ")].join(" ")

    // Simple extraction - in real implementation, this would be more sophisticated
    const hasRollback = /rollback|revert|undo/i.test(text)

    if (!hasRollback) {
      return undefined
    }

    return {
      steps: [
        "Identify the commit to revert",
        "Run: git revert <commit-hash>",
        "Verify rollback with test suite",
        "Deploy rollback to production",
      ],
      estimatedTime: "5-10 minutes",
      verificationCommand: "npm test",
      automated: false,
    }
  }

  private createDefaultTask(): TaskContract {
    return createDefaultTaskContract(
      `hotfix-${Date.now()}`,
      "Fix critical production issue",
      [],
      ["npm test", "verify fix in staging"]
    )
  }

  private handleTimeout(): void {
    this.state.phase = "failed"
    this.state.error = "Hotfix timeout - emergency fixes must be quick"
    this.blackboard?.emit("status-changed", "timeout", "running")
    this.abortController?.abort()
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createHotfixGuardrailMode(): ModeRunner {
  return new HotfixGuardrailMode()
}
