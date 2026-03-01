# Agent Teams 三分支合并实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 合并 codex、kimi、minimax 三个分支的 Agent Teams 实现，取各家之长，构建完整的多 Agent 协作系统。

**Architecture:** 以 kimi 分支为基础（代码量最大、测试最全)，逐步合并 minimax 的 worktree-isolation 和 codex 的 ralph-loop/drill/evaluator。采用 TDD 方式，每个合并步骤都有测试验证。

**Tech Stack:** TypeScript, Vitest, Zod, better-sqlite3, Vercel AI SDK

---

## Task 1: 准备合并环境

**Files:**
- Modify: `.gitignore`
- Create: `src/teams/.gitkeep`

**Step 1: 创建 teams 目录结构**

```bash
mkdir -p src/teams/{core,client,storage,execution,isolation,evaluation,loop,testing,modes,__tests__}
touch src/teams/.gitkeep
```

**Step 2: 更新 .gitignore**

```git
# 添加到 .gitignore
echo "
# Agent Teams artifacts
.agent-teams/
" >> .gitignore
```

**Step 3: 验证目录创建**

Run: `ls -la src/teams/`
Expected: 显示 core, client, storage 等目录

**Step 4: 提交**

```bash
git add src/teams/.gitkeep .gitignore
git commit -m "chore: create teams directory structure"
```

---

## Task 2: 合并核心类型定义

**Files:**
- Create: `src/teams/core/types.ts`
- Create: `src/teams/__tests__/types.test.ts`

**Step 1: 写失败测试**

```typescript
// src/teams/__tests__/types.test.ts
import { describe, it, expect } from "vitest"
import { TeamMode, AgentRole, TeamConfig, ThinkingBudget, ContextContract } from "../core/types.js"

describe("Types", () => {
  it("should define all team modes", () => {
    const modes: TeamMode[] = ["council", "leader-workers", "worker-reviewer", "planner-executor-reviewer", "hotfix-guardrail"]
    expect(modes).toHaveLength(5)
  })

  it("should define agent roles", () => {
    const roles: AgentRole[] = ["leader", "worker", "reviewer", "planner", "executor"]
    expect(roles).toHaveLength(5)
  })

  it("should have valid default team config", () => {
    const config: TeamConfig = {
      mode: "leader-workers",
      maxIterations: 10,
      timeoutMs: 300000,
      budget: { maxTokens: 100000 },
      qualityGate: { requiredChecks: [], autoFixOnFail: false },
    }
    expect(config.mode).toBe("leader-workers")
  })

  it("should support thinking budget", () => {
    const budget: ThinkingBudget = {
      enabled: true,
      maxThinkingTokens: 10000,
      outputThinkingProcess: true,
    }
    expect(budget.enabled).toBe(true)
  })

  it("should support context contract", () => {
    const contract: ContextContract = {
      objective: "Add feature",
      context: { background: "...", constraints: [], references: [] },
      boundaries: { mustNot: [], shouldConsider: [] },
      expectedOutcome: { intent: "...", validationHint: "..." },
    }
    expect(contract.objective).toBe("Add feature")
  })
})
```

**Step 2: 运行测试确认失败**

Run: `npm run test -- src/teams/__tests__/types.test.ts`
Expected: FAIL - Cannot find module '../core/types.js'

**Step 3: 实现 types.ts (合并三分支)**

