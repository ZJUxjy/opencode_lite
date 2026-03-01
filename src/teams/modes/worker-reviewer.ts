/**
 * Agent Teams - Worker-Reviewer Mode
 *
 * MVP mode: Worker implements, Reviewer reviews, iterate until approved or limits reached.
 */

import type { ModeRunner, TeamConfig, SharedBlackboard, CostController, ProgressTracker, AgentMessage } from "../types.js"
import type { TaskContract, WorkArtifact, ReviewArtifact } from "../contracts.js"
import { createDefaultTaskContract, createEmptyWorkArtifact, validateWorkArtifact, validateReviewArtifact, meetsQualityGate } from "../contracts.js"

// ============================================================================
// Worker-Reviewer State
// ============================================================================

interface WorkerReviewerState {
  phase: "idle" | "working" | "reviewing" | "completed" | "failed"
  iteration: number
  taskContract?: TaskContract
  workArtifact?: WorkArtifact
  reviewArtifact?: ReviewArtifact
  error?: string
}

// ============================================================================
// Worker-Reviewer Mode Runner
// ============================================================================

export class WorkerReviewerMode implements ModeRunner {
  readonly mode = "worker-reviewer" as const

  private config?: TeamConfig
  private blackboard?: SharedBlackboard
  private costController?: CostController
  private progressTracker?: ProgressTracker
  private state: WorkerReviewerState = {
    phase: "idle",
    iteration: 0,
  }
  private abortController?: AbortController
  private timeoutId?: ReturnType<typeof setTimeout>

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

    // Get worker and reviewer configs
    const workerConfig = config.agents.find((a) => a.role === "worker")
    const reviewerConfig = config.agents.find((a) => a.role === "reviewer")

    if (!workerConfig || !reviewerConfig) {
      throw new Error("Worker-Reviewer mode requires exactly one worker and one reviewer")
    }

    // Get task from blackboard or create default
    const taskContract = blackboard.getTaskContract() ?? this.createDefaultTask()
    this.state.taskContract = taskContract
    blackboard.setTaskContract(taskContract)

    // Set timeout
    this.timeoutId = setTimeout(() => {
      this.handleTimeout()
    }, config.timeoutMs)

    try {
      blackboard.emit("status-changed", "running", "initializing")

      // Main iteration loop
      for (let iteration = 1; iteration <= config.maxIterations; iteration++) {
        this.state.iteration = iteration

        // Check for cancellation
        if (this.abortController.signal.aborted) {
          throw new Error("Cancelled")
        }

        // Check circuit breaker
        if (progressTracker.shouldCircuitBreak()) {
          const reason = progressTracker.getCircuitBreakerReason()
          blackboard.emit("circuit-breaker", reason ?? "Unknown")
          throw new Error(`Circuit breaker triggered: ${reason}`)
        }

        // Check budget
        if (costController.isBudgetExceeded()) {
          throw new Error("Budget exceeded")
        }

        // Phase 1: Worker implements
        blackboard.emit("iteration-started", iteration, workerConfig.role, "worker")
        this.state.phase = "working"

        const workArtifact = await this.runWorker(workerConfig.model, taskContract, iteration)
        this.state.workArtifact = workArtifact
        blackboard.setWorkArtifact("worker", workArtifact)

        // Record progress
        progressTracker.recordCodeChange(workArtifact.changedFiles.length)

        // Phase 2: Reviewer reviews
        blackboard.emit("iteration-started", iteration, reviewerConfig.role, "reviewer")
        this.state.phase = "reviewing"

        const reviewArtifact = await this.runReviewer(reviewerConfig.model, taskContract, workArtifact)
        this.state.reviewArtifact = reviewArtifact
        blackboard.setReviewArtifact("reviewer", reviewArtifact)

        // Check quality gate
        const gateResult = meetsQualityGate(reviewArtifact, config.qualityGate)

        if (gateResult.passed && reviewArtifact.status === "approved") {
          // Success!
          this.state.phase = "completed"
          blackboard.emit("progress-detected", "review")
          blackboard.emit("completed", workArtifact)
          return workArtifact
        }

        // Not approved - record issues and continue
        for (const issue of reviewArtifact.mustFix) {
          progressTracker.recordReviewIssue(reviewArtifact.severity)
        }

        // Check progress
        const hasProgress = progressTracker.checkProgress()
        if (!hasProgress) {
          const noProgressRounds = progressTracker.getConsecutiveNoProgressRounds()
          blackboard.emit("no-progress", noProgressRounds)

          if (noProgressRounds >= config.circuitBreaker.maxNoProgressRounds) {
            throw new Error(`No progress for ${noProgressRounds} consecutive rounds`)
          }
        }

        blackboard.emit("iteration-completed", iteration, { workArtifact, reviewArtifact })
      }

      // Max iterations reached without approval
      throw new Error(`Max iterations (${config.maxIterations}) reached without approval`)
    } catch (error) {
      this.state.phase = "failed"
      this.state.error = error instanceof Error ? error.message : String(error)
      blackboard.emit("error", error instanceof Error ? error : new Error(String(error)))
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

  // ========================================================================
  // Private Methods
  // ========================================================================

  private async runWorker(
    model: string,
    taskContract: TaskContract,
    iteration: number
  ): Promise<WorkArtifact> {
    if (!this.blackboard || !this.costController) {
      throw new Error("Not initialized")
    }

    // Post task assignment message
    this.blackboard.postMessage(
      {
        type: "task-assign",
        task: taskContract,
      },
      "system",
      "worker"
    )

    // In real implementation, this would call the LLM
    // For now, return a placeholder that indicates the structure
    const artifact: WorkArtifact = {
      taskId: taskContract.taskId,
      summary: `Implementation iteration ${iteration}`,
      changedFiles: [], // Would be populated by actual implementation
      patchRef: `iteration-${iteration}`,
      testResults: [],
      risks: [],
      assumptions: [],
    }

    // Record cost (placeholder - would use actual token counts)
    this.costController.recordUsage(1000, 500, model)

    this.blackboard.postMessage(
      {
        type: "task-result",
        artifact,
      },
      "worker",
      "system"
    )

    return artifact
  }

  private async runReviewer(
    model: string,
    taskContract: TaskContract,
    workArtifact: WorkArtifact
  ): Promise<ReviewArtifact> {
    if (!this.blackboard || !this.costController) {
      throw new Error("Not initialized")
    }

    // Post review request message
    this.blackboard.postMessage(
      {
        type: "review-request",
        artifact: workArtifact,
      },
      "system",
      "reviewer"
    )

    // In real implementation, this would call the LLM
    // For now, return a placeholder review
    const review: ReviewArtifact = {
      status: "changes_requested",
      severity: "P1",
      mustFix: ["Implementation incomplete - this is a placeholder"],
      suggestions: ["Complete the implementation"],
    }

    // Record cost (placeholder)
    this.costController.recordUsage(800, 400, model)

    this.blackboard.postMessage(
      {
        type: "review-result",
        review,
      },
      "reviewer",
      "system"
    )

    return review
  }

  private createDefaultTask(): TaskContract {
    return createDefaultTaskContract(
      `task-${Date.now()}`,
      "Complete the assigned task",
      [],
      ["npm test"]
    )
  }

  private handleTimeout(): void {
    this.state.phase = "failed"
    this.state.error = "Timeout"
    this.blackboard?.emit("status-changed", "timeout", "running")
    this.abortController?.abort()
  }

  getState(): WorkerReviewerState {
    return { ...this.state }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createWorkerReviewerMode(): ModeRunner {
  return new WorkerReviewerMode()
}
