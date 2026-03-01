/**
 * Agent Teams - Cost Controller
 *
 * Tracks token usage and cost across all agents in a team.
 * Provides budget enforcement and dynamic pricing.
 */

import type { PricingTable, TeamConfig } from "./types.js"

// ============================================================================
// Default Pricing Table (USD per 1M tokens)
// ============================================================================

const DEFAULT_PRICING: PricingTable = {
  // Anthropic models
  "claude-opus-4-6": { inputPer1M: 15.0, outputPer1M: 75.0, updatedAt: Date.now() },
  "claude-sonnet-4-6": { inputPer1M: 3.0, outputPer1M: 15.0, updatedAt: Date.now() },
  "claude-haiku-4-5": { inputPer1M: 0.25, outputPer1M: 1.25, updatedAt: Date.now() },
  // Legacy names
  "claude-opus-4": { inputPer1M: 15.0, outputPer1M: 75.0, updatedAt: Date.now() },
  "claude-sonnet-4": { inputPer1M: 3.0, outputPer1M: 15.0, updatedAt: Date.now() },
  "claude-haiku-4": { inputPer1M: 0.25, outputPer1M: 1.25, updatedAt: Date.now() },
  // OpenAI models
  "gpt-4o": { inputPer1M: 5.0, outputPer1M: 15.0, updatedAt: Date.now() },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6, updatedAt: Date.now() },
  "o3-mini": { inputPer1M: 1.1, outputPer1M: 4.4, updatedAt: Date.now() },
  // Default fallback
  default: { inputPer1M: 3.0, outputPer1M: 9.0, updatedAt: Date.now() },
}

// ============================================================================
// Cost Controller Interface
// ============================================================================

export interface CostController {
  // Usage recording
  recordUsage(inputTokens: number, outputTokens: number, model: string): void

  // Current status
  getCurrentCost(): number
  getCurrentTokens(): { input: number; output: number }
  getUsageByModel(): Map<string, { input: number; output: number; cost: number }>

  // Budget checks
  isBudgetExceeded(): boolean
  isTokenBudgetExceeded(): boolean
  isCostBudgetExceeded(): boolean
  getBudgetStatus(): {
    tokens: { used: number; limit: number; percentage: number }
    cost: { used: number; limit: number | null; percentage: number | null }
  }

  // Pricing
  getPricingTable(): PricingTable
  updatePricingTable(pricing: PricingTable): void
  getModelPrice(model: string): { inputPer1M: number; outputPer1M: number }

  // Degradation strategy
  shouldDegrade(): "none" | "reduce-concurrency" | "switch-model" | "stop"

  // Callbacks
  onBudgetExceeded(callback: () => void): void
  onDegradationNeeded(callback: (level: "reduce-concurrency" | "switch-model" | "stop") => void): void
}

// ============================================================================
// Cost Controller Implementation
// ============================================================================

interface UsageRecord {
  inputTokens: number
  outputTokens: number
  model: string
  timestamp: number
  cost: number
}

export class TeamCostController implements CostController {
  private records: UsageRecord[] = []
  private pricingTable: PricingTable
  private maxTokens: number
  private maxCostUsd: number | null
  private budgetExceededCallbacks: (() => void)[] = []
  private degradationCallbacks: ((level: "reduce-concurrency" | "switch-model" | "stop") => void)[] = []
  private budgetExceededFired = false

  constructor(config: Pick<TeamConfig, "budget">) {
    this.pricingTable = { ...DEFAULT_PRICING }
    this.maxTokens = config.budget?.maxTokens ?? Number.MAX_SAFE_INTEGER
    this.maxCostUsd = config.budget?.maxCostUsd ?? null
  }

  recordUsage(inputTokens: number, outputTokens: number, model: string): void {
    const price = this.getModelPrice(model)
    const inputCost = (inputTokens / 1_000_000) * price.inputPer1M
    const outputCost = (outputTokens / 1_000_000) * price.outputPer1M
    const cost = inputCost + outputCost

    this.records.push({
      inputTokens,
      outputTokens,
      model,
      timestamp: Date.now(),
      cost,
    })

    // Check budget after recording
    this.checkBudget()
  }

