/**
 * 子代理类型定义
 *
 * 支持在 Plan Mode 下创建和管理子代理
 */

import type { z } from "zod"
import type { Message } from "../types.js"

/**
 * 子代理类型
 */
export type SubagentType = "explore" | "plan" | "review"

/**
 * 子代理状态
 */
export type SubagentStatus =
  | "pending"    // 等待执行
  | "running"    // 执行中
  | "completed"  // 已完成
  | "failed"     // 执行失败
  | "cancelled"  // 已取消

/**
 * 子代理配置
 */
export interface SubagentConfig {
  /** 子代理类型 */
  type: SubagentType
  /** 详细任务描述 */
  prompt: string
  /** 父上下文（用于继承环境） */
  parentContext?: {
    cwd: string
    messages: Message[]
  }
  /** 超时时间（毫秒） */
  timeout?: number
  /** 父代理 ID（支持嵌套） */
  parentId?: string
}

/**
 * 子代理实例
 */
export interface Subagent {
  /** 唯一标识 */
  id: string
  /** 子代理类型 */
  type: SubagentType
  /** 当前状态 */
  status: SubagentStatus
  /** 任务描述 */
  prompt: string
  /** 创建时间 */
  createdAt: number
  /** 开始时间 */
  startedAt?: number
  /** 完成时间 */
  completedAt?: number
  /** 执行结果 */
  result?: string
  /** 错误信息 */
  error?: string
  /** 父代理 ID */
  parentId?: string
  /** 子代理 IDs（支持嵌套） */
  childrenIds: string[]
  /** 工作目录 */
  cwd: string
  /** 消息历史（用于上下文） */
  messages: Message[]
}

/**
 * 子代理执行结果
 */
export interface SubagentResult {
  /** 子代理 ID */
  id: string
  /** 执行状态 */
  status: SubagentStatus
  /** 执行结果 */
  result?: string
  /** 错误信息 */
  error?: string
  /** 执行耗时（毫秒） */
  duration?: number
}

/**
 * 子代理管理器配置
 */
export interface SubagentManagerConfig {
  /** 最大并行子代理数 */
  maxConcurrent?: number
  /** 默认超时时间（毫秒） */
  defaultTimeout?: number
  /** 是否允许嵌套 */
  allowNesting?: boolean
  /** 最大嵌套深度 */
  maxNestingDepth?: number
}

/**
 * 并行探索配置
 */
export interface ParallelExploreConfig {
  /** 最大并行探索代理数 */
  maxAgents: number
  /** 每个代理超时时间（毫秒） */
  timeout: number
  /** 结果聚合策略 */
  aggregationStrategy: "merge" | "concat" | "summary"
}

/**
 * 探索任务定义
 */
export interface ExploreTask {
  /** 探索焦点 */
  focus: string
  /** 关注范围（文件/目录） */
  scope: string[]
  /** 需要回答的问题 */
  questions: string[]
}

/**
 * 聚合结果
 */
export interface AggregatedResult {
  /** 所有子代理的结果 */
  results: SubagentResult[]
  /** 聚合后的内容 */
  content: string
  /** 执行统计 */
  stats: {
    total: number
    completed: number
    failed: number
    duration: number
  }
}

/**
 * 子代理终止原因
 */
export enum SubagentTerminateReason {
  GOAL = "goal",                           // 正常完成 (调用了 complete_task)
  MAX_TURNS = "max_turns",                 // 超过 turn 限制
  TIMEOUT = "timeout",                     // 超过时间限制
  ERROR = "error",                         // 执行错误
  ABORTED = "aborted",                     // 被用户取消
  NO_COMPLETE_CALL = "no_complete",        // 停止而未调用 complete_task
  VALIDATION_FAILED = "validation_failed", // 输出验证失败
}

/**
 * 输出验证结果
 */
export interface OutputValidationResult {
  success: boolean
  error?: string
  data?: unknown
}

/**
 * complete_task 工具参数
 */
export interface CompleteTaskParams {
  result: string
  filesChanged?: string[]
  success?: boolean
}

/**
 * 子代理事件
 */
export interface SubagentEvents {
  /** 子代理创建 */
  onCreate?: (subagent: Subagent) => void
  /** 子代理开始执行 */
  onStart?: (subagent: Subagent) => void
  /** 子代理完成 */
  onComplete?: (result: SubagentResult) => void
  /** 子代理失败 */
  onError?: (id: string, error: string) => void
}
