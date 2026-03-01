/**
 * Agent Teams - Planner-Executor-Reviewer Mode
 *
 * Three-role mode for tasks with unclear requirements.
 * Planner clarifies requirements and outputs TaskContract.
 * Executor implements according to the contract.
 * Reviewer validates against the contract.
 */

import type { ModeRunner, TeamConfig, SharedBlackboard, CostController, ProgressTracker } from "../types.js"
import type { TaskContract, WorkArtifact, ReviewArtifact } from "../contracts.js"
import { createDefaultTaskContract, validateTaskContract, meetsQualityGate } from "../contracts.js"

// ============================================================================
// Planner-Executor-Reviewer State
// ============================================================================

interface PlannerExecutorReviewerState {
  phase: "idle" | "planning" | "executing" | "reviewing" | "completed" | "failed"
  iteration: number
  taskContract?: TaskContract
  workArtifact?: WorkArtifact
  reviewArtifact?: ReviewArtifact
  error?: string
}

// ============================================================================
// Planner-Executor-Reviewer Mode Runner
// ============================================================================

export class PlannerExecutorReviewerMode implements ModeRunner {
  readonly mode = "planner-executor-reviewer" as const

  private config?: TeamConfig
  private blackboard?: SharedBlackboard
  private costController?: CostController
  private progressTracker?: ProgressTracker
  private state: PlannerExecutorReviewerState = {
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

    // Get role configs
    const plannerConfig = config.agents.find((a) => a.role === "planner")
    const executorConfig = config.agents.find((a) => a.role === "executor")
    const reviewerConfig = config.agents.find((a) => a.role === "reviewer")

    if (!plannerConfig || !executorConfig || !reviewerConfig) {
      throw new Error("Planner-Executor-Reviewer mode requires exactly one planner, one executor, and one reviewer")
    }

    // Get initial objective from blackboard
    const initialObjective = blackboard.get<string>("objective") ?? "Complete the assigned task"
    const initialFileScope = blackboard.get<string[]>("file-scope") ?? []

    // Set timeout
    this.timeoutId = setTimeout(() => {
      this.handleTimeout()
    }, config.timeoutMs)

    try {
      blackboard.emit("status-changed", "running", "initializing")

      // Phase 1: Planner creates TaskContract
      this.state.phase = "planning"
      blackboard.emit("iteration-started", 0, plannerConfig.role, "planner")

      const taskContract = await this.runPlanner(
        plannerConfig.model,
        initialObjective,
        initialFileScope
      )
      this.state.taskContract = taskContract
      blackboard.setTaskContract(taskContract)

      // Record cost for planning phase
      costController.recordUsage(1500, 800, plannerConfig.model)

      // Main iteration loop (Executor + Reviewer)
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

        // Phase 2: Executor implements
        this.state.phase = "executing"
        blackboard.emit("iteration-started", iteration, executorConfig.role, "executor")

        const workArtifact = await this.runExecutor(
          executorConfig.model,
          taskContract,
          iteration
        )
        this.state.workArtifact = workArtifact
        blackboard.setWorkArtifact("executor", workArtifact)

        progressTracker.recordCodeChange(workArtifact.changedFiles.length)

        // Phase 3: Reviewer validates
        this.state.phase = "reviewing"
        blackboard.emit("iteration-started", iteration, reviewerConfig.role, "reviewer")

        const reviewArtifact = await this.runReviewer(
          reviewerConfig.model,
          taskContract,
          workArtifact
        )
        this.state.reviewArtifact = reviewArtifact
        blackboard.setReviewArtifact("reviewer", reviewArtifact)

        // Check quality gate
        const gateResult = meetsQualityGate(reviewArtifact, config.qualityGate)

        if (gateResult.passed && reviewArtifact.status === "approved") {
          this.state.phase = "completed"
          blackboard.emit("progress-detected", "review")
          blackboard.emit("completed", workArtifact)
          return workArtifact
        }

        // Not approved - record issues
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

  private async runPlanner(
    model: string,
    objective: string,
    fileScope: string[]
  ): Promise<TaskContract> {
    if (!this.blackboard || !this.costController) {
      throw new Error("Not initialized")
    }

    // In real implementation, this would call the LLM to:
    // 1. Analyze the objective
    // 2. Clarify requirements
    // 3. Define file scope
    // 4. Specify acceptance criteria

    const taskContract: TaskContract = {
      taskId: `task-${Date.now()}`,
      objective,
      fileScope: fileScope.length > 0 ? fileScope : ["src/"],
      acceptanceChecks: ["npm test", "npm run build"],
    }

    this.blackboard.postMessage(
      { type: "task-assign", task: taskContract },
      "system",
      "planner"
    )

    return taskContract
  }

  private async runExecutor(
    model: string,
    taskContract: TaskContract,
    iteration: number
  ): Promise<WorkArtifact> {
    if (!this.blackboard || !this.costController) {
      throw new Error("Not initialized")
    }

    this.blackboard.postMessage(
      { type: "task-assign", task: taskContract },
      "system",
      "executor"
    )

    const artifact: WorkArtifact = {
      taskId: taskContract.taskId,
      summary: `Implementation iteration ${iteration} based on contract`,
      changedFiles: [],
      patchRef: `iteration-${iteration}`,
      testResults: [],
      risks: [],
      assumptions: [],
    }

    this.costController.recordUsage(1200, 600, model)

    this.blackboard.postMessage(
      { type: "task-result", artifact },
      "executor",
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

    this.blackboard.postMessage(
      { type: "review-request", artifact: workArtifact },
      "system",
      "reviewer"
    )

    // Validate against contract
    const review: ReviewArtifact = {
      status: "changes_requested",
      severity: "P1",
      mustFix: ["Implementation incomplete - contract validation pending"],
      suggestions: ["Complete implementation according to contract"],
    }

    this.costController.recordUsage(900, 450, model)

    this.blackboard.postMessage(
      { type: "review-result", review },
      "reviewer",
      "system"
    )

    return review
  }

  private handleTimeout(): void {
    this.state.phase = "failed"
    this.state.error = "Timeout"
    this.blackboard?.emit("status-changed", "timeout", "running")
    this.abortController?.abort()
  }

  getState(): PlannerExecutorReviewerState {
    return { ...this.state }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createPlannerExecutorReviewerMode(): ModeRunner {
  return new PlannerExecutorReviewerMode()
}
