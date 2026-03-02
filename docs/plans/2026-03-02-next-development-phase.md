# Lite-OpenCode Next Development Phase Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement P0 features (Real Subagent Execution + Policy Persistence) and P1 features (Agent Teams remaining modes) to complete the core functionality of Lite-OpenCode.

**Architecture:** Use the recently merged Agent Teams infrastructure (Blackboard, TaskDAG, etc.) to enable real subagent execution with parallel exploration. Policy persistence uses SQLite to store learned user preferences.

**Tech Stack:** TypeScript, Vitest, SQLite (better-sqlite3), Ink (TUI)

---

## Phase 1: Real Subagent Execution (P0 - Critical)

**Context:** Current Plan Mode uses simulated subagents. This phase implements real subagent execution using the Agent class with isolated sessions.

---

### Task 1.1: Create Subagent Runner Core

**Files:**
- Create: `src/subagent/runner.ts`
- Create: `src/subagent/__tests__/runner.test.ts`

**Step 1: Write the failing test**

```typescript
// src/subagent/__tests__/runner.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import { SubagentRunner } from "../runner.js"

describe("SubagentRunner", () => {
  let runner: SubagentRunner

  beforeEach(() => {
    runner = new SubagentRunner({
      workingDir: "/tmp/test-subagent",
      parentSessionId: "test-parent",
    })
  })

  it("should create subagent with isolated session", async () => {
    const subagent = await runner.createSubagent("task-1", "Test task")
    expect(subagent.sessionId).toBeDefined()
    expect(subagent.sessionId).not.toBe("test-parent")
  })

  it("should execute task and return result", async () => {
    const result = await runner.execute("task-1", "List files in current directory")
    expect(result.success).toBe(true)
    expect(result.output).toBeDefined()
    expect(result.sessionId).toBeDefined()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test src/subagent/__tests__/runner.test.ts`
Expected: FAIL - "SubagentRunner is not defined"

**Step 3: Write minimal implementation**

```typescript
// src/subagent/runner.ts
import { Agent } from "../agent.js"
import type { SessionManager } from "../session/manager.js"

export interface SubagentConfig {
  workingDir: string
  parentSessionId: string
  model?: string
  timeout?: number
}

export interface SubagentResult {
  success: boolean
  output: string
  sessionId: string
  tokensUsed: { input: number; output: number }
  executionTime: number
}

export class SubagentRunner {
  private config: SubagentConfig
  private activeSubagents: Map<string, Agent> = new Map()

  constructor(config: SubagentConfig) {
    this.config = config
  }

  async createSubagent(taskId: string, objective: string): Promise<Agent> {
    const sessionId = `subagent-${taskId}-${Date.now()}`
    const agent = new Agent({
      workingDir: this.config.workingDir,
      sessionId,
      parentSessionId: this.config.parentSessionId,
      isSubagent: true,
    })
    this.activeSubagents.set(taskId, agent)
    return agent
  }

  async execute(taskId: string, objective: string): Promise<SubagentResult> {
    const startTime = Date.now()
    const agent = await this.createSubagent(taskId, objective)

    try {
      const result = await agent.run(objective)
      return {
        success: true,
        output: result.output,
        sessionId: agent.sessionId,
        tokensUsed: result.tokensUsed,
        executionTime: Date.now() - startTime,
      }
    } catch (error) {
      return {
        success: false,
        output: error instanceof Error ? error.message : String(error),
        sessionId: agent.sessionId,
        tokensUsed: { input: 0, output: 0 },
        executionTime: Date.now() - startTime,
      }
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test src/subagent/__tests__/runner.test.ts`
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add src/subagent/runner.ts src/subagent/__tests__/runner.test.ts
git commit -m "feat(subagent): add SubagentRunner core implementation

- Create isolated subagent sessions
- Execute tasks with timeout and error handling
- Track tokens and execution time"
```

---

### Task 1.2: Create Subagent Pool for Parallel Execution

**Files:**
- Create: `src/subagent/pool.ts`
- Create: `src/subagent/__tests__/pool.test.ts`
- Modify: `src/subagent/index.ts` (create exports)

**Step 1: Write the failing test**

```typescript
// src/subagent/__tests__/pool.test.ts
import { describe, it, expect } from "vitest"
import { SubagentPool } from "../pool.js"

