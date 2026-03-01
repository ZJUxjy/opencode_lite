/**
 * Baseline Benchmark Tests
 */

import { describe, it, expect, beforeEach } from "vitest"
import * as path from "path"
import * as os from "os"
import {
  BaselineRunner,
  DEFAULT_TEST_SUITE,
  formatBaselineReport,
  saveBaselineReport,
  createBaselineRunner,
} from "../benchmark.js"

describe("BaselineRunner", () => {
  let runner: BaselineRunner

  beforeEach(() => {
    runner = createBaselineRunner({
      model: "claude-sonnet-4",
      baseURL: "https://api.anthropic.com",
      apiKey: "test-key",
      workingDir: process.cwd(),
      dbPath: path.join(os.homedir(), ".lite-opencode", "test.db"),
    })
  })

  describe("DEFAULT_TEST_SUITE", () => {
    it("should have 20 samples", () => {
      expect(DEFAULT_TEST_SUITE.samples).toHaveLength(20)
    })

    it("should have correct categories", () => {
      const simple = DEFAULT_TEST_SUITE.samples.filter(s => s.category === "simple")
      const medium = DEFAULT_TEST_SUITE.samples.filter(s => s.category === "medium")
      const complex = DEFAULT_TEST_SUITE.samples.filter(s => s.category === "complex")

      expect(simple).toHaveLength(6)
      expect(medium).toHaveLength(7)
      expect(complex).toHaveLength(7)
    })

    it("should have unique IDs", () => {
      const ids = DEFAULT_TEST_SUITE.samples.map(s => s.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length)
    })

    it("should have all required fields", () => {
      for (const sample of DEFAULT_TEST_SUITE.samples) {
        expect(sample.id).toBeDefined()
        expect(sample.category).toBeDefined()
        expect(sample.task).toBeDefined()
        expect(sample.expectedFiles).toBeDefined()
        expect(sample.validationCommands).toBeDefined()
        expect(sample.timeBudget).toBeGreaterThan(0)
        expect(sample.tokenBudget).toBeGreaterThan(0)
      }
    })
  })

  describe("runBaselineComparison", () => {
    it("should run baseline for single sample", async () => {
      const suite = {
        name: "Test Suite",
        samples: [DEFAULT_TEST_SUITE.samples[0]],
      }

      const report = await runner.runBaselineComparison(suite, ["worker-reviewer"])

      expect(report).toBeDefined()
      expect(report.timestamp).toBeGreaterThan(0)
      expect(report.suite).toBe("Test Suite")
      expect(report.comparisons).toHaveLength(1)
      expect(report.summary.totalSamples).toBe(1)
    })

    it("should compare single agent vs team", async () => {
      const suite = {
        name: "Test Suite",
        samples: [DEFAULT_TEST_SUITE.samples[0]],
      }

      const report = await runner.runBaselineComparison(suite, ["worker-reviewer"])

      const comparison = report.comparisons[0]
      expect(comparison.singleAgent.mode).toBe("single-agent")
      expect(comparison.team.mode).toBe("worker-reviewer")
      expect(comparison.improvement).toBeDefined()
    })

    it("should run multiple modes", async () => {
      const suite = {
        name: "Test Suite",
        samples: [DEFAULT_TEST_SUITE.samples[0]],
      }

      const report = await runner.runBaselineComparison(suite, [
        "worker-reviewer",
        "planner-executor-reviewer",
      ])

      expect(report.comparisons).toHaveLength(2)
    })

    it("should calculate improvement metrics", async () => {
      const suite = {
        name: "Test Suite",
        samples: [DEFAULT_TEST_SUITE.samples[0]],
      }

      const report = await runner.runBaselineComparison(suite, ["worker-reviewer"])

      const comparison = report.comparisons[0]
      expect(typeof comparison.improvement.timeReduction).toBe("number")
      expect(typeof comparison.improvement.costIncrease).toBe("number")
      expect(typeof comparison.improvement.qualityImprovement).toBe("number")
    })

    it("should generate summary statistics", async () => {
      const suite = {
        name: "Test Suite",
        samples: DEFAULT_TEST_SUITE.samples.slice(0, 2),
      }

      const report = await runner.runBaselineComparison(suite, ["worker-reviewer"])

      expect(report.summary.totalSamples).toBe(2)
      expect(typeof report.summary.avgTimeReduction).toBe("number")
      expect(typeof report.summary.avgCostIncrease).toBe("number")
      expect(typeof report.summary.avgQualityImprovement).toBe("number")
      expect(typeof report.summary.costEffective).toBe("boolean")
    }, 10000)
  })

  describe("formatBaselineReport", () => {
    it("should format report as markdown", () => {
      const report: import("../benchmark.js").BaselineReport = {
        timestamp: Date.now(),
        suite: "Test Suite",
        comparisons: [
          {
            sampleId: "test-001",
            singleAgent: {
              sampleId: "test-001",
              mode: "single-agent",
              success: true,
              executionTime: 10000,
              tokensUsed: { input: 1000, output: 500 },
              costUsd: 0.01,
              validationResults: [{ command: "test", passed: true }],
              changedFiles: ["src/test.ts"],
            },
            team: {
              sampleId: "test-001",
              mode: "worker-reviewer",
              success: true,
              executionTime: 9000,
              tokensUsed: { input: 2000, output: 1000 },
              costUsd: 0.02,
              validationResults: [{ command: "test", passed: true }],
              changedFiles: ["src/test.ts"],
            },
            improvement: {
              timeReduction: 10,
              costIncrease: 100,
              qualityImprovement: 15,
              successRateImprovement: 0,
            },
          },
        ],
        summary: {
          totalSamples: 1,
          singleAgentSuccess: 1,
          teamSuccess: 1,
          avgTimeReduction: 10,
          avgCostIncrease: 100,
          avgQualityImprovement: 15,
          costEffective: true,
        },
      }

      const markdown = formatBaselineReport(report)

      expect(markdown).toContain("# Agent Teams Baseline Report")
      expect(markdown).toContain("Test Suite")
      expect(markdown).toContain("test-001")
      expect(markdown).toContain("10.0%") // time reduction
      expect(markdown).toContain("✅") // success markers
    })
  })
})

