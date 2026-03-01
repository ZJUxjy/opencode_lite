# Agent Teams 完整实现 - 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 完成 Agent Teams 的协作模式、CLI 集成和配置文件支持，使所有 5 个 Drill 场景通过

**Architecture:** 渐进式实现 - 先建立 ModeRunner 抽象层，再逐个实现具体模式

**Tech Stack:** TypeScript, Vitest, Zod, Commander, Vercel AI SDK

---

## Phase 1: 基础设施 (3 Tasks)

### Task 1: ModeRunner 抽象接口

**Files:**
- Create: `src/teams/modes/base.ts`
- Create: `src/teams/__tests__/modes/base.test.ts`

**Step 1: Write the failing test**

```typescript
// src/teams/__tests__/modes/base.test.ts
import { describe, it, expect } from "vitest"
import type { ModeRunner, TeamResult } from "../../modes/base.js"

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
    const runner: ModeRunner = {
      mode: "worker-reviewer",
      config: {
        mode: "worker-reviewer",
        maxIterations: 10,
        timeoutMs: 300000,
        budget: { maxTokens: 100000 },
        qualityGate: { requiredChecks: [], autoFixOnFail: false },
      },
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
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/teams/__tests__/modes/base.test.ts`
Expected: FAIL - Cannot find module

**Step 3: Write minimal implementation**

```typescript
// src/teams/modes/base.ts
import type { TeamMode, TeamConfig, TeamState } from "../core/types.js"

export interface TeamResult<T = unknown> {
  status: "completed" | "failed" | "cancelled" | "fallback"
  output: T
  stats: {
    durationMs: number
    tokensUsed: { input: number; output: number }
    iterations: number
  }
  fallbackUsed?: boolean
  error?: string
}

export interface ModeRunner<TInput = unknown, TOutput = unknown> {
  readonly mode: TeamMode
  readonly config: TeamConfig
  execute(input: TInput): Promise<TeamResult<TOutput>>
  cancel(): void
  getState(): TeamState
}

export type ProgressCallback = (message: string, data?: unknown) => void
export type ErrorCallback = (error: Error) => void
export type CompleteCallback = (result: TeamResult) => void

export abstract class BaseModeRunner<TInput = unknown, TOutput = unknown>
  implements ModeRunner<TInput, TOutput> {
  abstract readonly mode: TeamMode
  readonly config: TeamConfig
  protected state: TeamState
  protected abortController: AbortController

  constructor(config: TeamConfig) {
    this.config = config
    this.abortController = new AbortController()
    this.state = {
      teamId: `team-${Date.now()}`,
      mode: config.mode,
      status: "initializing",
      currentIteration: 0,
      startTime: Date.now(),
      tokensUsed: { input: 0, output: 0 },
      costUsd: 0,
      lastProgressAt: Date.now(),
      consecutiveNoProgressRounds: 0,
      consecutiveFailures: 0,
    }
  }

  abstract execute(input: TInput): Promise<TeamResult<TOutput>>

  cancel(): void {
    this.abortController.abort()
  }

  getState(): TeamState {
    return { ...this.state }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/teams/__tests__/modes/base.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/teams/modes/base.ts src/teams/__tests__/modes/base.test.ts
git commit -m "feat(teams): add ModeRunner abstract interface"
```

---

### Task 2: 配置文件加载器

**Files:**
- Create: `src/teams/config/loader.ts`
- Create: `src/teams/config/defaults.ts`
- Create: `src/teams/__tests__/config/loader.test.ts`

**Step 1: Write the failing test**

