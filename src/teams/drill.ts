import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { CheckpointStore } from "./checkpoint-store.js"
import { TeamManager, defaultTeamConfig, type TeamCallbacks } from "./manager.js"
import type { TeamExecutionResult } from "./types.js"

interface DrillScenarioResult {
  id: string
  passed: boolean
  expected: string
  observed: string
  metrics?: Record<string, number | string | boolean>
}

interface DrillReport {
  generatedAt: string
  scenarios: DrillScenarioResult[]
  summary: {
    total: number
    passed: number
    failed: number
    passRate: number
  }
}

function createCallbacks(overrides: Partial<TeamCallbacks> = {}): TeamCallbacks {
  return {
    askWorker: async (_prompt, workerIndex = 0) => ({
      output: `worker-${workerIndex}\nFILE: src/shared.ts`,
      tokensUsed: 10,
    }),
    askReviewer: async () => ({
      output: '{"status":"approved","severity":"P3","mustFix":[],"suggestions":[]}',
      tokensUsed: 6,
    }),
    askPlanner: async () => ({
      output: '[{"id":"task-1","title":"Implement","dependsOn":[]},{"id":"task-2","title":"Verify","dependsOn":["task-1"]}]',
      tokensUsed: 7,
    }),
    askExecutor: async () => ({
      output: "executor-output\nFILE: src/shared.ts",
      tokensUsed: 11,
    }),
    askLeader: async (prompt) => ({
      output: prompt.includes("CHOOSE") ? "CHOICE:1\nFINAL: winner" : "integrated output",
      tokensUsed: 8,
    }),
    runFallbackSingleAgent: async () => ({
      output: "fallback-output",
      tokensUsed: 3,
    }),
    runQualityCheck: async () => true,
    ...overrides,
  }
}

async function scenarioTimeoutFallback(): Promise<DrillScenarioResult> {
  const manager = new TeamManager({
    ...defaultTeamConfig,
    mode: "worker-reviewer",
    timeoutMs: 10,
  })
  const result = await manager.runTask(
    "timeout drill",
    createCallbacks({
      askWorker: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return { output: "late", tokensUsed: 5 }
      },
    })
  )
  const passed = !!result.fallbackUsed
  return {
    id: "drill-timeout-fallback",
    passed,
    expected: "fallbackUsed=true and session survives timeout",
    observed: `fallbackUsed=${!!result.fallbackUsed}, status=${result.status}`,
    metrics: { fallbackUsed: !!result.fallbackUsed, durationMs: result.stats.durationMs },
  }
}

async function scenarioBudgetExceeded(): Promise<DrillScenarioResult> {
  const manager = new TeamManager({
    ...defaultTeamConfig,
    mode: "planner-executor-reviewer",
    budget: { maxTokens: 1 },
  })
  const result = await manager.runTask("budget drill", createCallbacks())
  const passed = !!result.fallbackUsed
  return {
    id: "drill-budget-fallback",
    passed,
    expected: "budget exceeded triggers fallback",
    observed: `fallbackUsed=${!!result.fallbackUsed}, tokens=${result.stats.tokensUsed}`,
    metrics: { fallbackUsed: !!result.fallbackUsed, tokensUsed: result.stats.tokensUsed },
  }
}

async function scenarioQualityGateFail(): Promise<DrillScenarioResult> {
  const manager = new TeamManager({
    ...defaultTeamConfig,
    mode: "hotfix-guardrail",
    qualityGate: {
      ...defaultTeamConfig.qualityGate,
      requiredChecks: ["npm test"],
    },
  })
  const result = await manager.runTask(
    "quality gate drill",
    createCallbacks({
      askExecutor: async () => ({ output: "fix patch", tokensUsed: 8 }),
      runQualityCheck: async () => false,
    })
  )
  const passed = !!result.fallbackUsed
  return {
    id: "drill-quality-gate",
    passed,
    expected: "failed required check triggers fallback",
    observed: `fallbackUsed=${!!result.fallbackUsed}, output=${result.output}`,
    metrics: { fallbackUsed: !!result.fallbackUsed },
  }
}

