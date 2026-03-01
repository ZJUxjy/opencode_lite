/**
 * Non-Interactive Mode - 非交互模式支持
 *
 * 基于 agent-teams-supplement.md P2-4: 非交互模式支持
 *
 * 支持 CI/CD 集成，提供 JSON 输出和自动化执行能力。
 */

import type { Agent } from "../agent.js"
import type { TeamConfig, TeamResult } from "./types.js"
import { TeamExecutor } from "./team-executor.js"
import { executeWithFallback, type FallbackResult } from "./fallback.js"

/**
 * 输出格式
 */
export type OutputFormat = "text" | "json" | "markdown"

/**
 * 非交互模式配置
 */
export interface NonInteractiveConfig {
  /** 输出格式 */
  outputFormat: OutputFormat
  /** 是否详细输出 */
  verbose: boolean
  /** 是否在失败时退出 */
  exitOnFailure: boolean
  /** 失败退出码 */
  failureExitCode: number
  /** 超时时间 (毫秒) */
  timeout: number
  /** 是否启用 fallback */
  enableFallback: boolean
  /** 是否输出进度 */
  showProgress: boolean
}

/**
 * 默认配置
 */
export const DEFAULT_NON_INTERACTIVE_CONFIG: NonInteractiveConfig = {
  outputFormat: "text",
  verbose: false,
  exitOnFailure: true,
  failureExitCode: 1,
  timeout: 300000, // 5 minutes
  enableFallback: true,
  showProgress: false,
}

/**
 * 执行结果
 */
export interface NonInteractiveResult {
  /** 是否成功 */
  success: boolean
  /** 输出摘要 */
  summary: string
  /** 详细输出 */
  details?: string
  /** 统计信息 */
  stats?: {
    duration: number
    tokens: number
    cost: number
    iterations?: number
  }
  /** 错误信息 */
  error?: string
  /** 退出码 */
  exitCode: number
  /** 原始结果 */
  rawResult?: TeamResult | FallbackResult
}

/**
 * 非交互执行器
 */
export class NonInteractiveExecutor {
  private config: NonInteractiveConfig

  constructor(config: Partial<NonInteractiveConfig> = {}) {
    this.config = { ...DEFAULT_NON_INTERACTIVE_CONFIG, ...config }
  }

  /**
   * 执行任务
   */
  async execute(
    agent: Agent,
    prompt: string,
    teamConfig: TeamConfig | null
  ): Promise<NonInteractiveResult> {
    const startTime = Date.now()

    try {
      let result: TeamResult | FallbackResult

      if (teamConfig) {
        // Team 模式执行
        result = await this.executeWithTeam(agent, prompt, teamConfig)
      } else {
        // 单 Agent 执行
        result = await this.executeWithAgent(agent, prompt)
      }

      const duration = Date.now() - startTime

      return this.formatResult(result, duration)
    } catch (error) {
      const duration = Date.now() - startTime
      const err = error instanceof Error ? error : new Error(String(error))

      return {
        success: false,
        summary: `Execution failed: ${err.message}`,
        error: err.message,
        stats: { duration, tokens: 0, cost: 0 },
        exitCode: this.config.failureExitCode,
      }
    }
  }

  /**
   * 使用 Team 模式执行
   */
  private async executeWithTeam(
    agent: Agent,
    prompt: string,
    teamConfig: TeamConfig
  ): Promise<TeamResult | FallbackResult> {
    const sessionId = `non-interactive-${Date.now()}`

    if (this.config.enableFallback) {
      return executeWithFallback(
        async () => {
          const executor = new TeamExecutor({
            mainAgent: agent,
            teamConfig,
            sessionId,
          })
          return executor.execute(prompt)
        },
        agent,
        prompt,
        { enabled: true }
      )
    } else {
      const executor = new TeamExecutor({
        mainAgent: agent,
        teamConfig,
        sessionId,
      })
      return executor.execute(prompt)
    }
  }

  /**
   * 使用单 Agent 执行
   */
  private async executeWithAgent(
    agent: Agent,
    prompt: string
  ): Promise<TeamResult> {
    const startTime = Date.now()
    const response = await agent.run(prompt)
    const duration = Date.now() - startTime

    return {
      status: "success",
      summary: response,
      artifacts: [],
      stats: {
        duration,
        iterations: 1,
        totalCost: 0,
        totalTokens: 0,
      },
    }
  }