```typescript
// src/teams/__tests__/config/loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { loadTeamsConfig, resolveTeamConfig, mergeWithDefaults } from "../../config/loader.js"
import type { TeamConfig } from "../../core/types.js"

const tempDir = "/tmp/teams-config-test"

describe("ConfigLoader", () => {
  beforeEach(() => {
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("should load valid config file", () => {
    const configPath = join(tempDir, "teams.json")
    writeFileSync(configPath, JSON.stringify({
      teams: {
        default: { mode: "leader-workers", maxIterations: 5 },
      },
    }))

    const config = loadTeamsConfig(configPath)
    expect(config.teams.default.mode).toBe("leader-workers")
  })

  it("should return empty config for non-existent file", () => {
    const config = loadTeamsConfig("/nonexistent/path.json")
    expect(config.teams).toEqual({})
  })

  it("should resolve team config with defaults", () => {
    const overrides: Partial<TeamConfig> = {
      mode: "worker-reviewer",
      maxIterations: 20,
    }
    const config = resolveTeamConfig("default", overrides)
    expect(config.mode).toBe("worker-reviewer")
    expect(config.maxIterations).toBe(20)
    expect(config.timeoutMs).toBeDefined() // has default
  })

  it("should merge with defaults correctly", () => {
    const config = mergeWithDefaults({ mode: "council" })
    expect(config.mode).toBe("council")
    expect(config.maxIterations).toBe(10)
    expect(config.timeoutMs).toBe(300000)
    expect(config.budget.maxTokens).toBe(100000)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/teams/__tests__/config/loader.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/teams/config/defaults.ts
import type { TeamConfig } from "../core/types.js"

export const defaultTeamConfigs: Record<string, TeamConfig> = {
  default: {
    mode: "leader-workers",
    maxIterations: 10,
    timeoutMs: 300000,
    budget: { maxTokens: 100000 },
    qualityGate: { requiredChecks: [], autoFixOnFail: false },
  },
  fast: {
    mode: "worker-reviewer",
    maxIterations: 3,
    timeoutMs: 60000,
    budget: { maxTokens: 50000 },
    qualityGate: { requiredChecks: [], autoFixOnFail: false },
  },
  thorough: {
    mode: "planner-executor-reviewer",
    maxIterations: 20,
    timeoutMs: 600000,
    budget: { maxTokens: 200000 },
    qualityGate: { requiredChecks: ["npm test"], autoFixOnFail: true },
  },
}
```

```typescript
// src/teams/config/loader.ts
import { existsSync, readFileSync } from "node:fs"
import type { TeamConfig } from "../core/types.js"
import { defaultTeamConfigs } from "./defaults.js"

export interface TeamsConfigFile {
  teams: {
    [profile: string]: Partial<TeamConfig>
  }
}

export function loadTeamsConfig(path: string): TeamsConfigFile {
  if (!existsSync(path)) {
    return { teams: {} }
  }
  try {
    const content = readFileSync(path, "utf-8")
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed.teams === "object") {
      return parsed as TeamsConfigFile
    }
    return { teams: {} }
  } catch {
    return { teams: {} }
  }
}

export function mergeWithDefaults(overrides: Partial<TeamConfig>): TeamConfig {
  const base = defaultTeamConfigs.default
  return {
    ...base,
    ...overrides,
    budget: { ...base.budget, ...overrides.budget },
    qualityGate: { ...base.qualityGate, ...overrides.qualityGate },
  }
}

export function resolveTeamConfig(
  profile: string,
  overrides: Partial<TeamConfig> = {}
): TeamConfig {
  const baseConfig = defaultTeamConfigs[profile] || defaultTeamConfigs.default
  return {
    ...baseConfig,
    ...overrides,
    budget: { ...baseConfig.budget, ...overrides.budget },
    qualityGate: { ...baseConfig.qualityGate, ...overrides.qualityGate },
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/teams/__tests__/config/loader.test.ts`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add src/teams/config/ src/teams/__tests__/config/
git commit -m "feat(teams): add config loader with defaults"
```

---

### Task 3: CLI 参数解析

**Files:**
- Create: `src/cli/team-options.ts`
- Create: `src/cli/__tests__/team-options.test.ts`

**Step 1: Write the failing test**

```typescript
// src/cli/__tests__/team-options.test.ts
import { describe, it, expect } from "vitest"
import { parseTeamOptions, validateTeamOptions } from "../team-options.js"

