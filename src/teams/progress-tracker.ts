/**
 * ProgressTracker - 进度追踪器
 *
 * 职责：
 * - 追踪任务和迭代进度
 * - 检测无进展情况
 * - 提供进度可视化数据
 */

import type { TaskContract, WorkArtifact } from "./contracts.js"
import type { AgentStatus } from "./blackboard.js"

/**
 * 任务进度
 */
export interface TaskProgress {
  taskId: string
  status: "pending" | "in-progress" | "completed" | "failed"
  assignedTo?: string
  startedAt?: number
  completedAt?: number
  attempts: number
}

/**
 * 迭代记录
 */
export interface IterationRecord {
  iteration: number
  startedAt: number
  completedAt?: number
  tasksCompleted: number
  hasProgress: boolean  // 是否有有效进展
  changes: string[]     // 变更的文件
}

/**
 * 进度快照
 */
export interface ProgressSnapshot {
  totalTasks: number
  completedTasks: number
  failedTasks: number
  currentIteration: number
  maxIterations: number
  progressPercentage: number
  estimatedTimeRemaining?: number
}

/**
 * 进度追踪器
 */
export class ProgressTracker {
  private tasks = new Map<string, TaskProgress>()
  private iterations: IterationRecord[] = []
  private currentIteration = 0
  private maxIterations: number
  private startTime: number
  private changedFiles = new Set<string>()

  constructor(maxIterations: number) {
    this.maxIterations = maxIterations
    this.startTime = Date.now()
  }

  /**
   * 注册任务
   */
  registerTask(contract: TaskContract, assignedTo: string): void {
    this.tasks.set(contract.taskId, {
      taskId: contract.taskId,
      status: "pending",
      assignedTo,
      attempts: 0,
    })
  }

  /**
   * 开始任务
   */
  startTask(taskId: string): void {
    const task = this.tasks.get(taskId)
    if (task) {
      task.status = "in-progress"
      task.startedAt = Date.now()
      task.attempts++
    }
  }

  /**
   * 完成任务
   */
  completeTask(taskId: string, artifact: WorkArtifact): void {
    const task = this.tasks.get(taskId)
    if (task) {
      task.status = "completed"
      task.completedAt = Date.now()

      // 记录变更的文件
      artifact.changedFiles.forEach(file => this.changedFiles.add(file))
    }
  }

  /**
   * 任务失败
   */
  failTask(taskId: string): void {
    const task = this.tasks.get(taskId)
    if (task) {
      task.status = "failed"
      task.completedAt = Date.now()
    }
  }

  /**
   * 开始新迭代
   */
  startIteration(): void {
    this.currentIteration++

    const record: IterationRecord = {
      iteration: this.currentIteration,
      startedAt: Date.now(),
      tasksCompleted: 0,
      hasProgress: false,
      changes: [],
    }

    this.iterations.push(record)
  }

  /**
   * 完成当前迭代
   */
  completeIteration(): void {
    const current = this.iterations[this.iterations.length - 1]
    if (current) {
      current.completedAt = Date.now()

      // 统计完成的任务数
      current.tasksCompleted = Array.from(this.tasks.values()).filter(
        t => t.status === "completed"
      ).length

      // 检查是否有进展
      current.hasProgress = current.changes.length > 0 || current.tasksCompleted > 0
    }
  }

  /**
   * 记录文件变更
   */
  recordChange(files: string[]): void {
    const current = this.iterations[this.iterations.length - 1]
    if (current) {
      current.changes.push(...files)
    }
    files.forEach(file => this.changedFiles.add(file))
  }

  /**
   * 检测无进展
   */
  detectNoProgress(maxNoProgressRounds: number): boolean {
    if (this.iterations.length < maxNoProgressRounds) {
      return false
    }

    // 检查最近N轮是否都没有进展
    const recentIterations = this.iterations.slice(-maxNoProgressRounds)
    return recentIterations.every(iter => !iter.hasProgress)
  }

  /**
   * 获取进度快照
   */
  getSnapshot(): ProgressSnapshot {
    const totalTasks = this.tasks.size
    const completedTasks = Array.from(this.tasks.values()).filter(
      t => t.status === "completed"
    ).length
    const failedTasks = Array.from(this.tasks.values()).filter(
      t => t.status === "failed"
    ).length

    const progressPercentage = totalTasks > 0
      ? (completedTasks / totalTasks) * 100
      : 0

    // 估算剩余时间
    let estimatedTimeRemaining: number | undefined
    if (completedTasks > 0) {
      const elapsed = Date.now() - this.startTime
      const avgTimePerTask = elapsed / completedTasks
      const remainingTasks = totalTasks - completedTasks
      estimatedTimeRemaining = avgTimePerTask * remainingTasks
    }

    return {
      totalTasks,
      completedTasks,
      failedTasks,
      currentIteration: this.currentIteration,
      maxIterations: this.maxIterations,
      progressPercentage,
      estimatedTimeRemaining,
    }
  }

  /**
   * 获取所有任务状态
   */
  getAllTasks(): TaskProgress[] {
    return Array.from(this.tasks.values())
  }

  /**
   * 获取迭代历史
   */
  getIterations(): IterationRecord[] {
    return [...this.iterations]
  }

  /**
   * 获取变更的文件列表
   */
  getChangedFiles(): string[] {
    return Array.from(this.changedFiles)
  }

  /**
   * 是否达到最大迭代次数
   */
  isMaxIterationsReached(): boolean {
    return this.currentIteration >= this.maxIterations
  }

  /**
   * 清空追踪数据
   */
  clear(): void {
    this.tasks.clear()
    this.iterations = []
    this.currentIteration = 0
    this.changedFiles.clear()
  }
}
