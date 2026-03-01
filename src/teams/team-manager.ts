/**
 * Agent Teams - Team Manager
 *
 * Main controller for multi-agent collaboration.
 * Coordinates all components and manages team lifecycle.
 */

import type { TeamConfig, TeamState, TeamStatus, ModeRunner, SharedBlackboard, CostController, ProgressTracker } from "./types.js"
import { createBlackboard, type TeamBlackboard } from "./blackboard.js"
import { createCostController } from "./cost-controller.js"
import { createProgressTracker } from "./progress-tracker.js"
import { createWorkerReviewerMode } from "./modes/worker-reviewer.js"
import { createPlannerExecutorReviewerMode } from "./modes/planner-executor-reviewer.js"

// ============================================================================
// Team Manager Options
// ============================================================================

export interface TeamManagerOptions {
  config: TeamConfig
  objective?: string
  fileScope?: string[]
}

// ============================================================================
// Team Manager
// ============================================================================

export class TeamManager {
  private config: TeamConfig
  private blackboard: TeamBlackboard
  private costController: CostController
  private progressTracker: ProgressTracker
  private modeRunner: ModeRunner
  private state: TeamState
  private abortController?: AbortController

  constructor(options: TeamManagerOptions) {
    this.config = options.config

    // Initialize components
    this.blackboard = createBlackboard() as TeamBlackboard
    this.costController = createCostController({ budget: options.config.budget })
    this.progressTracker = createProgressTracker({ circuitBreaker: options.config.circuitBreaker })

    // Set initial objective and file scope
    if (options.objective) {
      this.blackboard.set("objective", options.objective)
    }
    if (options.fileScope) {
      this.blackboard.set("file-scope", options.fileScope)
    }

    // Create mode runner based on config
    this.modeRunner = this.createModeRunner(options.config.mode)

    // Initialize state
    this.state = {
      teamId: `team-${Date.now()}`,
      mode: options.config.mode,
      status: "initializing",
      currentIteration: 0,
      startTime: Date.now(),
      tokensUsed: { input: 0, output: 0 },
      costUsd: 0,
      lastProgressAt: Date.now(),
      consecutiveNoProgressRounds: 0,
      consecutiveFailures: 0,
    }

    // Set up event handlers
    this.setupEventHandlers()
  }

  // ========================================================================
  // Public API
  // ========================================================================

  /**
   * Run the team collaboration
   */
  async run(): Promise<unknown> {
    this.abortController = new AbortController()

    try {
      this.updateState({ status: "running" })

      const result = await this.modeRunner.run(
        this.config,
        this.blackboard,
        this.costController,
        this.progressTracker
      )

      this.updateState({ status: "completed", endTime: Date.now() })
      return result
    } catch (error) {
      this.updateState({
        status: "failed",
        endTime: Date.now(),
      })
      throw error
    }
  }

  /**
   * Cancel the team run
   */
  cancel(): void {
    this.modeRunner.cancel()
    this.updateState({ status: "cancelled", endTime: Date.now() })
  }

  /**
   * Get current state
   */
  getState(): TeamState {
    return { ...this.state }
  }

  /**
   * Get status
   */
  getStatus(): TeamStatus {
    return this.state.status
  }

  /**
   * Get blackboard for inspection
   */
  getBlackboard(): SharedBlackboard {
    return this.blackboard
  }

  /**
   * Get cost status
   */
  getCostStatus(): ReturnType<CostController["getBudgetStatus"]> {
    return this.costController.getBudgetStatus()
  }

  /**
   * Get progress stats
   */
  getProgressStats(): ReturnType<ProgressTracker["getStats"]> {
    return this.progressTracker.getStats()
  }

  // ========================================================================
  // Private Methods
  // ========================================================================

  private createModeRunner(mode: TeamConfig["mode"]): ModeRunner {
    switch (mode) {
      case "worker-reviewer":
        return createWorkerReviewerMode()
      case "planner-executor-reviewer":
        return createPlannerExecutorReviewerMode()
      default:
        throw new Error(`Mode '${mode}' not implemented yet`)
    }
  }

  private setupEventHandlers(): void {
    // Forward blackboard events to update state
    this.blackboard.on("status-changed", (status) => {
      this.updateState({ status })
    })

    this.blackboard.on("iteration-started", (iteration, agent, role) => {
      this.updateState({
        currentIteration: iteration,
        currentPhase: role,
        currentAgent: agent,
      })
    })

    this.blackboard.on("cost-updated", (tokens, cost) => {
      this.updateState({
        tokensUsed: {
          input: this.state.tokensUsed.input + tokens.input,
          output: this.state.tokensUsed.output + tokens.output,
        },
        costUsd: cost,
      })
    })

    this.blackboard.on("progress-detected", () => {
      this.updateState({
        lastProgressAt: Date.now(),
        consecutiveNoProgressRounds: 0,
      })
    })

    this.blackboard.on("no-progress", (rounds) => {
      this.updateState({
        consecutiveNoProgressRounds: rounds,
      })
    })

    this.blackboard.on("circuit-breaker", () => {
      this.updateState({
        consecutiveFailures: this.state.consecutiveFailures + 1,
      })
    })
  }

  private updateState(updates: Partial<TeamState>): void {
    this.state = { ...this.state, ...updates }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createTeamManager(options: TeamManagerOptions): TeamManager {
  return new TeamManager(options)
}
