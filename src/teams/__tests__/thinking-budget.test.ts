import { describe, it, expect, beforeEach } from "vitest"
import { ThinkingBudgetManager, createThinkingBudgetManager } from "../thinking-budget.js"

describe("ThinkingBudgetManager", () => {
  let manager: ThinkingBudgetManager

  beforeEach(() => {
    manager = createThinkingBudgetManager({
      enabled: true,
      maxThinkingTokens: 5000,
      outputThinkingProcess: true,
    })
  })

  describe("createThinkingBudgetManager", () => {
    it("should create manager with default config", () => {
      const m = createThinkingBudgetManager()
      expect(m.isEnabled()).toBe(false)
      expect(m.getMaxTokens()).toBe(10000)
    })

    it("should create manager with custom config", () => {
      const m = createThinkingBudgetManager({
        enabled: true,
        maxThinkingTokens: 5000,
      })
      expect(m.isEnabled()).toBe(true)
      expect(m.getMaxTokens()).toBe(5000)
    })
  })

  describe("recordThinking", () => {
    it("should record thinking artifact when enabled", () => {
      manager.recordThinking("task-001", {
        thinkingProcess: "Step by step analysis...",
        analysisSteps: ["Step 1", "Step 2"],
        considerations: ["Consider X"],
        conclusion: "Final answer",
        tokensUsed: 1000,
      })

      const artifact = manager.getThinking("task-001")
      expect(artifact).toBeDefined()
      expect(artifact?.thinkingProcess).toBe("Step by step analysis...")
      expect(artifact?.tokensUsed).toBe(1000)
    })

    it("should not record when disabled", () => {
      const disabledManager = createThinkingBudgetManager({ enabled: false })

      disabledManager.recordThinking("task-001", {
        thinkingProcess: "Analysis...",
        analysisSteps: [],
        considerations: [],
        conclusion: "Answer",
        tokensUsed: 500,
      })

      expect(disabledManager.getThinking("task-001")).toBeUndefined()
    })
  })

  describe("isBudgetExceeded", () => {
    it("should return true when budget exceeded", () => {
      manager.recordThinking("task-001", {
        thinkingProcess: "Long analysis...",
        analysisSteps: [],
        considerations: [],
        conclusion: "Answer",
        tokensUsed: 6000, // Exceeds 5000 limit
      })

      expect(manager.isBudgetExceeded("task-001")).toBe(true)
    })

    it("should return false when under budget", () => {
      manager.recordThinking("task-001", {
        thinkingProcess: "Short analysis...",
        analysisSteps: [],
        considerations: [],
        conclusion: "Answer",
        tokensUsed: 1000,
      })

      expect(manager.isBudgetExceeded("task-001")).toBe(false)
    })
  })

  describe("getTotalTokensUsed", () => {
    it("should sum tokens across all artifacts", () => {
      manager.recordThinking("task-001", {
        thinkingProcess: "Analysis 1",
        analysisSteps: [],
        considerations: [],
        conclusion: "A",
        tokensUsed: 1000,
      })

      manager.recordThinking("task-002", {
        thinkingProcess: "Analysis 2",
        analysisSteps: [],
        considerations: [],
        conclusion: "B",
        tokensUsed: 2000,
      })

      expect(manager.getTotalTokensUsed()).toBe(3000)
    })
  })

  describe("formatThinking", () => {
    it("should format artifact as markdown", () => {
      const artifact = {
        taskId: "task-001",
        thinkingProcess: "Deep analysis...",
        analysisSteps: ["Step 1", "Step 2"],
        considerations: ["Consider X"],
        conclusion: "Final answer",
        tokensUsed: 1500,
        timestamp: Date.now(),
      }

      const formatted = manager.formatThinking(artifact)

      expect(formatted).toContain("## Thinking Process (1500 tokens)")
      expect(formatted).toContain("Deep analysis...")
      expect(formatted).toContain("### Analysis Steps")
      expect(formatted).toContain("1. Step 1")
      expect(formatted).toContain("### Conclusion")
      expect(formatted).toContain("Final answer")
    })
  })
})
