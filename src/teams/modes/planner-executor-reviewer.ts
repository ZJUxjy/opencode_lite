import type { TeamConfig } from "../types.js"
import type { ReviewArtifact } from "../contracts.js"
import { TaskDagPlanner } from "../task-dag.js"
import { ConflictDetector } from "../conflict-detector.js"

interface PlannerExecutorReviewerCallbacks {
  askPlanner: (prompt: string) => Promise<{ output: string; tokensUsed: number }>
  askExecutor: (prompt: string) => Promise<{ output: string; tokensUsed: number }>
  askReviewer: (prompt: string) => Promise<{ output: string; tokensUsed: number }>
}

export interface PlannerExecutorReviewerResult {
  status: "success" | "failure"
  output: string
  reviewRounds: number
  mustFixCount: number
  p0Count: number
  tokensUsed: number
  error?: string
}

export class PlannerExecutorReviewerMode {
  private readonly dag = new TaskDagPlanner()
  private readonly conflictDetector = new ConflictDetector()

  constructor(private config: TeamConfig) {}

  async run(
    task: string,
    callbacks: PlannerExecutorReviewerCallbacks
  ): Promise<PlannerExecutorReviewerResult> {
    let totalTokensUsed = 0
    let rounds = 0
    let revisionFocus = task
    let lastOutput = ""
    let lastReview: ReviewArtifact | null = null
    let lastConflictCount = 0

    const planner = await callbacks.askPlanner(this.buildPlannerPrompt(task))
    totalTokensUsed += planner.tokensUsed
    const plan = planner.output
    const orderedTasks = this.dag.topologicalOrder(this.dag.parseOrFallback(planner.output))

    while (rounds < this.config.maxIterations) {
      rounds += 1
      const executorOutputs: string[] = []
      const changedFileGroups: string[][] = []

      for (const subtask of orderedTasks) {
        const executor = await callbacks.askExecutor(
          this.buildExecutorPrompt(task, plan, subtask.id, subtask.title, subtask.dependsOn, revisionFocus)
        )
        totalTokensUsed += executor.tokensUsed
        executorOutputs.push(`[${subtask.id}] ${executor.output}`)
        changedFileGroups.push(this.conflictDetector.extractChangedFiles(executor.output))
      }

      const conflict = this.conflictDetector.detect(changedFileGroups)
      lastConflictCount = conflict.files.length
      const executionOutput = executorOutputs.join("\n\n")
      lastOutput = executionOutput

      const reviewer = await callbacks.askReviewer(
        this.buildReviewerPrompt(task, plan, executionOutput, conflict)
      )
      totalTokensUsed += reviewer.tokensUsed
      lastReview = this.parseReview(reviewer.output)

      if (lastReview.status === "approved") {
        return {
          status: "success",
          output: executionOutput,
          reviewRounds: rounds,
          mustFixCount: 0,
          p0Count: 0,
          tokensUsed: totalTokensUsed,
        }
      }

      const conflictFixes = conflict.hasConflict
        ? [`Resolve overlapping changes for files: ${conflict.files.join(", ")}`]
        : []
      revisionFocus = this.buildRevisionTask(task, lastOutput, lastReview, conflictFixes)
    }

    const finalMustFixCount = (lastReview?.mustFix.length || 0) + lastConflictCount
    return {
      status: "failure",
      output: lastOutput,
      reviewRounds: rounds,
      mustFixCount: finalMustFixCount,
      p0Count: lastReview?.severity === "P0" ? 1 : 0,
      tokensUsed: totalTokensUsed,
      error: "Maximum planner-executor-reviewer iterations reached",
    }
  }

  private buildPlannerPrompt(task: string): string {
    return [
      "You are Planner. Build a concise implementation plan for the task.",
      "Return actionable steps and verification strategy.",
      ...(this.config.thinkingBudget?.enabled
        ? [`Thinking budget: up to ${this.config.thinkingBudget.maxThinkingTokens} tokens for planning.`]
        : []),
      "Task:",
      task,
    ].join("\n")
  }

  private buildExecutorPrompt(
    task: string,
    plan: string,
    subtaskId: string,
    subtaskTitle: string,
    dependsOn: string[],
    revisionFocus: string
  ): string {
    return [
      "You are Executor. Implement according to plan and scope.",
      "Task:",
      task,
      "Plan:",
      plan,
      "Subtask ID:",
      subtaskId,
      "Subtask:",
      subtaskTitle,
      "Dependencies:",
      dependsOn.join(", ") || "none",
      "Revision focus:",
      revisionFocus,
      "If you touched files, include lines as: FILE: path/to/file",
    ].join("\n")
  }

  private buildReviewerPrompt(
    task: string,
    plan: string,
    output: string,
    conflict: { hasConflict: boolean; files: string[]; reason?: string }
  ): string {
    return [
      "You are Reviewer. Validate execution against task and plan. Reply in JSON only.",
      '{"status":"approved|changes_requested","severity":"P0|P1|P2|P3","mustFix":["..."],"suggestions":["..."]}',
      "Task:",
      task,
      "Plan:",
      plan,
      "Conflict report:",
      conflict.hasConflict
        ? `hasConflict=true; files=${conflict.files.join(", ")}; reason=${conflict.reason || "n/a"}`
        : "hasConflict=false",
      "Output:",
      output,
    ].join("\n")
  }

  private buildRevisionTask(
    task: string,
    output: string,
    review: ReviewArtifact,
    conflictFixes: string[]
  ): string {
    return [
      task,
      "Revise the solution with these must-fix items:",
      ...review.mustFix.map((m) => `- ${m}`),
      ...conflictFixes.map((m) => `- ${m}`),
      "Previous output:",
      output,
    ].join("\n")
  }

  private parseReview(output: string): ReviewArtifact {
    const fallback: ReviewArtifact = {
      status: "changes_requested",
      severity: "P2",
      mustFix: ["Reviewer response was not structured JSON; revise for safety."],
      suggestions: [],
    }

    const match = output.match(/\{[\s\S]*\}/)
    if (!match) {
      return output.toLowerCase().includes("approved")
        ? { status: "approved", severity: "P3", mustFix: [], suggestions: [] }
        : fallback
    }

    try {
      const parsed = JSON.parse(match[0])
      return {
        status: parsed.status === "approved" ? "approved" : "changes_requested",
        severity: ["P0", "P1", "P2", "P3"].includes(parsed.severity) ? parsed.severity : "P2",
        mustFix: Array.isArray(parsed.mustFix) ? parsed.mustFix.map((v: unknown) => String(v)) : [],
        suggestions: Array.isArray(parsed.suggestions)
          ? parsed.suggestions.map((v: unknown) => String(v))
          : [],
      }
    } catch {
      return fallback
    }
  }
}
