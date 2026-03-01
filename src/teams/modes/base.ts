// src/teams/modes/base.ts
import type { TeamMode, TeamConfig, TeamState } from "../core/types.js"

export interface TeamResult<T = unknown> {
  status: "completed" | "failed" | "cancelled" | "fallback"
  output: T
  stats: {
    durationMs: number
    tokensUsed: { input: number; output: number }
    iterations: number
  }
  fallbackUsed?: boolean
  error?: string
}

export interface ModeRunner<TInput = unknown, TOutput = unknown> {
  readonly mode: TeamMode
  readonly config: TeamConfig
  execute(input: TInput): Promise<TeamResult<TOutput>>
  cancel(): void
  getState(): TeamState
}

export type ProgressCallback = (message: string, data?: unknown) => void
export type ErrorCallback = (error: Error) => void
export type CompleteCallback = (result: TeamResult) => void

export abstract class BaseModeRunner<TInput = unknown, TOutput = unknown>
  implements ModeRunner<TInput, TOutput>
{
  abstract readonly mode: TeamMode
  readonly config: TeamConfig
  protected state: TeamState
  protected abortController: AbortController

  constructor(config: TeamConfig) {
    this.config = config
    this.abortController = new AbortController()
    this.state = {
      teamId: `team-${Date.now()}`,
      mode: config.mode,
      status: "initializing",
      currentIteration: 0,
      startTime: Date.now(),
      tokensUsed: { input: 0, output: 0 },
      costUsd: 0,
      lastProgressAt: Date.now(),
      consecutiveNoProgressRounds: 0,
      consecutiveFailures: 0,
    }
  }

  abstract execute(input: TInput): Promise<TeamResult<TOutput>>

  cancel(): void {
    this.abortController.abort()
  }

  getState(): TeamState {
    return { ...this.state }
  }
}
