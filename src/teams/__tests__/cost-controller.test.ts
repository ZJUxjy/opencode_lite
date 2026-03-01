import { describe, it, expect } from "vitest"
import { CostController, BudgetExceededError } from "../cost-controller.js"

describe("CostController", () => {
  it("tracks token usage", () => {
    const controller = new CostController({ maxTokens: 1000 })
    controller.recordTokens(100, "claude-sonnet-4")
    const stats = controller.getStats()
    expect(stats.tokensUsed).toBe(100)
    expect(stats.estimatedCostUsd).toBeGreaterThan(0)
  })

  it("throws when budget exceeded", () => {
    const controller = new CostController({ maxTokens: 10 })
    expect(() => controller.recordTokens(20, "claude-sonnet-4")).toThrow(BudgetExceededError)
  })
})
