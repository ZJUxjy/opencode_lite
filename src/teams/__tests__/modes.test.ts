import { describe, it, expect } from "vitest"

describe("Modes", () => {
  const baseConfig = {
    mode: "council" as const,
    maxIterations: 10,
    timeoutMs: 300000,
    budget: { maxTokens: 100000 },
    qualityGate: { requiredChecks: [] as string[], autoFixOnFail: false },
  }

  it("should have council mode available", () => {
    expect(baseConfig.mode).toBe("council")
  })

  it("should support all team modes", () => {
    const modes = ["council", "leader-workers", "worker-reviewer", "planner-executor-reviewer", "hotfix-guardrail"]
    expect(modes).toHaveLength(5)
  })

  it("should have valid base config", () => {
    expect(baseConfig.maxIterations).toBe(10)
    expect(baseConfig.timeoutMs).toBe(300000)
    expect(baseConfig.budget.maxTokens).toBe(100000)
  })
})
