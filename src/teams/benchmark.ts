import type { TeamConfig, TeamMode } from "./types.js"
import { TeamManager, type TeamMetrics, type TeamRunResult } from "./manager.js"

// ============================================================================
// TeamBenchmark - 团队性能基准测试
// ============================================================================

/**
 * TeamBenchmark - 基线指标采集脚本
 *
 * 用于采集单Agent vs Team模式对比数据
 */
export class TeamBenchmark {
  private results: BenchmarkResult[] = []

  /**
   * 运行基准测试
   */
  async runBenchmark(params: BenchmarkParams): Promise<BenchmarkReport> {
    const { tasks, teamConfig, baselineConfig } = params

    console.log("=" .repeat(60))
    console.log("Team Benchmark Started")
    console.log("=" .repeat(60))

    // 运行 baseline (单Agent)
    console.log("\n[Phase 1] Running Baseline (Single Agent)...")
    const baselineResults: TaskResult[] = []

    for (const task of tasks) {
      console.log(`  - ${task.name}...`)
      const result = await this.runSingleAgentTask(task, baselineConfig)
      baselineResults.push(result)
    }

    // 运行 Team 模式
    console.log("\n[Phase 2] Running Team Mode...")
    const teamResults: TaskResult[] = []

    for (const task of tasks) {
      console.log(`  - ${task.name}...`)
      const result = await this.runTeamTask(task, teamConfig)
      teamResults.push(result)
    }

    // 生成报告
    const report = this.generateReport(baselineResults, teamResults)

    console.log("\n" + "=".repeat(60))
    console.log("Benchmark Complete")
    console.log("=".repeat(60))
    console.log(report.summary)

    this.results = baselineResults.map((r, i) => ({
      ...r,
      teamResult: teamResults[i],
    }))

    return report
  }

  /**
   * 运行单Agent任务（模拟）
   */
  private async runSingleAgentTask(task: BenchmarkTask, config: SingleAgentConfig): Promise<TaskResult> {
    const startTime = Date.now()

    // 模拟执行
    await this.simulateExecution(task, config)

    const endTime = Date.now()
    const duration = endTime - startTime

    return {
      taskName: task.name,
      mode: "single-agent",
      success: true,
      duration,
      cost: duration * 0.001 * (config.costPerSecond || 0.01),
      tokens: Math.floor(duration / 1000) * 1000,
      iterations: 1,
    }
  }

  /**
   * 运行团队任务（模拟）
   */
  private async runTeamTask(task: BenchmarkTask, config: TeamConfig): Promise<TaskResult> {
    const startTime = Date.now()

    // 模拟执行
    await this.simulateExecution(task, config)

    const endTime = Date.now()
    const duration = endTime - startTime

    // Team模式通常成本更高
    const agentCount = config.agents?.length || 2
    const cost = duration * 0.001 * (0.01 * agentCount)

    return {
      taskName: task.name,
      mode: config.mode,
      success: true,
      duration,
      cost,
      tokens: Math.floor(duration / 1000) * 1000 * agentCount,
      iterations: config.maxIterations || 3,
    }
  }

