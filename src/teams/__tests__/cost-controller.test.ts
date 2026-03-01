import { describe, it, expect, beforeEach } from "vitest"
import { CostController, DEFAULT_PRICING } from "../cost-controller.js"
import type { BudgetConfig } from "../types.js"

describe("CostController", () => {
  let costController: CostController

  beforeEach(() => {
    costController = new CostController()
  })

  describe("constructor", () => {
    it("should create with default pricing", () => {
      expect(costController).toBeDefined()
    })

    it("should create with custom budget", () => {
      const budget: BudgetConfig = {
        maxTokens: 100000,
        maxCostUsd: 1.0,
        maxParallelAgents: 2,
      }
      const cc = new CostController(budget)
      expect(cc).toBeDefined()
    })

    it("should create with custom pricing", () => {
      const customPricing = {
        "test-model": { inputPer1M: 1, outputPer1M: 2, updatedAt: Date.now() },
      }
      const cc = new CostController(undefined, customPricing)
      expect(cc).toBeDefined()
    })
  })

  describe("recordCall", () => {
    it("should record token usage", () => {
      costController.recordCall("claude-sonnet-4-20250514", 1000, 500)
      const usage = costController.getUsage()
      expect(usage.input).toBe(1000)
      expect(usage.output).toBe(500)
      expect(usage.total).toBe(1500)
    })

    it("should accumulate token usage across calls", () => {
      costController.recordCall("claude-sonnet-4-20250514", 1000, 500)
      costController.recordCall("claude-sonnet-4-20250514", 2000, 1000)
      const usage = costController.getUsage()
      expect(usage.input).toBe(3000)
      expect(usage.output).toBe(1500)
      expect(usage.total).toBe(4500)
    })
  })

  describe("calculateCallCost", () => {
    it("should calculate cost for known model", () => {
      const cost = costController.calculateCallCost("claude-sonnet-4-20250514", 1000000, 1000000)
      // input: 1M * $3/1M = $3, output: 1M * $15/1M = $15
      expect(cost).toBe(18)
    })

    it("should calculate cost for unknown model", () => {
      const cost = costController.calculateCallCost("unknown-model", 1000000, 1000000)
      // default: (2M / 1M) * $0.5 = $1
      expect(cost).toBe(1)
    })

    it("should calculate small token cost correctly", () => {
      const cost = costController.calculateCallCost("claude-sonnet-4-20250514", 1000, 500)
      // input: 0.001M * $3/1M = $0.003
      // output: 0.0005M * $15/1M = $0.0075
      expect(cost).toBeCloseTo(0.0105, 2)
    })
  })

  describe("budget checking", () => {
    it("should allow task when budget is not set", () => {
      expect(costController.canStartNewTask()).toBe(true)
    })

    it("should allow task when under budget", () => {
      const budget: BudgetConfig = {
        maxTokens: 100000,
        maxCostUsd: 1.0,
      }
      const cc = new CostController(budget)
      expect(cc.canStartNewTask()).toBe(true)
    })

    it("should get downgrade level", () => {
      const level = costController.getDowngradeLevel()
      expect(level).toBe("normal")
    })
  })

  describe("getMaxParallelAgents", () => {
    it("should return default when no budget", () => {
      expect(costController.getMaxParallelAgents()).toBe(2)
    })

    it("should return budget value when set", () => {
      const budget: BudgetConfig = {
        maxTokens: 100000,
        maxParallelAgents: 4,
      }
      const cc = new CostController(budget)
      expect(cc.getMaxParallelAgents()).toBe(4)
    })
  })

  describe("reset", () => {
    it("should reset all stats", () => {
      costController.recordCall("claude-sonnet-4-20250514", 1000, 500)
      costController.reset()
      const usage = costController.getUsage()
      expect(usage.input).toBe(0)
      expect(usage.output).toBe(0)
      expect(usage.total).toBe(0)
    })

    it("should reset downgrade level", () => {
      costController.reset()
      expect(costController.getDowngradeLevel()).toBe("normal")
    })
  })

  describe("getStats", () => {
    it("should return stats object", () => {
      const stats = costController.getStats()
      expect(stats).toHaveProperty("inputTokens")
      expect(stats).toHaveProperty("outputTokens")
      expect(stats).toHaveProperty("totalTokens")
      expect(stats).toHaveProperty("callCount")
      expect(stats).toHaveProperty("estimatedCost")
      expect(stats).toHaveProperty("budget")
      expect(stats).toHaveProperty("downgradeLevel")
    })
  })
})