  getCurrentCost(): number {
    return this.records.reduce((sum, r) => sum + r.cost, 0)
  }

  getCurrentTokens(): { input: number; output: number } {
    return this.records.reduce(
      (sum, r) => ({
        input: sum.input + r.inputTokens,
        output: sum.output + r.outputTokens,
      }),
      { input: 0, output: 0 }
    )
  }

  getUsageByModel(): Map<string, { input: number; output: number; cost: number }> {
    const byModel = new Map<string, { input: number; output: number; cost: number }>()

    for (const record of this.records) {
      const existing = byModel.get(record.model) ?? { input: 0, output: 0, cost: 0 }
      existing.input += record.inputTokens
      existing.output += record.outputTokens
      existing.cost += record.cost
      byModel.set(record.model, existing)
    }

    return byModel
  }

  isBudgetExceeded(): boolean {
    return this.isTokenBudgetExceeded() || this.isCostBudgetExceeded()
  }

  isTokenBudgetExceeded(): boolean {
    const tokens = this.getCurrentTokens()
    return tokens.input + tokens.output >= this.maxTokens
  }

  isCostBudgetExceeded(): boolean {
    if (this.maxCostUsd === null) return false
    return this.getCurrentCost() >= this.maxCostUsd
  }

  getBudgetStatus(): {
    tokens: { used: number; limit: number; percentage: number }
    cost: { used: number; limit: number | null; percentage: number | null }
  } {
    const tokens = this.getCurrentTokens()
    const totalTokens = tokens.input + tokens.output
    const cost = this.getCurrentCost()

    return {
      tokens: {
        used: totalTokens,
        limit: this.maxTokens,
        percentage: (totalTokens / this.maxTokens) * 100,
      },
      cost: {
        used: cost,
        limit: this.maxCostUsd,
        percentage: this.maxCostUsd !== null ? (cost / this.maxCostUsd) * 100 : null,
      },
    }
  }

  getPricingTable(): PricingTable {
    return { ...this.pricingTable }
  }

  updatePricingTable(pricing: PricingTable): void {
    this.pricingTable = { ...this.pricingTable, ...pricing }
  }

  getModelPrice(model: string): { inputPer1M: number; outputPer1M: number } {
    const price = this.pricingTable[model] ?? this.pricingTable.default
    return {
      inputPer1M: price.inputPer1M,
      outputPer1M: price.outputPer1M,
    }
  }

  shouldDegrade(): "none" | "reduce-concurrency" | "switch-model" | "stop" {
    const status = this.getBudgetStatus()

    // Stop if budget fully exceeded
    if (this.isBudgetExceeded()) {
      return "stop"
    }

    // Switch to cheaper model if cost > 80% or tokens > 85%
    if (
      (status.cost.percentage !== null && status.cost.percentage > 80) ||
      status.tokens.percentage > 85
    ) {
      return "switch-model"
    }

    // Reduce concurrency if cost > 60% or tokens > 70%
    if (
      (status.cost.percentage !== null && status.cost.percentage > 60) ||
      status.tokens.percentage > 70
    ) {
      return "reduce-concurrency"
    }

    return "none"
  }

  onBudgetExceeded(callback: () => void): void {
    this.budgetExceededCallbacks.push(callback)
  }

  onDegradationNeeded(
    callback: (level: "reduce-concurrency" | "switch-model" | "stop") => void
  ): void {
    this.degradationCallbacks.push(callback)
  }

  private checkBudget(): void {
    // Fire budget exceeded event once
    if (this.isBudgetExceeded() && !this.budgetExceededFired) {
      this.budgetExceededFired = true
      for (const callback of this.budgetExceededCallbacks) {
        try {
          callback()
        } catch {
          // Ignore callback errors
        }
      }
    }

    // Check degradation
    const degradation = this.shouldDegrade()
    if (degradation !== "none") {
      for (const callback of this.degradationCallbacks) {
        try {
          callback(degradation)
        } catch {
          // Ignore callback errors
        }
      }
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createCostController(
  config: Pick<TeamConfig, "budget">
): CostController {
  return new TeamCostController(config)
}
