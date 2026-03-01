/**
 * Agent Teams - Team Manager
 *
 * Main controller for multi-agent collaboration.
 * Coordinates all components and manages team lifecycle.
 */

import type { TeamConfig, TeamState, TeamStatus, ModeRunner, SharedBlackboard, CostController, ProgressTracker, TaskContract } from "./types.js"
import { createBlackboard, type TeamBlackboard } from "./blackboard.js"
import { createCostController } from "./cost-controller.js"
import { createProgressTracker } from "./progress-tracker.js"
import { createWorkerReviewerMode } from "./modes/worker-reviewer.js"
import { createPlannerExecutorReviewerMode } from "./modes/planner-executor-reviewer.js"
import { createLeaderWorkersMode } from "./modes/leader-workers.js"
import { createHotfixGuardrailMode } from "./modes/hotfix-guardrail.js"
import { createCouncilMode } from "./modes/council.js"
import { createFallbackHandler, type FallbackAgentInput, type TeamFailureReport } from "./fallback.js"
import { CheckpointResumer, createCheckpointResumer } from "./checkpoint-resume.js"
import type { CheckpointResumeConfig } from "./checkpoint-resume.js"
import { CheckpointManager, createCheckpointManager } from "./checkpoint.js"

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
  private fallbackHandler: ReturnType<typeof createFallbackHandler>
  private failureReport?: TeamFailureReport
  private checkpointResumer?: CheckpointResumer
  private checkpointManager?: CheckpointManager

  constructor(options: TeamManagerOptions) {
    this.config = options.config

    // Initialize state first (needed for other components)
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

    // Initialize components
    this.blackboard = createBlackboard() as TeamBlackboard
    this.costController = createCostController({ budget: options.config.budget })
    this.progressTracker = createProgressTracker({ circuitBreaker: options.config.circuitBreaker })

    // Initialize fallback handler with a default contract (will be updated when run starts)
    this.fallbackHandler = createFallbackHandler(this.state.teamId, {
      taskId: `task-${Date.now()}`,
      objective: options.objective || "No objective specified",
      fileScope: options.fileScope || [],
      acceptanceChecks: [],
    })

    // Set initial objective and file scope
    if (options.objective) {
      this.blackboard.set("objective", options.objective)
    }
    if (options.fileScope) {
      this.blackboard.set("file-scope", options.fileScope)
    }

    // Create mode runner based on config
    this.modeRunner = this.createModeRunner(options.config.mode)

    // Initialize checkpoint manager
    this.checkpointManager = createCheckpointManager(this.state.teamId)

    // Set up event handlers
    this.setupEventHandlers()
  }

  // ========================================================================
  // Public API
  // ========================================================================

  /**
   * Run the team collaboration
   */
  async run(contract?: TaskContract): Promise<unknown> {
    this.abortController = new AbortController()

    // Update fallback handler with actual contract if provided
    if (contract) {
      this.fallbackHandler = createFallbackHandler(this.state.teamId, contract)
    }

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

      // Generate fallback report
      const fallbackInput = await this.executeFallback("failed", error instanceof Error ? error : undefined)

      // Attach fallback info to error for upstream handling
      const enhancedError = error instanceof Error ? error : new Error(String(error))
      ;(enhancedError as Error & { fallbackInput?: FallbackAgentInput }).fallbackInput = fallbackInput

      throw enhancedError
    }
  }

  /**
   * Execute fallback to single Agent when team fails
   */
  async executeFallback(
    status: TeamStatus,
    error?: Error,
    budgetStatus?: { tokens: { used: number; limit: number; percentage: number }; cost: { used: number; limit: number | null; percentage: number | null } }
  ): Promise<FallbackAgentInput> {
    const fallbackInput = await this.fallbackHandler.executeFallback(status, {
      error,
      circuitBreakerReason: this.progressTracker.getCircuitBreakerReason(),
      budgetStatus,
    })

    this.failureReport = fallbackInput.failureReport

    return fallbackInput
  }

  /**
   * Get failure report (available after fallback)
   */
  getFailureReport(): TeamFailureReport | undefined {
    return this.failureReport
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

  /**
   * Resume from a checkpoint
   */
  async resumeFromCheckpoint(
    checkpointId: string,
    strategy: CheckpointResumeConfig["strategy"] = "continue-iteration"
  ): Promise<unknown> {
    // Initialize abort controller for cancellation support
    this.abortController = new AbortController()

    if (!this.checkpointManager) {
      throw new Error("Checkpoint manager not configured")
    }

    // Load checkpoint
    const checkpoint = await this.checkpointManager.restoreCheckpoint(checkpointId)
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`)
    }

    // Initialize resumer
    this.checkpointResumer = createCheckpointResumer()

    // Build resume configuration
    const resumeConfig: CheckpointResumeConfig = {
      checkpointId,
      strategy,
      contextInjection: {
        includePreviousThinking: true,
        includePreviousArtifacts: true,
        maxContextTokens: 4000,
      },
    }

    // Resume execution
    const resumed = await this.checkpointResumer.resume(checkpoint, resumeConfig)

    // Update internal state
    this.state = resumed.teamState

    // Continue execution with resumed state
    return this.continueExecution(resumed)
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
      case "leader-workers":
        return createLeaderWorkersMode(this.config.strategy || "collaborative")
      case "hotfix-guardrail":
        return createHotfixGuardrailMode()
      case "council":
        return createCouncilMode()
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

  private async continueExecution(
    resumed: import("./checkpoint-resume.js").ResumedExecution
  ): Promise<unknown> {
    // Rebuild blackboard from resumed state
    for (const [key, value] of resumed.blackboardState) {
      this.blackboard.set(key, value)
    }

    // Restore cost controller state
    this.costController.restoreFromSnapshot(
      resumed.teamState.tokensUsed,
      resumed.teamState.costUsd
    )

    // Restore progress tracker state
    this.progressTracker.restoreFromSnapshot({
      lastProgressAt: resumed.teamState.lastProgressAt,
      consecutiveNoProgressRounds: resumed.teamState.consecutiveNoProgressRounds,
      consecutiveFailures: resumed.teamState.consecutiveFailures,
    })

    // Log resume event
    this.blackboard.logEvent("resumed-from-checkpoint", {
      iteration: resumed.teamState.currentIteration,
      strategy: resumed.resumeStrategy,
      pendingTasks: resumed.pendingTasks,
    })

    // Continue with normal execution
    return this.run()
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createTeamManager(options: TeamManagerOptions): TeamManager {
  return new TeamManager(options)
}
