import { Agent } from "../agent.js"
import type { AgentConfig } from "../agent.js"
import * as path from "path"
import * as os from "os"
import type { z } from "zod"
import { DeadlineTimer } from "./timer.js"
import { TaskCompleter, CompleteTaskSchema } from "./completer.js"
import type {
  SubagentTerminateReason,
  CompleteTaskParams,
  OutputValidationResult,
} from "./types.js"

// 默认值
const DEFAULT_MAX_TURNS = 15
const DEFAULT_MAX_TIME_MS = 5 * 60 * 1000 // 5分钟
const GRACE_PERIOD_MS = 60 * 1000 // 60秒宽限期

export interface SubagentRunnerConfig {
  workingDir: string
  parentSessionId: string
  model?: string
  timeout?: number
  /** 最大 turn 数，默认 15 */
  maxTurns?: number
  /** 最大执行时间(毫秒)，默认 5分钟 */
  maxTimeMs?: number
  /** 输出验证 schema */
  outputSchema?: z.ZodType
}

export interface SubagentRunnerResult {
  success: boolean
  output: string
  sessionId: string
  executionTime: number
  /** 终止原因 */
  terminateReason: SubagentTerminateReason
  /** 验证后的输出 */
  validatedOutput?: unknown
  /** 实际使用的 turn 数 */
  turnCount: number
  /** 是否超时 */
  timedOut: boolean
}

export class SubagentRunner {
  private config: Required<
    Pick<SubagentRunnerConfig, "maxTurns" | "maxTimeMs">
  > &
    SubagentRunnerConfig
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

  async execute(
    taskId: string,
    objective: string
  ): Promise<SubagentRunnerResult> {
    const startTime = Date.now()
    let turnCount = 0

    // 创建 deadline timer
    const timer = new DeadlineTimer({ timeoutMs: this.config.maxTimeMs })
    timer.start()

    const agent = await this.createSubagent(taskId, objective)
    const completer = this.completers.get(taskId)!

    try {
      // 执行 agent
      const output = await agent.run(objective)

      // 检查是否调用了 complete_task
      const isCompleted = completer.isCompleted()

      // 确定终止原因
      let terminateReason: SubagentTerminateReason
      if (isCompleted) {
        terminateReason = "goal" as SubagentTerminateReason
      } else {
        terminateReason = "goal" as SubagentTerminateReason // 暂时允许无 complete_task
      }

      return {
        success: true,
        output: completer.serializeOutput() || output,
        sessionId: agent.sessionId,
        executionTime: Date.now() - startTime,
        terminateReason,
        turnCount,
        timedOut: false,
        validatedOutput: completer.getOutput(),
      }
    } catch (error) {
      return {
        success: false,
        output: error instanceof Error ? error.message : String(error),
        sessionId: agent.sessionId,
        executionTime: Date.now() - startTime,
        terminateReason: "error" as SubagentTerminateReason,
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
    // 这里应该集成到 Agent.run 中实现真正的 turn 限制
    // 暂时模拟执行 - 实际实现需要修改 Agent 类
    return agent.run(objective)
  }

  private async executeGracePeriod(
    taskId: string,
    objective: string,
    oldTimer: DeadlineTimer,
    completer: TaskCompleter,
    startTime: number,
    turnCount: number
  ): Promise<SubagentRunnerResult> {
    oldTimer.destroy()

    // 创建宽限期 timer
    const graceTimer = new DeadlineTimer({ timeoutMs: GRACE_PERIOD_MS })
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
          ? ("goal" as SubagentTerminateReason)
          : ("no_complete" as SubagentTerminateReason),
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

  /**
   * 验证输出
   */
  private validateOutput(output: string): OutputValidationResult {
    if (!this.config.outputSchema) {
      return { success: true, data: output }
    }

    try {
      const parsed =
        typeof output === "string" ? JSON.parse(output) : output
      const result = this.config.outputSchema.safeParse(parsed)

      if (!result.success) {
        return {
          success: false,
          error: `Validation failed: ${result.error.message}`,
        }
      }

      return { success: true, data: result.data }
    } catch (e) {
      return {
        success: false,
        error: `Invalid output format: ${e}`,
      }
    }
  }

  getActiveSubagents(): Map<string, Agent> {
    return this.activeSubagents
  }

  getCompleter(taskId: string): TaskCompleter | undefined {
    return this.completers.get(taskId)
  }
}