async function scenarioConflictManualVsAuto(): Promise<DrillScenarioResult> {
  const task = "conflict drill"

  const manualManager = new TeamManager({
    ...defaultTeamConfig,
    mode: "leader-workers",
    strategy: "collaborative",
    conflictResolution: "manual",
  })
  const autoManager = new TeamManager({
    ...defaultTeamConfig,
    mode: "leader-workers",
    strategy: "collaborative",
    conflictResolution: "auto",
  })

  const callbacks = createCallbacks({
    askLeader: async (prompt) => {
      if (prompt.includes("Decompose task")) {
        return {
          output: '[{"id":"task-1","title":"A","dependsOn":[]},{"id":"task-2","title":"B","dependsOn":[]}]',
          tokensUsed: 5,
        }
      }
      return { output: "integrated output", tokensUsed: 5 }
    },
    askWorker: async (_prompt, idx = 0) => ({
      output: idx === 0 ? "worker-a\nFILE: src/a.ts\nx" : "worker-b\nFILE: src/a.ts\nlong-content",
      tokensUsed: 5,
    }),
  })

  const manual = await manualManager.runTask(task, callbacks)
  const auto = await autoManager.runTask(task, callbacks)
  const passed = manual.mustFixCount > 0 && auto.mustFixCount === 0

  return {
    id: "drill-conflict-strategy",
    passed,
    expected: "manual has mustFix, auto resolves to 0 mustFix",
    observed: `manual.mustFix=${manual.mustFixCount}, auto.mustFix=${auto.mustFixCount}`,
    metrics: {
      manualMustFix: manual.mustFixCount,
      autoMustFix: auto.mustFixCount,
    },
  }
}

async function scenarioCheckpointRollback(): Promise<DrillScenarioResult> {
  const store = new CheckpointStore({
    filePath: resolve(process.cwd(), "docs/reports/phase3-drill-checkpoints.json"),
  })
  const checkpoint = store.create({
    description: "drill checkpoint",
    baseRef: "base-123",
    patchRefs: ["p1", "p2", "p3"],
    artifactRefs: ["a1"],
    blackboardSnapshotRef: "bb1",
  })
  const plan = store.buildRollbackPlan(checkpoint.id)
  const passed = plan.baseRef === "base-123" && plan.reversePatchRefs.join(",") === "p3,p2,p1"
  return {
    id: "drill-checkpoint-rollback",
    passed,
    expected: "rollback plan returns baseRef and reverse patch order",
    observed: `baseRef=${plan.baseRef}, reverse=${plan.reversePatchRefs.join(",")}`,
    metrics: { patches: plan.reversePatchRefs.length },
  }
}

function summarize(scenarios: DrillScenarioResult[]): DrillReport["summary"] {
  const total = scenarios.length
  const passed = scenarios.filter((s) => s.passed).length
  const failed = total - passed
  return {
    total,
    passed,
    failed,
    passRate: total === 0 ? 0 : Number((passed / total).toFixed(4)),
  }
}

async function main(): Promise<void> {
  const scenarios = [
    await scenarioTimeoutFallback(),
    await scenarioBudgetExceeded(),
    await scenarioQualityGateFail(),
    await scenarioConflictManualVsAuto(),
    await scenarioCheckpointRollback(),
  ]

  const report: DrillReport = {
    generatedAt: new Date().toISOString(),
    scenarios,
    summary: summarize(scenarios),
  }

  const outputPath = resolve(process.cwd(), "docs/reports/teams-phase3-drill.json")
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8")

  console.log(`Phase 3 drill report written: ${outputPath}`)
  console.log(`Summary: ${report.summary.passed}/${report.summary.total} passed`)
  for (const scenario of scenarios) {
    console.log(`${scenario.id}: ${scenario.passed ? "PASS" : "FAIL"} - ${scenario.observed}`)
  }
}

main().catch((error) => {
  console.error("Phase 3 drill failed:", error)
  process.exitCode = 1
})