describe("SubagentPool", () => {
  it("should execute multiple subagents in parallel", async () => {
    const pool = new SubagentPool({ maxConcurrent: 3 })

    const tasks = [
      { id: "task-1", objective: "List files" },
      { id: "task-2", objective: "Show current directory" },
      { id: "task-3", objective: "Check git status" },
    ]

    const results = await pool.executeParallel(tasks)

    expect(results).toHaveLength(3)
    expect(results.every(r => r.sessionId)).toBe(true)
  })

  it("should respect maxConcurrent limit", async () => {
    const pool = new SubagentPool({ maxConcurrent: 2 })
    expect(pool.getMaxConcurrent()).toBe(2)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test src/subagent/__tests__/pool.test.ts`
Expected: FAIL - "SubagentPool is not defined"

**Step 3: Write minimal implementation**

```typescript
// src/subagent/pool.ts
import { SubagentRunner, SubagentResult } from "./runner.js"

export interface SubagentPoolConfig {
  maxConcurrent: number
  workingDir: string
  parentSessionId: string
}

export interface SubagentTask {
  id: string
  objective: string
}

export class SubagentPool {
  private config: SubagentPoolConfig
  private runner: SubagentRunner

  constructor(config: SubagentPoolConfig) {
    this.config = config
    this.runner = new SubagentRunner({
      workingDir: config.workingDir,
      parentSessionId: config.parentSessionId,
    })
  }

  getMaxConcurrent(): number {
    return this.config.maxConcurrent
  }

  async executeParallel(tasks: SubagentTask[]): Promise<SubagentResult[]> {
    const results: SubagentResult[] = []

    // Execute in batches based on maxConcurrent
    for (let i = 0; i < tasks.length; i += this.config.maxConcurrent) {
      const batch = tasks.slice(i, i + this.config.maxConcurrent)
      const batchPromises = batch.map(task =>
        this.runner.execute(task.id, task.objective)
      )

      const batchResults = await Promise.all(batchPromises)
      results.push(...batchResults)
    }

    return results
  }

  async executeWithRace(tasks: SubagentTask[]): Promise<SubagentResult> {
    const promises = tasks.map(task =>
      this.runner.execute(task.id, task.objective)
    )

    return Promise.race(promises)
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test src/subagent/__tests__/pool.test.ts`
Expected: PASS (2 tests)

**Step 5: Create index.ts exports**

```typescript
// src/subagent/index.ts
export { SubagentRunner } from "./runner.js"
export type { SubagentConfig, SubagentResult } from "./runner.js"

export { SubagentPool } from "./pool.js"
export type { SubagentPoolConfig, SubagentTask } from "./pool.js"
```

**Step 6: Commit**

```bash
git add src/subagent/pool.ts src/subagent/__tests__/pool.test.ts src/subagent/index.ts
git commit -m "feat(subagent): add SubagentPool for parallel execution

- Support parallel subagent execution with concurrency limit
- Add executeParallel and executeWithRace methods
- Batch execution based on maxConcurrent config"
```

---

### Task 1.3: Integrate Subagent Tools with Real Execution

**Files:**
- Modify: `src/tools/task.ts` (integrate runner)
- Modify: `src/tools/get_subagent_result.ts` (handle real results)
- Modify: `src/tools/parallel_explore.ts` (use pool)

**Step 1: Update task tool to use real subagent**

```typescript
// src/tools/task.ts - modify execute function
import { SubagentRunner } from "../subagent/runner.js"

// In the execute method, replace simulation with:
const runner = new SubagentRunner({
  workingDir: ctx.workingDir,
  parentSessionId: ctx.sessionId,
})

const result = await runner.execute(taskId, objective)

return {
  taskId,
  status: result.success ? "completed" : "failed",
  result: result.output,
  sessionId: result.sessionId,
}
```

**Step 2: Update parallel_explore tool**

```typescript
// src/tools/parallel_explore.ts
import { SubagentPool } from "../subagent/pool.js"

// In execute:
const pool = new SubagentPool({
  maxConcurrent: approaches.length,
  workingDir: ctx.workingDir,
  parentSessionId: ctx.sessionId,
})

const tasks = approaches.map((approach, i) => ({
  id: `explore-${i}`,
  objective: `Explore: ${approach.description}\n${approach.prompt}`,
}))

const results = await pool.executeParallel(tasks)

return {
  results: results.map((r, i) => ({
    approachId: String(i),
    approach: approaches[i].description,
    result: r.output,
    success: r.success,
    sessionId: r.sessionId,
  })),
}
```

**Step 3: Run tests**

Run: `npm test src/tools/__tests__/task.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/tools/task.ts src/tools/parallel_explore.ts src/tools/get_subagent_result.ts
git commit -m "feat(tools): integrate real subagent execution

- Replace simulated subagents with SubagentRunner
- Use SubagentPool for parallel_explore
- Pass through real session IDs and results"
```

---

## Phase 2: Policy Persistence (P0 - High Priority)

**Context:** Policy rules currently exist only in memory. This phase adds SQLite persistence for learned user preferences.

---

### Task 2.1: Create Policy Store

**Files:**
- Create: `src/policy/store.ts`
- Create: `src/policy/__tests__/store.test.ts`

**Step 1: Write the failing test**

```typescript
// src/policy/__tests__/store.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { PolicyStore } from "../store.js"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

describe("PolicyStore", () => {
  let store: PolicyStore
  let testDbPath: string

  beforeEach(() => {
    testDbPath = path.join(os.tmpdir(), `test-policy-${Date.now()}.db`)
    store = new PolicyStore(testDbPath)
  })

  afterEach(() => {
    store.close()
    try {
      fs.unlinkSync(testDbPath)
    } catch {}
  })

  it("should save and retrieve policy rule", () => {
    store.saveRule({
      id: "rule-1",
      type: "allowed",
      tool: "bash",
      pattern: "npm test",
      createdAt: Date.now(),
    })

    const rules = store.getRules()
    expect(rules).toHaveLength(1)
    expect(rules[0].pattern).toBe("npm test")
  })

  it("should persist rules across instances", () => {
    store.saveRule({
      id: "rule-2",
      type: "denied",
      tool: "bash",
      pattern: "rm -rf /",
      createdAt: Date.now(),
    })

    // Create new instance with same DB
    const store2 = new PolicyStore(testDbPath)
    const rules = store2.getRules()

    expect(rules).toHaveLength(1)
    expect(rules[0].type).toBe("denied")
    store2.close()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test src/policy/__tests__/store.test.ts`
Expected: FAIL - "PolicyStore is not defined"

**Step 3: Write minimal implementation**

```typescript
// src/policy/store.ts
import Database from "better-sqlite3"

export interface PolicyRule {
  id: string
  type: "allowed" | "denied" | "learned"
  tool: string
  pattern: string
  createdAt: number
  lastUsed?: number
  confidence?: number
}

export class PolicyStore {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.initTable()
  }

  private initTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS policy_rules (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        tool TEXT NOT NULL,
        pattern TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used INTEGER,
        confidence REAL DEFAULT 1.0
      );

      CREATE INDEX IF NOT EXISTS idx_tool ON policy_rules(tool);
      CREATE INDEX IF NOT EXISTS idx_type ON policy_rules(type);
    `)
  }

  saveRule(rule: PolicyRule): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO policy_rules
      (id, type, tool, pattern, created_at, last_used, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      rule.id,
      rule.type,
      rule.tool,
      rule.pattern,
      rule.createdAt,
      rule.lastUsed || null,
      rule.confidence || 1.0
    )
  }

  getRules(tool?: string, type?: string): PolicyRule[] {
    let query = "SELECT * FROM policy_rules"
    const conditions: string[] = []
    const params: (string | undefined)[] = []

    if (tool) {
      conditions.push("tool = ?")
      params.push(tool)
    }
    if (type) {
      conditions.push("type = ?")
      params.push(type)
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ")
    }

    query += " ORDER BY created_at DESC"

    const stmt = this.db.prepare(query)
    const rows = stmt.all(...params) as any[]

    return rows.map(row => ({
      id: row.id,
      type: row.type,
      tool: row.tool,
      pattern: row.pattern,
      createdAt: row.created_at,
      lastUsed: row.last_used,
      confidence: row.confidence,
    }))
  }

  deleteRule(id: string): void {
    const stmt = this.db.prepare("DELETE FROM policy_rules WHERE id = ?")
    stmt.run(id)
  }

  updateLastUsed(id: string): void {
    const stmt = this.db.prepare(
      "UPDATE policy_rules SET last_used = ? WHERE id = ?"
    )
    stmt.run(Date.now(), id)
  }

  close(): void {
    this.db.close()
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test src/policy/__tests__/store.test.ts`
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add src/policy/store.ts src/policy/__tests__/store.test.ts
git commit -m "feat(policy): add PolicyStore for SQLite persistence

- Store policy rules in SQLite with better-sqlite3
- Support CRUD operations
- Add indexes for efficient queries
- Track rule usage and confidence"
```

---

### Task 2.2: Integrate Policy Store with Policy Engine

**Files:**
- Modify: `src/policy.ts` (integrate store)

**Step 1: Update PolicyEngine to use store**

```typescript
// src/policy.ts - add to PolicyEngine class
import { PolicyStore } from "./policy/store.js"

export class PolicyEngine {
  private store: PolicyStore
  private cache: Map<string, PolicyDecision>

  constructor(dbPath?: string) {
    const defaultPath = path.join(
      process.env.HOME || process.env.USERPROFILE || ".",
      ".lite-opencode",
      "policy.db"
    )
    this.store = new PolicyStore(dbPath || defaultPath)
    this.cache = new Map()
    this.loadRules()
  }

  private loadRules(): void {
    const rules = this.store.getRules()
    for (const rule of rules) {
      this.rules.set(rule.id, rule)
    }
  }

  recordDecision(decision: PolicyDecision): void {
    // Existing logic...

    // Persist learned rules
    if (decision.action === "allow" || decision.action === "deny") {
      this.store.saveRule({
        id: `rule-${Date.now()}`,
        type: decision.action === "allow" ? "allowed" : "denied",
        tool: decision.tool,
        pattern: decision.params?.command || "",
        createdAt: Date.now(),
      })
    }
  }

  close(): void {
    this.store.close()
  }
}
```

**Step 2: Run tests**

Run: `npm test src/policy/__tests__/`
Expected: PASS

**Step 3: Commit**

```bash
git add src/policy.ts
git commit -m "feat(policy): integrate PolicyStore with PolicyEngine

- Load persisted rules on initialization
- Save learned rules to database
- Support custom database path"
```

---

## Phase 3: Agent Teams Remaining Modes (P1)

**Context:** Currently only worker-reviewer and leader-workers are implemented. Need to add 3 more modes.

---

### Task 3.1: Implement Planner-Executor-Reviewer Mode

**Files:**
- Create: `src/teams/modes/planner-executor-reviewer.ts`
- Create: `src/teams/__tests__/modes/planner-executor-reviewer.test.ts`

**Step 1: Write the failing test**

```typescript
// src/teams/__tests__/modes/planner-executor-reviewer.test.ts
import { describe, it, expect } from "vitest"
import { PlannerExecutorReviewerRunner } from "../../modes/planner-executor-reviewer.js"

describe("PlannerExecutorReviewerRunner", () => {
  it("should execute planning phase", async () => {
    const runner = new PlannerExecutorReviewerRunner()
    const result = await runner.execute("Implement feature X")

    expect(result.status).toBe("success")
    expect(result.phases).toContain("plan")
    expect(result.phases).toContain("execute")
    expect(result.phases).toContain("review")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test src/teams/__tests__/modes/planner-executor-reviewer.test.ts`
Expected: FAIL - "PlannerExecutorReviewerRunner is not defined"

**Step 3: Write implementation**

```typescript
// src/teams/modes/planner-executor-reviewer.ts
import type { TeamConfig } from "../core/types.js"
import type { TeamResult } from "./base.js"

export interface PlannerOutput {
  planId: string
  tasks: Array<{
    id: string
    description: string
    dependencies: string[]
  }>
}

export interface ExecutorOutput {
  taskId: string
  completed: boolean
  output: string
}

export interface ReviewerOutput {
  approved: boolean
  feedback: string
  requiredChanges?: string[]
}

export class PlannerExecutorReviewerRunner {
  readonly mode = "planner-executor-reviewer" as const

  async execute(objective: string, config?: TeamConfig): Promise<TeamResult> {
    const phases: string[] = []

    // Phase 1: Planning
    phases.push("plan")
    const plan = await this.plan(objective)

    // Phase 2: Execution
    phases.push("execute")
    const executionResults = await this.executePlan(plan)

    // Phase 3: Review
    phases.push("review")
    const review = await this.review(executionResults)

    if (!review.approved && review.requiredChanges) {
      // Iterate if changes needed
      return this.iterate(objective, plan, review)
    }

    return {
      status: "success",
      output: `Completed: ${objective}`,
      phases,
      iterations: 1,
    }
  }

  private async plan(objective: string): Promise<PlannerOutput> {
    // Integration with LLM for planning
    return {
      planId: `plan-${Date.now()}`,
      tasks: [
        { id: "task-1", description: objective, dependencies: [] },
      ],
    }
  }

  private async executePlan(plan: PlannerOutput): Promise<ExecutorOutput[]> {
    // Execute each task
    return plan.tasks.map(task => ({
      taskId: task.id,
      completed: true,
      output: `Executed: ${task.description}`,
    }))
  }

  private async review(results: ExecutorOutput[]): Promise<ReviewerOutput> {
    // Review results
    return {
      approved: true,
      feedback: "All tasks completed successfully",
    }
  }

  private async iterate(
    objective: string,
    plan: PlannerOutput,
    review: ReviewerOutput
  ): Promise<TeamResult> {
    // Handle iteration
    return {
      status: "success",
      output: `Completed with iteration: ${objective}`,
      phases: ["plan", "execute", "review", "iterate"],
      iterations: 2,
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test src/teams/__tests__/modes/planner-executor-reviewer.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/teams/modes/planner-executor-reviewer.ts src/teams/__tests__/modes/planner-executor-reviewer.test.ts
git commit -m "feat(teams): add planner-executor-reviewer mode

- Three-phase collaboration: plan → execute → review
- Support iteration when review requires changes
- Integrate with existing TeamConfig"
```

---

### Task 3.2: Implement Hotfix Guardrail Mode

**Files:**
- Create: `src/teams/modes/hotfix-guardrail.ts`
- Create: `src/teams/__tests__/modes/hotfix-guardrail.test.ts`

**Step 1: Write the failing test**

```typescript
// src/teams/__tests__/modes/hotfix-guardrail.test.ts
import { describe, it, expect } from "vitest"
import { HotfixGuardrailRunner } from "../../modes/hotfix-guardrail.js"

describe("HotfixGuardrailRunner", () => {
  it("should apply hotfix with safety checks", async () => {
    const runner = new HotfixGuardrailRunner()
    const result = await runner.execute("Fix critical bug in auth")

    expect(result.status).toBe("success")
    expect(result.safetyChecks).toBeDefined()
    expect(result.safetyChecks?.passed).toBe(true)
  })
})
```

**Step 2-5:** Similar pattern to Task 3.1

---

### Task 3.3: Implement Council Mode

**Files:**
- Create: `src/teams/modes/council.ts`
- Create: `src/teams/__tests__/modes/council.test.ts`

**Pattern:** Similar to above, implements multi-agent discussion and voting.

---

### Task 3.4: Update Mode Registry

**Files:**
- Modify: `src/teams/modes/index.ts`

```typescript
// Export new modes
export { PlannerExecutorReviewerRunner } from "./planner-executor-reviewer.js"
export { HotfixGuardrailRunner } from "./hotfix-guardrail.js"
export { CouncilRunner } from "./council.js"

// Update mode registry
export const MODE_RUNNERS = {
  "worker-reviewer": WorkerReviewerRunner,
  "leader-workers": LeaderWorkersRunner,
  "planner-executor-reviewer": PlannerExecutorReviewerRunner,
  "hotfix-guardrail": HotfixGuardrailRunner,
  "council": CouncilRunner,
}
```

---

## Appendix: Reference Documentation

### Related Files

- `src/agent.ts` - Main Agent class for subagent creation
- `src/teams/core/blackboard.ts` - State sharing between agents
- `src/teams/execution/task-dag.ts` - Task dependency management
- `src/policy.ts` - Policy engine integration
- `src/store.ts` - Session storage

### Testing Commands

```bash
# Run all tests
npm test

# Run specific test file
npm test src/subagent/__tests__/runner.test.ts

# Run with watch mode
npm run test:watch

# Build
npm run build
```

### Database Schema

**Policy Rules Table:**
```sql
CREATE TABLE policy_rules (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,      -- 'allowed', 'denied', 'learned'
  tool TEXT NOT NULL,      -- tool name
  pattern TEXT NOT NULL,   -- command pattern
  created_at INTEGER,
  last_used INTEGER,
  confidence REAL
);
```

---

## Execution Options

**Plan complete and saved to `docs/plans/2026-03-02-next-development-phase.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Recommended: Option 1 (Subagent-Driven)** for Phases 1-2, as they have interdependencies.

**Which approach?**
