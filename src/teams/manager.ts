/**
 * TeamManager - CLI integration for Agent Teams
 *
 * Factory class that creates the appropriate runner based on team mode
 * and executes the team collaboration.
 */

import { WorkerReviewerRunner } from "./modes/worker-reviewer.js"
import { LeaderWorkersRunner } from "./modes/leader-workers.js"
import type { TeamConfig, TeamMode } from "./core/types.js"
import type { TeamResult } from "./modes/base.js"
import { resolveTeamConfig } from "./config/loader.js"

export interface TeamManagerOptions {
  mode: TeamMode
  objective: string
  configPath?: string
  profile?: string
  budget?: number
  timeout?: number
}

export class TeamManager {
  private config: TeamConfig
  private objective: string

  constructor(options: TeamManagerOptions) {
    this.objective = options.objective
    this.config = resolveTeamConfig(options.profile || "default", {
      mode: options.mode,
      budget: options.budget ? { maxTokens: options.budget } : undefined,
      timeoutMs: options.timeout,
    })
  }

  async run(): Promise<TeamResult> {
    // Create appropriate runner based on mode
    switch (this.config.mode) {
      case "worker-reviewer": {
        const runner = new WorkerReviewerRunner(this.config, {
          askWorker: async () => {
            throw new Error("Not implemented: askWorker callback not connected")
          },
          askReviewer: async () => {
            throw new Error("Not implemented: askReviewer callback not connected")
          },
        })
        return runner.execute(this.objective)
      }
      case "leader-workers": {
        const runner = new LeaderWorkersRunner(this.config, {
          askLeader: async () => {
            throw new Error("Not implemented: askLeader callback not connected")
          },
          askWorker: async () => {
            throw new Error("Not implemented: askWorker callback not connected")
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
