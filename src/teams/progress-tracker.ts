import { EventEmitter } from "events"
import type { CircuitBreakerConfig, TeamStatus } from "./types.js"

// ============================================================================
// ProgressTracker - 进度追踪
// ============================================================================

/**
 * 进度追踪器
 *
 * 职责：
 * - 追踪任务进度
 * - 检测无进展轮次
 * - 计算迭代进度
 * - 触发熔断
 */
export class ProgressTracker extends EventEmitter {
  private config: CircuitBreakerConfig

  // 进度状态
  private totalTasks = 0
  private completedTasks = 0
  private failedTasks = 0

  // 轮次追踪
  private currentRound = 0
  private consecutiveNoProgressRounds = 0
  private consecutiveFailures = 0

  // 无进展检测
  private lastChangedFilesCount = 0
  private lastMustFixCount = 0
  private lastPassedChecks: string[] = []

  // 迭代状态
  private currentIteration = 0
  private maxIterations = 3

  // 任务详情
  private tasks: Map<string, TaskProgress> = new Map()

  constructor(config: CircuitBreakerConfig, maxIterations = 3) {
    super()
    this.config = config
    this.maxIterations = maxIterations
  }

  // ========================================================================
  // 任务管理
  // ========================================================================

  /**
   * 添加任务
   */
  addTask(taskId: string, objective: string): void {
    this.tasks.set(taskId, {
      taskId,
      objective,
      status: "pending",
      progress: 0,
      round: 0,
      attempts: 0,
    })
    this.totalTasks++
    this.emit("task-added", { taskId, objective })
  }

  /**
   * 更新任务状态
   */
  updateTaskStatus(taskId: string, status: TaskStatus, progress?: number): void {
    const task = this.tasks.get(taskId)
    if (!task) return

    const oldStatus = task.status
    task.status = status
    if (progress !== undefined) {
      task.progress = progress
    }

    if (status === "completed") {
      this.completedTasks++
      this.emit("task-completed", { taskId })
    } else if (status === "failed") {
      this.failedTasks++
      this.emit("task-failed", { taskId })
    }

    if (oldStatus !== status) {
      this.emit("status-changed", { taskId, oldStatus, newStatus: status })
    }
  }

  /**
   * 获取任务进度
   */
  getTaskProgress(taskId: string): TaskProgress | undefined {
    return this.tasks.get(taskId)
  }

  // ========================================================================
  // 轮次管理
  // ========================================================================

  /**
   * 开始新轮次
   */
  startRound(): number {
    this.currentRound++
    this.currentIteration = Math.ceil(this.currentRound / 2)
    this.emit("round-start", { round: this.currentRound, iteration: this.currentIteration })
    return this.currentRound
  }

  /**
   * 获取当前轮次
   */
  getCurrentRound(): number {
    return this.currentRound
  }

  /**
   * 获取当前迭代
   */
  getCurrentIteration(): number {
    return this.currentIteration
  }

  // ========================================================================
  // 无进展检测
  // ========================================================================

  /**
   * 检查无进展
   *
   * 判定条件（满足任一即触发）：
   * 1. 连续 2 轮 changedFiles = 0
   * 2. 连续 2 轮 mustFix 问题数未下降
   * 3. 连续 2 轮关键检查命令无新增通过项
   */
  checkNoProgress(params: {
    changedFilesCount: number
    mustFixCount: number
    passedChecks: string[]
  }): boolean {
    const { changedFilesCount, mustFixCount, passedChecks } = params

    let isNoProgress = false

    // 检查 changedFiles
    if (changedFilesCount === 0 && this.lastChangedFilesCount === 0) {
      this.consecutiveNoProgressRounds++
      isNoProgress = true
    } else {
      this.consecutiveNoProgressRounds = 0
    }

    // 检查 mustFix
    if (mustFixCount > 0 && mustFixCount >= this.lastMustFixCount) {
      // 连续未下降
      this.consecutiveNoProgressRounds++
      isNoProgress = true
    }

    // 检查新通过的检查项
    const newPassedChecks = passedChecks.filter(
      (check) => !this.lastPassedChecks.includes(check)
    )
    if (newPassedChecks.length === 0 && this.lastPassedChecks.length > 0) {
      this.consecutiveNoProgressRounds++
      isNoProgress = true
    }

    // 更新上一次状态
    this.lastChangedFilesCount = changedFilesCount
    this.lastMustFixCount = mustFixCount
    this.lastPassedChecks = [...passedChecks]

    // 触发无进展事件
    if (this.consecutiveNoProgressRounds >= this.config.maxNoProgressRounds) {
      this.emit("no-progress", {
        round: this.currentRound,
        consecutiveRounds: this.consecutiveNoProgressRounds,
        changedFilesCount,
        mustFixCount,
      })
      return true
    }

    return false
  }

