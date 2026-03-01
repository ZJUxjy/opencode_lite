/**
 * CostController Tests
 */

import { describe, it, expect, vi } from "vitest"
import { TeamCostController } from "../cost-controller.js"

describe("TeamCostController", () => {
  describe("basic usage tracking", () => {
    it("should record and retrieve usage", () => {
      const controller = new TeamCostController({
        budget: { maxTokens: 100000 },
      })

      controller.recordUsage(1000, 500, "claude-sonnet-4")

      const tokens = controller.getCurrentTokens()
      expect(tokens.input).toBe(1000)
      expect(tokens.output).toBe(500)
      expect(controller.getCurrentCost()).toBeGreaterThan(0)
    })

    it("should aggregate usage by model", () => {
      const controller = new TeamCostController({
        budget: { maxTokens: 100000 },
      })

      controller.recordUsage(1000, 500, "claude-sonnet-4")
      controller.recordUsage(2000, 1000, "claude-haiku-4")

      const byModel = controller.getUsageByModel()
      expect(byModel.has("claude-sonnet-4")).toBe(true)
      expect(byModel.has("claude-haiku-4")).toBe(true)
    })
  })

  describe("budget checking", () => {
    it("should detect token budget exceeded", () => {
      const controller = new TeamCostController({
        budget: { maxTokens: 1000 },
      })

      controller.recordUsage(500, 600, "claude-sonnet-4") // 1100 total

      expect(controller.isTokenBudgetExceeded()).toBe(true)
      expect(controller.isBudgetExceeded()).toBe(true)
    })

    it("should detect cost budget exceeded", () => {
      const controller = new TeamCostController({
        budget: { maxTokens: 1000000, maxCostUsd: 0.01 },
      })

      // Record large usage to exceed $0.01
      controller.recordUsage(10000, 5000, "claude-opus-4")

      expect(controller.isCostBudgetExceeded()).toBe(true)
    })

    it("should return budget status", () => {
      const controller = new TeamCostController({
        budget: { maxTokens: 10000, maxCostUsd: 1.0 },
      })

      controller.recordUsage(1000, 1000, "claude-sonnet-4")

      const status = controller.getBudgetStatus()
      expect(status.tokens.used).toBe(2000)
      expect(status.tokens.limit).toBe(10000)
      expect(status.cost.limit).toBe(1.0)
    })
  })

  describe("degradation strategy", () => {
    it("should suggest reduce-concurrency at 60% usage", () => {
      const controller = new TeamCostController({
        budget: { maxTokens: 10000 },
      })

      controller.recordUsage(3500, 3500, "claude-sonnet-4") // 70%

      expect(controller.shouldDegrade()).toBe("reduce-concurrency")
    })

    it("should suggest switch-model at 80% usage", () => {
      const controller = new TeamCostController({
        budget: { maxTokens: 10000 },
      })

      controller.recordUsage(4500, 4500, "claude-sonnet-4") // 90%

      expect(controller.shouldDegrade()).toBe("switch-model")
    })

    it("should suggest stop when budget exceeded", () => {
      const controller = new TeamCostController({
        budget: { maxTokens: 1000 },
      })

      controller.recordUsage(600, 600, "claude-sonnet-4") // 120%

      expect(controller.shouldDegrade()).toBe("stop")
    })

    it("should return none when usage is low", () => {
      const controller = new TeamCostController({
        budget: { maxTokens: 10000 },
      })

      controller.recordUsage(100, 100, "claude-sonnet-4")

      expect(controller.shouldDegrade()).toBe("none")
    })
  })

  describe("callbacks", () => {
    it("should call budget exceeded callback", () => {
      const controller = new TeamCostController({
        budget: { maxTokens: 1000 },
      })
      const callback = vi.fn()

      controller.onBudgetExceeded(callback)
      controller.recordUsage(600, 600, "claude-sonnet-4")

      expect(callback).toHaveBeenCalled()
    })

    it("should call degradation callback", () => {
      const controller = new TeamCostController({
        budget: { maxTokens: 10000 },
      })
      const callback = vi.fn()

      controller.onDegradationNeeded(callback)
      controller.recordUsage(3500, 3500, "claude-sonnet-4")

      expect(callback).toHaveBeenCalledWith("reduce-concurrency")
    })
  })
})