describe("TeamCLIOptions", () => {
  it("should parse team mode", () => {
    const options = parseTeamOptions(["--team", "leader-workers"])
    expect(options.team).toBe("leader-workers")
  })

  it("should parse team config path", () => {
    const options = parseTeamOptions(["--team-config", "./teams.json"])
    expect(options.teamConfig).toBe("./teams.json")
  })

  it("should parse team objective", () => {
    const options = parseTeamOptions(["--team-objective", "Add auth"])
    expect(options.teamObjective).toBe("Add auth")
  })

  it("should parse team budget", () => {
    const options = parseTeamOptions(["--team-budget", "50000"])
    expect(options.teamBudget).toBe(50000)
  })

  it("should parse all options together", () => {
    const options = parseTeamOptions([
      "--team", "council",
      "--team-config", "./teams.json",
      "--team-objective", "Test",
      "--team-budget", "100000",
      "--team-timeout", "60000",
    ])
    expect(options.team).toBe("council")
    expect(options.teamConfig).toBe("./teams.json")
    expect(options.teamObjective).toBe("Test")
    expect(options.teamBudget).toBe(100000)
    expect(options.teamTimeout).toBe(60000)
  })

  it("should validate required options", () => {
    const result = validateTeamOptions({ team: "leader-workers" })
    expect(result.valid).toBe(true)
  })

  it("should reject invalid mode", () => {
    const result = validateTeamOptions({ team: "invalid-mode" as any })
    expect(result.valid).toBe(false)
    expect(result.error).toContain("Invalid team mode")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/cli/__tests__/team-options.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/cli/team-options.ts
import { TEAM_MODES, type TeamMode } from "../teams/modes/index.js"

export interface TeamCLIOptions {
  team?: TeamMode
  teamConfig?: string
  teamObjective?: string
  teamBudget?: number
  teamTimeout?: number
  teamProfile?: string
}

export function parseTeamOptions(argv: string[]): TeamCLIOptions {
  const options: TeamCLIOptions = {}

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case "--team":
        options.team = argv[++i] as TeamMode
        break
      case "--team-config":
        options.teamConfig = argv[++i]
        break
      case "--team-objective":
        options.teamObjective = argv[++i]
        break
      case "--team-budget":
        options.teamBudget = parseInt(argv[++i], 10)
        break
      case "--team-timeout":
        options.teamTimeout = parseInt(argv[++i], 10)
        break
      case "--team-profile":
        options.teamProfile = argv[++i]
        break
    }
  }

  return options
}

export function validateTeamOptions(options: TeamCLIOptions):
  { valid: true } | { valid: false; error: string } {
  if (options.team && !TEAM_MODES.includes(options.team)) {
    return { valid: false, error: `Invalid team mode: ${options.team}. Valid modes: ${TEAM_MODES.join(", ")}` }
  }

  if (options.teamBudget !== undefined && options.teamBudget <= 0) {
    return { valid: false, error: "Team budget must be positive" }
  }

  if (options.teamTimeout !== undefined && options.teamTimeout <= 0) {
    return { valid: false, error: "Team timeout must be positive" }
  }

  return { valid: true }
}
```

**Step 4: Create test directory and run test**

Run: `mkdir -p src/cli/__tests__ && npm run test -- src/cli/__tests__/team-options.test.ts`
Expected: PASS (7 tests)

**Step 5: Commit**

```bash
git add src/cli/team-options.ts src/cli/__tests__/team-options.test.ts
git commit -m "feat(cli): add team options parser"
```

---

## Phase 2: 核心模式 (2 Tasks)

### Task 4: WorkerReviewerRunner

**Files:**
- Create: `src/teams/modes/worker-reviewer.ts`
- Create: `src/teams/__tests__/modes/worker-reviewer.test.ts`

**Step 1: Write the failing test**

```typescript
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
    qualityGate: { requiredChecks: [], autoFixOnFail: false },
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
    expect(result.error).toContain("max iterations")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/teams/__tests__/modes/worker-reviewer.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/teams/modes/worker-reviewer.ts
import { BaseModeRunner, type TeamResult } from "./base.js"
import type { TeamConfig, TeamState, TaskContract, WorkArtifact } from "../core/types.js"
import type { ReviewArtifact } from "../core/contracts.js"

export interface WorkerOutput {
  summary: string
  changedFiles: string[]
  patchRef: string
  testResults: Array<{ command: string; passed: boolean }>
  risks: string[]
  assumptions: string[]
}

export interface ReviewerOutput {
  status: "approved" | "changes_requested"
  severity: "P0" | "P1" | "P2" | "P3"
  mustFix: string[]
  suggestions: string[]
}

export interface WorkerReviewerCallbacks {
  askWorker: (objective: string, contract: TaskContract) => Promise<WorkerOutput>
  askReviewer: (artifact: WorkArtifact) => Promise<ReviewerOutput>
}

export class WorkerReviewerRunner extends BaseModeRunner<string, WorkArtifact> {
  readonly mode = "worker-reviewer" as const
  private callbacks: WorkerReviewerCallbacks

  constructor(config: TeamConfig, callbacks: WorkerReviewerCallbacks) {
    super(config)
    this.callbacks = callbacks
  }

  async execute(objective: string): Promise<TeamResult<WorkArtifact>> {
    const startTime = Date.now()
    this.state.status = "running"

    const contract: TaskContract = {
      taskId: `task-${Date.now()}`,
      objective,
      fileScope: [],
      acceptanceChecks: this.config.qualityGate.requiredChecks,
    }

    let currentArtifact: WorkArtifact | null = null

    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
      this.state.currentIteration = iteration + 1

      // Worker executes
      const workerOutput = await this.callbacks.askWorker(objective, contract)
      currentArtifact = {
        taskId: contract.taskId,
        summary: workerOutput.summary,
        changedFiles: workerOutput.changedFiles,
        patchRef: workerOutput.patchRef,
        testResults: workerOutput.testResults,
        risks: workerOutput.risks,
        assumptions: workerOutput.assumptions,
      }

      // Reviewer checks
      const review = await this.callbacks.askReviewer(currentArtifact)

      if (review.status === "approved") {
        this.state.status = "completed"
        return {
          status: "completed",
          output: currentArtifact,
          stats: {
            durationMs: Date.now() - startTime,
            tokensUsed: this.state.tokensUsed,
            iterations: iteration + 1,
          },
        }
      }

      // Update objective for next iteration with feedback
      objective = `${objective}\n\nReviewer feedback (must fix): ${review.mustFix.join(", ")}`
    }

    // Max iterations reached without approval
    this.state.status = "failed"
    return {
      status: "failed",
      output: currentArtifact!,
      error: `Max iterations (${this.config.maxIterations}) reached without approval`,
      stats: {
        durationMs: Date.now() - startTime,
        tokensUsed: this.state.tokensUsed,
        iterations: this.config.maxIterations,
      },
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/teams/__tests__/modes/worker-reviewer.test.ts`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add src/teams/modes/worker-reviewer.ts src/teams/__tests__/modes/worker-reviewer.test.ts
git commit -m "feat(teams): implement WorkerReviewerRunner mode"
```

---

### Task 5: LeaderWorkersRunner

**Files:**
- Create: `src/teams/modes/leader-workers.ts`
- Create: `src/teams/__tests__/modes/leader-workers.test.ts`

**Step 1: Write the failing test**

```typescript
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
    qualityGate: { requiredChecks: [], autoFixOnFail: false },
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
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/teams/__tests__/modes/leader-workers.test.ts`
Expected: FAIL

**Step 3: Write implementation** (see design doc for full implementation)

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add src/teams/modes/leader-workers.ts src/teams/__tests__/modes/leader-workers.test.ts
git commit -m "feat(teams): implement LeaderWorkersRunner mode"
```

---

## Phase 3: 集成和验证 (2 Tasks)

### Task 6: CLI 集成到主程序

**Files:**
- Modify: `src/index.tsx` (add team mode handling)
- Create: `src/teams/manager.ts`

**Step 1: Write test for CLI integration**

**Step 2: Add team handling to index.tsx**

**Step 3: Create TeamManager**

**Step 4: Verify CLI works**

**Step 5: Commit**

---

### Task 7: Drill 测试验证

**Files:**
- Modify: `src/teams/testing/drill.ts` (update to use new modes)

**Step 1: Run all drill scenarios**

Run: `npm run test -- src/teams/__tests__/drill.test.ts`

**Step 2: Fix any failing scenarios**

**Step 3: Verify all 5 scenarios pass**

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(teams): all drill scenarios passing"
```

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-03-02-teams-completion-impl.md`.

**Two execution options:**

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
