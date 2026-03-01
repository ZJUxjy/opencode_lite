# Ralph Loop Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enhance Ralph Loop with Stream JSON output, parallel execution, Plan Mode integration, and health monitoring.

**Architecture:** Extend existing `ralph-loop.ts` with new configuration options and execution modes. Integrate with existing `worktree-isolation.ts` for parallel workers and `plan/manager.ts` for Plan Mode support.

**Tech Stack:** TypeScript, Node.js, Vitest for testing

---

## Task 1: Stream JSON Output - Types and Configuration

**Files:**
- Modify: `src/teams/ralph-loop.ts:1-70`
- Test: `src/teams/__tests__/ralph-loop-stream.test.ts`

**Step 1: Write the failing test for event types**

```typescript
// src/teams/__tests__/ralph-loop-stream.test.ts
import { describe, it, expect } from "vitest"
import { RalphLoop, type RalphEvent, type RalphLoopConfig } from "../index.js"

describe("RalphLoop Stream JSON Output", () => {
  describe("RalphEvent types", () => {
    it("should define start event type", () => {
      const event: RalphEvent = {
        type: "start",
        timestamp: Date.now(),
        config: { maxIterations: 10 } as RalphLoopConfig,
      }
      expect(event.type).toBe("start")
    })

    it("should define task_start event type", () => {
      const event: RalphEvent = {
        type: "task_start",
        timestamp: Date.now(),
        taskId: "task-1",
        description: "Test task",
        priority: "high",
      }
      expect(event.type).toBe("task_start")
    })

    it("should define task_complete event type", () => {
      const event: RalphEvent = {
        type: "task_complete",
        timestamp: Date.now(),
        taskId: "task-1",
        success: true,
        duration: 1000,
        tokens: 500,
      }
      expect(event.type).toBe("task_complete")
    })

    it("should define heartbeat event type", () => {
      const event: RalphEvent = {
        type: "heartbeat",
        timestamp: Date.now(),
        stats: {
          totalTasks: 1,
          completedTasks: 1,
          failedTasks: 0,
          skippedTasks: 0,
          totalDuration: 1000,
          totalCost: 0.01,
          totalTokens: 500,
        },
        runningTasks: 0,
      }
      expect(event.type).toBe("heartbeat")
    })

    it("should define complete event type", () => {
      const event: RalphEvent = {
        type: "complete",
        timestamp: Date.now(),
        stats: {
          totalTasks: 1,
          completedTasks: 1,
          failedTasks: 0,
          skippedTasks: 0,
          totalDuration: 1000,
          totalCost: 0.01,
          totalTokens: 500,
        },
      }
      expect(event.type).toBe("complete")
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/teams/__tests__/ralph-loop-stream.test.ts`
Expected: FAIL with "RalphEvent is not defined"

**Step 3: Add RalphEvent types and config to ralph-loop.ts**

Add after line 47 (after `maxRetries` in `RalphLoopConfig`):

```typescript
/**
 * 输出格式
 */
export type OutputFormat = "text" | "json" | "stream-json"

/**
 * Ralph Loop 事件（用于 stream-json 输出）
 */
export type RalphEvent =
  | { type: "start"; timestamp: number; config: RalphLoopConfig }
  | { type: "task_start"; timestamp: number; taskId: string; description: string; priority: string }
  | { type: "task_complete"; timestamp: number; taskId: string; success: boolean; duration: number; tokens: number; error?: string }
  | { type: "iteration"; timestamp: number; iteration: number; maxIterations: number }
  | { type: "heartbeat"; timestamp: number; stats: RalphLoopStats; runningTasks: number }
  | { type: "error"; timestamp: number; taskId: string; error: string }
  | { type: "complete"; timestamp: number; stats: RalphLoopStats }
```

Update `RalphLoopConfig` interface (add after `maxRetries`):

```typescript
  /** 输出格式 */
  outputFormat: OutputFormat
  /** 日志文件路径（可选） */
  logFile?: string
```

Update `DEFAULT_RALPH_CONFIG` (add after `maxRetries`):

```typescript
  outputFormat: "text",
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/teams/__tests__/ralph-loop-stream.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/teams/ralph-loop.ts src/teams/__tests__/ralph-loop-stream.test.ts
git commit -m "feat(teams): add RalphEvent types for stream-json output"
```