  /**
   * 获取无进展轮次数
   */
  getConsecutiveNoProgressRounds(): number {
    return this.consecutiveNoProgressRounds
  }

  // ========================================================================
  // 失败追踪
  // ========================================================================

  /**
   * 记录失败
   */
  recordFailure(): void {
    this.consecutiveFailures++
    this.emit("failure-recorded", { count: this.consecutiveFailures })

    if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      this.emit("circuit-open", {
        reason: "max-consecutive-failures",
        failures: this.consecutiveFailures,
      })
    }
  }

  /**
   * 重置失败计数
   */
  resetFailures(): void {
    this.consecutiveFailures = 0
  }

  /**
   * 获取连续失败数
   */
  getConsecutiveFailures(): number {
    return this.consecutiveFailures
  }

  // ========================================================================
  // 进度查询
  // ========================================================================

  /**
   * 获取整体进度
   */
  getProgress(): {
    totalTasks: number
    completedTasks: number
    failedTasks: number
    pendingTasks: number
    progressPercent: number
    currentRound: number
    currentIteration: number
    maxIterations: number
  } {
    const pendingTasks = this.totalTasks - this.completedTasks - this.failedTasks
    const progressPercent = this.totalTasks > 0
      ? (this.completedTasks / this.totalTasks) * 100
      : 0

    return {
      totalTasks: this.totalTasks,
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
      pendingTasks,
      progressPercent,
      currentRound: this.currentRound,
      currentIteration: this.currentIteration,
      maxIterations: this.maxIterations,
    }
  }

  /**
   * 是否应该继续
   */
  shouldContinue(status: TeamStatus): boolean {
    if (status !== "running") return false
    if (this.currentIteration >= this.maxIterations) return false
    if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) return false
    if (this.consecutiveNoProgressRounds >= this.config.maxNoProgressRounds) return false

    return true
  }

  /**
   * 获取统计摘要
   */
  getStats(): ProgressStats {
    return {
      totalTasks: this.totalTasks,
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
      currentRound: this.currentRound,
      currentIteration: this.currentIteration,
      consecutiveNoProgressRounds: this.consecutiveNoProgressRounds,
      consecutiveFailures: this.consecutiveFailures,
      tasks: Array.from(this.tasks.values()),
    }
  }

  // ========================================================================
  // 重置
  // ========================================================================

  /**
   * 重置进度
   */
  reset(): void {
    this.totalTasks = 0
    this.completedTasks = 0
    this.failedTasks = 0
    this.currentRound = 0
    this.currentIteration = 0
    this.consecutiveNoProgressRounds = 0
    this.consecutiveFailures = 0
    this.lastChangedFilesCount = 0
    this.lastMustFixCount = 0
    this.lastPassedChecks = []
    this.tasks.clear()
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<CircuitBreakerConfig>): void {
    this.config = { ...this.config, ...config }
  }
}

// ============================================================================
// 类型定义
// ============================================================================

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed"

export interface TaskProgress {
  taskId: string
  objective: string
  status: TaskStatus
  progress: number // 0-100
  round: number
  attempts: number
  error?: string
}

export interface ProgressStats {
  totalTasks: number
  completedTasks: number
  failedTasks: number
  currentRound: number
  currentIteration: number
  consecutiveNoProgressRounds: number
  consecutiveFailures: number
  tasks: TaskProgress[]
}
