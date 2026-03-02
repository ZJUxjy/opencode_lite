/**
 * TeamManager - CLI integration for Agent Teams
 *
 * Factory class that creates the appropriate runner based on team mode
 * and executes the team collaboration.
 */

import { WorkerReviewerRunner } from "./modes/worker-reviewer.js"
import { LeaderWorkersRunner } from "./modes/leader-workers.js"
import { AgentLLMClient, createAgentLLMClient } from "./client/llm-client.js"
import type { TeamConfig, TeamMode, TaskContract } from "./core/types.js"
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
}

export class TeamManager {
  private config: TeamConfig
  private objective: string
  private llmClient: AgentLLMClient

  constructor(options: TeamManagerOptions) {
    this.objective = options.objective
    this.config = resolveTeamConfig(options.profile || "default", {
      mode: options.mode,
      budget: options.budget ? { maxTokens: options.budget } : undefined,
      timeoutMs: options.timeout,
    })

    // Create LLM client for agents
    this.llmClient = createAgentLLMClient({
      model: options.model || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
      baseURL: options.baseURL || process.env.ANTHROPIC_BASE_URL,
      apiKey: options.apiKey || process.env.ANTHROPIC_API_KEY,
      timeout: options.timeout || 120000,
    })
  }

  async run(): Promise<TeamResult> {
    // Create appropriate runner based on mode
    switch (this.config.mode) {
      case "worker-reviewer": {
        const runner = new WorkerReviewerRunner(this.config, {
          askWorker: async (objective: string, contract: TaskContract) => {
            const artifact = await this.llmClient.executeWorker(contract, 1)
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
            const review = await this.llmClient.executeReviewer(contract, artifact)
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
            const artifact = await this.llmClient.executeWorker(contract, 1)
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
