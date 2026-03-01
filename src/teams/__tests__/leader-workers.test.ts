import { describe, it, expect } from "vitest"
import { LeaderWorkersMode } from "../modes/leader-workers.js"
import { defaultTeamConfig } from "../manager.js"

describe("LeaderWorkersMode", () => {
  it("runs collaborative strategy with DAG layer parallelism", async () => {
    const mode = new LeaderWorkersMode({
      ...defaultTeamConfig,
      mode: "leader-workers",
      strategy: "collaborative",
      conflictResolution: "manual",
      budget: { ...(defaultTeamConfig.budget || { maxTokens: 1000 }), maxParallelAgents: 2 },
    })

    const assignedWorkers: number[] = []
    let active = 0
    let maxActive = 0
    const leaderPrompts: string[] = []

    const result = await mode.run("build module", {
      askLeader: async (prompt) => {
        leaderPrompts.push(prompt)
        if (prompt.includes("Decompose task")) {
          return {
            output:
              '[{"id":"task-1","title":"A","dependsOn":[]},{"id":"task-2","title":"B","dependsOn":[]},{"id":"task-3","title":"C","dependsOn":["task-1","task-2"]}]',
            tokensUsed: 10,
          }
        }
        return { output: "integrated output", tokensUsed: 5 }
      },
      askWorker: async (_prompt, idx) => {
        assignedWorkers.push(idx)
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 10))
        active -= 1
        return { output: `worker-${idx}\nFILE: src/shared.ts`, tokensUsed: 5 }
      },
    })

    expect(result.status).toBe("success")
    expect(result.output).toContain("integrated")
    expect(assignedWorkers).toEqual([0, 1, 0])
    expect(maxActive).toBeGreaterThan(1)
    expect(result.mustFixCount).toBe(1)
    expect(leaderPrompts[1]).toContain("CONFLICT_MODE:MANUAL")
  })

  it("runs competitive strategy", async () => {
    const mode = new LeaderWorkersMode({
      ...defaultTeamConfig,
      mode: "leader-workers",
      strategy: "competitive",
    })
    const result = await mode.run("build module", {
      askLeader: async () => ({ output: "CHOICE:2\nFINAL: winner", tokensUsed: 5 }),
      askWorker: async (_prompt, idx) => ({ output: `candidate-${idx}`, tokensUsed: 5 }),
    })

    expect(result.status).toBe("success")
    expect(result.output).toBe("winner")
  })

  it("auto-resolves conflicts before integration when configured", async () => {
    const mode = new LeaderWorkersMode({
      ...defaultTeamConfig,
      mode: "leader-workers",
      strategy: "collaborative",
      conflictResolution: "auto",
    })

    const leaderPrompts: string[] = []
    const result = await mode.run("build module", {
      askLeader: async (prompt) => {
        leaderPrompts.push(prompt)
        if (prompt.includes("Decompose task")) {
          return {
            output: '[{"id":"task-1","title":"A","dependsOn":[]},{"id":"task-2","title":"B","dependsOn":[]}]',
            tokensUsed: 10,
          }
        }
        return { output: "integrated output", tokensUsed: 5 }
      },
      askWorker: async (_prompt, idx) => ({
        output: idx === 0 ? "worker-0\nFILE: src/a.ts\nx" : "worker-1\nFILE: src/a.ts\nlong-content",
        tokensUsed: 5,
      }),
    })

    expect(result.status).toBe("success")
    expect(result.mustFixCount).toBe(0)
    expect(leaderPrompts.some((p) => p.includes("CONFLICT_MODE:AUTO"))).toBe(true)
    expect(leaderPrompts.some((p) => p.includes("AUTO_MERGED_OUTPUTS"))).toBe(true)
    expect(leaderPrompts.some((p) => p.includes("AUTO_MERGE_DECISIONS"))).toBe(true)
  })
})
