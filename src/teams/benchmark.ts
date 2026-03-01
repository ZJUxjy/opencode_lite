import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { TeamManager, defaultTeamConfig, type TeamCallbacks } from "./manager.js"
import type { BaselineComparison, LeaderWorkersStrategy, TeamMode } from "./types.js"

interface ModeBenchmarkResult {
  mode: TeamMode
  strategy?: LeaderWorkersStrategy
  summary: ReturnType<TeamManager["summarizeBaselines"]>
}

interface BenchmarkReport {
  generatedAt: string
  sampleSize: number
  tasks: string[]
  results: ModeBenchmarkResult[]
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

function buildCallbacks(): TeamCallbacks {
  return {
    askWorker: async (prompt, workerIndex = 0) => {
      await delay(2)
      const normalized = Math.max(1, Math.floor(prompt.length / 40))
      return {
        output: `worker-${workerIndex}\nFILE: src/module-${workerIndex % 2}.ts`,
        tokensUsed: 20 + normalized,
      }
    },
    askReviewer: async () => {
      await delay(1)
      return {
        output: '{"status":"approved","severity":"P3","mustFix":[],"suggestions":[]}',
        tokensUsed: 18,
      }
    },
    askPlanner: async () => {
      await delay(1)
      return {
        output: '[{"id":"task-1","title":"Implement core","dependsOn":[]},{"id":"task-2","title":"Add tests","dependsOn":["task-1"]}]',
        tokensUsed: 16,
      }
    },
    askExecutor: async (prompt) => {
      await delay(2)
      const suffix = prompt.includes("task-2") ? "test" : "core"
      return {
        output: `executor-${suffix}\nFILE: src/shared.ts`,
        tokensUsed: 22,
      }
    },
    askLeader: async (prompt) => {
      await delay(1)
      if (prompt.includes("Decompose task")) {
        return {
          output: '[{"id":"task-1","title":"A","dependsOn":[]},{"id":"task-2","title":"B","dependsOn":[]},{"id":"task-3","title":"C","dependsOn":["task-1","task-2"]}]',
          tokensUsed: 14,
        }
      }
      if (prompt.includes("Resolve conflicting edits automatically")) {
        return { output: "resolved worker outputs", tokensUsed: 12 }
      }
      return { output: "integrated result", tokensUsed: 15 }
    },
    runFallbackSingleAgent: async (prompt) => {
      await delay(1)
      return { output: `fallback for: ${prompt.slice(0, 40)}`, tokensUsed: 25 }
    },
    runQualityCheck: async () => true,
  }
}

async function runSingleAgent(task: string): Promise<{ output: string; tokensUsed: number; durationMs: number }> {
  const startedAt = Date.now()
  await delay(2)
  return {
    output: `single-agent result for ${task}`,
    tokensUsed: 28 + Math.floor(task.length / 30),
    durationMs: Date.now() - startedAt,
  }
}

async function benchmarkMode(
  tasks: string[],
  mode: TeamMode,
  strategy?: LeaderWorkersStrategy
): Promise<ModeBenchmarkResult> {
  const manager = new TeamManager({
    ...defaultTeamConfig,
    mode,
    strategy: strategy || defaultTeamConfig.strategy,
    conflictResolution: "auto",
    budget: { ...(defaultTeamConfig.budget || { maxTokens: 200_000 }), maxParallelAgents: 3 },
    qualityGate: {
      ...defaultTeamConfig.qualityGate,
      requiredChecks: ["npm test"],
    },
  })

  const callbacks = buildCallbacks()
  const comparisons: BaselineComparison[] = []

  for (const task of tasks) {
    const single = await runSingleAgent(task)
    const teamStartedAt = Date.now()
    const team = await manager.runTask(task, callbacks)
    const teamDurationMs = Date.now() - teamStartedAt

    comparisons.push({
      task,
      single: {
        output: single.output,
        tokensUsed: single.tokensUsed,
        durationMs: single.durationMs,
      },
      team: {
        output: team.output,
        tokensUsed: team.stats.tokensUsed,
        durationMs: teamDurationMs,
        reviewRounds: team.reviewRounds,
        mustFixCount: team.mustFixCount,
        p0Count: team.p0Count,
        fallbackUsed: !!team.fallbackUsed,
      },
    })
  }

  return {
    mode,
    strategy,
    summary: manager.summarizeBaselines(comparisons),
  }
}

async function main(): Promise<void> {
  const tasks = [
    "Refactor config loading flow and preserve backward compatibility",
    "Implement robust retry policy for HTTP tool calls",
    "Add validation and error mapping for MCP transport setup",
    "Improve parser fallback branch for malformed tool responses",
    "Optimize prompt assembly and remove duplicate context fields",
    "Introduce baseline report formatter with percentile sections",
    "Harden policy checks for dangerous file operations",
    "Add test coverage for timeout and fallback interactions",
    "Implement command handler for mode switch and status output",
    "Stabilize task decomposition with deterministic ordering",
  ]

  const results: ModeBenchmarkResult[] = []
  results.push(await benchmarkMode(tasks, "worker-reviewer"))
  results.push(await benchmarkMode(tasks, "planner-executor-reviewer"))
  results.push(await benchmarkMode(tasks, "leader-workers", "collaborative"))
  results.push(await benchmarkMode(tasks, "leader-workers", "competitive"))

  const report: BenchmarkReport = {
    generatedAt: new Date().toISOString(),
    sampleSize: tasks.length,
    tasks,
    results,
  }

  const outputPath = resolve(process.cwd(), "docs/reports/teams-phase2-benchmark.json")
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8")

  console.log(`Phase 2 benchmark written: ${outputPath}`)
  for (const item of report.results) {
    const label = item.strategy ? `${item.mode}(${item.strategy})` : item.mode
    console.log(
      `${label}: sample=${item.summary.sampleSize}, team p50 tokens=${item.summary.team.p50Tokens}, team fallback=${item.summary.team.fallbackRate}`
    )
  }
}

main().catch((error) => {
  console.error("Phase 2 benchmark failed:", error)
  process.exitCode = 1
})