```typescript
// src/teams/core/types.ts
import { z } from "zod"

// ============================================================================
// Team Modes
// ============================================================================

export type TeamMode =
  | "council"
  | "leader-workers"
  | "worker-reviewer"
  | "planner-executor-reviewer"
  | "hotfix-guardrail"

export type AgentRole = "leader" | "worker" | "reviewer" | "planner" | "executor"

export type Strategy = "collaborative" | "competitive"

// ============================================================================
// Configuration
// ============================================================================

export interface BudgetConfig {
  maxTokens: number
  maxCost?: number
}

export interface QualityGateConfig {
  requiredChecks: string[]
  autoFixOnFail: boolean
}

export interface ThinkingBudget {
  enabled: boolean
  maxThinkingTokens: number
  outputThinkingProcess: boolean
}

export interface TeamConfig {
  mode: TeamMode
  strategy?: Strategy
  maxIterations: number
  timeoutMs: number
  budget: BudgetConfig
  qualityGate: QualityGateConfig
  circuitBreaker?: {
    failureThreshold: number
    resetTimeoutMs: number
  }
  thinkingBudget?: ThinkingBudget
}

// ============================================================================
// Contracts (from supplement doc)
// ============================================================================

export interface ContextContract {
  objective: string
  context: {
    background: string
    constraints: string[]
    references: string[]
  }
  boundaries: {
    mustNot: string[]
    shouldConsider: string[]
  }
  expectedOutcome: {
    intent: string
    validationHint: string
  }
}

// ============================================================================
// Execution Status
// ============================================================================

export type TeamStatus =
  | "initializing"
  | "planning"
  | "executing"
  | "reviewing"
  | "integrating"
  | "completed"
  | "failed"
  | "fallback"

export interface TeamExecutionResult {
  status: TeamStatus
  output: string
  stats: {
    durationMs: number
    tokensUsed: number
    iterations: number
  }
  fallbackUsed?: boolean
  mustFixCount: number
}

// ============================================================================
// Zod Schemas
// ============================================================================

export const TeamModeSchema = z.enum([
  "council",
  "leader-workers",
  "worker-reviewer",
  "planner-executor-reviewer",
  "hotfix-guardrail",
])

export const TeamConfigSchema = z.object({
  mode: TeamModeSchema,
  strategy: z.enum(["collaborative", "competitive"]).optional(),
  maxIterations: z.number(),
  timeoutMs: z.number(),
  budget: z.object({
    maxTokens: z.number(),
    maxCost: z.number().optional(),
  }),
  qualityGate: z.object({
    requiredChecks: z.array(z.string()),
    autoFixOnFail: z.boolean(),
  }),
  thinkingBudget: z.object({
    enabled: z.boolean(),
    maxThinkingTokens: z.number(),
    outputThinkingProcess: z.boolean(),
  }).optional(),
})

export const defaultTeamConfig: TeamConfig = {
  mode: "leader-workers",
  maxIterations: 10,
  timeoutMs: 300000,
  budget: { maxTokens: 100000 },
  qualityGate: { requiredChecks: [], autoFixOnFail: false },
}
```

**Step 4: 运行测试确认通过**

Run: `npm run test -- src/teams/__tests__/types.test.ts`
Expected: PASS (5 tests)

**Step 5: 提交**

```bash
git add src/teams/core/types.ts src/teams/__tests__/types.test.ts
git commit -m "feat(teams): add unified types from codex/kimi/minimax"
```

---

## Task 3: 合并 LLM 客户端 (来自 kimi)

**Files:**
- Create: `src/teams/client/llm-client.ts`
- Create: `src/teams/__tests__/llm-client.test.ts`

**Step 1: 写失败测试**

```typescript
// src/teams/__tests__/llm-client.test.ts
import { describe, it, expect, vi } from "vitest"
import { AgentLLMClient, WorkerOutput, ReviewerOutput } from "../client/llm-client.js"

describe("AgentLLMClient", () => {
  it("should create client with config", () => {
    const client = new AgentLLMClient({
      model: "claude-3-5-sonnet-20241022",
    })
    expect(client).toBeDefined()
  })

  it("should build worker prompt", () => {
    const client = new AgentLLMClient({ model: "test-model" })
    const prompt = client.buildWorkerPrompt({
      taskId: "task-1",
      objective: "Add feature",
      fileScope: ["src/utils.ts"],
    })
    expect(prompt).toContain("task-1")
    expect(prompt).toContain("Add feature")
  })

  it("should parse worker output", () => {
    const client = new AgentLLMClient({ model: "test-model" })
    const output = client.parseWorkerOutput(`
      SUMMARY: Added hello function
      FILES: src/utils.ts
      PATCH: abc123
    `)
    expect(output.summary).toBe("Added hello function")
    expect(output.changedFiles).toContain("src/utils.ts")
  })
})
```

**Step 2: 运行测试确认失败**

Run: `npm run test -- src/teams/__tests__/llm-client.test.ts`
Expected: FAIL

**Step 3: 从 kimi 复制 llm-client.ts**

```bash
cp /home/xu/code/agent/worktree/opencode_lite_kimi/src/teams/llm-client.ts src/teams/client/llm-client.ts
```

**Step 4: 调整导入路径**

```typescript
// 修改 src/teams/client/llm-client.ts 中的导入
import type { TaskContract } from "../core/contracts.js"  // 更新路径
```

**Step 5: 运行测试确认通过**