---

## Task 2: Stream JSON Output - Event Emission

**Files:**
- Modify: `src/teams/ralph-loop.ts:120-450`
- Test: `src/teams/__tests__/ralph-loop-stream.test.ts`

**Step 1: Write the failing test for event emission**

Add to `src/teams/__tests__/ralph-loop-stream.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"

describe("RalphLoop Event Emission", () => {
  const testDir = path.resolve(process.cwd(), ".test-ralph-stream")

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true })
    }
    // Create empty TASKS.md
    fs.writeFileSync(path.join(testDir, "TASKS.md"), "")
  })

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe("emitEvent", () => {
    it("should emit events to console in stream-json mode", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})

      const loop = new RalphLoop(
        { run: async () => "done" } as any,
        null,
        { cwd: testDir, outputFormat: "stream-json", maxIterations: 0 }
      )

      const event: RalphEvent = {
        type: "heartbeat",
        timestamp: Date.now(),
        stats: loop.getStats(),
        runningTasks: 0,
      }

      loop.emitEvent(event)

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(event))

      consoleSpy.mockRestore()
    })

    it("should emit events to file when logFile is set", () => {
      const logFile = path.join(testDir, "ralph.log")

      const loop = new RalphLoop(
        { run: async () => "done" } as any,
        null,
        { cwd: testDir, outputFormat: "stream-json", logFile, maxIterations: 0 }
      )

      const event: RalphEvent = {
        type: "heartbeat",
        timestamp: Date.now(),
        stats: loop.getStats(),
        runningTasks: 0,
      }

      loop.emitEvent(event)

      expect(fs.existsSync(logFile)).toBe(true)
      const content = fs.readFileSync(logFile, "utf-8")
      expect(content).toContain('"type":"heartbeat"')
    })

    it("should not emit to console in text mode", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})

      const loop = new RalphLoop(
        { run: async () => "done" } as any,
        null,
        { cwd: testDir, outputFormat: "text", maxIterations: 0 }
      )

      const event: RalphEvent = {
        type: "heartbeat",
        timestamp: Date.now(),
        stats: loop.getStats(),
        runningTasks: 0,
      }

      loop.emitEvent(event)

      // Should not have been called with JSON
      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('"type":"heartbeat"'))

      consoleSpy.mockRestore()
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/teams/__tests__/ralph-loop-stream.test.ts`
Expected: FAIL with "emitEvent is not defined"

**Step 3: Add emitEvent method to RalphLoop class**

Add to `RalphLoop` class (after constructor):

```typescript
  /**
   * 发送事件
   */
  emitEvent(event: RalphEvent): void {
    const eventStr = JSON.stringify(event)

    // 输出到控制台
    if (this.config.outputFormat === "stream-json") {
      console.log(eventStr)
    }

    // 输出到文件
    if (this.config.logFile) {
      const logPath = path.resolve(this.config.cwd, this.config.logFile)
      fs.appendFileSync(logPath, eventStr + "\n", "utf-8")
    }
  }
```

Add import at top of file:

```typescript
import * as fs from "fs"
import * as path from "path"
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/teams/__tests__/ralph-loop-stream.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/teams/ralph-loop.ts src/teams/__tests__/ralph-loop-stream.test.ts
git commit -m "feat(teams): add emitEvent method for stream-json output"
```

---

## Task 3: Stream JSON Output - Integrate with Run Loop

**Files:**
- Modify: `src/teams/ralph-loop.ts:313-381`
- Test: `src/teams/__tests__/ralph-loop-stream.test.ts`

**Step 1: Write the failing test for integrated event emission**

Add to `src/teams/__tests__/ralph-loop-stream.test.ts`:

```typescript
describe("RalphLoop Integrated Event Emission", () => {
  const testDir = path.resolve(process.cwd(), ".test-ralph-integrated")

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true })
    }
  })

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  it("should emit start event when run begins", async () => {
    fs.writeFileSync(path.join(testDir, "TASKS.md"), "")

    const events: RalphEvent[] = []

    const loop = new RalphLoop(
      { run: async () => "done" } as any,
      null,
      { cwd: testDir, outputFormat: "stream-json", maxIterations: 0 }
    )

    // Capture events
    const originalEmit = loop.emitEvent.bind(loop)
    loop.emitEvent = (event) => {
      events.push(event)
      originalEmit(event)
    }

    await loop.run()

    const startEvent = events.find(e => e.type === "start")
    expect(startEvent).toBeDefined()
  })

  it("should emit complete event when run ends", async () => {
    fs.writeFileSync(path.join(testDir, "TASKS.md"), "")

    const events: RalphEvent[] = []

    const loop = new RalphLoop(
      { run: async () => "done" } as any,
      null,
      { cwd: testDir, outputFormat: "stream-json", maxIterations: 0 }
    )

    const originalEmit = loop.emitEvent.bind(loop)
    loop.emitEvent = (event) => {
      events.push(event)
      originalEmit(event)
    }

    await loop.run()

    const completeEvent = events.find(e => e.type === "complete")
    expect(completeEvent).toBeDefined()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/teams/__tests__/ralph-loop-stream.test.ts`
Expected: FAIL - start/complete events not emitted

**Step 3: Integrate event emission into run() method**

Modify the `run()` method. Add at the beginning (after the enabled check):

```typescript
    // Emit start event
    this.emitEvent({
      type: "start",
      timestamp: Date.now(),
      config: this.config,
    })
```

Add at the end (before `return this.stats`):

```typescript
    // Emit complete event
    this.emitEvent({
      type: "complete",
      timestamp: Date.now(),
      stats: this.stats,
    })
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/teams/__tests__/ralph-loop-stream.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/teams/ralph-loop.ts src/teams/__tests__/ralph-loop-stream.test.ts
git commit -m "feat(teams): integrate start/complete events in RalphLoop"
```

---

## Task 4: Heartbeat and Health Status

**Files:**
- Modify: `src/teams/ralph-loop.ts`
- Test: `src/teams/__tests__/ralph-loop-health.test.ts`

**Step 1: Write the failing test for health status**

```typescript
// src/teams/__tests__/ralph-loop-health.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import { RalphLoop, type HealthStatus, type RalphEvent } from "../index.js"

describe("RalphLoop Health Status", () => {
  const testDir = path.resolve(process.cwd(), ".test-ralph-health")

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true })
    }
  })

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe("getHealthStatus", () => {
    it("should return stopped status when not running", () => {
      const loop = new RalphLoop(
        { run: async () => "done" } as any,
        null,
        { cwd: testDir, maxIterations: 0 }
      )

      const status = loop.getHealthStatus()

      expect(status.status).toBe("stopped")
      expect(status.uptime).toBeGreaterThanOrEqual(0)
    })

    it("should include current task when running", async () => {
      fs.writeFileSync(path.join(testDir, "TASKS.md"), "- [ ] Test task\n")

      const loop = new RalphLoop(
        { run: async () => { await new Promise(r => setTimeout(r, 100)); return "done" } } as any,
        null,
        { cwd: testDir, maxIterations: 1 }
      )

      const runPromise = loop.run()

      // Give it a moment to start
      await new Promise(r => setTimeout(r, 50))

      const status = loop.getHealthStatus()

      expect(status.status).toBe("running")
      expect(status.currentTask).toBeDefined()

      await runPromise
    })
  })

  describe("Heartbeat", () => {
    it("should emit heartbeat events at interval", async () => {
      fs.writeFileSync(path.join(testDir, "TASKS.md"), "- [ ] Test task\n")

      const events: RalphEvent[] = []
      const heartbeatInterval = 50

      const loop = new RalphLoop(
        { run: async () => { await new Promise(r => setTimeout(r, 200)); return "done" } } as any,
        null,
        { cwd: testDir, maxIterations: 1, heartbeatInterval }
      )

      const originalEmit = loop.emitEvent.bind(loop)
      loop.emitEvent = (event) => {
        events.push(event)
        originalEmit(event)
      }

      await loop.run()

      const heartbeats = events.filter(e => e.type === "heartbeat")
      expect(heartbeats.length).toBeGreaterThanOrEqual(1)
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/teams/__tests__/ralph-loop-health.test.ts`
Expected: FAIL with "getHealthStatus is not defined"

**Step 3: Add HealthStatus type and methods**

Add type definition after `RalphEvent`:

```typescript
/**
 * 健康状态
 */
export interface HealthStatus {
  /** 运行状态 */
  status: "running" | "idle" | "stopped"
  /** 运行时间（毫秒） */
  uptime: number
  /** 当前任务 */
  currentTask?: string
  /** 统计信息 */
  stats: RalphLoopStats
  /** 最后心跳时间 */
  lastHeartbeat: number
}
```

Add properties and methods to `RalphLoop` class:

Add property after `private iteration: number = 0`:

```typescript
  private startTime: number = 0
  private currentTask: string | null = null
  private lastHeartbeat: number = 0
  private heartbeatTimer: NodeJS.Timeout | null = null
```

Add `getHealthStatus` method:

```typescript
  /**
   * 获取健康状态
   */
  getHealthStatus(): HealthStatus {
    return {
      status: this.running ? "running" : "stopped",
      uptime: this.startTime > 0 ? Date.now() - this.startTime : 0,
      currentTask: this.currentTask || undefined,
      stats: { ...this.stats },
      lastHeartbeat: this.lastHeartbeat,
    }
  }
```

Add heartbeat timer methods:

```typescript
  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    if (this.config.heartbeatInterval <= 0) return

    this.heartbeatTimer = setInterval(() => {
      this.lastHeartbeat = Date.now()
      this.emitEvent({
        type: "heartbeat",
        timestamp: this.lastHeartbeat,
        stats: this.stats,
        runningTasks: this.currentTask ? 1 : 0,
      })
    }, this.config.heartbeatInterval)
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }
```

Update `RalphLoopConfig` to add `heartbeatInterval`:

```typescript
  /** 心跳间隔（毫秒），0 表示禁用 */
  heartbeatInterval: number
```

Update `DEFAULT_RALPH_CONFIG`:

```typescript
  heartbeatInterval: 0,
```

Update `run()` method to use heartbeat:

```typescript
  async run(): Promise<RalphLoopStats> {
    if (!this.config.enabled) {
      this.emitEvent({
        type: "complete",
        timestamp: Date.now(),
        stats: this.stats,
      })
      return this.stats
    }

    this.running = true
    this.startTime = Date.now()

    // Emit start event
    this.emitEvent({
      type: "start",
      timestamp: this.startTime,
      config: this.config,
    })

    // Start heartbeat
    this.startHeartbeat()

    // ... existing loop code ...

    // Before each task, set currentTask
    this.currentTask = task.description

    // After task completes, clear currentTask
    this.currentTask = null

    // ... end of loop ...

    // Stop heartbeat
    this.stopHeartbeat()

    // Emit complete event
    this.emitEvent({
      type: Date.now(),
      stats: this.stats,
    })

    return this.stats
  }
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/teams/__tests__/ralph-loop-health.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/teams/ralph-loop.ts src/teams/__tests__/ralph-loop-health.test.ts
git commit -m "feat(teams): add heartbeat and health status to RalphLoop"
```

---

## Task 5: Parallel Execution - Configuration and Types

**Files:**
- Modify: `src/teams/ralph-loop.ts`
- Test: `src/teams/__tests__/ralph-loop-parallel.test.ts`

**Step 1: Write the failing test for parallel config**

```typescript
// src/teams/__tests__/ralph-loop-parallel.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import { RalphLoop, type ParallelConfig } from "../index.js"

describe("RalphLoop Parallel Execution", () => {
  const testDir = path.resolve(process.cwd(), ".test-ralph-parallel")

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true })
    }
  })

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe("ParallelConfig", () => {
    it("should define parallel configuration", () => {
      const config: ParallelConfig = {
        enabled: true,
        maxWorkers: 3,
        worktreeEnabled: true,
      }
      expect(config.maxWorkers).toBe(3)
    })

    it("should have default maxWorkers of 1", () => {
      const loop = new RalphLoop(
        { run: async () => "done" } as any,
        null,
        { cwd: testDir, maxIterations: 0 }
      )

      const config = loop.getConfig()
      expect(config.parallelWorkers).toBe(1)
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/teams/__tests__/ralph-loop-parallel.test.ts`
Expected: FAIL with "ParallelConfig is not defined"

**Step 3: Add parallel execution types and config**

Add to `RalphLoopConfig`:

```typescript
  /** 并行 worker 数量 */
  parallelWorkers: number
  /** 是否启用 worktree 隔离 */
  worktreeEnabled: boolean
```

Update `DEFAULT_RALPH_CONFIG`:

```typescript
  parallelWorkers: 1,
  worktreeEnabled: false,
```

Add `ParallelConfig` interface:

```typescript
/**
 * 并行执行配置
 */
export interface ParallelConfig {
  /** 是否启用 */
  enabled: boolean
  /** 最大 worker 数量 */
  maxWorkers: number
  /** 是否启用 worktree 隔离 */
  worktreeEnabled: boolean
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/teams/__tests__/ralph-loop-parallel.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/teams/ralph-loop.ts src/teams/__tests__/ralph-loop-parallel.test.ts
git commit -m "feat(teams): add parallel execution config to RalphLoop"
```

---

## Task 6: Parallel Execution - ParallelExecutor Class

**Files:**
- Modify: `src/teams/ralph-loop.ts`
- Test: `src/teams/__tests__/ralph-loop-parallel.test.ts`

**Step 1: Write the failing test for ParallelExecutor**

Add to test file:

```typescript
import { ParallelExecutor, type ParallelTaskResult } from "../index.js"

describe("ParallelExecutor", () => {
  it("should execute tasks in parallel", async () => {
    const executionOrder: number[] = []

    const executor = new ParallelExecutor({
      maxWorkers: 3,
      worktreeEnabled: false,
    })

    const tasks = [
      { id: "1", description: "Task 1", priority: "medium" as const },
      { id: "2", description: "Task 2", priority: "medium" as const },
      { id: "3", description: "Task 3", priority: "medium" as const },
    ]

    const results = await executor.executeParallel(tasks, async (task) => {
      executionOrder.push(Number(task.id))
      await new Promise(r => setTimeout(r, 50))
      return {
        taskId: task.id,
        success: true,
        result: `Completed ${task.id}`,
      }
    })

    expect(results).toHaveLength(3)
    expect(results.every(r => r.success)).toBe(true)
  })

  it("should limit concurrent workers", async () => {
    let concurrentCount = 0
    let maxConcurrent = 0

    const executor = new ParallelExecutor({
      maxWorkers: 2,
      worktreeEnabled: false,
    })

    const tasks = Array.from({ length: 5 }, (_, i) => ({
      id: `${i + 1}`,
      description: `Task ${i + 1}`,
      priority: "medium" as const,
    }))

    await executor.executeParallel(tasks, async (task) => {
      concurrentCount++
      maxConcurrent = Math.max(maxConcurrent, concurrentCount)
      await new Promise(r => setTimeout(r, 30))
      concurrentCount--
      return { taskId: task.id, success: true, result: "done" }
    })

    expect(maxConcurrent).toBeLessThanOrEqual(2)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/teams/__tests__/ralph-loop-parallel.test.ts`
Expected: FAIL with "ParallelExecutor is not defined"

**Step 3: Implement ParallelExecutor class**

Add to `ralph-loop.ts`:

```typescript
/**
 * 并行任务结果
 */
export interface ParallelTaskResult {
  taskId: string
  success: boolean
  result?: string
  error?: string
}

/**
 * 并行执行器
 */
export class ParallelExecutor {
  private config: { maxWorkers: number; worktreeEnabled: boolean }

  constructor(config: { maxWorkers: number; worktreeEnabled: boolean }) {
    this.config = config
  }

  /**
   * 并行执行任务
   */
  async executeParallel<T>(
    tasks: TaskDefinition[],
    executor: (task: TaskDefinition, workerId: number) => Promise<T>
  ): Promise<T[]> {
    const results: T[] = []
    const executing: Promise<void>[] = []
    let taskIndex = 0

    const runNext = async (workerId: number): Promise<void> => {
      while (taskIndex < tasks.length) {
        const currentIndex = taskIndex++
        const task = tasks[currentIndex]

        try {
          const result = await executor(task, workerId)
          results[currentIndex] = result
        } catch (error) {
          throw error
        }
      }
    }

    // Start workers
    const workerCount = Math.min(this.config.maxWorkers, tasks.length)
    for (let i = 0; i < workerCount; i++) {
      executing.push(runNext(i))
    }

    await Promise.all(executing)
    return results
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/teams/__tests__/ralph-loop-parallel.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/teams/ralph-loop.ts src/teams/__tests__/ralph-loop-parallel.test.ts
git commit -m "feat(teams): implement ParallelExecutor for concurrent task execution"
```

