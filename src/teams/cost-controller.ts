import type { TeamBudgetConfig } from "./types.js"

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BudgetExceededError"
  }
}

export class CostController {
  private tokensUsed = 0
  private estimatedCostUsd = 0

  constructor(private budget?: TeamBudgetConfig) {}

  recordTokens(tokens: number, model: string): void {
    this.tokensUsed += Math.max(0, tokens)
    this.estimatedCostUsd += this.calculateEstimatedCost(tokens, model)

    if (!this.canProceed()) {
      throw new BudgetExceededError("Team budget exceeded")
    }
  }

  canProceed(): boolean {
    if (!this.budget) return true

    if (this.tokensUsed >= this.budget.maxTokens) {
      return false
    }

    if (this.budget.maxCostUsd && this.estimatedCostUsd >= this.budget.maxCostUsd) {
      return false
    }

    return true
  }

  getStats() {
    return {
      tokensUsed: this.tokensUsed,
      estimatedCostUsd: Number(this.estimatedCostUsd.toFixed(6)),
    }
  }

  private calculateEstimatedCost(tokens: number, model: string): number {
    const pricing: Record<string, { input: number; output: number }> = {
      "claude-opus-4": { input: 15, output: 75 },
      "claude-sonnet-4": { input: 3, output: 15 },
      "claude-haiku-4": { input: 0.25, output: 1.25 },
    }

    const p = pricing[model] || pricing["claude-sonnet-4"]
    return (Math.max(0, tokens) / 1_000_000) * (p.input + p.output) / 2
  }
}
