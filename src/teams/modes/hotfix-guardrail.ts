import type { TeamConfig } from "../types.js"
import type { ReviewArtifact } from "../contracts.js"

interface HotfixGuardrailCallbacks {
  askFixer: (prompt: string) => Promise<{ output: string; tokensUsed: number }>
  askSafetyReviewer: (prompt: string) => Promise<{ output: string; tokensUsed: number }>
}

export interface HotfixGuardrailResult {
  status: "success" | "failure"
  output: string
  reviewRounds: number
  mustFixCount: number
  p0Count: number
  tokensUsed: number
  error?: string
}

export class HotfixGuardrailMode {
  constructor(private config: TeamConfig) {}

  async run(task: string, callbacks: HotfixGuardrailCallbacks): Promise<HotfixGuardrailResult> {
    let tokensUsed = 0
    let rounds = 0
    let currentTask = task
    let lastOutput = ""
    let lastReview: ReviewArtifact | null = null

    while (rounds < this.config.maxIterations) {
      rounds += 1
      const fixer = await callbacks.askFixer(this.buildFixerPrompt(currentTask))
      tokensUsed += fixer.tokensUsed
      lastOutput = fixer.output

      const safety = await callbacks.askSafetyReviewer(this.buildSafetyPrompt(task, fixer.output))
      tokensUsed += safety.tokensUsed
      lastReview = this.parseReview(safety.output)

      if (lastReview.status === "approved") {
        return {
          status: "success",
          output: fixer.output,
          reviewRounds: rounds,
          mustFixCount: 0,
          p0Count: 0,
          tokensUsed,
        }
      }

      currentTask = [
        task,
        "Revise with strict hotfix guardrails:",
        ...lastReview.mustFix.map((m) => `- ${m}`),
        "Must include rollback section and keep minimal scope.",
        "Previous patch:",
        fixer.output,
      ].join("\n")
    }

    return {
      status: "failure",
      output: lastOutput,
      reviewRounds: rounds,
      mustFixCount: lastReview?.mustFix.length || 0,
      p0Count: lastReview?.severity === "P0" ? 1 : 0,
      tokensUsed,
      error: "Hotfix guardrail max iterations reached",
    }
  }

  private buildFixerPrompt(task: string): string {
    return [
      "You are Fixer in hotfix mode.",
      "Constraints:",
      "- minimal file scope",
      "- no refactor",
      "- must include rollback steps",
      "Task:",
      task,
    ].join("\n")
  }

  private buildSafetyPrompt(task: string, output: string): string {
    return [
      "You are Safety Reviewer. Reply in JSON only.",
      '{"status":"approved|changes_requested","severity":"P0|P1|P2|P3","mustFix":["..."],"suggestions":["..."]}',
      "Validate: safety risks, data consistency, rollback path, scope creep.",
      "Task:",
      task,
      "Patch proposal:",
      output,
    ].join("\n")
  }

  private parseReview(output: string): ReviewArtifact {
    const fallback: ReviewArtifact = {
      status: "changes_requested",
      severity: "P1",
      mustFix: ["Safety review response was invalid JSON."],
      suggestions: [],
    }
    const match = output.match(/\{[\s\S]*\}/)
    if (!match) return fallback
    try {
      const parsed = JSON.parse(match[0])
      return {
        status: parsed.status === "approved" ? "approved" : "changes_requested",
        severity: ["P0", "P1", "P2", "P3"].includes(parsed.severity) ? parsed.severity : "P1",
        mustFix: Array.isArray(parsed.mustFix) ? parsed.mustFix.map((v: unknown) => String(v)) : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map((v: unknown) => String(v)) : [],
      }
    } catch {
      return fallback
    }
  }
}
