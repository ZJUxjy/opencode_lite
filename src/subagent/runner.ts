import { Agent } from "../agent.js"
import type { AgentConfig } from "../agent.js"
import * as path from "path"
import * as os from "os"

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

    const agentConfig: AgentConfig = {
      cwd: this.config.workingDir,
      dbPath: path.join(os.homedir(), ".lite-opencode", "history.db"),
      isSubagent: true,  // 防止 subagent 递归调用 subagent 工具
    }

    const agent = new Agent(sessionId, agentConfig)
    this.activeSubagents.set(taskId, agent)
    return agent
  }

  async execute(taskId: string, objective: string): Promise<SubagentResult> {
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
