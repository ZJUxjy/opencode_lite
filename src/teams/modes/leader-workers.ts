/**
 * Leader-Workers Collaboration Mode
 *
 * A collaboration pattern where:
 * - Leader decomposes the objective into subtasks
 * - Workers execute subtasks (potentially in parallel or sequential)
 * - Leader integrates the results into final output
 *
 * Supports two strategies:
 * - collaborative: Workers share context and work together
 * - competitive: Workers work independently, leader picks best results
 */

import { BaseModeRunner, type TeamResult } from "./base.js"
import type { TeamConfig, WorkArtifact } from "../core/types.js"

// ============================================================================
// SubTask Definition
// ============================================================================

export interface SubTask {
  id: string
  description: string
  fileScope?: string[]
  dependencies?: string[]
}

// ============================================================================
// Leader Outputs
// ============================================================================

export interface LeaderDecomposeOutput {
  tasks: SubTask[]
}

export interface LeaderIntegrateOutput {
  integratedOutput: string
  summary?: string
}

// ============================================================================
// Worker Output
// ============================================================================

export interface WorkerOutput {
  summary: string
  changedFiles: string[]
  patchRef: string
  testResults: Array<{ command: string; passed: boolean; outputRef?: string }>
  risks: string[]
  assumptions: string[]
}

// ============================================================================
// Callbacks
// ============================================================================

export interface LeaderWorkersCallbacks {
  askLeader: (
    phase: "decompose" | "integrate",
    input: { objective: string; workerResults?: WorkerOutput[] }
  ) => Promise<LeaderDecomposeOutput | LeaderIntegrateOutput>
  askWorker: (task: SubTask) => Promise<WorkerOutput>
}

// ============================================================================
// LeaderWorkersRunner
// ============================================================================

export class LeaderWorkersRunner extends BaseModeRunner<string, WorkArtifact> {
  readonly mode = "leader-workers" as const
  private callbacks: LeaderWorkersCallbacks

  constructor(config: TeamConfig, callbacks: LeaderWorkersCallbacks) {
    super(config)
    this.callbacks = callbacks
  }

  async execute(objective: string): Promise<TeamResult<WorkArtifact>> {
    const startTime = Date.now()
    this.state.status = "running"

    try {
      // Phase 1: Leader decomposes the objective into subtasks
      this.state.currentPhase = "decompose"
      const decomposeResult = (await this.callbacks.askLeader("decompose", {
        objective,
      })) as LeaderDecomposeOutput

      const { tasks } = decomposeResult

      if (!tasks || tasks.length === 0) {
        // No subtasks, create a simple artifact
        this.state.status = "completed"
        return {
          status: "completed",
          output: {
            taskId: `task-${Date.now()}`,
            summary: "No subtasks generated",
            changedFiles: [],
            patchRef: "",
            testResults: [],
            risks: [],
            assumptions: [],
          },
          stats: {
            durationMs: Date.now() - startTime,
            tokensUsed: this.state.tokensUsed,
            iterations: 1,
          },
        }
      }

      // Phase 2: Execute workers for each subtask
      this.state.currentPhase = "execute"
      const workerResults = await this.executeWorkers(tasks)

      // Phase 3: Leader integrates the results
      this.state.currentPhase = "integrate"
      const integrateResult = (await this.callbacks.askLeader("integrate", {
        objective,
        workerResults,
      })) as LeaderIntegrateOutput

      // Build final artifact
      const finalArtifact: WorkArtifact = {
        taskId: `task-${Date.now()}`,
        summary: integrateResult.summary || integrateResult.integratedOutput,
        changedFiles: workerResults.flatMap((r) => r.changedFiles),
        patchRef: workerResults.map((r) => r.patchRef).filter(Boolean).join(","),
        testResults: workerResults.flatMap((r) => r.testResults),
        risks: workerResults.flatMap((r) => r.risks),
        assumptions: workerResults.flatMap((r) => r.assumptions),
      }

      this.state.status = "completed"
      return {
        status: "completed",
        output: finalArtifact,
        stats: {
          durationMs: Date.now() - startTime,
          tokensUsed: this.state.tokensUsed,
          iterations: 1,
        },
      }
    } catch (error) {
      this.state.status = "failed"
      return {
        status: "failed",
        output: {
          taskId: `task-${Date.now()}`,
          summary: "Execution failed",
          changedFiles: [],
          patchRef: "",
          testResults: [],
          risks: [],
          assumptions: [],
        },
        error: error instanceof Error ? error.message : String(error),
        stats: {
          durationMs: Date.now() - startTime,
          tokensUsed: this.state.tokensUsed,
          iterations: this.state.currentIteration,
        },
      }
    }
  }

  /**
   * Execute workers based on the strategy (parallel or sequential)
   */
  private async executeWorkers(tasks: SubTask[]): Promise<WorkerOutput[]> {
    const strategy = this.config.strategy || "collaborative"
    const parallelStrategy = this.config.parallelStrategy?.mode || "sequential"

    // Determine execution mode based on strategy and parallel configuration
    if (parallelStrategy === "parallel" || (strategy === "collaborative" && parallelStrategy !== "sequential")) {
      // Execute in parallel
      return Promise.all(tasks.map((task) => this.callbacks.askWorker(task)))
    } else {
      // Execute sequentially
      const results: WorkerOutput[] = []
      for (const task of tasks) {
        const result = await this.callbacks.askWorker(task)
        results.push(result)
      }
      return results
    }
  }
}
