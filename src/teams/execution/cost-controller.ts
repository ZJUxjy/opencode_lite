/**
 * Agent Teams - Cost Controller
 *
 * Tracks token usage and cost across all agents in a team.
 * Provides budget enforcement and dynamic pricing.
 *
 * Note: Full implementation will be merged in a later task.
 * This file provides the interface for type checking.
 */

import type { PricingTable, TeamConfig } from "../core/types.js"

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
  onDegradationNeeded(
    callback: (level: "reduce-concurrency" | "switch-model" | "stop") => void
  ): void
}

// ============================================================================
// Placeholder Factory (will be implemented in a later task)
// ============================================================================

/**
 * Creates a CostController instance.
 * Note: Full implementation will be merged in a later task.
 */
export function createCostController(config: Pick<TeamConfig, "budget">): CostController {
  // Placeholder implementation - returns a minimal mock
  // This will be replaced with the full TeamCostController implementation
  const records: Array<{ input: number; output: number; model: string; cost: number }> = []

  return {
    recordUsage: (input, output, model) => {
      records.push({ input, output, model, cost: 0 })
    },
    getCurrentCost: () => 0,
    getCurrentTokens: () => records.reduce(
      (sum, r) => ({ input: sum.input + r.input, output: sum.output + r.output }),
      { input: 0, output: 0 }
    ),
    getUsageByModel: () => new Map(),
    isBudgetExceeded: () => false,
    isTokenBudgetExceeded: () => false,
    isCostBudgetExceeded: () => false,
    getBudgetStatus: () => ({
      tokens: { used: 0, limit: Number.MAX_SAFE_INTEGER, percentage: 0 },
      cost: { used: 0, limit: null, percentage: null },
    }),
    getPricingTable: () => ({}),
    updatePricingTable: () => {},
    getModelPrice: () => ({ inputPer1M: 3.0, outputPer1M: 9.0 }),
    shouldDegrade: () => "none",
    onBudgetExceeded: () => {},
    onDegradationNeeded: () => {},
  }
}
