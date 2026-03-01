// src/teams/__tests__/modes/leader-workers.test.ts
import { describe, it, expect, vi } from "vitest"
import { LeaderWorkersRunner } from "../../modes/leader-workers.js"
import type { TeamConfig } from "../../core/types.js"

describe("LeaderWorkersRunner", () => {
  const config: TeamConfig = {
    mode: "leader-workers",
    maxIterations: 5,
    timeoutMs: 120000,
    budget: { maxTokens: 50000 },
    qualityGate: { testsMustPass: true, noP0Issues: true, requiredChecks: [], autoFixOnFail: false },
    circuitBreaker: {
      maxConsecutiveFailures: 3,
      maxNoProgressRounds: 5,
      cooldownMs: 60000,
    },
    conflictResolution: "auto",
  }

  it("should create runner with config", () => {
    const runner = new LeaderWorkersRunner(config, {
      askLeader: vi.fn(),
      askWorker: vi.fn(),
    })
    expect(runner.mode).toBe("leader-workers")
  })

  it("should decompose task and execute workers", async () => {
    const runner = new LeaderWorkersRunner(config, {
      askLeader: vi.fn()
        .mockResolvedValueOnce({
          tasks: [
            { id: "task-1", description: "Subtask 1" },
            { id: "task-2", description: "Subtask 2" },
          ],
        })
        .mockResolvedValueOnce({
          integratedOutput: "Final result",
        }),
      askWorker: vi.fn().mockResolvedValue({
        summary: "Worker done",
        changedFiles: ["src/a.ts"],
        patchRef: "patch-1",
        testResults: [],
        risks: [],
        assumptions: [],
      }),
    })

    const result = await runner.execute("Build feature X")
    expect(result.status).toBe("completed")
  })

  it("should support collaborative strategy", async () => {
    const collaborativeConfig = { ...config, strategy: "collaborative" as const }
    const runner = new LeaderWorkersRunner(collaborativeConfig, {
      askLeader: vi.fn()
        .mockResolvedValueOnce({ tasks: [{ id: "t1", description: "Task" }] })
        .mockResolvedValueOnce({ integratedOutput: "Done" }),
      askWorker: vi.fn().mockResolvedValue({
        summary: "Done",
        changedFiles: [],
        patchRef: "",
        testResults: [],
        risks: [],
        assumptions: [],
      }),
    })

    const result = await runner.execute("Test")
    expect(result.status).toBe("completed")
  })
})