describe("DEFAULT_TEST_SUITE samples", () => {
  it("should have appropriate complexity distribution", () => {
    const simple = DEFAULT_TEST_SUITE.samples.filter(s => s.category === "simple")
    const medium = DEFAULT_TEST_SUITE.samples.filter(s => s.category === "medium")
    const complex = DEFAULT_TEST_SUITE.samples.filter(s => s.category === "complex")

    expect(simple.length).toBe(6)
    expect(medium.length).toBe(7)
    expect(complex.length).toBe(7)
  })

  it("should have increasing token budgets by complexity", () => {
    const simpleAvg = averageTokenBudget(
      DEFAULT_TEST_SUITE.samples.filter(s => s.category === "simple")
    )
    const mediumAvg = averageTokenBudget(
      DEFAULT_TEST_SUITE.samples.filter(s => s.category === "medium")
    )
    const complexAvg = averageTokenBudget(
      DEFAULT_TEST_SUITE.samples.filter(s => s.category === "complex")
    )

    expect(simpleAvg).toBeLessThan(mediumAvg)
    expect(mediumAvg).toBeLessThan(complexAvg)
  })

  it("should have increasing time budgets by complexity", () => {
    const simpleAvg = averageTimeBudget(
      DEFAULT_TEST_SUITE.samples.filter(s => s.category === "simple")
    )
    const mediumAvg = averageTimeBudget(
      DEFAULT_TEST_SUITE.samples.filter(s => s.category === "medium")
    )
    const complexAvg = averageTimeBudget(
      DEFAULT_TEST_SUITE.samples.filter(s => s.category === "complex")
    )

    expect(simpleAvg).toBeLessThan(mediumAvg)
    expect(mediumAvg).toBeLessThan(complexAvg)
  })
})

// Helper functions
function averageTokenBudget(samples: typeof DEFAULT_TEST_SUITE.samples): number {
  return samples.reduce((sum, s) => sum + s.tokenBudget, 0) / samples.length
}

function averageTimeBudget(samples: typeof DEFAULT_TEST_SUITE.samples): number {
  return samples.reduce((sum, s) => sum + s.timeBudget, 0) / samples.length
}
