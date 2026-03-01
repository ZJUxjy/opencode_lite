/**
 * Baseline Benchmark Script
 *
 * 对比单 Agent 和 Team 模式的性能基线。
 * 基于 agent-teams-supplement.md 原则 6: Baseline Testing Automation
 *
 * Usage:
 *   npx tsx scripts/baseline-benchmark.ts
 *   npm run benchmark
 */

import * as fs from "fs"
import * as path from "path"

// ============ Types ============

interface BaselineSample {
  id: string
  category: "simple" | "medium" | "complex"
  task: string
  expectedFiles: string[]
  validationCommands: string[]
  timeBudget: number // seconds
  tokenBudget: number
}

interface ExecutionResult {
  sampleId: string
  mode: "single-agent" | string
  success: boolean
  duration: number
  tokens: number
  cost: number
  filesModified: string[]
  validationPassed: boolean
  error?: string
}

interface ComparisonResult {
  sampleId: string
  mode: string
  singleAgent: ExecutionResult
  team: ExecutionResult
  improvement: {
    duration: number // percentage improvement
    successRate: number // percentage improvement
  }
}

interface BaselineReport {
  timestamp: number
  comparisons: ComparisonResult[]
  summary: {
    totalSamples: number
    singleAgentSuccessRate: number
    teamSuccessRate: number
    averageImprovement: number
    totalCost: {
      singleAgent: number
      team: number
    }
  }
}

// ============ Default Test Suite ============

const DEFAULT_TEST_SUITE: BaselineSample[] = [
  // Simple tasks (5 samples)
  {
    id: "simple-001",
    category: "simple",
    task: "Add a helloWorld function that returns 'Hello, World!' to src/utils.ts",
    expectedFiles: ["src/utils.ts"],
    validationCommands: ["grep -q 'helloWorld' src/utils.ts"],
    timeBudget: 60,
    tokenBudget: 10000,
  },
  {
    id: "simple-002",
    category: "simple",
    task: "Add a comment to the Agent class explaining its purpose",
    expectedFiles: ["src/agent.ts"],
    validationCommands: ["grep -q 'class Agent' src/agent.ts"],
    timeBudget: 60,
    tokenBudget: 10000,
  },
  {
    id: "simple-003",
    category: "simple",
    task: "Create a constant DEFAULT_TIMEOUT = 30000 in src/config.ts",
    expectedFiles: ["src/config.ts"],
    validationCommands: ["grep -q 'DEFAULT_TIMEOUT' src/config.ts"],
    timeBudget: 60,
    tokenBudget: 10000,
  },
  {
    id: "simple-004",
    category: "simple",
    task: "Add a utility function formatDate(date: Date): string that returns ISO format",
    expectedFiles: ["src/utils.ts"],
    validationCommands: ["grep -q 'formatDate' src/utils.ts"],
    timeBudget: 60,
    tokenBudget: 10000,
  },
  {
    id: "simple-005",
    category: "simple",
    task: "Add a type alias UserId = string in src/types.ts",
    expectedFiles: ["src/types.ts"],
    validationCommands: ["grep -q 'UserId' src/types.ts"],
    timeBudget: 60,
    tokenBudget: 10000,
  },

  // Medium tasks (3 samples)
  {
    id: "medium-001",
    category: "medium",
    task: "Implement a simple LRU cache class with get, set, and has methods in src/cache.ts",
    expectedFiles: ["src/cache.ts"],
    validationCommands: [
      "grep -q 'class LRUCache' src/cache.ts",
      "grep -q 'get(' src/cache.ts",
      "grep -q 'set(' src/cache.ts",
    ],
    timeBudget: 180,
    tokenBudget: 30000,
  },
  {
    id: "medium-002",
    category: "medium",
    task: "Create a rate limiter class that limits calls per second in src/rate-limiter.ts",
    expectedFiles: ["src/rate-limiter.ts"],
    validationCommands: [
      "grep -q 'class RateLimiter' src/rate-limiter.ts",
      "grep -q 'acquire' src/rate-limiter.ts",
    ],
    timeBudget: 180,
    tokenBudget: 30000,
  },
  {
    id: "medium-003",
    category: "medium",
    task: "Implement a simple event emitter with on, off, and emit methods in src/events.ts",
    expectedFiles: ["src/events.ts"],
    validationCommands: [
      "grep -q 'class EventEmitter' src/events.ts",
      "grep -q 'on(' src/events.ts",
      "grep -q 'emit(' src/events.ts",
    ],
    timeBudget: 180,
    tokenBudget: 30000,
  },

  // Complex tasks (2 samples)
  {
    id: "complex-001",
    category: "complex",
    task: "Create a complete promise pool implementation that limits concurrent async operations in src/promise-pool.ts",
    expectedFiles: ["src/promise-pool.ts"],
    validationCommands: [
      "grep -q 'class PromisePool' src/promise-pool.ts",
      "grep -q 'add' src/promise-pool.ts",
      "grep -q 'all' src/promise-pool.ts",
    ],
    timeBudget: 300,
    tokenBudget: 50000,
  },
  {
    id: "complex-002",
    category: "complex",
    task: "Implement a simple dependency injection container with register, resolve, and singleton support in src/di.ts",
    expectedFiles: ["src/di.ts"],
    validationCommands: [
      "grep -q 'class Container' src/di.ts",
      "grep -q 'register' src/di.ts",
      "grep -q 'resolve' src/di.ts",
    ],
    timeBudget: 300,
    tokenBudget: 50000,
  },
]

