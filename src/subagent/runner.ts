import { Agent } from "../agent.js"
import type { AgentConfig } from "../agent.js"
import * as path from "path"
import * as os from "os"
import type { z } from "zod"

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
  terminateReason?: string
  /** 验证后的输出 */
  validatedOutput?: unknown
  /** 实际使用的 turn 数 */
  turnCount?: number
  /** 是否超时 */
  timedOut?: boolean
}

export class SubagentRunner {
  private config: Required<Pick<SubagentRunnerConfig, "maxTurns" | "maxTimeMs">> & SubagentRunnerConfig
  private activeSubagents: Map<string, Agent> = new Map()

  constructor(config: SubagentRunnerConfig) {
    this.config = {
      ...config,
      maxTurns: config.maxTurns ?? 15,
      maxTimeMs: config.maxTimeMs ?? 5 * 60 * 1000, // 5分钟
    }
  }

  async createSubagent(taskId: string, objective: string): Promise<Agent> {
    const sessionId = `subagent-${taskId}-${Date.now()}`

    const agentConfig: AgentConfig = {
      cwd: this.config.workingDir,
      dbPath: path.join(os.homedir(), ".lite-opencode", "history.db"),
      isSubagent: true,  // 防止 subagent 递归调用 subagent 工具
    }

    const agent = new Agent(sessionId, agentConfig)
    this.activeSubagents.set(taskId, agent)
    return agent
  }

  async execute(taskId: string, objective: string): Promise<SubagentRunnerResult> {
    const startTime = Date.now()
    const agent = await this.createSubagent(taskId, objective)
    const sessionId = `subagent-${taskId}-${startTime}`

    try {
      const output = await agent.run(objective)
      return {
        success: true,
        output,
        sessionId,
        executionTime: Date.now() - startTime,
      }
    } catch (error) {
      return {
        success: false,
        output: error instanceof Error ? error.message : String(error),
        sessionId,
        executionTime: Date.now() - startTime,
      }
    }
  }

  getActiveSubagents(): Map<string, Agent> {
    return this.activeSubagents
  }
}
