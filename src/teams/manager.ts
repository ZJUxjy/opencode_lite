/**
 * TeamManager - CLI integration for Agent Teams
 *
 * Factory class that creates the appropriate runner based on team mode
 * and executes the team collaboration.
 */

import { LLMClient } from "../llm.js"
import { getBuiltinProvider } from "../providers/registry.js"
import { WorkerReviewerRunner } from "./modes/worker-reviewer.js"
import { LeaderWorkersRunner } from "./modes/leader-workers.js"
import { AgentLLMClient, createAgentLLMClient } from "./client/llm-client.js"
import type { TeamConfig, TeamMode, TaskContract, TokenUsage } from "./core/types.js"
import type { TeamResult } from "./modes/base.js"
import type { WorkArtifact } from "./core/contracts.js"
import { resolveTeamConfig } from "./config/loader.js"

export interface TeamManagerOptions {
  mode: TeamMode
  objective: string
  configPath?: string
  profile?: string
  budget?: number
  timeout?: number
  /** LLM configuration */
  model?: string
  baseURL?: string
  apiKey?: string
  /** Protocol to use (anthropic, openai, google) */
  protocol?: "anthropic" | "openai" | "google"
}

export class TeamManager {
  private config: TeamConfig
  private objective: string
  private llmClient: LLMClient
  private agentLLMClient: AgentLLMClient
  private tokenUsage: TokenUsage = { input: 0, output: 0 }

  constructor(options: TeamManagerOptions) {
    this.objective = options.objective

    // Resolve team config with overrides
    this.config = resolveTeamConfig(options.profile || "default", {
      mode: options.mode,
      timeoutMs: options.timeout,
      budget: options.budget ? { maxTokens: options.budget } : undefined,
    })

    // Get default model from provider registry instead of hardcoding
    const defaultProvider = getBuiltinProvider("anthropic")
    const defaultModel = defaultProvider?.defaultModel || "claude-sonnet-4-6"

    // Create main LLM client (supports multiple providers)
    this.llmClient = new LLMClient({
      model: options.model || process.env.ANTHROPIC_MODEL || defaultModel,
      baseURL: options.baseURL || process.env.ANTHROPIC_BASE_URL,
      apiKey: options.apiKey || process.env.ANTHROPIC_API_KEY,
      timeout: options.timeout || 120000,
      protocol: options.protocol,
    })

    // Create Agent LLM client with token usage callback
    this.agentLLMClient = createAgentLLMClient({
      llmClient: this.llmClient,
      onTokenUsage: (usage) => {
        this.tokenUsage.input += usage.inputTokens
        this.tokenUsage.output += usage.outputTokens
      },
    })
  }

  /**
   * Get total token usage across all agents
   */
  getTokenUsage(): TokenUsage {
    return { ...this.tokenUsage }
  }

  /**
   * Clean up resources
   */
  async dispose(): Promise<void> {
    if (this.llmClient) {
      this.llmClient.abort()
    }
  }

  async run(): Promise<TeamResult> {
    // Reset token usage for this run
    this.tokenUsage = { input: 0, output: 0 }

    // Create appropriate runner based on mode
    switch (this.config.mode) {
      case "worker-reviewer": {
        const runner = new WorkerReviewerRunner(this.config, {
          askWorker: async (objective: string, contract: TaskContract) => {
            const artifact = await this.agentLLMClient.executeWorker(contract, 1)
            return {
              summary: artifact.summary,
              changedFiles: artifact.changedFiles,
              patchRef: artifact.patchRef,
              testResults: artifact.testResults.map(t => ({ command: t.command, passed: t.passed })),
              risks: artifact.risks,
              assumptions: artifact.assumptions,
            }
          },
          askReviewer: async (artifact: WorkArtifact) => {
            const contract: TaskContract = {
              taskId: artifact.taskId,
              objective: this.objective,
              fileScope: [],
              acceptanceChecks: this.config.qualityGate?.requiredChecks || [],
            }
            const review = await this.agentLLMClient.executeReviewer(contract, artifact)
            return {
              status: review.status,
              severity: review.severity,
              mustFix: review.mustFix,
              suggestions: review.suggestions,
            }
          },
        })
        return runner.execute(this.objective)
      }
      case "leader-workers": {
        const runner = new LeaderWorkersRunner(this.config, {
          askLeader: async (phase, input) => {
            if (phase === "decompose") {
              // For now, return a simple single task
              return {
                tasks: [{ id: `task-${Date.now()}`, description: input.objective }],
              }
            } else {
              // Integrate phase
              const summaries = input.workerResults?.map(w => w.summary).join("\n") || ""
              return {
                integratedOutput: `Integrated results:\n${summaries}`,
              }
            }
          },
          askWorker: async (task) => {
            const contract: TaskContract = {
              taskId: task.id,
              objective: task.description,
              fileScope: task.fileScope || [],
              acceptanceChecks: this.config.qualityGate?.requiredChecks || [],
            }
            const artifact = await this.agentLLMClient.executeWorker(contract, 1)
            return {
              summary: artifact.summary,
              changedFiles: artifact.changedFiles,
              patchRef: artifact.patchRef,
              testResults: artifact.testResults.map(t => ({ command: t.command, passed: t.passed })),
              risks: artifact.risks,
              assumptions: artifact.assumptions,
            }
          },
        })
        return runner.execute(this.objective)
      }
      case "planner-executor-reviewer":
      case "hotfix-guardrail":
      case "council":
        throw new Error(`Unsupported mode: ${this.config.mode}. This mode is not yet implemented.`)
      default:
        throw new Error(`Unknown mode: ${this.config.mode}`)
    }
  }
}