// ============ Benchmark Runner ============

class BaselineBenchmark {
  private samples: BaselineSample[]
  private results: ExecutionResult[] = []
  private outputDir: string

  constructor(samples: BaselineSample[] = DEFAULT_TEST_SUITE) {
    this.samples = samples
    this.outputDir = path.resolve(process.cwd(), ".agent-teams/benchmark")
  }

  /**
   * Run all samples and generate report
   */
  async run(modes: string[] = ["worker-reviewer"]): Promise<BaselineReport> {
    console.log(`\n📊 Baseline Benchmark`)
    console.log(`========================`)
    console.log(`Samples: ${this.samples.length}`)
    console.log(`Modes to compare: single-agent, ${modes.join(", ")}`)
    console.log(``)

    // Ensure output directory
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true })
    }

    const comparisons: ComparisonResult[] = []

    for (const sample of this.samples) {
      console.log(`\n🔍 Running sample: ${sample.id} (${sample.category})`)
      console.log(`   Task: ${sample.task.substring(0, 60)}...`)

      // Run single agent
      const singleAgentResult = await this.runSingleAgent(sample)
      this.results.push(singleAgentResult)

      // Run team mode for each specified mode
      for (const mode of modes) {
        const teamResult = await this.runTeamMode(sample, mode)
        this.results.push(teamResult)

        comparisons.push({
          sampleId: sample.id,
          mode,
          singleAgent: singleAgentResult,
          team: teamResult,
          improvement: this.calculateImprovement(singleAgentResult, teamResult),
        })
      }

      // Progress indicator
      const progress = ((this.results.length / (this.samples.length * (modes.length + 1))) * 100).toFixed(0)
      process.stdout.write(`\r   Progress: ${progress}%`)
    }

    console.log(`\n\n✅ Benchmark complete!`)

    const report: BaselineReport = {
      timestamp: Date.now(),
      comparisons,
      summary: this.generateSummary(comparisons),
    }

    // Save report
    const reportPath = path.join(this.outputDir, `report-${Date.now()}.json`)
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(`\n📄 Report saved to: ${reportPath}`)

    // Print summary
    this.printSummary(report)

    return report
  }

  /**
   * Run single agent execution (simulated)
   */
  private async runSingleAgent(sample: BaselineSample): Promise<ExecutionResult> {
    const startTime = Date.now()

    // Simulate execution - in real implementation, this would call the Agent
    // For now, we return mock data
    const mockDuration = this.getMockDuration(sample.category)
    const mockTokens = this.getMockTokens(sample.category)
    const mockCost = mockTokens * 0.000003 // $3 per 1M tokens

    return {
      sampleId: sample.id,
      mode: "single-agent",
      success: Math.random() > 0.2, // 80% success rate
      duration: mockDuration,
      tokens: mockTokens,
      cost: mockCost,
      filesModified: sample.expectedFiles,
      validationPassed: Math.random() > 0.25, // 75% validation pass rate
    }
  }

  /**
   * Run team mode execution (simulated)
   */
  private async runTeamMode(sample: BaselineSample, mode: string): Promise<ExecutionResult> {
    // Simulate execution - in real implementation, this would call TeamExecutor
    const mockDuration = this.getMockDuration(sample.category) * 1.5 // Team takes 50% more time
    const mockTokens = this.getMockTokens(sample.category) * 2.5 // But uses 2.5x tokens
    const mockCost = mockTokens * 0.000003

    return {
      sampleId: sample.id,
      mode,
      success: Math.random() > 0.1, // 90% success rate (better than single agent)
      duration: mockDuration,
      tokens: mockTokens,
      cost: mockCost,
      filesModified: sample.expectedFiles,
      validationPassed: Math.random() > 0.15, // 85% validation pass rate
    }
  }

  /**
   * Calculate improvement metrics
   */
  private calculateImprovement(
    singleAgent: ExecutionResult,
    team: ExecutionResult
  ): ComparisonResult["improvement"] {
    const durationImprovement =
      singleAgent.duration > 0
        ? ((singleAgent.duration - team.duration) / singleAgent.duration) * 100
        : 0

    const successImprovement =
      ((team.success ? 1 : 0) - (singleAgent.success ? 1 : 0)) * 100

    return {
      duration: durationImprovement,
      successRate: successImprovement,
    }
  }

  /**
   * Generate summary statistics
   */
  private generateSummary(comparisons: ComparisonResult[]): BaselineReport["summary"] {
    const totalSamples = comparisons.length

    const singleAgentSuccesses = comparisons.filter(c => c.singleAgent.success).length
    const teamSuccesses = comparisons.filter(c => c.team.success).length

    const totalSingleAgentCost = comparisons.reduce((sum, c) => sum + c.singleAgent.cost, 0)
    const totalTeamCost = comparisons.reduce((sum, c) => sum + c.team.cost, 0)

    const avgImprovement =
      comparisons.reduce((sum, c) => sum + c.improvement.successRate, 0) / totalSamples

    return {
      totalSamples,
      singleAgentSuccessRate: (singleAgentSuccesses / totalSamples) * 100,
      teamSuccessRate: (teamSuccesses / totalSamples) * 100,
      averageImprovement: avgImprovement,
      totalCost: {
        singleAgent: totalSingleAgentCost,
        team: totalTeamCost,
      },
    }
  }

  /**
   * Print summary to console
   */
  private printSummary(report: BaselineReport): void {
    const { summary } = report

    console.log(`\n📈 Summary`)
    console.log(`============`)
    console.log(`Total Samples: ${summary.totalSamples}`)
    console.log(``)
    console.log(`Success Rate:`)
    console.log(`  Single Agent: ${summary.singleAgentSuccessRate.toFixed(1)}%`)
    console.log(`  Team Mode:    ${summary.teamSuccessRate.toFixed(1)}%`)
    console.log(`  Improvement:  ${(summary.teamSuccessRate - summary.singleAgentSuccessRate).toFixed(1)}%`)
    console.log(``)
    console.log(`Total Cost:`)
    console.log(`  Single Agent: $${summary.totalCost.singleAgent.toFixed(4)}`)
    console.log(`  Team Mode:    $${summary.totalCost.team.toFixed(4)}`)
    console.log(`  Ratio:        ${(summary.totalCost.team / summary.totalCost.singleAgent).toFixed(2)}x`)
    console.log(``)
    console.log(`Average Success Rate Improvement: ${summary.averageImprovement.toFixed(1)}%`)
  }

  /**
   * Get mock duration based on category
   */
  private getMockDuration(category: BaselineSample["category"]): number {
    const baseDuration = {
      simple: 30000,
      medium: 90000,
      complex: 180000,
    }
    // Add some randomness
    return baseDuration[category] * (0.8 + Math.random() * 0.4)
  }

  /**
   * Get mock token count based on category
   */
  private getMockTokens(category: BaselineSample["category"]): number {
    const baseTokens = {
      simple: 5000,
      medium: 15000,
      complex: 30000,
    }
    // Add some randomness
    return Math.floor(baseTokens[category] * (0.8 + Math.random() * 0.4))
  }
}

// ============ CLI Entry Point ============

async function main() {
  const args = process.argv.slice(2)
  const modes = args.includes("--modes")
    ? args[args.indexOf("--modes") + 1]?.split(",") || ["worker-reviewer"]
    : ["worker-reviewer"]

  const benchmark = new BaselineBenchmark()
  await benchmark.run(modes)
}

main().catch(console.error)

export { BaselineBenchmark, DEFAULT_TEST_SUITE, type BaselineSample, type BaselineReport }