---

## Task 7: Parallel Execution - Integrate with RalphLoop

**Files:**
- Modify: `src/teams/ralph-loop.ts`
- Test: `src/teams/__tests__/ralph-loop-parallel.test.ts`

**Step 1: Write the failing test for integrated parallel execution**

Add to test file:

```typescript
describe("RalphLoop Parallel Integration", () => {
  it("should execute multiple tasks in parallel when parallelWorkers > 1", async () => {
    fs.writeFileSync(path.join(testDir, "TASKS.md"),
      "- [ ] Task A\n- [ ] Task B\n- [ ] Task C\n"
    )

    let concurrentCount = 0
    let maxConcurrent = 0

    const loop = new RalphLoop(
      {
        run: async () => {
          concurrentCount++
          maxConcurrent = Math.max(maxConcurrent, concurrentCount)
          await new Promise(r => setTimeout(r, 50))
          concurrentCount--
          return "done"
        }
      } as any,
      null,
      {
        cwd: testDir,
        maxIterations: 3,
        parallelWorkers: 3,
        worktreeEnabled: false,
      }
    )

    await loop.run()

    expect(maxConcurrent).toBeGreaterThan(1)
    expect(loop.getStats().completedTasks).toBe(3)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/teams/__tests__/ralph-loop-parallel.test.ts`
Expected: FAIL - parallel execution not implemented

**Step 3: Integrate ParallelExecutor into RalphLoop.run()**

Modify the `run()` method to use parallel execution when `parallelWorkers > 1`:

```typescript
  async run(): Promise<RalphLoopStats> {
    // ... existing setup code ...

    if (this.config.parallelWorkers > 1) {
      return this.runParallel()
    }

    // ... existing sequential execution ...
  }

  /**
   * 并行执行
   */
  private async runParallel(): Promise<RalphLoopStats> {
    this.running = true
    this.startTime = Date.now()

    this.emitEvent({
      type: "start",
      timestamp: this.startTime,
      config: this.config,
    })

    this.startHeartbeat()

    const executor = new ParallelExecutor({
      maxWorkers: this.config.parallelWorkers,
      worktreeEnabled: this.config.worktreeEnabled,
    })

    const tasks = this.getAllTasks()

    this.stats.totalTasks = tasks.length

    const results = await executor.executeParallel(tasks, async (task, workerId) => {
      this.currentTask = task.description

      this.emitEvent({
        type: "task_start",
        timestamp: Date.now(),
        taskId: task.id,
        description: task.description,
        priority: task.priority,
      })

      const startTime = Date.now()
      const result = await this.executeTask(task)
      const duration = Date.now() - startTime

      this.emitEvent({
        type: "task_complete",
        timestamp: Date.now(),
        taskId: task.id,
        success: result.result.status === "success",
        duration,
        tokens: result.result.stats.totalTokens,
      })

      this.currentTask = null
      return result
    })

    // Process results
    for (const result of results) {
      if (result.result.status === "success") {
        this.stats.completedTasks++
      } else {
        this.stats.failedTasks++
      }
      this.stats.totalDuration += result.duration
      this.stats.totalCost += result.result.stats.totalCost
      this.stats.totalTokens += result.result.stats.totalTokens
    }

    this.stopHeartbeat()
    this.running = false

    this.emitEvent({
      type: "complete",
      timestamp: Date.now(),
      stats: this.stats,
    })

    return this.stats
  }

  /**
   * 获取所有任务
   */
  private getAllTasks(): TaskDefinition[] {
    const progressTasks = this.progressManager.getPendingTasks()
    const fileTasks = this.loadTasksFromFile()

    // Merge and deduplicate
    const allTasks = [...progressTasks.map(t => ({
      id: t.id,
      description: t.description,
      priority: t.priority,
    })), ...fileTasks]

    // Sort by priority
    const priorityOrder: Record<string, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    }

    return allTasks.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
  }
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/teams/__tests__/ralph-loop-parallel.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/teams/ralph-loop.ts src/teams/__tests__/ralph-loop-parallel.test.ts
git commit -m "feat(teams): integrate parallel execution into RalphLoop"
```