Run: `npm run test -- src/teams/__tests__/llm-client.test.ts`
Expected: PASS

**Step 6: 提交**

```bash
git add src/teams/client/llm-client.ts src/teams/__tests__/llm-client.test.ts
git commit -m "feat(teams): add LLM client from kimi branch"
```

---

## Task 4: 合并 Agent Pool (来自 kimi/minimax)

**Files:**
- Create: `src/teams/client/agent-pool.ts`
- Create: `src/teams/__tests__/agent-pool.test.ts`

**Step 1: 写失败测试**

```typescript
// src/teams/__tests__/agent-pool.test.ts
import { describe, it, expect } from "vitest"
import { AgentPool, AgentInstance } from "../client/agent-pool.js"

describe("AgentPool", () => {
  it("should create pool with config", () => {
    const pool = new AgentPool({ maxInstances: 5 })
    expect(pool).toBeDefined()
  })

  it("should acquire agent instance", () => {
    const pool = new AgentPool({ maxInstances: 5 })
    const instance = pool.acquire({
      role: "worker",
      model: "claude-3-5-sonnet-20241022",
    })
    expect(instance).toBeDefined()
    expect(instance.role).toBe("worker")
    expect(instance.status).toBe("idle")
  })

  it("should track instance usage", () => {
    const pool = new AgentPool({ maxInstances: 5 })
    const instance = pool.acquire({ role: "worker", model: "test" })
    pool.recordUsage(instance.id, { input: 100, output: 50 })
    expect(instance.tokensUsed.input).toBe(100)
  })

  it("should retire instances with too many errors", () => {
    const pool = new AgentPool({ maxInstances: 5, maxConsecutiveErrors: 3 })
    const instance = pool.acquire({ role: "worker", model: "test" })
    pool.recordError(instance.id)
    pool.recordError(instance.id)
    pool.recordError(instance.id)
    expect(instance.status).toBe("retired")
  })
})
```

**Step 2: 运行测试确认失败**

Run: `npm run test -- src/teams/__tests__/agent-pool.test.ts`
Expected: FAIL

**Step 3: 合并 kimi 和 minimax 的 agent-pool 实现**

```bash
# 使用 kimi 版本作为基础（更完整）
cp /home/xu/code/agent/worktree/opencode_lite_kimi/src/teams/agent-pool.ts src/teams/client/agent-pool.ts
```

**Step 4: 调整导入路径并合并 minimax 的改进**

```typescript
// 在 src/teams/client/agent-pool.ts 顶部修改导入
import type { AgentRole } from "../core/types.js"
```

**Step 5: 运行测试确认通过**

Run: `npm run test -- src/teams/__tests__/agent-pool.test.ts`
Expected: PASS (4 tests)

**Step 6: 提交**

```bash
git add src/teams/client/agent-pool.ts src/teams/__tests__/agent-pool.test.ts
git commit -m "feat(teams): add agent pool with instance management"
```

---

## Task 5: 合并 Worktree 隔离 (来自 minimax)

**Files:**
- Create: `src/teams/isolation/worktree-isolation.ts`
- Create: `src/teams/__tests__/worktree-isolation.test.ts`

**Step 1: 写失败测试**

```typescript
// src/teams/__tests__/worktree-isolation.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { WorktreeIsolation } from "../isolation/worktree-isolation.js"
import * as fs from "fs/promises"
import * as path from "path"

describe("WorktreeIsolation", () => {
  let isolation: WorktreeIsolation
  const testDir = "/tmp/worktree-test"

  beforeEach(async () => {
    isolation = new WorktreeIsolation({ baseDir: testDir })
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await isolation.cleanup()
    await fs.rm(testDir, { recursive: true, force: true })
  })

  it("should create worktree isolation", () => {
    expect(isolation).toBeDefined()
  })

  it("should create worker worktree", async () => {
    const handle = await isolation.createWorkerWorktree("worker-1")
    expect(handle.path).toContain("worker-1")
    expect(handle.branch).toBeDefined()
  })

  it("should cleanup worktrees", async () => {
    await isolation.createWorkerWorktree("worker-2")
    await isolation.cleanup()
    const remaining = await isolation.listActive()
    expect(remaining.length).toBe(0)
  })
})
```

**Step 2: 运行测试确认失败**

Run: `npm run test -- src/teams/__tests__/worktree-isolation.test.ts`
Expected: FAIL