  /**
   * 模拟执行（实际应该调用真实Agent）
   */
  private async simulateExecution(task: BenchmarkTask, config: unknown): Promise<void> {
    // 模拟延迟
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  /**
   * 生成报告
   */
  private generateReport(baseline: TaskResult[], team: TaskResult[]): BenchmarkReport {
    // 计算统计
    const baselineStats = this.calculateStats(baseline)
    const teamStats = this.calculateStats(team)

    // 计算对比
    const costRatio = teamStats.avgCost / baselineStats.avgCost
    const tokenRatio = teamStats.avgTokens / baselineStats.avgTokens
    const durationRatio = teamStats.avgDuration / baselineStats.avgDuration

    // 质量评估（需要外部提供）
    const qualityImprovement = 0 // 简化

    const report: BenchmarkReport = {
      timestamp: Date.now(),
      taskCount: baseline.length,

      baseline: baselineStats,
      team: teamStats,

      comparison: {
        costRatio,
        tokenRatio,
        durationRatio,
        qualityImprovement,
        verdict: this.getVerdict(costRatio, qualityImprovement),
      },

      details: baseline.map((r, i) => ({
        taskName: r.taskName,
        baseline: r,
        team: team[i],
      })),

      summary: this.generateSummary(baselineStats, teamStats, costRatio, qualityImprovement),
    }

    return report
  }

  private calculateStats(results: TaskResult[]): StatSummary {
    if (results.length === 0) {
      return { avgCost: 0, avgTokens: 0, avgDuration: 0, successRate: 0 }
    }

    const total = results.reduce(
      (acc, r) => ({
        cost: acc.cost + r.cost,
        tokens: acc.tokens + r.tokens,
        duration: acc.duration + r.duration,
        success: acc.success + (r.success ? 1 : 0),
      }),
      { cost: 0, tokens: 0, duration: 0, success: 0 }
    )

    const count = results.length

    return {
      avgCost: total.cost / count,
      avgTokens: total.tokens / count,
      avgDuration: total.duration / count,
      successRate: (total.success / count) * 100,
    }
  }

  private getVerdict(costRatio: number, qualityImprovement: number): "recommended" | "neutral" | "not-recommended" {
    // 简单判定：成本增加不超过2倍且质量有提升则推荐
    if (costRatio <= 2.0 && qualityImprovement > 0) {
      return "recommended"
    }
    if (costRatio > 2.5) {
      return "not-recommended"
    }
    return "neutral"
  }

  private generateSummary(
    baseline: StatSummary,
    team: StatSummary,
    costRatio: number,
    qualityImprovement: number
  ): string {
    const lines: string[] = []

    lines.push("")
    lines.push("## 基准测试报告")
    lines.push("")
    lines.push(`| 指标 | Baseline (单Agent) | Team | 对比 |`)
    lines.push(`|------|-------------------|------|------|`)
    lines.push(`| 平均成本 | $${baseline.avgCost.toFixed(2)} | $${team.avgCost.toFixed(2)} | ${costRatio.toFixed(1)}x |`)
    lines.push(`| 平均Token | ${baseline.avgTokens.toFixed(0)} | ${team.avgTokens.toFixed(0)} | ${(team.avgTokens / baseline.avgTokens).toFixed(1)}x |`)
    lines.push(`| 平均耗时 | ${(baseline.avgDuration / 1000).toFixed(1)}s | ${(team.avgDuration / 1000).toFixed(1)}s | ${(team.avgDuration / baseline.avgDuration).toFixed(1)}x |`)
    lines.push(`| 成功率 | ${baseline.successRate.toFixed(0)}% | ${team.successRate.toFixed(0)}% | - |`)
    lines.push("")

    const verdict = this.getVerdict(costRatio, qualityImprovement)
    const verdictText = {
      recommended: "✅ 推荐 - Team模式质量提升明显",
      neutral: "⚠️ 观望 - 需要更多数据",
      "not-recommended": "❌ 不推荐 - 成本过高",
    }[verdict]

    lines.push(`**结论**: ${verdictText}`)

    return lines.join("\n")
  }

  /**
   * 导出JSON报告
   */
  exportJSON(): string {
    return JSON.stringify(this.results, null, 2)
  }
}

// ============================================================================
// 快速运行函数
// ============================================================================

/**
 * 快速运行单个对比测试
 */
export async function quickBenchmark(
  taskName: string,
  teamConfig: TeamConfig
): Promise<{ baseline: TaskResult; team: TaskResult }> {
  const benchmark = new TeamBenchmark()

  const task: BenchmarkTask = {
    name: taskName,
    description: taskName,
    expectedOutput: "",
  }

  const result = await benchmark.runBenchmark({
    tasks: [task],
    teamConfig,
    baselineConfig: { costPerSecond: 0.01 },
  })

  return {
    baseline: result.details[0].baseline,
    team: result.details[0].team,
  }
}

// ============================================================================
// 类型定义
// ============================================================================

export interface BenchmarkParams {
  tasks: BenchmarkTask[]
  teamConfig: TeamConfig
  baselineConfig: SingleAgentConfig
}

export interface BenchmarkTask {
  name: string
  description: string
  expectedOutput: string
}

export interface SingleAgentConfig {
  costPerSecond?: number
  model?: string
}

export interface TaskResult {
  taskName: string
  mode: string
  success: boolean
  duration: number
  cost: number
  tokens: number
  iterations: number
}

export interface StatSummary {
  avgCost: number
  avgTokens: number
  avgDuration: number
  successRate: number
}

export interface BenchmarkResult extends TaskResult {
  teamResult?: TaskResult
}

export interface BenchmarkReport {
  timestamp: number
  taskCount: number
  baseline: StatSummary
  team: StatSummary
  comparison: {
    costRatio: number
    tokenRatio: number
    durationRatio: number
    qualityImprovement: number
    verdict: "recommended" | "neutral" | "not-recommended"
  }
  details: Array<{
    taskName: string
    baseline: TaskResult
    team: TaskResult
  }>
  summary: string
}

// ============================================================================
// 默认测试套件
// ============================================================================

/**
 * 默认测试套件 - 10+ 基线测试样本
 *
 * 用于快速验证 Agent Teams 性能
 */
export const DEFAULT_TEST_SUITE: BenchmarkTask[] = [
  // Simple 级别 (1-4)
  {
    name: "simple-001",
    description: "Add a hello world function to utils.ts",
    expectedOutput: "Function hello() { return 'Hello, World!' }",
  },
  {
    name: "simple-002",
    description: "Fix typo in README.md: 'teh' -> 'the'",
    expectedOutput: "Fixed typo",
  },
  {
    name: "simple-003",
    description: "Add console.log statement to entry point",
    expectedOutput: "Added logging",
  },
  {
    name: "simple-004",
    description: "Create a simple config file with default values",
    expectedOutput: "Config file created",
  },

  // Medium 级别 (5-8)
  {
    name: "medium-001",
    description: "Implement a function to calculate fibonacci sequence",
    expectedOutput: "Fibonacci function implemented",
  },
  {
    name: "medium-002",
    description: "Add input validation to a form handler",
    expectedOutput: "Validation added",
  },
  {
    name: "medium-003",
    description: "Refactor a function to use async/await",
    expectedOutput: "Function refactored",
  },
  {
    name: "medium-004",
    description: "Add error handling to API endpoint",
    expectedOutput: "Error handling added",
  },

  // Complex 级别 (9-12)
  {
    name: "complex-001",
    description: "Implement user authentication flow with JWT",
    expectedOutput: "Auth flow implemented",
  },
  {
    name: "complex-002",
    description: "Create a pagination utility for database queries",
    expectedOutput: "Pagination utility created",
  },
  {
    name: "complex-003",
    description: "Implement rate limiting middleware",
    expectedOutput: "Rate limiting implemented",
  },
  {
    name: "complex-004",
    description: "Add caching layer to API client",
    expectedOutput: "Caching layer added",
  },
]

/**
 * 根据难度获取测试样本
 */
export function getTestSuiteByDifficulty(
  difficulty: "simple" | "medium" | "complex" | "all"
): BenchmarkTask[] {
  switch (difficulty) {
    case "simple":
      return DEFAULT_TEST_SUITE.filter((t) => t.name.startsWith("simple"))
    case "medium":
      return DEFAULT_TEST_SUITE.filter((t) => t.name.startsWith("medium"))
    case "complex":
      return DEFAULT_TEST_SUITE.filter((t) => t.name.startsWith("complex"))
    case "all":
    default:
      return DEFAULT_TEST_SUITE
  }
}
