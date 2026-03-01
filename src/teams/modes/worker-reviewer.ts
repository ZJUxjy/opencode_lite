/**
 * Worker-Reviewer Collaboration Mode
 *
 * Simplest collaboration pattern:
 * - Worker produces work (code changes)
 * - Reviewer checks quality and approves or requests changes
 * - Loops until approved or max iterations reached
 */

import { BaseModeRunner, type TeamResult } from "./base.js"
import type { TeamConfig, TeamState, TaskContract, WorkArtifact } from "../core/types.js"
import type { ReviewArtifact } from "../core/contracts.js"

export interface WorkerOutput {
  summary: string
  changedFiles: string[]
  patchRef: string
  testResults: Array<{ command: string; passed: boolean }>
  risks: string[]
  assumptions: string[]
}

export interface ReviewerOutput {
  status: "approved" | "changes_requested"
  severity: "P0" | "P1" | "P2" | "P3"
  mustFix: string[]
  suggestions: string[]
}

export interface WorkerReviewerCallbacks {
  askWorker: (objective: string, contract: TaskContract) => Promise<WorkerOutput>
  askReviewer: (artifact: WorkArtifact) => Promise<ReviewerOutput>
}

export class WorkerReviewerRunner extends BaseModeRunner<string, WorkArtifact> {
  readonly mode = "worker-reviewer" as const
  private callbacks: WorkerReviewerCallbacks

  constructor(config: TeamConfig, callbacks: WorkerReviewerCallbacks) {
    super(config)
    this.callbacks = callbacks
  }

  async execute(objective: string): Promise<TeamResult<WorkArtifact>> {
    const startTime = Date.now()
    this.state.status = "running"

    const contract: TaskContract = {
      taskId: `task-${Date.now()}`,
      objective,
      fileScope: [],
      acceptanceChecks: this.config.qualityGate.requiredChecks || [],
    }

    let currentArtifact: WorkArtifact | null = null

    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
      this.state.currentIteration = iteration + 1

      // Worker executes
      const workerOutput = await this.callbacks.askWorker(objective, contract)
      currentArtifact = {
        taskId: contract.taskId,
        summary: workerOutput.summary,
        changedFiles: workerOutput.changedFiles,
        patchRef: workerOutput.patchRef,
        testResults: workerOutput.testResults,
        risks: workerOutput.risks,
        assumptions: workerOutput.assumptions,
      }

      // Reviewer checks
      const review = await this.callbacks.askReviewer(currentArtifact)

      if (review.status === "approved") {
        this.state.status = "completed"
        return {
          status: "completed",
          output: currentArtifact,
          stats: {
            durationMs: Date.now() - startTime,
            tokensUsed: this.state.tokensUsed,
            iterations: iteration + 1,
          },
        }
      }

      // Update objective for next iteration with feedback
      objective = `${objective}\n\nReviewer feedback (must fix): ${review.mustFix.join(", ")}`
    }

    // Max iterations reached without approval
    this.state.status = "failed"
    return {
      status: "failed",
      output: currentArtifact!,
      error: `Max iterations (${this.config.maxIterations}) reached without approval`,
      stats: {
        durationMs: Date.now() - startTime,
        tokensUsed: this.state.tokensUsed,
        iterations: this.config.maxIterations,
      },
    }
  }
}