---

## Task 8: Plan Mode Integration - Configuration

**Files:**
- Modify: `src/teams/ralph-loop.ts`
- Test: `src/teams/__tests__/ralph-loop-plan.test.ts`

**Step 1: Write the failing test for plan config**

```typescript
// src/teams/__tests__/ralph-loop-plan.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import { RalphLoop, type PlanModeConfig } from "../index.js"

describe("RalphLoop Plan Mode Integration", () => {
  const testDir = path.resolve(process.cwd(), ".test-ralph-plan")

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true })
    }
  })

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe("PlanModeConfig", () => {
    it("should define plan mode configuration", () => {
      const config: PlanModeConfig = {
        enabled: true,
        batchSize: 5,
        autoApprove: false,
      }
      expect(config.enabled).toBe(true)
      expect(config.batchSize).toBe(5)
    })

    it("should have planFirst disabled by default", () => {
      const loop = new RalphLoop(
        { run: async () => "done" } as any,
        null,
        { cwd: testDir, maxIterations: 0 }
      )

      const config = loop.getConfig()
      expect(config.planFirst).toBe(false)
    })
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/teams/__tests__/ralph-loop-plan.test.ts`
Expected: FAIL with "PlanModeConfig is not defined"

**Step 3: Add Plan Mode configuration**

Add to `RalphLoopConfig`:

```typescript
  /** 是否在执行前先生成计划 */
  planFirst: boolean
  /** 批量规划的任务数 */
  planBatchSize: number
```

Update `DEFAULT_RALPH_CONFIG`:

```typescript
  planFirst: false,
  planBatchSize: 5,
```

Add `PlanModeConfig` interface:

```typescript
/**
 * Plan Mode 配置
 */
export interface PlanModeConfig {
  /** 是否启用 */
  enabled: boolean
  /** 批量规划任务数 */
  batchSize: number
  /** 是否自动批准计划 */
  autoApprove: boolean
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/teams/__tests__/ralph-loop-plan.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/teams/ralph-loop.ts src/teams/__tests__/ralph-loop-plan.test.ts
git commit -m "feat(teams): add Plan Mode configuration to RalphLoop"
```

---

## Task 9: Plan Mode Integration - Plan Generation

**Files:**
- Modify: `src/teams/ralph-loop.ts`
- Test: `src/teams/__tests__/ralph-loop-plan.test.ts`

**Step 1: Write the failing test for plan generation**

Add to test file:

```typescript
describe("Plan Generation", () => {
  it("should generate plan before task execution when planFirst is enabled", async () => {
    fs.writeFileSync(path.join(testDir, "TASKS.md"), "- [ ] Implement feature X\n")

    const plans: string[] = []

    const loop = new RalphLoop(
      {
        run: async (prompt: string) => {
          if (prompt.includes("Plan")) {
            plans.push(prompt)
            return "## Plan\n1. Step one\n2. Step two\n3. Step three"
          }
          return "done"
        }
      } as any,
      null,
      {
        cwd: testDir,
        maxIterations: 1,
        planFirst: true,
      }
    )

    await loop.run()

    expect(plans.length).toBeGreaterThan(0)
    expect(plans[0]).toContain("Implement feature X")
  })

  it("should batch plan generation for multiple tasks", async () => {
    fs.writeFileSync(
      path.join(testDir, "TASKS.md"),
      "- [ ] Task 1\n- [ ] Task 2\n- [ ] Task 3\n"
    )

    const planBatches: number[] = []

    const loop = new RalphLoop(
      {
        run: async (prompt: string) => {
          if (prompt.includes("Generate plans for")) {
            const taskCount = (prompt.match(/Task \d/g) || []).length
            planBatches.push(taskCount)
            return "Plans generated"
          }
          return "done"
        }
      } as any,
      null,
      {
        cwd: testDir,
        maxIterations: 3,
        planFirst: true,
        planBatchSize: 2,
      }
    )

    await loop.run()

    // Should have batched tasks into groups of 2
    expect(planBatches.some(b => b <= 2)).toBe(true)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/teams/__tests__/ralph-loop-plan.test.ts`
Expected: FAIL - plan generation not implemented

**Step 3: Implement plan generation**

