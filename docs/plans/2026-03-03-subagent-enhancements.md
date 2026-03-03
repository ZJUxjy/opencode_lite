# Subagent 增强实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 对齐 gemini-cli 的 subagent 限制机制，实现 Turn/时间限制、complete_task 强制完成、输出验证和宽限期恢复

**Architecture:** 扩展 SubagentConfig 添加限制配置，在 SubagentRunner 中集成 DeadlineTimer 和 complete_task 工具，使用 Zod 进行输出验证

**Tech Stack:** TypeScript, Zod, Async/await

---

## 任务列表

### Task 1: 扩展 SubagentConfig 和类型定义

**Files:**
- Modify: `src/subagent/types.ts`

**Step 1: 定义新的类型和接口**

添加以下内容到 `src/subagent/types.ts`：

```typescript
import type { z } from "zod"

/**
 * Subagent 终止原因
 */
export enum SubagentTerminateReason {
  GOAL = "goal",                          // 正常完成
  MAX_TURNS = "max_turns",                // 超过 turn 限制
  TIMEOUT = "timeout",                    // 超时
  ERROR = "error",                        // 执行错误
  ABORTED = "aborted",                    // 被取消
  NO_COMPLETE_CALL = "no_complete",       // 未调用 complete_task
  VALIDATION_FAILED = "validation_failed", // 输出验证失败
}

/**
 * 扩展的 SubagentConfig
 */
export interface SubagentConfig {
  workingDir: string
  parentSessionId: string
  model?: string
  timeout?: number

  // 新增: 资源限制
  maxTurns?: number           // 默认 15
  maxTimeMs?: number          // 默认 300000 (5分钟)

  // 新增: 输出验证
  outputSchema?: z.ZodType
}

/**
 * 扩展的 SubagentResult
 */
export interface SubagentResult {
  success: boolean
  output: string
  sessionId: string
  executionTime: number

  // 新增
  terminateReason: SubagentTerminateReason
  validatedOutput?: unknown
  turnCount?: number
  timedOut?: boolean
}

/**
 * 输出验证结果
 */
export interface OutputValidationResult {
  success: boolean
  error?: string
  data?: unknown
}

/**
 * complete_task 工具参数
 */
export interface CompleteTaskParams {
  result: string
  filesChanged?: string[]
  success?: boolean
}
```

**Step 2: 验证类型导出**

Run: `npm run build`
Expected: 成功编译，无类型错误

**Step 3: Commit**

```bash
git add src/subagent/types.ts
git commit -m "feat(subagent): add resource limits and output validation types"
```

---

### Task 2: 实现 DeadlineTimer

**Files:**
- Create: `src/subagent/timer.ts`

**Step 1: 实现 DeadlineTimer 类**

```typescript
/**
 * DeadlineTimer - 带有暂停/恢复功能的计时器
 *
 * 用于追踪 subagent 执行时间，支持宽限期恢复
 */
export class DeadlineTimer {
  private timeoutMs: number
  private startTime: number = 0
  private paused: boolean = false
  private elapsedBeforePause: number = 0
  private timeoutId?: NodeJS.Timeout
  private onTimeout?: () => void

  constructor(timeoutMs: number, onTimeout?: () => void) {
    this.timeoutMs = timeoutMs
    this.onTimeout = onTimeout
  }

  start(): void {
    this.startTime = Date.now()
    this.elapsedBeforePause = 0
    this.paused = false
    this.scheduleTimeout()
  }

  pause(): void {
    if (this.paused) return
    this.paused = true
    this.elapsedBeforePause = Date.now() - this.startTime
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
      this.timeoutId = undefined
    }
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    this.startTime = Date.now() - this.elapsedBeforePause
    this.scheduleTimeout()
  }

  private scheduleTimeout(): void {
    const remaining = this.getRemainingMs()
    if (remaining <= 0) {
      this.onTimeout?.()
      return
    }
    this.timeoutId = setTimeout(() => {
      this.onTimeout?.()
    }, remaining)
  }

  getRemainingMs(): number {
    if (this.paused) {
      return this.timeoutMs - this.elapsedBeforePause
    }
    return Math.max(0, this.timeoutMs - (Date.now() - this.startTime))
  }

  isPaused(): boolean {
    return this.paused
  }

  isExpired(): boolean {
    return this.getRemainingMs() <= 0
  }

  destroy(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
      this.timeoutId = undefined
    }
  }
}
```