**Step 3: 从 minimax 复制 worktree-isolation.ts**

```bash
cp /home/xu/code/agent/worktree/opencode_lite_minimax/src/teams/worktree-isolation.ts src/teams/isolation/worktree-isolation.ts
```

**Step 4: 验证安全性 (execFile 而非 exec)**

```typescript
// 确保使用 execFile 避免命令注入
// 检查 src/teams/isolation/worktree-isolation.ts 第1行
import { execFile } from "child_process"  // ✅ 安全
```

**Step 5: 运行测试确认通过**

Run: `npm run test -- src/teams/__tests__/worktree-isolation.test.ts`
Expected: PASS (3 tests)

**Step 6: 提交**

```bash
git add src/teams/isolation/worktree-isolation.ts src/teams/__tests__/worktree-isolation.test.ts
git commit -m "feat(teams): add worktree isolation from minimax"
```

---

## Task 6: 合并 Ralph Loop (来自 codex)

**Files:**
- Create: `src/teams/loop/ralph-loop.ts`
- Create: `src/teams/__tests__/ralph-loop.test.ts`

**Step 1: 写失败测试**

```typescript
// src/teams/__tests__/ralph-loop.test.ts
import { describe, it, expect } from "vitest"
import { RalphLoopManager, RalphTaskQueue } from "../loop/ralph-loop.js"

describe("RalphLoopManager", () => {
  it("should parse empty queue", () => {
    const manager = new RalphLoopManager()
    const queue = manager.loadQueue("/nonexistent/path")
    expect(queue.pending).toEqual([])
    expect(queue.inProgress).toEqual([])
    expect(queue.completed).toEqual([])
  })

  it("should save and load queue", () => {
    const manager = new RalphLoopManager()
    const queue: RalphTaskQueue = {
      pending: ["task-1", "task-2"],
      inProgress: ["task-3"],
      completed: ["task-0"],
    }
    const path = "/tmp/test-queue.md"
    manager.saveQueue(path, queue)
    const loaded = manager.loadQueue(path)
    expect(loaded.pending).toEqual(["task-1", "task-2"])
    expect(loaded.inProgress).toEqual(["task-3"])
    expect(loaded.completed).toEqual(["task-0"])
  })

  it("should dequeue pending task", () => {
    const manager = new RalphLoopManager()
    const queue: RalphTaskQueue = {
      pending: ["task-1", "task-2"],
      inProgress: [],
      completed: [],
    }
    const task = manager.dequeuePending(queue)
    expect(task).toBe("task-1")
    expect(queue.pending).toEqual(["task-2"])
    expect(queue.inProgress).toEqual(["task-1"])
  })

  it("should mark task completed", () => {
    const manager = new RalphLoopManager()
    const queue: RalphTaskQueue = {
      pending: [],
      inProgress: ["task-1"],
      completed: [],
    }
    manager.markCompleted(queue, "task-1")
    expect(queue.inProgress).toEqual([])
    expect(queue.completed).toEqual(["task-1"])
  })
})
```

**Step 2: 运行测试确认失败**

Run: `npm run test -- src/teams/__tests__/ralph-loop.test.ts`
Expected: FAIL

**Step 3: 从 codex 复制 ralph-loop.ts**

```bash
cp /home/xu/code/agent/worktree/opencode_lite_codex/src/teams/ralph-loop.ts src/teams/loop/ralph-loop.ts
```

**Step 4: 运行测试确认通过**

Run: `npm run test -- src/teams/__tests__/ralph-loop.test.ts`
Expected: PASS (4 tests)

**Step 5: 提交**

```bash
git add src/teams/loop/ralph-loop.ts src/teams/__tests__/ralph-loop.test.ts
git commit -m "feat(teams): add ralph loop for continuous execution"
```

---

## Task 7: 合并 Drill 测试工具 (来自 codex)

**Files:**
- Create: `src/teams/testing/drill.ts`
- Create: `src/teams/__tests__/drill.test.ts`

**Step 1: 写失败测试**

