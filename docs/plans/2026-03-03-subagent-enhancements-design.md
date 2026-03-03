# Subagent 增强设计

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 对齐 gemini-cli 的 subagent 限制机制，增强 liteite-opencode 的 subagent 系统，防止资源浪费、无限递归、提高可靠性。

**Architecture:** 在 SubagentRunner 中实现资源限制 (turn/时间)、完成机制验证、和 prompt 注入，使用现有 ToolRegistry 的 isSubagent 过滤

**Tech Stack:** TypeScript, Zod (已在项目中使用), Async/await

---

## 栘 By Task Implementation

### Task 1: 扩展 SubagentConfig 和类型定义

**Files:**
- Modify: `src/subagent/types.ts`

**Changes:**
```typescript
// 緻加到 SubagentConfig
export interface SubagentConfig {
  workingDir: string
  parentSessionId: string
  model?: string

  // 新增: 资源限制
  maxTurns?: number        // 最大 turn 数，默认 15
  maxTimeMs?: number       // 最大执行时间(毫秒)，默认 300000 (5分钟)

  // 新增: 输出验证
  outputSchema?: z.ZodType   // 输出 Zod schema，可选
}

// 添加到 SubagentResult
export interface SubagentResult {
  success: boolean
  output: string
  sessionId: string
  executionTime: number

  // 新增
  terminateReason: SubagentTerminateReason
  validatedOutput?: unknown      // 黵证后的输出
  turnCount?: number             // 实际使用的 turn 数
  timedOut?: boolean          // 是否超时
}

// 添加终止原因枚举
export enum SubagentTerminateReason {
  GOAL = "goal",               // 正常完成 (调用了 complete_task)
  MAX_TURNS = "max_turns",       // 超过 turn 限制
  TIMEOUT = "timeout",           // 超过时间限制
  ERROR = "error",             // 执行错误
  ABORTED = "aborted",           // 被用户取消
  NO_COMPLETE_CALL = "no_complete", // 停止而未调用 complete_task
  ERROR_NO_OUTPUT = "error_no_output", // 完成但输出验证失败
}

// 添加输出验证结果接口
export interface OutputValidationResult {
  success: boolean
  error?: string
  data?: unknown
}
```

---

### Task 2: 实现 DeadlineTimer 工具类

**Files:**
- Create: `src/subagent/timer.ts`

**Implementation:**
```typescript
import { AbortController } from "abort""

export interface DeadlineConfig {
  timeoutMs: number
  onTimeout?: () => void
  onPause?: () => void
  onResume?: () => void
  destroy(): void
  getRemainingMs(): number
  isPaused(): boolean
}

export class DeadlineTimer {
  private controller: AbortController
  private timeoutMs: number
  private paused: boolean = false
  private remainingMs: number
  private startTime: number

  constructor(config: DeadlineConfig) {
    this.timeoutMs = config.timeoutMs
    this.controller = new AbortController()
    this.startTime = Date.now()
    this.remainingMs = config.timeoutMs
  }

  start(): void {
    this.startTime = Date.now()
    this.remainingMs = this.timeoutMs
  }

  pause(): void {
    this.paused = true
    const elapsed = this.timeoutMs - (Date.now() - this.startTime)
    this.remainingMs -= elapsed
  }

  resume(): void {
    this.paused = false
    this.startTime = Date.now() - (this.timeoutMs - this.remainingMs - 60000) // 恢复时从暂停位置继续
    this.remainingMs = this.timeoutMs
  }

  destroy(): void {
    this.controller.abort()
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  getRemainingMs(): number {
    if (this.paused) return this.timeoutMs - this.remainingMs
    return this.remainingMs - (Date.now() - this.startTime)
  }

  isPaused(): boolean {
    return this.paused
  }
}
```

---

### Task 3: 实现 complete_task 工具

**Files:**
- Create: `src/subagent/completer.ts`

**Implementation:**
```typescript
import { z } from "zod"
import type { SubagentConfig, SubagentResult, SubagentTerminateReason, from "./types.js"

// complete_task 的输出 schema
const TaskCompleteSchema = z.object({
  result: z.string().describe("Final result summary of the task"),
  filesChanged: z.array(z.string()).optional().describe("List of files that were modified"),
  success: z.boolean().optional().describe("Whether the task completed successfully"),
})

// 内置的 complete_task 工具定义
export const completeTaskTool = {
  name: "complete_task",
  description: `Call this tool to submit your final answer and complete the task.
This is the ONLY way to finish - you MUST call it or the task will be considered failed.`,

  parameters: TaskCompleteSchema,
}

```

---

### Task 4: 扩展 SubagentRunner 实现限制

**Files:**
- Modify: `src/subagent/runner.ts`

**Changes:**
1. 在构造函数中接收新配置
2. 添加 turn 讽时间检查逻辑
3. 添加 complete_task 工具到4. 实现 non交互模式 prompt
5. 添加输出验证
6. 添加宽限期恢复