  /**
   * 格式化结果
   */
  private formatResult(
    result: TeamResult | FallbackResult,
    duration: number
  ): NonInteractiveResult {
    // 检查是否为 FallbackResult
    const isFallback = "executionMode" in result

    if (isFallback) {
      const fallbackResult = result as FallbackResult
      const success = fallbackResult.executionMode !== "team-failure"

      return {
        success,
        summary: fallbackResult.finalSummary,
        stats: {
          duration,
          tokens: fallbackResult.teamResult?.stats.totalTokens ||
                  fallbackResult.singleAgentResult?.length || 0,
          cost: fallbackResult.teamResult?.stats.totalCost || 0,
          iterations: fallbackResult.teamResult?.stats.iterations || 1,
        },
        exitCode: success ? 0 : this.config.failureExitCode,
        rawResult: fallbackResult,
      }
    } else {
      const teamResult = result as TeamResult
      const success = teamResult.status === "success"

      return {
        success,
        summary: teamResult.summary,
        stats: {
          duration,
          tokens: teamResult.stats.totalTokens,
          cost: teamResult.stats.totalCost,
          iterations: teamResult.stats.iterations,
        },
        exitCode: success ? 0 : this.config.failureExitCode,
        rawResult: teamResult,
      }
    }
  }

  /**
   * 格式化输出
   */
  formatOutput(result: NonInteractiveResult): string {
    switch (this.config.outputFormat) {
      case "json":
        return this.formatAsJson(result)
      case "markdown":
        return this.formatAsMarkdown(result)
      default:
        return this.formatAsText(result)
    }
  }

  /**
   * 文本格式输出
   */
  private formatAsText(result: NonInteractiveResult): string {
    const lines: string[] = []

    lines.push(result.success ? "✅ Success" : "❌ Failed")
    lines.push("")
    lines.push("Summary:")
    lines.push(result.summary)

    if (result.stats) {
      lines.push("")
      lines.push("Statistics:")
      lines.push(`  Duration: ${(result.stats.duration / 1000).toFixed(1)}s`)
      if (result.stats.tokens) {
        lines.push(`  Tokens: ${result.stats.tokens}`)
      }
      if (result.stats.cost) {
        lines.push(`  Cost: $${result.stats.cost.toFixed(4)}`)
      }
      if (result.stats.iterations) {
        lines.push(`  Iterations: ${result.stats.iterations}`)
      }
    }

    if (result.error && this.config.verbose) {
      lines.push("")
      lines.push("Error:")
      lines.push(result.error)
    }

    return lines.join("\n")
  }

  /**
   * JSON 格式输出
   */
  private formatAsJson(result: NonInteractiveResult): string {
    const output = {
      success: result.success,
      summary: result.summary,
      stats: result.stats,
      error: result.error,
      exitCode: result.exitCode,
    }

    return JSON.stringify(output, null, this.config.verbose ? 2 : 0)
  }

  /**
   * Markdown 格式输出
   */
  private formatAsMarkdown(result: NonInteractiveResult): string {
    const lines: string[] = []

    lines.push(`# Execution Result`)
    lines.push("")
    lines.push(`**Status**: ${result.success ? "✅ Success" : "❌ Failed"}`)
    lines.push("")

    lines.push("## Summary")
    lines.push("")
    lines.push(result.summary)
    lines.push("")

    if (result.stats) {
      lines.push("## Statistics")
      lines.push("")
      lines.push("| Metric | Value |")
      lines.push("|--------|-------|")
      lines.push(`| Duration | ${(result.stats.duration / 1000).toFixed(1)}s |`)
      if (result.stats.tokens) {
        lines.push(`| Tokens | ${result.stats.tokens} |`)
      }
      if (result.stats.cost) {
        lines.push(`| Cost | $${result.stats.cost.toFixed(4)} |`)
      }
      if (result.stats.iterations) {
        lines.push(`| Iterations | ${result.stats.iterations} |`)
      }
      lines.push("")
    }

    if (result.error && this.config.verbose) {
      lines.push("## Error")
      lines.push("")
      lines.push("```")
      lines.push(result.error)
      lines.push("```")
      lines.push("")
    }

    return lines.join("\n")
  }

  /**
   * 获取配置
   */
  getConfig(): NonInteractiveConfig {
    return { ...this.config }
  }
}

/**
 * 创建非交互执行器
 */
export function createNonInteractiveExecutor(
  config?: Partial<NonInteractiveConfig>
): NonInteractiveExecutor {
  return new NonInteractiveExecutor(config)
}

/**
 * 快速执行函数
 */
export async function runNonInteractive(
  agent: Agent,
  prompt: string,
  teamConfig: TeamConfig | null,
  config?: Partial<NonInteractiveConfig>
): Promise<NonInteractiveResult> {
  const executor = new NonInteractiveExecutor(config)
  return executor.execute(agent, prompt, teamConfig)
}
