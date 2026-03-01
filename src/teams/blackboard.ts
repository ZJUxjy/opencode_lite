import { EventEmitter } from "events"
import type { AgentMessage, TeamStatus, AgentInstance } from "./types.js"
import type { TaskContract, WorkArtifact, ReviewArtifact, PlanningArtifact } from "./contracts.js"

// ============================================================================
// SharedBlackboard - 共享状态与消息总线
// ============================================================================

/**
 * SharedBlackboard - 团队协作的共享状态中心
 *
 * 职责：
 * - 存储任务、产物、评审结果
 * - 事件通知
 * - 只存结构化摘要，不存大体积原文
 */
export class SharedBlackboard extends EventEmitter {
  private tasks: Map<string, TaskContract> = new Map()
  private workArtifacts: Map<string, WorkArtifact> = new Map()
  private reviewArtifacts: Map<string, ReviewArtifact> = new Map()
  private planningArtifacts: Map<string, PlanningArtifact> = new Map()

  private teamStatus: TeamStatus = "initializing"
  private currentRound = 0

  // 消息历史
  private messageHistory: Array<{
    timestamp: number
    sender: string
    message: AgentMessage
  }> = []

  constructor() {
    super()
  }

  // ========================================================================
  // 状态管理
  // ========================================================================

  /**
   * 设置团队状态
   */
  setTeamStatus(status: TeamStatus): void {
    this.teamStatus = status
    this.emit("status-changed", status)
  }

  /**
   * 获取团队状态
   */
  getTeamStatus(): TeamStatus {
    return this.teamStatus
  }

  /**
   * 增加轮次
   */
  incrementRound(): number {
    this.currentRound++
    return this.currentRound
  }

  /**
   * 获取当前轮次
   */
  getCurrentRound(): number {
    return this.currentRound
  }

  // ========================================================================
  // 任务管理
  // ========================================================================

  /**
   * 添加任务契约
   */
  addTask(task: TaskContract): void {
    this.tasks.set(task.taskId, task)
    this.emit("task-added", task)
  }

  /**
   * 获取任务契约
   */
  getTask(taskId: string): TaskContract | undefined {
    return this.tasks.get(taskId)
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): TaskContract[] {
    return Array.from(this.tasks.values())
  }

  /**
   * 删除任务
   */
  removeTask(taskId: string): void {
    this.tasks.delete(taskId)
    this.emit("task-removed", taskId)
  }

  // ========================================================================
  // 工作产物管理
  // ========================================================================

  /**
   * 添加工作产物
   */
  addWorkArtifact(artifact: WorkArtifact): void {
    this.workArtifacts.set(artifact.taskId, artifact)
    this.emit("artifact-added", artifact)
  }

  /**
   * 获取工作产物
   */
  getWorkArtifact(taskId: string): WorkArtifact | undefined {
    return this.workArtifacts.get(taskId)
  }

  /**
   * 获取所有工作产物
   */
  getAllWorkArtifacts(): WorkArtifact[] {
    return Array.from(this.workArtifacts.values())
  }

  // ========================================================================
  // 评审结果管理
  // ========================================================================

  /**
   * 添加评审结果
   */
  addReviewArtifact(artifact: ReviewArtifact): void {
    // 使用 taskId 作为 key
    const key = artifact.mustFix[0] || `review-${Date.now()}`
    this.reviewArtifacts.set(key, artifact)
    this.emit("review-added", artifact)
  }

  /**
   * 获取最新评审结果
   */
  getLatestReview(): ReviewArtifact | undefined {
    const reviews = Array.from(this.reviewArtifacts.values())
    return reviews[reviews.length - 1]
  }

  // ========================================================================
  // 规划产物管理
  // ========================================================================

  /**
   * 添加规划产物
   */
  addPlanningArtifact(artifact: PlanningArtifact): void {
    this.planningArtifacts.set(artifact.taskId, artifact)
    this.emit("planning-added", artifact)
  }

  /**
   * 获取规划产物
   */
  getPlanningArtifact(taskId: string): PlanningArtifact | undefined {
    return this.planningArtifacts.get(taskId)
  }

  // ========================================================================
  // 消息总线
  // ========================================================================

  /**
   * 发送消息
   */
  sendMessage(sender: string, message: AgentMessage): void {
    this.messageHistory.push({
      timestamp: Date.now(),
      sender,
      message,
    })

    // 触发相应事件
    switch (message.type) {
      case "task-assign":
        this.emit("task-assign", message)
        break
      case "task-result":
        this.emit("task-result", message)
        break
      case "review-request":
        this.emit("review-request", message)
        break
      case "review-result":
        this.emit("review-result", message)
        break
      case "conflict-detected":
        this.emit("conflict-detected", message)
        break
      case "progress-update":
        this.emit("progress-update", message)
        break
      case "error":
        this.emit("error", message)
        break
    }
  }

  /**
   * 获取消息历史
   */
  getMessageHistory(limit?: number): Array<{
    timestamp: number
    sender: string
    message: AgentMessage
  }> {
    if (limit) {
      return this.messageHistory.slice(-limit)
    }
    return [...this.messageHistory]
  }

  // ========================================================================
  // 快照
  // ========================================================================

  /**
   * 获取黑板快照（用于检查点）
   */
  getSnapshot(): BlackboardSnapshot {
    return {
      timestamp: Date.now(),
      teamStatus: this.teamStatus,
      currentRound: this.currentRound,
      taskCount: this.tasks.size,
      artifactCount: this.workArtifacts.size,
      reviewCount: this.reviewArtifacts.size,
      messageCount: this.messageHistory.length,
    }
  }

  /**
   * 清理资源
   */
  clear(): void {
    this.tasks.clear()
    this.workArtifacts.clear()
    this.reviewArtifacts.clear()
    this.planningArtifacts.clear()
    this.messageHistory = []
    this.currentRound = 0
    this.teamStatus = "initializing"
  }
}

// ============================================================================
// 快照类型
// ============================================================================

export interface BlackboardSnapshot {
  timestamp: number
  teamStatus: TeamStatus
  currentRound: number
  taskCount: number
  artifactCount: number
  reviewCount: number
  messageCount: number
}
