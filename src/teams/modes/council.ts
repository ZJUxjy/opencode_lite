import type { TeamConfig } from "../types.js"

interface CouncilCallbacks {
  askMember: (prompt: string, memberIndex: number) => Promise<{ output: string; tokensUsed: number }>
  askSpeaker: (prompt: string) => Promise<{ output: string; tokensUsed: number }>
}

export interface CouncilResult {
  status: "success" | "failure"
  output: string
  reviewRounds: number
  mustFixCount: number
  p0Count: number
  tokensUsed: number
  error?: string
}

export class CouncilMode {
  constructor(private config: TeamConfig) {}

  async run(task: string, callbacks: CouncilCallbacks): Promise<CouncilResult> {
    const memberCount = Math.max(2, this.config.budget?.maxParallelAgents ?? 3)
    const runParallel = this.shouldRunParallel(memberCount)
    const memberResults = runParallel
      ? await Promise.all(
          Array.from({ length: memberCount }, async (_, i) =>
            callbacks.askMember(this.buildMemberPrompt(task, i + 1), i)
          )
        )
      : await this.runSequential(memberCount, (i) =>
          callbacks.askMember(this.buildMemberPrompt(task, i + 1), i)
        )
    let tokensUsed = memberResults.reduce((sum, r) => sum + r.tokensUsed, 0)
    const perspectives = memberResults.map((result, idx) => `Member ${idx + 1}:\n${result.output}`)

    const synthesis = await callbacks.askSpeaker(
      [
        "You are Council Speaker.",
        "Synthesize the proposals into: Decision, Rationale, Risks, Next actions.",
        "Do not output code patch.",
        "Task:",
        task,
        "Inputs:",
        perspectives.join("\n\n"),
      ].join("\n")
    )
    tokensUsed += synthesis.tokensUsed

    return {
      status: "success",
      output: synthesis.output,
      reviewRounds: 1,
      mustFixCount: 0,
      p0Count: 0,
      tokensUsed,
    }
  }

  private buildMemberPrompt(task: string, slot: number): string {
    return [
      "You are a council member focused on architecture decision quality.",
      `Member slot: ${slot}`,
      "Provide: recommendation, trade-offs, and risks.",
      ...(this.config.thinkingBudget?.enabled
        ? [`Thinking budget: up to ${this.config.thinkingBudget.maxThinkingTokens} tokens for analysis.`]
        : []),
      "Task:",
      task,
    ].join("\n")
  }

  private shouldRunParallel(memberCount: number): boolean {
    const strategy = this.config.parallelStrategy
    if (!strategy || strategy.mode === "parallel") return true
    if (strategy.mode === "sequential") return false

    const adaptive = strategy.adaptive
    if (!adaptive) return true
    return memberCount >= adaptive.scaleUpThreshold
  }

  private async runSequential<T>(count: number, run: (index: number) => Promise<T>): Promise<T[]> {
    const out: T[] = []
    for (let i = 0; i < count; i++) {
      out.push(await run(i))
    }
    return out
  }
}
