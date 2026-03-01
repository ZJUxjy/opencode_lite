import { describe, expect, it } from "vitest"
import { TeamManager, defaultTeamConfig, type TeamCallbacks } from "../manager.js"
import type { TeamMode } from "../types.js"

function createCallbacks(): TeamCallbacks {
  return {
    askWorker: async (prompt, workerIndex = 0) => {
      if (prompt.includes("Subtask")) {
        return { output: `worker-${workerIndex}\nFILE: src/${workerIndex}.ts`, tokensUsed: 8 }
      }
      return { output: "worker-output\nFILE: src/main.ts", tokensUsed: 10 }
    },
    askReviewer: async (prompt) => {
      if (prompt.includes("JSON")) {
        return {
          output: '{"status":"approved","severity":"P3","mustFix":[],"suggestions":[]}',
          tokensUsed: 6,
        }
      }
      return { output: "review-ok", tokensUsed: 4 }
    },
    askPlanner: async () => ({
      output: '[{"id":"task-1","title":"Core impl","dependsOn":[]},{"id":"task-2","title":"Tests","dependsOn":["task-1"]}]',
      tokensUsed: 7,
    }),
    askExecutor: async (prompt) => {
      if (prompt.includes("task-2")) {
        return { output: "executor-2\nFILE: src/main.ts", tokensUsed: 9 }
      }
      return { output: "executor-1\nFILE: src/main.ts", tokensUsed: 9 }
    },
    askLeader: async (prompt) => {
      if (prompt.includes("Decompose task")) {
        return {
          output: '[{"id":"task-1","title":"A","dependsOn":[]},{"id":"task-2","title":"B","dependsOn":[]}]',
          tokensUsed: 7,
        }
      }
      if (prompt.includes("Resolve conflicting edits automatically")) {
        return { output: "auto-resolved-outputs", tokensUsed: 5 }
      }
      if (prompt.includes("CHOOSE") || prompt.includes("CHOICE")) {
        return { output: "CHOICE:1\nFINAL: winner", tokensUsed: 5 }
      }
      return { output: "integrated-output", tokensUsed: 5 }
    },
    runFallbackSingleAgent: async () => ({ output: "fallback-output", tokensUsed: 3 }),
    runQualityCheck: async () => true,
  }
}

describe("Teams Phase 2 integration", () => {
  it("runs phase 2 modes end-to-end through TeamManager dispatcher", async () => {
    const manager = new TeamManager({
      ...defaultTeamConfig,
      qualityGate: {
        ...defaultTeamConfig.qualityGate,
        requiredChecks: ["npm test"],
      },
      conflictResolution: "auto",
      budget: { ...(defaultTeamConfig.budget || { maxTokens: 2000 }), maxParallelAgents: 2 },
    })
    const callbacks = createCallbacks()

    const sequence: Array<{ mode: TeamMode; strategy?: "collaborative" | "competitive" }> = [
      { mode: "worker-reviewer" },
      { mode: "planner-executor-reviewer" },
      { mode: "leader-workers", strategy: "collaborative" },
      { mode: "leader-workers", strategy: "competitive" },
      { mode: "hotfix-guardrail" },
      { mode: "council" },
    ]

    for (const item of sequence) {
      manager.setMode(item.mode, item.strategy)
      const result = await manager.runTask("implement feature", callbacks)
      expect(result.status).toBe("success")
      expect(result.fallbackUsed).not.toBe(true)
    }

    const records = manager.getProgressTracker().getRecords()
    expect(records).toHaveLength(sequence.length)
    expect(records.map((r) => r.mode)).toEqual([
      "worker-reviewer",
      "planner-executor-reviewer",
      "leader-workers",
      "leader-workers",
      "hotfix-guardrail",
      "council",
    ])
  })

  it("falls back when quality gate required check fails", async () => {
    const manager = new TeamManager({
      ...defaultTeamConfig,
      mode: "worker-reviewer",
      qualityGate: {
        ...defaultTeamConfig.qualityGate,
        requiredChecks: ["npm test"],
      },
    })
    const callbacks = createCallbacks()
    callbacks.runQualityCheck = async () => false

    const result = await manager.runTask("implement feature", callbacks)
    expect(result.fallbackUsed).toBe(true)
    expect(result.output).toBe("fallback-output")
  })

  it("falls back when team budget is exceeded", async () => {
    const manager = new TeamManager({
      ...defaultTeamConfig,
      mode: "worker-reviewer",
      budget: { maxTokens: 1 },
    })
    const callbacks = createCallbacks()
    callbacks.askWorker = async () => ({ output: "huge", tokensUsed: 999 })

    const result = await manager.runTask("implement feature", callbacks)
    expect(result.fallbackUsed).toBe(true)
    expect(result.status).toBe("success")
  })
})
