import { describe, it, expect } from "vitest"
import { mkdtempSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { TeamManager, defaultTeamConfig } from "../manager.js"
import { TeamRunStore } from "../team-run-store.js"
import { ArtifactStore } from "../artifact-store.js"
import { CheckpointStore } from "../checkpoint-store.js"

describe("TeamManager", () => {
  it("falls back on timeout", async () => {
    const manager = new TeamManager({
      ...defaultTeamConfig,
      mode: "worker-reviewer",
      timeoutMs: 10,
      maxIterations: 1,
    })

    const result = await manager.runTask("task", {
      askWorker: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return { output: "late", tokensUsed: 1 }
      },
      askReviewer: async () => ({ output: '{"status":"approved","severity":"P3","mustFix":[],"suggestions":[]}', tokensUsed: 1 }),
      runFallbackSingleAgent: async () => ({ output: "fallback", tokensUsed: 2 }),
    })

    expect(result.fallbackUsed).toBe(true)
    expect(result.output).toBe("fallback")
  })

  it("dispatches planner-executor-reviewer mode", async () => {
    const manager = new TeamManager({
      ...defaultTeamConfig,
      mode: "planner-executor-reviewer",
    })

    const result = await manager.runTask("task", {
      askWorker: async () => ({ output: "worker", tokensUsed: 1 }),
      askReviewer: async () => ({ output: '{"status":"approved","severity":"P3","mustFix":[],"suggestions":[]}', tokensUsed: 1 }),
      askPlanner: async () => ({ output: "plan", tokensUsed: 1 }),
      askExecutor: async () => ({ output: "execution", tokensUsed: 1 }),
      runFallbackSingleAgent: async () => ({ output: "fallback", tokensUsed: 1 }),
    })

    expect(result.status).toBe("success")
    expect(result.fallbackUsed).not.toBe(true)
  })

  it("records actual mode in progress tracker", async () => {
    const manager = new TeamManager({
      ...defaultTeamConfig,
      mode: "leader-workers",
      strategy: "competitive",
    })

    await manager.runTask("task", {
      askWorker: async (_prompt, workerIndex = 0) => ({ output: `candidate-${workerIndex}`, tokensUsed: 1 }),
      askReviewer: async () => ({ output: "noop", tokensUsed: 1 }),
      askLeader: async () => ({ output: "CHOICE:1\nFINAL: winner", tokensUsed: 1 }),
      runFallbackSingleAgent: async () => ({ output: "fallback", tokensUsed: 1 }),
    })

    const records = manager.getProgressTracker().getRecords()
    expect(records).toHaveLength(1)
    expect(records[0].mode).toBe("leader-workers")
  })

  it("dispatches hotfix-guardrail mode", async () => {
    const manager = new TeamManager({
      ...defaultTeamConfig,
      mode: "hotfix-guardrail",
      maxIterations: 2,
    })

    const result = await manager.runTask("hotfix task", {
      askWorker: async () => ({ output: "worker", tokensUsed: 1 }),
      askReviewer: async () => ({ output: '{"status":"approved","severity":"P3","mustFix":[],"suggestions":[]}', tokensUsed: 1 }),
      askExecutor: async () => ({ output: "fix patch", tokensUsed: 1 }),
      runFallbackSingleAgent: async () => ({ output: "fallback", tokensUsed: 1 }),
    })

    expect(result.status).toBe("success")
    expect(result.fallbackUsed).not.toBe(true)
  })

  it("dispatches council mode", async () => {
    const manager = new TeamManager({
      ...defaultTeamConfig,
      mode: "council",
      budget: { ...(defaultTeamConfig.budget || { maxTokens: 1000 }), maxParallelAgents: 2 },
    })

    const result = await manager.runTask("architecture decision", {
      askWorker: async (_prompt, idx = 0) => ({ output: `member-${idx}`, tokensUsed: 1 }),
      askReviewer: async () => ({ output: "speaker", tokensUsed: 1 }),
      askLeader: async () => ({ output: "decision", tokensUsed: 1 }),
      runFallbackSingleAgent: async () => ({ output: "fallback", tokensUsed: 1 }),
    })

    expect(result.status).toBe("success")
    expect(result.output).toContain("decision")
  })

  it("persists run records with fallback failure reason", async () => {
    const dir = mkdtempSync(join(tmpdir(), "manager-run-store-"))
    const dbPath = join(dir, "team-runs.db")
    const store = new TeamRunStore(dbPath)
    const manager = new TeamManager(
      {
        ...defaultTeamConfig,
        mode: "worker-reviewer",
        timeoutMs: 10,
      },
      store
    )

    await manager.runTask("task", {
      askWorker: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return { output: "late", tokensUsed: 1 }
      },
      askReviewer: async () => ({ output: '{"status":"approved","severity":"P3","mustFix":[],"suggestions":[]}', tokensUsed: 1 }),
      runFallbackSingleAgent: async () => ({ output: "fallback", tokensUsed: 2 }),
    })

    const runs = store.list(10)
    expect(runs).toHaveLength(1)
    expect(runs[0].fallbackUsed).toBe(true)
    expect(runs[0].failureReason).toBe("timeout")
    store.close()
  })

  it("writes run artifacts to filesystem", async () => {
    const dir = mkdtempSync(join(tmpdir(), "manager-artifacts-"))
    const artifacts = new ArtifactStore(dir)
    const manager = new TeamManager(
      {
        ...defaultTeamConfig,
        mode: "worker-reviewer",
      },
      undefined,
      artifacts
    )

    const result = await manager.runTask("task", {
      askWorker: async () => ({ output: "worker-result", tokensUsed: 2 }),
      askReviewer: async () => ({ output: '{"status":"approved","severity":"P3","mustFix":[],"suggestions":[]}', tokensUsed: 2 }),
      runFallbackSingleAgent: async () => ({ output: "fallback", tokensUsed: 1 }),
    })

    expect(result.status).toBe("success")
    const runDirs = readdirSync(dir)
    expect(runDirs.length).toBe(1)
    const runDir = join(dir, runDirs[0])
    expect(existsSync(join(runDir, "metadata.json"))).toBe(true)
    expect(existsSync(join(runDir, "output.md"))).toBe(true)
  })

  it("resumes from checkpoint with continue-iteration strategy", async () => {
    const dir = mkdtempSync(join(tmpdir(), "manager-checkpoints-"))
    const checkpointStore = new CheckpointStore({ filePath: join(dir, "checkpoints.json") })
    const manager = new TeamManager(
      {
        ...defaultTeamConfig,
        mode: "worker-reviewer",
      },
      undefined,
      undefined,
      checkpointStore
    )

    const first = await manager.runTask("original task", {
      askWorker: async () => ({ output: "worker-output", tokensUsed: 2 }),
      askReviewer: async () => ({ output: '{"status":"approved","severity":"P3","mustFix":[],"suggestions":[]}', tokensUsed: 2 }),
      runFallbackSingleAgent: async () => ({ output: "fallback", tokensUsed: 1 }),
    })
    expect(first.status).toBe("success")

    const checkpoints = manager.listCheckpoints(10)
    expect(checkpoints.length).toBeGreaterThan(0)
    const resumed = await manager.resumeFromCheckpoint(checkpoints[0].id, "continue-iteration", {
      askWorker: async (prompt) => ({ output: prompt.includes("Resume from previous checkpoint.") ? "resumed" : "worker", tokensUsed: 2 }),
      askReviewer: async () => ({ output: '{"status":"approved","severity":"P3","mustFix":[],"suggestions":[]}', tokensUsed: 2 }),
      runFallbackSingleAgent: async () => ({ output: "fallback", tokensUsed: 1 }),
    })

    expect(resumed.status).toBe("success")
  })

  it("falls back when rubric gate fails", async () => {
    const manager = new TeamManager({
      ...defaultTeamConfig,
      mode: "worker-reviewer",
      evaluationRubric: {
        dimensions: [{ name: "correctness", weight: 1, scale: 5, criteria: ["1-5"] }],
        overallThreshold: 4.5,
      },
    })

    const result = await manager.runTask("task", {
      askWorker: async () => ({ output: "worker-output", tokensUsed: 2 }),
      askReviewer: async (prompt) =>
        prompt.includes("evaluation judge")
          ? { output: '{"scores":[],"overallScore":3.0,"passed":false,"improvementSuggestions":["fix"]}', tokensUsed: 2 }
          : { output: '{"status":"approved","severity":"P3","mustFix":[],"suggestions":[]}', tokensUsed: 2 },
      runFallbackSingleAgent: async () => ({ output: "fallback", tokensUsed: 1 }),
    })

    expect(result.fallbackUsed).toBe(true)
  })

  it("summarizes baseline percentiles", () => {
    const manager = new TeamManager(defaultTeamConfig)
    const summary = manager.summarizeBaselines([
      {
        task: "a",
        single: { output: "a", tokensUsed: 100, durationMs: 1000 },
        team: {
          output: "a",
          tokensUsed: 120,
          durationMs: 1200,
          reviewRounds: 1,
          mustFixCount: 0,
          p0Count: 0,
          fallbackUsed: false,
        },
      },
      {
        task: "b",
        single: { output: "b", tokensUsed: 200, durationMs: 2000 },
        team: {
          output: "b",
          tokensUsed: 300,
          durationMs: 2400,
          reviewRounds: 2,
          mustFixCount: 1,
          p0Count: 0,
          fallbackUsed: true,
        },
      },
    ])

    expect(summary.sampleSize).toBe(2)
    expect(summary.single.p50Tokens).toBe(100)
    expect(summary.single.p90Tokens).toBe(200)
    expect(summary.team.fallbackRate).toBe(0.5)
  })
})
