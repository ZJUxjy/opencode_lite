import type { ReviewArtifact } from "../contracts.js"
import type { TeamConfig } from "../types.js"

interface WorkerReviewerCallbacks {
  askWorker: (prompt: string) => Promise<{ output: string; tokensUsed: number }>
  askReviewer: (prompt: string) => Promise<{ output: string; tokensUsed: number }>
}

export interface WorkerReviewerResult {
  status: "success" | "failure"
  output: string
  reviewRounds: number
  mustFixCount: number
  p0Count: number
  tokensUsed: number
  error?: string
}

export class WorkerReviewerMode {
  constructor(private config: TeamConfig) {}

  async run(task: string, callbacks: WorkerReviewerCallbacks): Promise<WorkerReviewerResult> {
    let currentTask = task
    let reviewRounds = 0
    let totalTokensUsed = 0
    let lastWorkerOutput = ""
    let lastReview: ReviewArtifact | null = null

    while (reviewRounds < this.config.maxIterations) {
      const worker = await callbacks.askWorker(currentTask)
      reviewRounds += 1
      totalTokensUsed += worker.tokensUsed
      lastWorkerOutput = worker.output

      const reviewerPrompt = this.buildReviewerPrompt(task, worker.output)
      const reviewer = await callbacks.askReviewer(reviewerPrompt)
      totalTokensUsed += reviewer.tokensUsed

      lastReview = this.parseReview(reviewer.output)

      if (lastReview.status === "approved") {
        return {
          status: "success",
          output: worker.output,
          reviewRounds,
          mustFixCount: 0,
          p0Count: 0,
          tokensUsed: totalTokensUsed,
        }
      }

      currentTask = this.buildRevisionPrompt(task, worker.output, lastReview)
    }

    return {
      status: "failure",
      output: lastWorkerOutput,
      reviewRounds,
      mustFixCount: lastReview?.mustFix.length || 0,
      p0Count: lastReview?.severity === "P0" ? 1 : 0,
      tokensUsed: totalTokensUsed,
      error: "Maximum review iterations reached",
    }
  }

  private buildReviewerPrompt(task: string, workerOutput: string): string {
    return [
      "You are a strict code reviewer.",
      "Review the implementation for the task below and reply in JSON only.",
      "JSON schema:",
      '{"status":"approved|changes_requested","severity":"P0|P1|P2|P3","mustFix":["..."],"suggestions":["..."]}',
      "Task:",
      task,
      "Implementation summary/output:",
      workerOutput,
    ].join("\n")
  }

  private buildRevisionPrompt(task: string, workerOutput: string, review: ReviewArtifact): string {
    return [
      "Revise your implementation according to reviewer feedback.",
      "Original task:",
      task,
      "Previous output:",
      workerOutput,
      "Must fix:",
      ...(review.mustFix.length > 0 ? review.mustFix.map((m) => `- ${m}`) : ["- None listed"]),
      "Return the improved implementation.",
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
      if (output.toLowerCase().includes("approved")) {
        return { status: "approved", severity: "P3", mustFix: [], suggestions: [] }
      }
      return fallback
    }

    try {
      const parsed = JSON.parse(match[0])
      const status = parsed.status === "approved" ? "approved" : "changes_requested"
      const severity = ["P0", "P1", "P2", "P3"].includes(parsed.severity)
        ? parsed.severity
        : "P2"
      const mustFix = Array.isArray(parsed.mustFix)
        ? parsed.mustFix.map((v: unknown) => String(v))
        : []
      const suggestions = Array.isArray(parsed.suggestions)
        ? parsed.suggestions.map((v: unknown) => String(v))
        : []

      return { status, severity, mustFix, suggestions }
    } catch {
      return fallback
    }
  }
}