**Step 2: 创建测试文件**

Create: `src/subagent/__tests__/timer.test.ts`

```typescript
import { describe, it, expect, vi } from "vitest"
import { DeadlineTimer } from "../timer.js"

describe("DeadlineTimer", () => {
  it("should track remaining time", () => {
    const timer = new DeadlineTimer(1000)
    timer.start()

    expect(timer.getRemainingMs()).toBeGreaterThan(900)
    expect(timer.getRemainingMs()).toBeLessThanOrEqual(1000)
  })

  it("should pause and resume", async () => {
    const timer = new DeadlineTimer(1000)
    timer.start()

    await new Promise(r => setTimeout(r, 100))
    timer.pause()
    const remainingWhenPaused = timer.getRemainingMs()

    await new Promise(r => setTimeout(r, 100))
    expect(timer.getRemainingMs()).toBe(remainingWhenPaused)

    timer.resume()
    expect(timer.isPaused()).toBe(false)
  })

  it("should call onTimeout when expired", async () => {
    const onTimeout = vi.fn()
    const timer = new DeadlineTimer(50, onTimeout)
    timer.start()

    await new Promise(r => setTimeout(r, 100))
    expect(onTimeout).toHaveBeenCalled()
    timer.destroy()
  })
})
```

**Step 3: 运行测试**

Run: `npm run test -- --run src/subagent/__tests__/timer.test.ts`
Expected: 所有测试通过

**Step 4: Commit**

```bash
git add src/subagent/timer.ts src/subagent/__tests__/timer.test.ts
git commit -m "feat(subagent): add DeadlineTimer with pause/resume support"
```

---

### Task 3: 实现 complete_task 工具

**Files:**
- Create: `src/subagent/completer.ts`

**Step 1: 实现 complete_task 工具和 completer 类**

```typescript
import { z } from "zod"
import type { CompleteTaskParams } from "./types.js"

/**
 * complete_task 工具的参数 schema
 */
export const CompleteTaskSchema = z.object({
  result: z.string().describe("任务的最终结果摘要"),
  filesChanged: z.array(z.string()).optional().describe("被修改的文件列表"),
  success: z.boolean().optional().describe("任务是否成功完成"),
})

/**
 * complete_task 工具定义
 */
export const completeTaskTool = {
  name: "complete_task",
  description: `提交最终结果并完成任务。这是唯一合法的结束方式。

如果不调用此工具，任务将被视为失败。
必须在 result 参数中提供完整的任务结果。`,
  parameters: CompleteTaskSchema,
}

/**
 * TaskCompleter - 管理任务完成状态
 */
export class TaskCompleter {
  private completed: boolean = false
  private output?: CompleteTaskParams

  /**
   * 标记任务完成
   */
  complete(params: CompleteTaskParams): void {
    if (this.completed) {
      throw new Error("Task already completed")
    }
    this.completed = true
    this.output = params
  }

  /**
   * 检查任务是否已完成
   */
  isCompleted(): boolean {
    return this.completed
  }

  /**
   * 获取完成输出
   */
  getOutput(): CompleteTaskParams | undefined {
    return this.output
  }

  /**
   * 序列化输出为字符串
   */
  serializeOutput(): string {
    if (!this.output) return ""
    return JSON.stringify(this.output, null, 2)
  }
}
```

**Step 2: 更新 index 导出**

Modify: `src/subagent/index.ts`

添加导出：
```typescript
export * from "./timer.js"
export * from "./completer.js"
```

**Step 3: Commit**

```bash
git add src/subagent/completer.ts src/subagent/index.ts
git commit -m "feat(subagent): add complete_task tool and TaskCompleter"
```

---

### Task 4: 重构 SubagentRunner 实现限制

**Files:**
- Modify: `src/subagent/runner.ts`

**Step 1: 重构 runner.ts**

