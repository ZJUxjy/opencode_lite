export type TeamMode =
  | "worker-reviewer"
  | "planner-executor-reviewer"
  | "leader-workers"
  | "hotfix-guardrail"
  | "council"

export type LeaderWorkersStrategy = "collaborative" | "competitive"

export type TeamStatus =
  | "initializing"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "cancelled"

export type AgentRole =
  | "worker"
  | "reviewer"
  | "planner"
  | "executor"
  | "leader"
  | "member"
  | "speaker"
  | "fixer"
  | "safety-reviewer"

export interface TeamBudgetConfig {
  maxTokens: number
  maxCostUsd?: number
  maxParallelAgents?: number
}

export interface TeamQualityGate {
  testsMustPass: boolean
  noP0Issues: boolean
  minCoverage?: number
  requiredChecks?: string[]
}

export interface TeamCircuitBreakerConfig {
  maxConsecutiveFailures: number
  maxNoProgressRounds: number
  cooldownMs: number
}

export interface TeamAgentConfig {
  role: AgentRole
  model: string
  skills?: string[]
  systemPrompt?: string
}

export interface ParallelStrategy {
  mode: "sequential" | "parallel" | "adaptive"
  adaptive?: {
    minParallelism: number
    maxParallelism: number
    scaleUpThreshold: number
    scaleDownOnFailure?: boolean
  }
  isolation?: "shared-context" | "isolated-context" | "worktree"
}

export interface ThinkingBudget {
  enabled: boolean
  maxThinkingTokens: number
  outputThinkingProcess: boolean
}

export interface EvaluationRubricDimension {
  name: string
  weight: number
  scale: number
  criteria: string[]
  examples?: string[]
}

export interface EvaluationRubric {
  dimensions: EvaluationRubricDimension[]
  overallThreshold: number
}

export interface TeamConfig {
  mode: TeamMode
  strategy?: LeaderWorkersStrategy
  agents: TeamAgentConfig[]
  maxIterations: number
  timeoutMs: number
  budget?: TeamBudgetConfig
  qualityGate: TeamQualityGate
  circuitBreaker: TeamCircuitBreakerConfig
  conflictResolution: "auto" | "manual"
  parallelStrategy?: ParallelStrategy
  thinkingBudget?: ThinkingBudget
  evaluationRubric?: EvaluationRubric
}

export interface TeamRunStats {
  durationMs: number
  iterations: number
  tokensUsed: number
  estimatedCostUsd: number
}

export interface TeamFailureReport {
  teamId: string
  reason: "failed" | "timeout" | "budget_exceeded" | "circuit_open"
  completedTasks: string[]
  pendingTasks: string[]
  recoveryPrompt: string
}

export interface TeamExecutionResult {
  status: "success" | "failure" | "timeout"
  output: string
  reviewRounds: number
  mustFixCount: number
  p0Count: number
  stats: TeamRunStats
  fallbackUsed?: boolean
}

export interface TeamRuntimeStatus {
  enabled: boolean
  mode: TeamMode
  status: TeamStatus
}

export interface BaselineComparison {
  task: string
  single: {
    output: string
    tokensUsed: number
    durationMs: number
  }
  team: {
    output: string
    tokensUsed: number
    durationMs: number
    reviewRounds: number
    mustFixCount: number
    p0Count: number
    fallbackUsed: boolean
  }
}

export interface BaselineBatchSummary {
  sampleSize: number
  single: {
    avgTokens: number
    p50Tokens: number
    p90Tokens: number
    avgDurationMs: number
    p50DurationMs: number
    p90DurationMs: number
  }
  team: {
    avgTokens: number
    p50Tokens: number
    p90Tokens: number
    avgDurationMs: number
    p50DurationMs: number
    p90DurationMs: number
    avgReviewRounds: number
    avgMustFixCount: number
    avgP0Count: number
    fallbackRate: number
  }
}
