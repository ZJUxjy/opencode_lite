// src/teams/__tests__/modes/base.test.ts
import { describe, it, expect } from "vitest"
import type { ModeRunner, TeamResult } from "../../modes/base.js"
import { BaseModeRunner as BaseModeRunnerClass } from "../../modes/base.js"
import type { TeamConfig } from "../../core/types.js"

describe("ModeRunner", () => {
  it("should define TeamResult type with required fields", () => {
    const result: TeamResult = {
      status: "completed",
      output: { summary: "test" },
      stats: {
        durationMs: 1000,
        tokensUsed: { input: 100, output: 50 },
        iterations: 1,
      },
    }
    expect(result.status).toBe("completed")
  })

  it("should support all status types", () => {
    const statuses: TeamResult["status"][] = ["completed", "failed", "cancelled", "fallback"]
    expect(statuses).toHaveLength(4)
  })

  it("should define ModeRunner interface", () => {
    const config: TeamConfig = {
      mode: "worker-reviewer",
      maxIterations: 10,
      timeoutMs: 300000,
      budget: { maxTokens: 100000 },
      qualityGate: {
        testsMustPass: true,
        noP0Issues: true,
        requiredChecks: [],
      },
      circuitBreaker: {
        maxConsecutiveFailures: 3,
        maxNoProgressRounds: 5,
        cooldownMs: 60000,
      },
      conflictResolution: "auto",
    }

    const runner: ModeRunner = {
      mode: "worker-reviewer",
      config,
      execute: async () => ({
        status: "completed",
        output: {},
        stats: { durationMs: 0, tokensUsed: { input: 0, output: 0 }, iterations: 0 },
      }),
      cancel: () => {},
      getState: () => ({
        teamId: "test",
        mode: "worker-reviewer",
        status: "running",
        currentIteration: 0,
        startTime: Date.now(),
        tokensUsed: { input: 0, output: 0 },
        costUsd: 0,
        lastProgressAt: Date.now(),
        consecutiveNoProgressRounds: 0,
        consecutiveFailures: 0,
      }),
    }
    expect(runner.mode).toBe("worker-reviewer")
  })
})

describe("BaseModeRunner", () => {
  it("should be exported as a class", () => {
    expect(BaseModeRunnerClass).toBeDefined()
    expect(typeof BaseModeRunnerClass).toBe("function")
  })
})