Add method to `RalphLoop` class:

```typescript
  /**
   * 为任务生成计划
   */
  private async generatePlanForTask(task: TaskDefinition): Promise<string> {
    const planPrompt = `Generate a plan for the following task:

## Task
${task.description}

## Requirements
- Break down the task into clear steps
- Identify potential risks or edge cases
- Suggest the best approach

Output the plan in markdown format.`

    const plan = await this.agent.run(planPrompt)

    // Save plan to file
    const planDir = path.resolve(this.config.cwd, ".agent-teams/plans")
    if (!fs.existsSync(planDir)) {
      fs.mkdirSync(planDir, { recursive: true })
    }

    const planFile = path.join(planDir, `${task.id}-plan.md`)
    fs.writeFileSync(planFile, plan, "utf-8")

    return plan
  }

  /**
   * 批量生成计划
   */
  private async generateBatchPlans(tasks: TaskDefinition[]): Promise<Map<string, string>> {
    const plans = new Map<string, string>()

    if (tasks.length === 0) return plans

    const batchPrompt = `Generate plans for the following tasks:

${tasks.map((t, i) => `### Task ${i + 1}: ${t.id}
${t.description}`).join("\n\n")}

## Requirements
For each task, provide a brief plan with:
- Key steps
- Potential issues
- Recommended approach

Output in markdown format with clear task separators.`

    const batchResult = await this.agent.run(batchPrompt)

    // Parse individual plans from batch result
    const taskPlanRegex = /### Task \d+: (task-[^\n]+)\n([\s\S]*?)(?=### Task \d+:|$)/g
    let match

    while ((match = taskPlanRegex.exec(batchResult)) !== null) {
      const taskId = match[1].trim()
      const plan = match[2].trim()
      plans.set(taskId, plan)
    }

    return plans
  }
```

Modify `executeTask` to use plan when `planFirst` is enabled:

```typescript
  private async executeTask(task: TaskDefinition): Promise<TaskExecutionResult> {
    const startTime = Date.now()
    let retries = 0
    let result: TeamResult

    // 标记任务为进行中
    this.progressManager.updateTaskStatus(task.id, "in_progress")

    // Generate plan if planFirst is enabled
    let plan: string | null = null
    if (this.config.planFirst) {
      plan = await this.generatePlanForTask(task)
    }

    const taskPrompt = plan
      ? `${task.description}\n\n## Plan\n${plan}`
      : task.description

    do {
      // ... existing execution code, use taskPrompt instead of task.description ...
    } while (...)
    // ...
  }
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/teams/__tests__/ralph-loop-plan.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/teams/ralph-loop.ts src/teams/__tests__/ralph-loop-plan.test.ts
git commit -m "feat(teams): implement plan generation for RalphLoop"
```

---

## Task 10: Update Exports and Final Integration

**Files:**
- Modify: `src/teams/index.ts`
- Test: Run all tests

**Step 1: Update exports in index.ts**

Add exports:

```typescript
export {
  RalphLoop,
  ParallelExecutor,
  createRalphLoop,
  DEFAULT_RALPH_CONFIG,
  type RalphLoopConfig,
  type RalphLoopStats,
  type TaskDefinition,
  type TaskExecutionResult,
  type TaskSourceType,
  type RalphEvent,
  type HealthStatus,
  type ParallelConfig,
  type ParallelTaskResult,
  type PlanModeConfig,
  type OutputFormat,
} from "./ralph-loop.js"
```

**Step 2: Run all Ralph Loop tests**

Run: `npm run test -- src/teams/__tests__/ralph-loop`
Expected: All tests PASS

**Step 3: Run full test suite**

Run: `npm run test`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/teams/index.ts
git commit -m "feat(teams): export RalphLoop enhancement types"
```

---

## Verification

1. Build: `npm run build` - should succeed
2. Tests: `npm run test` - all tests pass
3. Type check: `npx tsc --noEmit` - no errors

## Summary

| Feature | Tasks | Status |
|---------|-------|--------|
| Stream JSON Output | 1-3 | Pending |
| Heartbeat & Health | 4 | Pending |
| Parallel Execution | 5-7 | Pending |
| Plan Mode | 8-9 | Pending |
| Exports & Integration | 10 | Pending |