```typescript
// src/teams/__tests__/drill.test.ts
import { describe, it, expect } from "vitest"
import { runDrillScenario } from "../testing/drill.js"

describe("Drill", () => {
  it("should run timeout fallback drill", async () => {
    const result = await runDrillScenario("timeout-fallback")
    expect(result.id).toBe("drill-timeout-fallback")
    expect(result.passed).toBeDefined()
    expect(result.metrics).toBeDefined()
  })

  it("should run budget exceeded drill", async () => {
    const result = await runDrillScenario("budget-fallback")
    expect(result.id).toBe("drill-budget-fallback")
  })

  it("should run checkpoint rollback drill", async () => {
    const result = await runDrillScenario("checkpoint-rollback")
    expect(result.id).toBe("drill-checkpoint-rollback")
  })
})
```

**Step 2: 运行测试确认失败**

Run: `npm run test -- src/teams/__tests__/drill.test.ts`
Expected: FAIL

**Step 3: 从 codex 复制 drill.ts**

```bash
cp /home/xu/code/agent/worktree/opencode_lite_codex/src/teams/drill.ts src/teams/testing/drill.ts
```

**Step 4: 调整导入路径**

```typescript
// 在 src/teams/testing/drill.ts 中修改导入
import { CheckpointStore } from "../storage/checkpoint-store.js"
import { TeamManager } from "../manager.js"
```

**Step 5: 运行测试确认通过**

Run: `npm run test -- src/teams/__tests__/drill.test.ts`
Expected: PASS

**Step 6: 提交**

```bash
git add src/teams/testing/drill.ts src/teams/__tests__/drill.test.ts
git commit -m "feat(teams): add drill testing framework from codex"
```

---

## Task 8: 合并协作模式 (来自 kimi)

**Files:**
- Create: `src/teams/modes/council.ts`
- Create: `src/teams/modes/leader-workers.ts`
- Create: `src/teams/modes/planner-executor-reviewer.ts`
- Create: `src/teams/modes/worker-reviewer.ts`
- Create: `src/teams/modes/hotfix-guardrail.ts`
- Create: `src/teams/__tests__/modes.test.ts`

**Step 1: 写失败测试**

```typescript
// src/teams/__tests__/modes.test.ts
import { describe, it, expect } from "vitest"
import { CouncilRunner } from "../modes/council.js"
import { LeaderWorkersRunner } from "../modes/leader-workers.js"

describe("Modes", () => {
  it("should create council runner", () => {
    const runner = new CouncilRunner({ mode: "council", maxIterations: 5, timeoutMs: 60000, budget: { maxTokens: 10000 }, qualityGate: { requiredChecks: [], autoFixOnFail: false } })
    expect(runner).toBeDefined()
  })

  it("should create leader-workers runner", () => {
    const runner = new LeaderWorkersRunner(
      { mode: "leader-workers", maxIterations: 10, timeoutMs: 300000, budget: { maxTokens: 100000 }, qualityGate: { requiredChecks: [], autoFixOnFail: false } },
      { leaderExecutor: async () => ({ tasks: [] }), workerExecutor: async () => ({ taskId: "1", summary: "", changedFiles: [], patchRef: "", testResults: [], risks: [], assumptions: [] }) }
    )
    expect(runner).toBeDefined()
  })
})
```

**Step 2: 运行测试确认失败**

Run: `npm run test -- src/teams/__tests__/modes.test.ts`
Expected: FAIL

**Step 3: 从 kimi 复制所有 modes**

```bash
cp /home/xu/code/agent/worktree/opencode_lite_kimi/src/teams/modes/*.ts src/teams/modes/
```

**Step 4: 调整导入路径**

```typescript
// 在每个 mode 文件中更新导入
import type { TeamConfig } from "../core/types.js"
import { SharedBlackboard } from "../storage/blackboard.js"
```

**Step 5: 运行测试确认通过**

Run: `npm run test -- src/teams/__tests__/modes.test.ts`
Expected: PASS

**Step 6: 提交**

```bash
git add src/teams/modes/*.ts src/teams/__tests__/modes.test.ts
git commit -m "feat(teams): add collaboration modes from kimi"
```

---

## Task 9: 创建统一导出和集成测试

**Files:**
- Create: `src/teams/index.ts`
- Create: `src/teams/core/index.ts`
- Create: `src/teams/__tests__/integration.test.ts`

**Step 1: 写失败测试**

