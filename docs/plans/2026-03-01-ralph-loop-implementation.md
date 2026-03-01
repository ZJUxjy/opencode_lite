# Ralph Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 Ralph Loop 任务队列持续执行循环，从 TASKS.md 读取任务，调用 Agent Teams 执行，支持无人值守运行。

**Architecture:** 创建独立的 RalphLoop 类，与 TeamManager 解耦。复用 ProgressStore 进行进度追踪，支持 PROGRESS.md 和 JSON 输出。

**Tech Stack:** TypeScript, TeamManager, ProgressStore

---

## Task 1: RalphLoop 类骨架

**Files:**
- Create: `src/teams/ralph-loop.ts`

**Step 1: 创建 ralph-loop.ts 骨架**

```typescript
import * as fs from "fs/promises"
import * as path from "path"
import { EventEmitter } from "events"

// ============================================================================
// RalphLoop - 任务队列持续执行循环
// ============================================================================

/**
 * RalphLoop - Ralph 任务队列循环执行器
 *
 * 功能:
 * - 从 TASKS.md 读取任务队列
 * - 调用 Agent Teams 执行任务
 * - 支持无人值守运行
 * - 输出 PROGRESS.md + JSON 结果
 */
export class RalphLoop extends EventEmitter {
  private config: RalphLoopConfig

  constructor(config: RalphLoopConfig) {
    super()
    this.config = {
      taskFilePath: config.taskFilePath || "TASKS.md",
      progressFilePath: config.progressFilePath || "PROGRESS.md",
      teamMode: config.teamMode || "worker-reviewer",
      maxRetries: config.maxRetries ?? 1,
      cooldownMs: config.cooldownMs ?? 0,
      notifyOnFailure: config.notifyOnFailure ?? true,
      ...config,
    }
  }

  /**
   * 运行 Ralph Loop
   */
  async run(): Promise<RalphLoopResult> {
    // TODO: 实现
    throw new Error("Not implemented")
  }
}

// ============================================================================
// 类型定义
// ============================================================================

export interface RalphLoopConfig {
  taskFilePath?: string
  progressFilePath?: string
  teamMode?: "worker-reviewer" | "leader-workers"
  teamConfig?: any
  maxRetries?: number
  cooldownMs?: number
  maxIterations?: number
  notifyOnFailure?: boolean
}

export interface RalphLoopResult {
  timestamp: string
  totalTasks: number
  completedTasks: number
  failedTasks: number
  duration: number
  results: TaskResult[]
}

export interface TaskResult {
  taskName: string
  status: "completed" | "failed" | "skipped"
  workerId?: string
  duration: number
  error?: string
  attempts: number
}
```

**Step 2: 运行构建验证**

Run: `npm run build`
Expected: PASS (空文件编译通过)

**Step 3: Commit**

```bash
git add src/teams/ralph-loop.ts
git commit -m "feat: add RalphLoop class skeleton"
```

---

## Task 2: TASKS.md 解析器

**Files:**
- Modify: `src/teams/ralph-loop.ts`

**Step 1: 添加 TASKS.md 解析方法**

在 RalphLoop 类中添加:

```typescript
/**
 * 解析 TASKS.md 文件
 */
async parseTasksFile(): Promise<ParsedTask[]> {
  const content = await fs.readFile(this.config.taskFilePath, "utf-8")
  return this.parseMarkdown(content)
}

/**
 * 解析 Markdown 内容
 */
private parseMarkdown(content: string): ParsedTask[] {
  const tasks: ParsedTask[] = []
  const lines = content.split("\n")

  let currentSection = "pending"

  for (const line of lines) {
    // 检测章节
    if (line.startsWith("## ")) {
      const section = line.replace("## ", "").toLowerCase()
      if (section.includes("pending")) currentSection = "pending"
      else if (section.includes("progress") || section.includes("in progress")) currentSection = "in_progress"
      else if (section.includes("completed")) currentSection = "completed"
      else if (section.includes("failed")) currentSection = "failed"
      continue
    }

    // 解析任务行
    const taskMatch = line.match(/^-\s*\[([ x~~-])\]\s*(.+)$/)
    if (taskMatch) {
      const status = taskMatch[1]
      const name = taskMatch[2].trim()

      if (status === " ") {  // [ ] pending
        tasks.push({
          name,
          status: "pending",
          section: currentSection,
        })
      }
    }
  }

  return tasks
}

interface ParsedTask {
  name: string
  status: "pending" | "in_progress" | "completed" | "failed"
  section: string
}
```

**Step 2: 运行构建验证**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/teams/ralph-loop.ts
git commit -m "feat: add TASKS.md parser to RalphLoop"
```

---

## Task 3: 任务执行逻辑

**Files:**
- Modify: `src/teams/ralph-loop.ts`

**Step 1: 添加任务执行方法**

```typescript
/**
 * 执行单个任务
 */
