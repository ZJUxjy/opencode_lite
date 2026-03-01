/**
 * SharedBlackboard - 共享状态黑板
 *
 * 职责：
 * - 共享状态管理
 * - 事件通知（事件驱动，避免轮询）
 * - 只存结构化摘要，不存大体积原文
 */

import { EventEmitter } from "events"
import type { WorkArtifact, ReviewArtifact, TaskContract } from "./contracts.js"
import type { AgentRole } from "./types.js"

/**
 * 黑板事件类型
 */
export type BlackboardEvent =
  | "task-assigned"
  | "task-started"
  | "task-completed"
  | "work-submitted"
  | "review-requested"
  | "review-completed"
  | "conflict-detected"
  | "agent-status-changed"

/**
 * 黑板条目
 */
export interface BlackboardEntry {
  id: string
  type: "task" | "work" | "review" | "status" | "conflict"
  data: unknown
  createdBy: string
  createdAt: number
  expiresAt?: number
}

/**
 * Agent 状态
 */
export interface AgentStatus {
  agentId: string
  role: AgentRole
  status: "idle" | "working" | "waiting" | "completed" | "failed"
  currentTask?: string
  lastUpdate: number
}

/**
 * SharedBlackboard 类
 */
export class SharedBlackboard extends EventEmitter {
  private entries = new Map<string, BlackboardEntry>()
  private agentStatuses = new Map<string, AgentStatus>()
  private taskContracts = new Map<string, TaskContract>()
  private workArtifacts = new Map<string, WorkArtifact>()
  private reviewArtifacts = new Map<string, ReviewArtifact>()

  constructor() {
    super()
    this.setMaxListeners(50) // 支持多个Agent监听
  }

  /**
   * 发布任务契约
   */
  publishTask(contract: TaskContract, assignedTo: string): void {
    this.taskContracts.set(contract.taskId, contract)

    const entry: BlackboardEntry = {
      id: `task-${contract.taskId}`,
      type: "task",
      data: { contract, assignedTo },
      createdBy: "system",
      createdAt: Date.now(),
    }

    this.entries.set(entry.id, entry)
    this.emit("task-assigned", { contract, assignedTo })
  }

  /**
   * 提交工作产物
   */
  submitWork(artifact: WorkArtifact): void {
    this.workArtifacts.set(artifact.taskId, artifact)

    const entry: BlackboardEntry = {
      id: `work-${artifact.taskId}`,
      type: "work",
      data: artifact,
      createdBy: artifact.agentId,
      createdAt: Date.now(),
    }

    this.entries.set(entry.id, entry)
    this.emit("work-submitted", artifact)
  }

  /**
   * 提交审查结果
   */
  submitReview(review: ReviewArtifact): void {
    this.reviewArtifacts.set(review.workArtifactId, review)

    const entry: BlackboardEntry = {
      id: `review-${review.workArtifactId}`,
      type: "review",
      data: review,
      createdBy: review.reviewerId,
      createdAt: Date.now(),
    }

    this.entries.set(entry.id, entry)
    this.emit("review-completed", review)
  }

  /**
   * 更新 Agent 状态
   */
  updateAgentStatus(status: AgentStatus): void {
    this.agentStatuses.set(status.agentId, status)

    const entry: BlackboardEntry = {
      id: `status-${status.agentId}`,
      type: "status",
      data: status,
      createdBy: status.agentId,
      createdAt: Date.now(),
    }

    this.entries.set(entry.id, entry)
    this.emit("agent-status-changed", status)
  }

  /**
   * 报告冲突
   */
  reportConflict(files: string[], involvedAgents: string[]): void {
    const conflictId = `conflict-${Date.now()}`
    const entry: BlackboardEntry = {
      id: conflictId,
      type: "conflict",
      data: { files, involvedAgents },
      createdBy: "system",
      createdAt: Date.now(),
    }

    this.entries.set(entry.id, entry)
    this.emit("conflict-detected", { files, involvedAgents })
  }

  /**
   * 获取任务契约
   */
  getTask(taskId: string): TaskContract | undefined {
    return this.taskContracts.get(taskId)
  }

  /**
   * 获取工作产物
   */
  getWork(taskId: string): WorkArtifact | undefined {
    return this.workArtifacts.get(taskId)
  }

  /**
   * 获取审查结果
   */
  getReview(workArtifactId: string): ReviewArtifact | undefined {
    return this.reviewArtifacts.get(workArtifactId)
  }

  /**
   * 获取 Agent 状态
   */
  getAgentStatus(agentId: string): AgentStatus | undefined {
    return this.agentStatuses.get(agentId)
  }

  /**
   * 获取所有 Agent 状态
   */
  getAllAgentStatuses(): AgentStatus[] {
    return Array.from(this.agentStatuses.values())
  }

  /**
   * 清理过期条目
   */
  cleanup(): void {
    const now = Date.now()
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.entries.delete(id)
      }
    }
  }

  /**
   * 清空黑板
   */
  clear(): void {
    this.entries.clear()
    this.agentStatuses.clear()
    this.taskContracts.clear()
    this.workArtifacts.clear()
    this.reviewArtifacts.clear()
    this.removeAllListeners()
  }
}
