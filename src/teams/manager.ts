import { TeamFallbackService } from "./fallback.js"
import { WorkerReviewerMode } from "./modes/worker-reviewer.js"
import { PlannerExecutorReviewerMode } from "./modes/planner-executor-reviewer.js"
import { LeaderWorkersMode } from "./modes/leader-workers.js"
import { HotfixGuardrailMode } from "./modes/hotfix-guardrail.js"
import { CouncilMode } from "./modes/council.js"
import { CostController } from "./cost-controller.js"
import { ProgressTracker } from "./progress-tracker.js"
import { TeamRunStore } from "./team-run-store.js"
import { ArtifactStore } from "./artifact-store.js"
import { CheckpointStore } from "./checkpoint-store.js"
import { RubricEvaluator } from "./evaluator.js"
import type {
  BaselineBatchSummary,
  BaselineComparison,
  LeaderWorkersStrategy,
  TeamConfig,
  TeamExecutionResult,
  TeamMode,
  TeamRuntimeStatus,
  TeamStatus,
} from "./types.js"
import type { Checkpoint } from "./checkpoint-store.js"

export interface TeamCallbacks {
  askWorker: (prompt: string, workerIndex?: number) => Promise<{ output: string; tokensUsed: number }>
  askReviewer: (prompt: string) => Promise<{ output: string; tokensUsed: number }>
  askJudge?: (prompt: string) => Promise<{ output: string; tokensUsed: number }>
  askPlanner?: (prompt: string) => Promise<{ output: string; tokensUsed: number }>
  askExecutor?: (prompt: string) => Promise<{ output: string; tokensUsed: number }>
  askLeader?: (prompt: string) => Promise<{ output: string; tokensUsed: number }>
  runFallbackSingleAgent: (prompt: string) => Promise<{ output: string; tokensUsed: number }>
  runQualityCheck?: (command: string) => Promise<boolean>
}

export const defaultTeamConfig: TeamConfig = {
  mode: "worker-reviewer",
  strategy: "collaborative",
  agents: [
    { role: "worker", model: "claude-sonnet-4" },
    { role: "reviewer", model: "claude-sonnet-4" },
  ],
  maxIterations: 3,
  timeoutMs: 30 * 60 * 1000,
  qualityGate: {
    testsMustPass: true,
    noP0Issues: true,
  },
  circuitBreaker: {
    maxConsecutiveFailures: 3,
    maxNoProgressRounds: 2,
    cooldownMs: 60_000,
  },
  conflictResolution: "manual",
  budget: {
    maxTokens: 200_000,
    maxCostUsd: 1,
    maxParallelAgents: 2,
  },
}

export class TeamManager {
  private enabled = false
  private status: TeamStatus = "initializing"
  private readonly fallbackService = new TeamFallbackService()
  private readonly progressTracker = new ProgressTracker()
  private consecutiveFailures = 0
  private noProgressRuns = 0
  private circuitOpenUntil = 0
  private readonly rubricEvaluator = new RubricEvaluator()