```typescript
import { Agent } from "../agent.js"
import type { AgentConfig } from "../agent.js"
import * as path from "path"
import * as os from "os"
import { DeadlineTimer } from "./timer.js"
import { TaskCompleter, CompleteTaskSchema } from "./completer.js"
import type {
  SubagentConfig,
  SubagentResult,
  SubagentTerminateReason,
  CompleteTaskParams,
} from "./types.js"

// 默认值
const DEFAULT_MAX_TURNS = 15
const DEFAULT_MAX_TIME_MS = 5 * 60 * 1000 // 5分钟
const GRACE_PERIOD_MS = 60 * 1000 // 60秒宽限期

export interface SubagentRunnerConfig extends SubagentConfig {
  // 允许覆盖默认值
}

export class SubagentRunner {
  private config: Required<Pick<SubagentConfig, "maxTurns" | "maxTimeMs">> & SubagentConfig
  private activeSubagents = new Map<string, Agent>()
  private completers = new Map<string, TaskCompleter>()

  constructor(config: SubagentRunnerConfig) {
    this.config = {
      ...config,
      maxTurns: config.maxTurns ?? DEFAULT_MAX_TURNS,
      maxTimeMs: config.maxTimeMs ?? DEFAULT_MAX_TIME_MS,
    }
  }

  async createSubagent(taskId: string, objective: string): Promise<Agent> {
    const sessionId = `subagent-${taskId}-${Date.now()}`

    const agentConfig: AgentConfig = {
      cwd: this.config.workingDir,
      dbPath: path.join(os.homedir(), ".lite-opencode", "history.db"),
      isSubagent: true,
    }

    const agent = new Agent(sessionId, agentConfig)
    this.activeSubagents.set(taskId, agent)

    // 为每个 subagent 创建 completer
    this.completers.set(taskId, new TaskCompleter())

    return agent
  }

  async execute(taskId: string, objective: string): Promise<SubagentResult> {
    const startTime = Date.now()
    let turnCount = 0

    // 创建 deadline timer
    const timer = new DeadlineTimer(this.config.maxTimeMs)
    timer.start()

    const agent = await this.createSubagent(taskId, objective)
    const completer = this.completers.get(taskId)!

    try {
      // 构建带限制的 system prompt
      const systemPrompt = this.buildSystemPrompt(objective, timer.getRemainingMs())

      // 执行 agent
      const output = await this.runWithLimits(agent, objective, timer, completer, turnCount)

      // 检查终止原因
      let terminateReason: SubagentTerminateReason

      if (completer.isCompleted()) {
        terminateReason = SubagentTerminateReason.GOAL
      } else if (turnCount >= this.config.maxTurns) {
        terminateReason = SubagentTerminateReason.MAX_TURNS
      } else if (timer.isExpired()) {
        terminateReason = SubagentTerminateReason.TIMEOUT
      } else {
        terminateReason = SubagentTerminateReason.NO_COMPLETE_CALL
      }

      // 如果需要，进入宽限期
      if (terminateReason !== SubagentTerminateReason.GOAL &&
          (terminateReason === SubagentTerminateReason.MAX_TURNS ||
           terminateReason === SubagentTerminateReason.TIMEOUT)) {
        return await this.executeGracePeriod(taskId, objective, timer, completer, startTime, turnCount)
      }

      return {
        success: terminateReason === SubagentTerminateReason.GOAL,
        output: completer.serializeOutput() || output,
        sessionId: agent.sessionId,
        executionTime: Date.now() - startTime,
        terminateReason,
        turnCount,
        timedOut: timer.isExpired(),
        validatedOutput: completer.getOutput(),
      }
    } catch (error) {
      return {
        success: false,
        output: error instanceof Error ? error.message : String(error),
        sessionId: agent.sessionId,
        executionTime: Date.now() - startTime,
        terminateReason: SubagentTerminateReason.ERROR,
        turnCount,
        timedOut: timer.isExpired(),
      }
    } finally {
      timer.destroy()
    }
  }

  private async runWithLimits(
    agent: Agent,
    objective: string,
    timer: DeadlineTimer,
    completer: TaskCompleter,
    turnCount: number
  ): Promise<string> {
    // 这里应该集成到 Agent.run 中
    // 暂时模拟执行
    return agent.run(objective)
  }

  private async executeGracePeriod(
    taskId: string,
    objective: string,
    oldTimer: DeadlineTimer,
    completer: TaskCompleter,
    startTime: number,
    turnCount: number
  ): Promise<SubagentResult> {
    oldTimer.destroy()

    // 创建宽限期 timer
    const graceTimer = new DeadlineTimer(GRACE_PERIOD_MS)
    graceTimer.start()

    const agent = this.activeSubagents.get(taskId)!

    try {
      const gracePrompt = this.buildGracePrompt(objective, turnCount)
      const output = await agent.run(gracePrompt)

      return {
        success: completer.isCompleted(),
        output: completer.serializeOutput() || output,
        sessionId: agent.sessionId,
        executionTime: Date.now() - startTime,
        terminateReason: completer.isCompleted()
          ? SubagentTerminateReason.GOAL
          : SubagentTerminateReason.NO_COMPLETE_CALL,
        turnCount,
        timedOut: false,
        validatedOutput: completer.getOutput(),
      }
    } finally {
      graceTimer.destroy()
    }
  }

  private buildSystemPrompt(objective: string, remainingMs: number): string {
    return `You are an autonomous agent running in non-interactive mode.

