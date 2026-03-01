import { describe, it, expect } from "vitest"
import { runDrillScenario, DrillScenarioResult, listDrillScenarios, runAllDrillScenarios } from "../testing/drill.js"

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
    expect(result.passed).toBeDefined()
  })

  it("should run quality gate drill", async () => {
    const result = await runDrillScenario("quality-gate")
    expect(result.id).toBe("drill-quality-gate")
    expect(result.passed).toBeDefined()
    expect(result.metrics).toBeDefined()
  })

  it("should run conflict resolution drill", async () => {
    const result = await runDrillScenario("conflict-resolution")
    expect(result.id).toBe("drill-conflict-strategy")
    expect(result.passed).toBeDefined()
    expect(result.metrics).toBeDefined()
  })

  it("should run checkpoint rollback drill", async () => {
    const result = await runDrillScenario("checkpoint-rollback")
    expect(result.id).toBe("drill-checkpoint-rollback")
    expect(result.passed).toBeDefined()
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

  it("should run all drill scenarios and generate report", async () => {
    const report = await runAllDrillScenarios()
    expect(report.scenarios.length).toBe(5)
    expect(report.summary.total).toBe(5)
    expect(report.summary.passed).toBeGreaterThanOrEqual(0)
    expect(report.summary.passRate).toBeGreaterThanOrEqual(0)
    expect(report.summary.passRate).toBeLessThanOrEqual(1)
  })
})
