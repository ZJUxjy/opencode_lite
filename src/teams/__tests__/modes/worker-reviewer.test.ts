// src/teams/__tests__/modes/worker-reviewer.test.ts
import { describe, it, expect, vi } from "vitest"
import { WorkerReviewerRunner } from "../../modes/worker-reviewer.js"
import type { TeamConfig, TaskContract, WorkArtifact, ReviewArtifact } from "../../index.js"

describe("WorkerReviewerRunner", () => {
  const config: TeamConfig = {
    mode: "worker-reviewer",
    maxIterations: 3,
    timeoutMs: 60000,
    budget: { maxTokens: 10000 },
    qualityGate: { testsMustPass: true, noP0Issues: true, requiredChecks: [] },
    circuitBreaker: {
      maxConsecutiveFailures: 3,
      maxNoProgressRounds: 5,
      cooldownMs: 60000,
    },
    conflictResolution: "auto",
  }

  it("should create runner with config", () => {
    const runner = new WorkerReviewerRunner(config, {
      askWorker: vi.fn(),
      askReviewer: vi.fn(),
    })
    expect(runner.mode).toBe("worker-reviewer")
  })

  it("should complete on first approval", async () => {
    const runner = new WorkerReviewerRunner(config, {
      askWorker: vi.fn().mockResolvedValue({
        summary: "Done",
        changedFiles: ["src/test.ts"],
        patchRef: "abc",
        testResults: [],
        risks: [],
        assumptions: [],
      }),
      askReviewer: vi.fn().mockResolvedValue({
        status: "approved",
        severity: "P3",
        mustFix: [],
        suggestions: [],
      }),
    })

    const result = await runner.execute("Add hello function")
    expect(result.status).toBe("completed")
    expect(result.output.summary).toBe("Done")
  })

  it("should loop until approved or max iterations", async () => {
    let reviewCount = 0
    const runner = new WorkerReviewerRunner(config, {
      askWorker: vi.fn().mockResolvedValue({
        summary: "Work in progress",
        changedFiles: [],
        patchRef: "",
        testResults: [],
        risks: [],
        assumptions: [],
      }),
      askReviewer: vi.fn().mockImplementation(() => {
        reviewCount++
        return Promise.resolve({
          status: reviewCount >= 2 ? "approved" : "changes_requested",
          severity: "P2",
          mustFix: reviewCount < 2 ? ["Fix this"] : [],
          suggestions: [],
        })
      }),
    })

    const result = await runner.execute("Test task")
    expect(result.status).toBe("completed")
    expect(reviewCount).toBe(2)
  })

  it("should fail after max iterations without approval", async () => {
    const strictConfig = { ...config, maxIterations: 2 }
    const runner = new WorkerReviewerRunner(strictConfig, {
      askWorker: vi.fn().mockResolvedValue({
        summary: "Work",
        changedFiles: [],
        patchRef: "",
        testResults: [],
        risks: [],
        assumptions: [],
      }),
      askReviewer: vi.fn().mockResolvedValue({
        status: "changes_requested",
        severity: "P1",
        mustFix: ["Always reject"],
        suggestions: [],
      }),
    })

    const result = await runner.execute("Test task")
    expect(result.status).toBe("failed")
    expect(result.error?.toLowerCase()).toContain("max iterations")
  })
})