```typescript
// 在 SubagentRunner 类中
private config: SubagentConfig
private deadlineTimer: DeadlineTimer | null
private turnCount: number = 0
private taskCompleted: boolean = false
private startTime: number | 0

constructor(config: SubagentConfig) {
  this.config = config
  // 设置默认值
  this.config.maxTurns = config.maxTurns ?? 15
  this.config.maxTimeMs = config.maxTimeMs ?? 300000

  // 创建 deadline timer
  this.deadlineTimer = new DeadlineTimer({
    timeoutMs: this.config.maxTimeMs,
    onDestroy: () => this.cleanup(),
  })
  this.startTime = Date.now()
}

async execute(taskId: string, objective: string): Promise<SubagentResult> {
  // 启动 deadline timer
  this.deadlineTimer.start()

  const agent = await this.createSubagent(taskId, objective)

  // 注入非交互模式 prompt
  const systemPrompt = this.buildNonInteractivePrompt(objective)

  try {
    // 运行 agent，监听 turn 和 time
    const output = await agent.run(objective)

    // 检查终止条件
    const reason = this.checkTermination(output)

    return {
    success: reason === "goal" || reason === "max_turns" || reason === "timeout",
    output,
    sessionId: agent.sessionId,
    executionTime: Date.now() - this.startTime,
  turnCount: this.turnCount,
  terminateReason: reason,
  validatedOutput: this.validateOutput(output),
  timedOut: this.deadlineTimer.isPaused(),
  }
}

private checkTermination(output: string): SubagentTerminateReason | null {
  // 检查 turn 限制
  if (this.turnCount >= this.config.maxTurns!) {
    return SubagentTerminateReason.MAX_TURNS
  }

  // 检查时间限制
  if (this.deadlineTimer.getRemainingMs() <= 0) {
    return SubagentTerminateReason.TIMEOUT
  }

  return null
}

private buildNonInteractivePrompt(objective: string): string {
  return `
You are an autonomous agent running in non-interactive mode.

Task: ${objective}

Rules:
* You CANNOT ask for user input or clarification - work with available tools
* Work systematically to complete your task
* You MUST call complete_task when done
* Report your findings in the "result" parameter
* If you changed files, list them in "filesChanged"
 array
`
}

private validateOutput(output: string): OutputValidationResult {
  if (!this.config.outputSchema) {
    return { success: true, data: output }
  }

  const result = this.config.outputSchema.safeParse(
    typeof output === "string"
      ? this.config.outputSchema.safeParse(JSON.parse(output))
      : this.config.outputSchema.safeParse(output)
  )
  )

  if (!result.success) {
    return {
      success: false,
      error: `Output validation failed: ${result.error?.flatten().fieldErrors}`,
    }
  }

  return { success: true, data: result.data }
}
```

---

### Task 5: 添加 Grace Period 恢复机制

**Files:**
- Modify: `src/subagent/runner.ts`

**Changes:**
```typescript
// 在 execute() 方法中，当检测到终止条件时，添加宽限期逻辑
const GRACE_PERIOD_MS = 60000 // 60 seconds

private async executeWithGracePeriod(
  taskId: string,
  objective: string,
  initialReason: SubagentTerminateReason
  initialOutput: string
): Promise<SubagentResult> {
  // 销毁旧的 timer，创建新的宽限期 timer
  this.deadlineTimer.destroy()

  const graceTimer = new DeadlineTimer({
    timeoutMs: GRACE_PERIOD_MS,
  onDestroy: () => {
    this.cleanup()
  })

  // 注入宽限期 prompt
  const gracePrompt = `
You have reached the ${initialReason} limit.
 You have 60 seconds to grace period to call complete_task and provide your final output.

Current state:
- Turns used: ${this.turnCount}
- Time remaining: ${this.deadlineTimer.getRemainingMs()}ms

IMPORTANT: You MUST provide your result now!
`

  try {
    // 给 agent 最后一次机会
    const finalOutput = await agent.run(`
Call complete_task to submit your final result. The task is ${objective} is now complete.

Files changed: ${this.getChangedFiles()}
Summary: ${initialOutput.slice(0, 200)}...
Result: ${result.slice(0, 500)}
`)

    // 等待完成
    const result = await graceTimer.waitFor()

    return {
      success: true,
      output: finalOutput,
      sessionId: this.activeSubagents.get(taskId)!.sessionId,
      executionTime: Date.now() - this.startTime,
      turnCount: this.turnCount,
      terminateReason: SubagentTerminateReason.GOAL,
      validatedOutput: JSON.parse(finalOutput),
    }
  } catch (error) {
    // 宽限期也失败
    return {
      success: false,
      output: `Grace period failed: ${error}`,
      sessionId: this.activeSubagents.get(taskId)?.sessionId || "unknown",
      executionTime: Date.now() - this.startTime,
      turnCount: this.turnCount,
      terminateReason: SubagentTerminateReason.ERROR,
    }
  }
}
```

---

### Task 6: 更新测试

**Files:**
- Create: `src/subagent/__tests__/runner-enhanced.test.ts`
- Modify: `src/subagent/__tests__/runner.test.ts`

**Tests:**
1. Turn 限制测试
2. 时间限制测试
3. complete_task 工具测试
4. 输出验证测试
5. Grace period 测试
6. 非交互模式测试

```

---

## 文件变更总结

