import { describe, it, expect } from "vitest"
import { runDrillScenario, DrillScenarioResult, listDrillScenarios } from "../testing/drill.js"

describe("Drill", () => {
  it("should run timeout fallback drill", async () => {
    const result = await runDrillScenario("timeout-fallback")
    expect(result.id).toBe("drill-timeout-fallback")
    expect(result.passed).toBeDefined()
    expect(result.metrics).toBeDefined()
  })

  it("should run budget exceeded drill", async () => {
    const result = await runDrillScenario("budget-fallback")
    expect(result.id).toBe("drill-budget-fallback")
  })

  it("should run checkpoint rollback drill", async () => {
    const result = await runDrillScenario("checkpoint-rollback")
    expect(result.id).toBe("drill-checkpoint-rollback")
  })

  it("should list available scenarios", () => {
    const scenarios = listDrillScenarios()
    expect(scenarios).toContain("timeout-fallback")
    expect(scenarios).toContain("budget-fallback")
    expect(scenarios).toContain("quality-gate")
    expect(scenarios).toContain("conflict-resolution")
    expect(scenarios).toContain("checkpoint-rollback")
    expect(scenarios.length).toBe(5)
  })
})