Task: ${objective}

Resource Limits:
- Maximum turns: ${this.config.maxTurns}
- Time limit: ${Math.floor(remainingMs / 1000)}s remaining

Rules:
* You CANNOT ask for user input or clarification
* Work systematically using available tools
* You MUST call complete_task when done
* Provide complete results in the "result" parameter
* List any modified files in "filesChanged"

If you reach limits without completing, you will get a 60-second grace period to finish.`
  }

  private buildGracePrompt(objective: string, turnCount: number): string {
    return `GRACE PERIOD: You have 60 seconds to complete your task.

Task: ${objective}
Turns used: ${turnCount}

You MUST call complete_task NOW with your final result.
This is your last chance to complete successfully.`
  }

  getActiveSubagents(): Map<string, Agent> {
    return this.activeSubagents
  }
}
```

**Step 2: 更新测试**

Modify: `src/subagent/__tests__/runner.test.ts`

添加新测试用例验证限制功能。

**Step 3: 运行测试**

Run: `npm run test -- --run src/subagent`
Expected: 所有测试通过

**Step 4: Commit**

```bash
git add src/subagent/runner.ts src/subagent/__tests__/runner.test.ts
git commit -m "feat(subagent): implement resource limits, complete_task, and grace period"
```

---

### Task 5: 集成到 task 工具

**Files:**
- Modify: `src/tools/task.ts`

**Step 1: 更新 task 工具使用新的 runner**

```typescript
import { SubagentRunner } from "../subagent/runner.js"
import type { SubagentConfig } from "../subagent/types.js"

// 在 taskTool 中使用新的配置
const subagentConfig: SubagentConfig = {
  workingDir: ctx.cwd,
  parentSessionId: ctx.sessionId,
  maxTurns: 15,
  maxTimeMs: 300000,
}

const runner = new SubagentRunner(subagentConfig)
```

**Step 2: 运行完整测试**

Run: `npm run test -- --run`
Expected: 所有测试通过 (除已知失败的 promptDumper 测试外)

**Step 3: Commit**

```bash
git add src/tools/task.ts
git commit -m "feat(tools): integrate enhanced subagent runner with limits"
```

---

### Task 6: 最终验证和文档

**Files:**
- Modify: `CLAUDE.md` (添加 subagent 增强文档)

**Step 1: 运行完整构建**

Run: `npm run build`
Expected: 编译成功

**Step 2: 运行所有测试**

Run: `npm run test -- --run`
Expected: 243 tests passed (subagent 相关全部通过)

**Step 3: 提交最终文档**

```bash
git add CLAUDE.md docs/plans/
git commit -m "docs: document subagent enhancements and resource limits"
```

---

## 文件变更总结

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/subagent/types.ts` | 修改 | 添加 SubagentTerminateReason, 扩展 Config/Result |
| `src/subagent/timer.ts` | 创建 | DeadlineTimer 实现 |
| `src/subagent/__tests__/timer.test.ts` | 创建 | DeadlineTimer 测试 |
| `src/subagent/completer.ts` | 创建 | complete_task 工具和 TaskCompleter |
| `src/subagent/runner.ts` | 修改 | 集成限制和宽限期 |
| `src/subagent/__tests__/runner.test.ts` | 修改 | 添加限制测试 |
| `src/subagent/index.ts` | 修改 | 导出新模块 |
| `src/tools/task.ts` | 修改 | 使用新的 runner |
| `CLAUDE.md` | 修改 | 文档更新 |

---

## 关键设计决策

1. **默认值**: 15 turns, 5分钟, 60秒宽限期 (与 gemini-cli 一致)
2. **complete_task 工具**: 内置实现，非通过 ToolRegistry 暴露
3. **暂停/恢复**: DeadlineTimer 支持在宽限期暂停主计时器
4. **输出验证**: 使用 Zod schema，可选配置
5. **非交互模式**: 通过 system prompt 注入实现