```typescript
// src/teams/__tests__/integration.test.ts
import { describe, it, expect } from "vitest"
import { TeamManager, AgentPool, WorktreeIsolation, RalphLoopManager } from "../index.js"

describe("Integration", () => {
  it("should export all components", () => {
    expect(TeamManager).toBeDefined()
    expect(AgentPool).toBeDefined()
    expect(WorktreeIsolation).toBeDefined()
    expect(RalphLoopManager).toBeDefined()
  })

  it("should create complete team setup", () => {
    const pool = new AgentPool({ maxInstances: 5 })
    const manager = new TeamManager({
      mode: "leader-workers",
      maxIterations: 10,
      timeoutMs: 300000,
      budget: { maxTokens: 100000 },
      qualityGate: { requiredChecks: [], autoFixOnFail: false },
    })
    expect(pool).toBeDefined()
    expect(manager).toBeDefined()
  })
})
```

**Step 2: 运行测试确认失败**

Run: `npm run test -- src/teams/__tests__/integration.test.ts`
Expected: FAIL

**Step 3: 创建导出文件**

```typescript
// src/teams/core/index.ts
export * from "./types.js"
export * from "./contracts.js"
```

```typescript
// src/teams/index.ts
// Core
export * from "./core/types.js"
export * from "./core/contracts.js"

// Client
export { AgentLLMClient } from "./client/llm-client.js"
export { AgentPool } from "./client/agent-pool.js"

// Storage
export { SharedBlackboard } from "./storage/blackboard.js"
export { CheckpointStore } from "./storage/checkpoint-store.js"
export { ArtifactStore } from "./storage/artifact-store.js"

// Execution
export { TaskDAG } from "./execution/task-dag.js"
export { ProgressTracker } from "./execution/progress-tracker.js"
export { CostController } from "./execution/cost-controller.js"
export { ConflictDetector } from "./execution/conflict-detector.js"
export { FallbackHandler } from "./execution/fallback.js"

// Isolation
export { WorktreeIsolation } from "./isolation/worktree-isolation.js"

// Evaluation
export { RubricEvaluator } from "./evaluation/evaluator.js"
export { runBenchmark } from "./evaluation/benchmark.js"

// Loop
export { RalphLoopManager } from "./loop/ralph-loop.js"

// Testing
export { runDrillScenario } from "./testing/drill.js"

// Modes
export { CouncilRunner } from "./modes/council.js"
export { LeaderWorkersRunner } from "./modes/leader-workers.js"
export { PlannerExecutorReviewerRunner } from "./modes/planner-executor-reviewer.js"
export { WorkerReviewerRunner } from "./modes/worker-reviewer.js"
export { HotfixGuardrailRunner } from "./modes/hotfix-guardrail.js"

// Manager
export { TeamManager, defaultTeamConfig } from "./manager.js"
```

**Step 4: 运行测试确认通过**

Run: `npm run test -- src/teams/__tests__/integration.test.ts`
Expected: PASS

**Step 5: 运行所有测试**

Run: `npm run test -- src/teams/`
Expected: PASS (all tests)

**Step 6: 提交**

```bash
git add src/teams/index.ts src/teams/core/index.ts src/teams/__tests__/integration.test.ts
git commit -m "feat(teams): add unified exports and integration tests"
```

---

## Task 10: 更新 CLAUDE.md 文档

**Files:**
- Modify: `CLAUDE.md`

**Step 1: 添加 Teams 架构文档**

在 `CLAUDE.md` 中添加:

```markdown
### Agent Teams System (`src/teams/`)

多 Agent 协作系统，支持多种协作模式：

| 目录 | 用途 |
|------|------|
| `core/` | 核心类型和契约 |
| `client/` | LLM 客户端和 Agent 池 |
| `storage/` | 黑板、检查点、产物存储 |
| `execution/` | 任务 DAG、进度追踪、成本控制 |
| `isolation/` | Git Worktree 隔离 |
| `evaluation/` | 评估器、基线测试 |
| `loop/` | Ralph 持续执行循环 |
| `testing/` | Drill 演练测试框架 |
| `modes/` | 协作模式 (council, leader-workers 等) |

**使用示例**:
```typescript
import { TeamManager, AgentPool } from "./teams"

const pool = new AgentPool({ maxInstances: 5 })
const manager = new TeamManager({
  mode: "leader-workers",
  maxIterations: 10,
  // ...
})
const result = await manager.runTask("Add user authentication")
```
```

**Step 2: 提交**

```bash
git add CLAUDE.md
git commit -m "docs: add Agent Teams architecture to CLAUDE.md"
```

---

## Execution Handoff

Plan complete and saved to `docs/plans/2026-03-01-merge-teams-branches.md`.

**Two execution options:**

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