async executeTask(task: ParsedTask): Promise<TaskResult> {
  const startTime = Date.now()
  let attempts = 0
  let lastError: string | undefined

  while (attempts <= this.config.maxRetries) {
    attempts++

    try {
      // 更新任务状态为 in_progress
      await this.updateTaskStatus(task.name, "in_progress")

      // 执行任务 (调用 Agent)
      const response = await this.runAgentTask(task.name)

      // 检查完成关键词
      if (this.isCompleted(response)) {
        await this.updateTaskStatus(task.name, "completed")

        return {
          taskName: task.name,
          status: "completed",
          duration: Date.now() - startTime,
          attempts,
        }
      }

      // 未完成，标记为失败
      throw new Error("Task not completed")

    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)

      // 如果还有重试次数，等待后重试
      if (attempts <= this.config.maxRetries) {
        console.log(`Task failed, retrying... (${attempts}/${this.config.maxRetries})`)
        await this.sleep(1000)  // 1秒后重试
      }
    }
  }

  // 重试耗尽，失败处理
  if (this.config.notifyOnFailure) {
    await this.notifyFailure(task.name, lastError!)
  }

  await this.updateTaskStatus(task.name, "failed", lastError)

  return {
    taskName: task.name,
    status: "failed",
    duration: Date.now() - startTime,
    error: lastError,
    attempts,
  }
}

/**
 * 运行 Agent 任务 (placeholder - 需要集成 Agent)
 */
private async runAgentTask(taskName: string): Promise<string> {
  // TODO: 集成 Agent 执行器
  // 这里返回空字符串，实际需要调用 Agent
  console.log(`[Ralph] Executing task: ${taskName}`)
  return ""
}

/**
 * 检查 Agent 响应是否完成
 */
private isCompleted(response: string): boolean {
  const keywords = [
    "task completed",
    "task done",
    "completed successfully",
    "all done",
    "done!",
  ]

  const lowerResponse = response.toLowerCase()
  return keywords.some(keyword => lowerResponse.includes(keyword))
}

/**
 * 通知失败
 */
private async notifyFailure(taskName: string, error: string): Promise<void> {
  console.log(`[Ralph] Task failed: ${taskName}`)
  console.log(`[Ralph] Error: ${error}`)
  console.log(`[Ralph] Waiting for main agent assessment...`)
  // TODO: 通知主Agent评估
}

/**
 * 更新任务状态
 */
private async updateTaskStatus(
  taskName: string,
  status: "in_progress" | "completed" | "failed",
  error?: string
): Promise<void> {
  // 读取当前 TASKS.md
  let content = await fs.readFile(this.config.taskFilePath, "utf-8")

  // 替换状态标记
  const oldPattern = `- [ ] ${taskName}`
  const newPattern = status === "in_progress"
    ? `- [~] ${taskName}`
    : status === "completed"
    ? `- [x] ${taskName}`
    : `[-] ${taskName}${error ? ` (${error})` : ""}`

  content = content.replace(oldPattern, newPattern)

  await fs.writeFile(this.config.taskFilePath, content, "utf-8")
}

private sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
```

**Step 2: 运行构建验证**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/teams/ralph-loop.ts
git commit -m "feat: add task execution logic to RalphLoop"
```

---

## Task 4: 主循环和输出

**Files:**
- Modify: `src/teams/ralph-loop.ts`

**Step 1: 实现 run 方法**

```typescript
/**
 * 运行 Ralph Loop
 */
async run(): Promise<RalphLoopResult> {
  const startTime = Date.now()
  console.log("[Ralph] Starting Ralph Loop...")
  console.log(`[Ralph] Task file: ${this.config.taskFilePath}`)
  console.log(`[Ralph] Team mode: ${this.config.teamMode}`)
  console.log("")

  // 解析任务
  const tasks = await this.parseTasksFile()
  const pendingTasks = tasks.filter(t => t.status === "pending")

  console.log(`[Ralph] Found ${pendingTasks.length} pending tasks`)

  if (pendingTasks.length === 0) {
    console.log("[Ralph] No pending tasks")
    return {
      timestamp: new Date().toISOString(),
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      duration: 0,
      results: [],
    }
  }

  const results: TaskResult[] = []

  // 执行每个任务
  for (let i = 0; i < pendingTasks.length; i++) {
    const task = pendingTasks[i]

    // 检查最大迭代次数
    if (this.config.maxIterations && i >= this.config.maxIterations) {
      console.log(`[Ralph] Reached max iterations: ${this.config.maxIterations}`)
      break
    }

    console.log(`\n[Ralph] Task ${i + 1}/${pendingTasks.length}: ${task.name}`)

    const result = await this.executeTask(task)
    results.push(result)

    // 任务间隔
    if (this.config.cooldownMs > 0 && i < pendingTasks.length - 1) {
      console.log(`[Ralph] Cooldown: ${this.config.cooldownMs}ms`)
      await this.sleep(this.config.cooldownMs)
    }
  }

  const duration = Date.now() - startTime
  const completedTasks = results.filter(r => r.status === "completed").length
  const failedTasks = results.filter(r => r.status === "failed").length

  // 生成结果
  const result: RalphLoopResult = {
    timestamp: new Date().toISOString(),
    totalTasks: pendingTasks.length,
    completedTasks,
    failedTasks,
    duration,
    results,
  }

  // 输出结果
  console.log("\n" + "=".repeat(50))
  console.log("[Ralph] Loop Complete")
  console.log("=".repeat(50))
  console.log(`Total: ${pendingTasks.length} | Completed: ${completedTasks} | Failed: ${failedTasks}`)
  console.log(`Duration: ${(duration / 1000).toFixed(1)}s`)

  // 保存 JSON 结果
  await this.saveJsonResult(result)

  return result
}

/**
 * 保存 JSON 结果
 */
private async saveJsonResult(result: RalphLoopResult): Promise<void> {
  const outputPath = "ralph-loop-result.json"
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2), "utf-8")
  console.log(`Results saved to: ${outputPath}`)
}
```

