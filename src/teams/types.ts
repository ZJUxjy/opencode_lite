/**
 * Agent Teams 类型定义
 *
 * 定义多 Agent 协作系统的核心类型
 */

import type { Message } from "../types.js"
import type { AgentConfig } from "../agent.js"
import type { WorkArtifact } from "./contracts.js"

/**
 * 团队协作模式
 */
export type TeamMode =
  | "worker-reviewer"
  | "planner-executor-reviewer"
  | "leader-workers"
  | "hotfix-guardrail"
  | "council"

/**
 * Leader-Workers 策略
 */
export type LeaderWorkersStrategy = "collaborative" | "competitive"

/**
 * Agent 角色
 */
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

/**
 * 团队状态
 */
export type TeamStatus =
  | "initializing"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "cancelled"

/**
 * 团队配置
 */
export interface TeamConfig {
  mode: TeamMode
  strategy?: LeaderWorkersStrategy // 仅 mode=leader-workers 时有效
  agents: TeamAgentConfig[]

  maxIterations: number
  timeoutMs: number

  budget?: {
    maxTokens: number
    maxCostUsd?: number
    maxParallelAgents?: number
  }

  qualityGate: {
    testsMustPass: boolean
    noP0Issues: boolean
    minCoverage?: number
    requiredChecks?: string[]
  }

  circuitBreaker: {
    maxConsecutiveFailures: number
    maxNoProgressRounds: number
    cooldownMs: number
  }

  conflictResolution: "auto" | "manual"
}

/**
 * 团队 Agent 配置
 */
export interface TeamAgentConfig {
  role: AgentRole
  model: string
  skills?: string[]
  systemPrompt?: string
  reuseInstance?: boolean  // 是否复用 Agent 实例
  sharedContext?: boolean  // 是否共享消息历史
}

/**
 * 团队 Agent 实例
 */
export interface TeamAgent {
  id: string
  role: AgentRole
  config: TeamAgentConfig
  status: "idle" | "working" | "waiting" | "completed" | "failed"
  createdAt: number
  startedAt?: number
  completedAt?: number
}

/**
 * 团队实例
 */
export interface Team {
  id: string
  mode: TeamMode
  config: TeamConfig
  agents: Map<string, TeamAgent>
  status: TeamStatus
  createdAt: number
  startedAt?: number
  completedAt?: number
  result?: TeamResult
}

/**
 * 团队执行结果
 */
export interface TeamResult {
  status: "success" | "failure"
  summary: string
  artifacts: WorkArtifact[]
  stats: {
    duration: number
    iterations: number
    totalCost: number
    totalTokens: number
  }
  metadata?: Record<string, unknown>  // 扩展字段，用于存储模式特定信息
}

/**
 * 状态转换触发器
 */
export type StateTransition = {
  from: TeamStatus
  to: TeamStatus
  trigger:
    | { type: "all-agents-ready" }
    | { type: "task-completed" }
    | { type: "error"; error: Error }
    | { type: "timeout" }
    | { type: "budget-exceeded" }
    | { type: "user-cancelled" }
}

/**
 * 成本记录
 */
export interface CostRecord {
  agentId: string
  agentRole: AgentRole
  taskId?: string
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  timestamp: number
}

/**
 * 成本汇总
 */
export interface CostSummary {
  total: number
  byAgent: Map<string, number>
  byRole: Map<AgentRole, number>
  byTask: Map<string, number>
}

/**
 * 超时配置
 */
export interface TimeoutConfig {
  total: number          // 整个Team的总超时
  perAgent: number       // 单个Agent的超时
  perIteration: number   // 单轮迭代的超时
  perToolCall?: number   // 单个工具调用的超时
}