  constructor(
    private config: TeamConfig = defaultTeamConfig,
    private readonly teamRunStore?: TeamRunStore,
    private readonly artifactStore?: ArtifactStore,
    private readonly checkpointStore?: CheckpointStore
  ) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.status = enabled ? "running" : "initializing"
  }

  isEnabled(): boolean {
    return this.enabled
  }

  setMode(mode: TeamMode, strategy?: LeaderWorkersStrategy): void {
    this.config = {
      ...this.config,
      mode,
      strategy: strategy || this.config.strategy || "collaborative",
    }
  }

  getMode(): { mode: TeamMode; strategy?: LeaderWorkersStrategy } {
    return { mode: this.config.mode, strategy: this.config.strategy }
  }

  getStatus(): TeamRuntimeStatus {
    return {
      enabled: this.enabled,
      mode: this.config.mode,
      status: this.status,
    }
  }

  getProgressTracker(): ProgressTracker {
    return this.progressTracker
  }

  listCheckpoints(limit = 20): Checkpoint[] {
    if (!this.checkpointStore) return []
    return this.checkpointStore.list().slice(0, Math.max(1, limit))
  }

  async resumeFromCheckpoint(
    checkpointId: string,
    strategy: "restart-task" | "continue-iteration" | "skip-completed",
    callbacks: TeamCallbacks
  ): Promise<TeamExecutionResult> {
    if (!this.checkpointStore) {
      throw new Error("Checkpoint store is not configured")
    }

    const checkpoint = this.checkpointStore.get(checkpointId)
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`)
    }
    if (!checkpoint.context) {
      throw new Error(`Checkpoint has no resumable context: ${checkpointId}`)
    }

    this.setMode(checkpoint.context.mode, this.config.strategy)
    const resumeTask = this.buildResumeTask(checkpoint.context, strategy)
    return this.runTask(resumeTask, callbacks)
  }

  async runTask(task: string, callbacks: TeamCallbacks): Promise<TeamExecutionResult> {
    switch (this.config.mode) {
      case "worker-reviewer":
        return this.runWithMode(task, callbacks, async () => {
          const mode = new WorkerReviewerMode(this.config)
          return mode.run(task, {
            askWorker: (prompt) => callbacks.askWorker(prompt, 0),
            askReviewer: callbacks.askReviewer,
          })
        })

      case "planner-executor-reviewer":
        return this.runWithMode(task, callbacks, async () => {
          const mode = new PlannerExecutorReviewerMode(this.config)
          return mode.run(task, {
            askPlanner: callbacks.askPlanner || ((prompt) => callbacks.askWorker(prompt, 0)),
            askExecutor: callbacks.askExecutor || ((prompt) => callbacks.askWorker(prompt, 0)),
            askReviewer: callbacks.askReviewer,
          })
        })

      case "leader-workers":
        return this.runWithMode(task, callbacks, async () => {
          const mode = new LeaderWorkersMode(this.config)
          return mode.run(task, {
            askLeader: callbacks.askLeader || ((prompt) => callbacks.askReviewer(prompt)),
            askWorker: (prompt, workerIndex) => callbacks.askWorker(prompt, workerIndex),
          })
        })

      case "hotfix-guardrail":
        return this.runWithMode(task, callbacks, async () => {
          const mode = new HotfixGuardrailMode(this.config)
          return mode.run(task, {
            askFixer: callbacks.askExecutor || ((prompt) => callbacks.askWorker(prompt, 0)),
            askSafetyReviewer: callbacks.askReviewer,
          })
        })

      case "council":
        return this.runWithMode(task, callbacks, async () => {
          const mode = new CouncilMode(this.config)
          return mode.run(task, {
            askMember: (prompt, memberIndex) => callbacks.askWorker(prompt, memberIndex),
            askSpeaker: callbacks.askLeader || ((prompt) => callbacks.askReviewer(prompt)),
          })
        })

      default:
        return this.runFallback("failed", task, callbacks, `Mode '${this.config.mode}' is not implemented yet`)
    }
  }

  private async runWithMode(
    task: string,
    callbacks: TeamCallbacks,
    executor: () => Promise<{
      status: "success" | "failure"
      output: string
      reviewRounds: number
      mustFixCount: number
      p0Count: number
      tokensUsed: number
      error?: string
    }>
  ): Promise<TeamExecutionResult> {
    const startedAt = Date.now()

    if (Date.now() < this.circuitOpenUntil) {
      const fallback = await this.runFallback("circuit_open", task, callbacks, "Circuit breaker open")
      this.persistRun(task, fallback, "circuit_open")
      return fallback
    }

    const costController = new CostController(this.config.budget)

    try {
      this.status = "running"
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error("Team execution timeout")), this.config.timeoutMs)
      })
      const result = await Promise.race([executor(), timeoutPromise]).finally(() => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle)
        }
      })

      costController.recordTokens(result.tokensUsed, "claude-sonnet-4")

      if (result.status === "failure") {
        throw new Error(result.error || "Team mode failed")
      }

      const qualityError = await this.checkQualityGate(result, callbacks)
      if (qualityError) {
        throw new Error(qualityError)
      }

      const judgeError = await this.checkRubricGate(task, result, callbacks)
      if (judgeError) {
        throw new Error(judgeError)
      }

      if (this.isNoProgress(result)) {
        this.noProgressRuns += 1
      } else {
        this.noProgressRuns = 0
      }

      if (this.noProgressRuns >= this.config.circuitBreaker.maxNoProgressRounds) {
        this.openCircuit()
        return this.runFallback("circuit_open", task, callbacks, "No-progress threshold exceeded")
      }

      this.consecutiveFailures = 0
      this.status = "completed"

      const stats = costController.getStats()
      const execution: TeamExecutionResult = {
        status: "success",
        output: result.output,
        reviewRounds: result.reviewRounds,
        mustFixCount: result.mustFixCount,
        p0Count: result.p0Count,
        stats: {
          durationMs: Date.now() - startedAt,
          iterations: result.reviewRounds,
          tokensUsed: stats.tokensUsed,
          estimatedCostUsd: stats.estimatedCostUsd,
        },
      }

      this.progressTracker.addRecord({
        mode: this.config.mode,
        task,
        durationMs: execution.stats.durationMs,
        tokensUsed: execution.stats.tokensUsed,
        mustFixCount: execution.mustFixCount,
        p0Count: execution.p0Count,
        reviewRounds: execution.reviewRounds,
      })

      this.persistRun(task, execution)

      return execution
    } catch (error) {
      this.status = error instanceof Error && error.message.includes("timeout") ? "timeout" : "failed"
      this.consecutiveFailures += 1

      if (this.consecutiveFailures >= this.config.circuitBreaker.maxConsecutiveFailures) {
        this.openCircuit()
      }

      const reason =
        error instanceof Error && error.message.includes("budget")
          ? "budget_exceeded"
          : error instanceof Error && error.message.includes("timeout")
            ? "timeout"
            : this.consecutiveFailures >= this.config.circuitBreaker.maxConsecutiveFailures
              ? "circuit_open"
              : "failed"

      const fallback = await this.runFallback(
        reason,
        task,
        callbacks,
        error instanceof Error ? error.message : String(error)
      )
      this.persistRun(task, fallback, reason)
      return fallback
    }
  }

  addBaseline(comparison: BaselineComparison): void {
    this.progressTracker.addBaseline(comparison)
  }

  summarizeBaselines(comparisons: BaselineComparison[]): BaselineBatchSummary {
    const sampleSize = comparisons.length
    if (sampleSize === 0) {
      return {
        sampleSize: 0,
        single: {
          avgTokens: 0,
          p50Tokens: 0,
          p90Tokens: 0,
          avgDurationMs: 0,
          p50DurationMs: 0,
          p90DurationMs: 0,
        },
        team: {
          avgTokens: 0,
          p50Tokens: 0,
          p90Tokens: 0,
          avgDurationMs: 0,
          p50DurationMs: 0,
          p90DurationMs: 0,
          avgReviewRounds: 0,
          avgMustFixCount: 0,
          avgP0Count: 0,
          fallbackRate: 0,
        },
      }
    }

    const singleTokens = comparisons.map((c) => c.single.tokensUsed)
    const singleDurations = comparisons.map((c) => c.single.durationMs)
    const teamTokens = comparisons.map((c) => c.team.tokensUsed)
    const teamDurations = comparisons.map((c) => c.team.durationMs)
    const teamRounds = comparisons.map((c) => c.team.reviewRounds)
    const teamMustFix = comparisons.map((c) => c.team.mustFixCount)
    const teamP0 = comparisons.map((c) => c.team.p0Count)
    const fallbackCount = comparisons.filter((c) => c.team.fallbackUsed).length

    return {
      sampleSize,
      single: {
        avgTokens: this.avg(singleTokens),
        p50Tokens: this.percentile(singleTokens, 50),
        p90Tokens: this.percentile(singleTokens, 90),
        avgDurationMs: this.avg(singleDurations),
        p50DurationMs: this.percentile(singleDurations, 50),
        p90DurationMs: this.percentile(singleDurations, 90),
      },
      team: {
        avgTokens: this.avg(teamTokens),
        p50Tokens: this.percentile(teamTokens, 50),
        p90Tokens: this.percentile(teamTokens, 90),
        avgDurationMs: this.avg(teamDurations),
        p50DurationMs: this.percentile(teamDurations, 50),
        p90DurationMs: this.percentile(teamDurations, 90),
        avgReviewRounds: this.avg(teamRounds),
        avgMustFixCount: this.avg(teamMustFix),
        avgP0Count: this.avg(teamP0),
        fallbackRate: Number((fallbackCount / sampleSize).toFixed(4)),
      },
    }
  }

  private async checkQualityGate(
    result: { p0Count: number },
    callbacks: TeamCallbacks
  ): Promise<string | null> {
    if (this.config.qualityGate.noP0Issues && result.p0Count > 0) {
      return "Quality gate failed: P0 issues detected"
    }

    if (this.config.qualityGate.testsMustPass && this.config.qualityGate.requiredChecks?.length) {
      for (const check of this.config.qualityGate.requiredChecks) {
        if (!callbacks.runQualityCheck) {
          return `Quality gate failed: no check runner for '${check}'`
        }

        const passed = await callbacks.runQualityCheck(check)
        if (!passed) {
          return `Quality gate failed: check '${check}' did not pass`
        }
      }
    }

    return null
  }

  private async checkRubricGate(
    task: string,
    result: { output: string },
    callbacks: TeamCallbacks
  ): Promise<string | null> {
    const rubric = this.config.evaluationRubric
    if (!rubric) return null

    const judge = callbacks.askJudge || callbacks.askReviewer
    const prompt = this.rubricEvaluator.buildJudgePrompt(rubric, task, result.output)
    const judgement = await judge(prompt)
    const parsed = this.rubricEvaluator.parseJudgeResult(judgement.output)
    if (parsed.passed && parsed.overallScore >= rubric.overallThreshold) {
      return null
    }

    return `Rubric gate failed: score=${parsed.overallScore}, threshold=${rubric.overallThreshold}`
  }

  private isNoProgress(result: { output: string }): boolean {
    return result.output.trim().length === 0
  }

  private openCircuit(): void {
    this.circuitOpenUntil = Date.now() + this.config.circuitBreaker.cooldownMs
  }

  private async runFallback(
    reason: "failed" | "timeout" | "budget_exceeded" | "circuit_open",
    task: string,
    callbacks: TeamCallbacks,
    details: string
  ): Promise<TeamExecutionResult> {
    const startedAt = Date.now()
    const failureReport = this.fallbackService.createFailureReport(
      `team-${Date.now()}`,
      reason,
      [],
      [task],
      details
    )

    const fallback = await callbacks.runFallbackSingleAgent(
      `${failureReport.recoveryPrompt}\n\nOriginal task:\n${task}`
    )

    return {
      status: "success",
      output: fallback.output,
      reviewRounds: 0,
      mustFixCount: 0,
      p0Count: 0,
      fallbackUsed: true,
      stats: {
        durationMs: Date.now() - startedAt,
        iterations: 0,
        tokensUsed: fallback.tokensUsed,
        estimatedCostUsd: 0,
      },
    }
  }

  private avg(values: number[]): number {
    if (values.length === 0) return 0
    return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2))
  }

  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
    return sorted[Math.max(0, idx)]
  }

  private persistRun(
    task: string,
    result: TeamExecutionResult,
    failureReason?: "failed" | "timeout" | "budget_exceeded" | "circuit_open"
  ): void {
    if (!this.teamRunStore && !this.artifactStore && !this.checkpointStore) return
    const status: TeamStatus = result.fallbackUsed
      ? "failed"
      : result.status === "timeout"
        ? "timeout"
        : result.status === "failure"
          ? "failed"
          : "completed"
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const createdAt = Date.now()
    this.teamRunStore?.add({
      id: runId,
      mode: this.config.mode,
      task,
      status,
      fallbackUsed: !!result.fallbackUsed,
      failureReason,
      reviewRounds: result.reviewRounds,
      mustFixCount: result.mustFixCount,
      p0Count: result.p0Count,
      tokensUsed: result.stats.tokensUsed,
      estimatedCostUsd: result.stats.estimatedCostUsd,
      durationMs: result.stats.durationMs,
      createdAt,
    })
    this.artifactStore?.writeRunArtifact({
      runId,
      mode: this.config.mode,
      task,
      status,
      fallbackUsed: !!result.fallbackUsed,
      failureReason,
      output: result.output,
      reviewRounds: result.reviewRounds,
      mustFixCount: result.mustFixCount,
      p0Count: result.p0Count,
      tokensUsed: result.stats.tokensUsed,
      estimatedCostUsd: result.stats.estimatedCostUsd,
      durationMs: result.stats.durationMs,
      createdAt,
    })
    this.checkpointStore?.create({
      description: `Run checkpoint for ${this.config.mode}`,
      baseRef: "unknown-base-ref",
      patchRefs: [],
      artifactRefs: [runId],
      blackboardSnapshotRef: `bb-${runId}`,
      context: {
        task,
        mode: this.config.mode,
        lastOutput: result.output,
        reviewRounds: result.reviewRounds,
      },
    })
  }

  private buildResumeTask(
    context: NonNullable<Checkpoint["context"]>,
    strategy: "restart-task" | "continue-iteration" | "skip-completed"
  ): string {
    if (strategy === "restart-task") {
      return context.task
    }

    if (strategy === "skip-completed") {
      if (context.pendingTasks && context.pendingTasks.length > 0) {
        return context.pendingTasks.join("\n")
      }
      return context.task
    }

    return [
      context.task,
      "Resume from previous checkpoint.",
      `Previous review rounds: ${context.reviewRounds || 0}`,
      "Previous output:",
      context.lastOutput || "(none)",
    ].join("\n")
  }
}