**Step 2: 运行构建验证**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/teams/ralph-loop.ts
git commit -m "feat: add main loop and output to RalphLoop"
```

---

## Task 5: CLI 集成

**Files:**
- Modify: `src/index.tsx`

**Step 1: 更新 CLI 选项**

修改 `--team-ralph` 相关代码，添加真实执行逻辑:

```typescript
// 处理 Team Ralph 循环模式
if (options.teamRalph) {
  const taskFile = options.teamRalphTaskFile || "TASKS.md"
  const progressFile = options.teamRalphProgress || "PROGRESS.md"

  if (!fs.existsSync(taskFile)) {
    console.error(`Error: Task file not found: ${taskFile}`)
    process.exit(1)
  }

  const { RalphLoop } = await import("./teams/ralph-loop.js")

  const ralphLoop = new RalphLoop({
    taskFilePath: taskFile,
    progressFilePath: progressFile,
    teamMode: (options.team as any) || "worker-reviewer",
    maxRetries: 1,
    cooldownMs: 0,
    notifyOnFailure: true,
  })

  const result = await ralphLoop.run()

  // 根据结果退出
  if (result.failedTasks > 0) {
    process.exit(1)
  }
  process.exit(0)
}
```

**Step 2: 添加 --team-ralph-progress 选项**

```typescript
.option("--team-ralph-progress <path>", "Progress file for Ralph loop (default: PROGRESS.md)")
```

**Step 3: 运行构建验证**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add src/index.tsx
git commit -m "feat: integrate RalphLoop with CLI"
```

---

## Task 6: 导出 RalphLoop

**Files:**
- Modify: `src/teams/index.ts`

**Step 1: 添加导出**

```typescript
// Ralph Loop
export { RalphLoop } from "./ralph-loop.js"
export type { RalphLoopConfig, RalphLoopResult, TaskResult } from "./ralph-loop.js"
```

**Step 2: 运行构建验证**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/teams/index.ts
git commit -m "feat: export RalphLoop from teams module"
```

---

## Task 7: 测试

**Files:**
- Create: `src/teams/ralph-loop.test.ts`

**Step 1: 创建测试文件**

```typescript
import { describe, it, expect, beforeEach } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import { RalphLoop } from "./ralph-loop.js"

describe("RalphLoop", () => {
  const testDir = path.join(process.cwd(), ".test-ralph")
  const taskFile = path.join(testDir, "TASKS.md")

  beforeEach(async () => {
    // 创建测试目录和文件
    await fs.mkdir(testDir, { recursive: true })
    await fs.writeFile(taskFile, `
# Task Queue

## Pending
- [ ] Task 1
- [ ] Task 2

## Completed
- [x] Task 0
`, "utf-8")
  })

  it("should parse TASKS.md", async () => {
    const loop = new RalphLoop({
      taskFilePath: taskFile,
    })

    const tasks = await loop.parseTasksFile()

    expect(tasks).toHaveLength(2)
    expect(tasks[0].name).toBe("Task 1")
    expect(tasks[0].status).toBe("pending")
  })
})
```

**Step 2: 运行测试**

Run: `npm run test -- src/teams/ralph-loop.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/teams/ralph-loop.test.ts
git commit -m "test: add RalphLoop unit tests"
```

---

## 总结

| Task | 描述 |
|------|------|
| 1 | RalphLoop 类骨架 |
| 2 | TASKS.md 解析器 |
| 3 | 任务执行逻辑 |
| 4 | 主循环和输出 |
| 5 | CLI 集成 |
| 6 | 导出 RalphLoop |
| 7 | 单元测试 |

**Plan complete and saved to `docs/plans/2026-03-01-ralph-loop-implementation.md`.**

Two execution options:

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
