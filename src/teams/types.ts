import { z } from "zod"

// ============================================================================
// 团队模式
// ============================================================================

export type TeamMode =
  | "worker-reviewer"
  | "planner-executor-reviewer"
  | "leader-workers"
  | "hotfix-guardrail"
  | "council"

export type LeaderWorkersStrategy = "collaborative" | "competitive"

// ============================================================================
// Agent 角色
// ============================================================================

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

// ============================================================================
// 团队状态
// ============================================================================

export type TeamStatus =
  | "initializing"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "cancelled"

// ============================================================================
// 团队配置
// ============================================================================

export interface TeamAgentConfig {
  role: AgentRole
  model: string
  skills?: string[]
  systemPrompt?: string
}

/**
 * 思考预算配置 - 控制扩展思考 (Extended Thinking)
 *
 * 来源: Anthropic 的 "thinking budget" 机制
 * 用途: 为 Planner/Leader 角色启用扩展思考，Worker 可禁用以节省成本
 */
export interface ThinkingBudget {
  enabled: boolean
  maxThinkingTokens: number  // 思考阶段最大 token
  outputThinkingProcess: boolean  // 是否输出思考过程
}

export interface BudgetConfig {
  maxTokens: number
  maxCostUsd?: number
  maxParallelAgents?: number
}

export interface QualityGateConfig {
  testsMustPass: boolean
  noP0Issues: boolean
  minCoverage?: number
  requiredChecks?: string[]
}

export interface CircuitBreakerConfig {
  maxConsecutiveFailures: number
  maxNoProgressRounds: number
  cooldownMs: number
}

export interface TeamConfig {
  mode: TeamMode
  strategy?: LeaderWorkersStrategy
  agents: TeamAgentConfig[]
  maxIterations: number
  timeoutMs: number
  budget?: BudgetConfig
  qualityGate: QualityGateConfig
  circuitBreaker: CircuitBreakerConfig
  conflictResolution: "auto" | "manual"
  // 检查点配置
  checkpointEnabled?: boolean
  checkpointDir?: string
  // 思考预算配置
  thinkingBudget?: ThinkingBudget
}

// ============================================================================
// Agent 通信消息
// ============================================================================

export type AgentMessage =
  | { type: "task-assign"; taskId: string; objective: string; fileScope: string[] }
  | { type: "task-result"; taskId: string; summary: string; changedFiles: string[]; passed: boolean }
  | { type: "review-request"; taskId: string; artifactRef: string }
  | { type: "review-result"; taskId: string; status: "approved" | "changes_requested"; mustFix: string[] }
  | { type: "conflict-detected"; files: string[] }
  | { type: "progress-update"; taskId: string; progress: number }
  | { type: "error"; taskId: string; error: string }

// ============================================================================
// Agent 实例状态
// ============================================================================

export interface AgentInstance {
  id: string
  role: AgentRole
  model: string
  status: "idle" | "working" | "completed" | "error"
  currentTaskId?: string
  createdAt: number
  lastActiveAt: number
}

// ============================================================================
// 团队运行上下文
// ============================================================================

export interface TeamContext {
  teamId: string
  config: TeamConfig
  status: TeamStatus
  agents: Map<string, AgentInstance>
  currentIteration: number
  startTime: number
  endTime?: number

  // 统计信息
  totalTokens: number
  totalCostUsd: number
  completedTasks: number
  failedTasks: number
}

// ============================================================================
// Zod Schemas for validation
// ============================================================================

export const TeamAgentConfigSchema = z.object({
  role: z.enum([
    "worker",
    "reviewer",
    "planner",
    "executor",
    "leader",
    "member",
    "speaker",
    "fixer",
    "safety-reviewer",
  ]),
  model: z.string(),
  skills: z.array(z.string()).optional(),
  systemPrompt: z.string().optional(),
})

export const BudgetConfigSchema = z.object({
  maxTokens: z.number(),
  maxCostUsd: z.number().optional(),
  maxParallelAgents: z.number().optional(),
})

export const QualityGateConfigSchema = z.object({
  testsMustPass: z.boolean(),
  noP0Issues: z.boolean(),
  minCoverage: z.number().optional(),
  requiredChecks: z.array(z.string()).optional(),
})

export const CircuitBreakerConfigSchema = z.object({
  maxConsecutiveFailures: z.number(),
  maxNoProgressRounds: z.number(),
  cooldownMs: z.number(),
})

export const TeamConfigSchema = z.object({
  mode: z.enum([
    "worker-reviewer",
    "planner-executor-reviewer",
    "leader-workers",
    "hotfix-guardrail",
    "council",
  ]),
  strategy: z.enum(["collaborative", "competitive"]).optional(),
  agents: z.array(TeamAgentConfigSchema),
  maxIterations: z.number(),
  timeoutMs: z.number(),
  budget: BudgetConfigSchema.optional(),
  qualityGate: QualityGateConfigSchema,
  circuitBreaker: CircuitBreakerConfigSchema,
  conflictResolution: z.enum(["auto", "manual"]),
})
