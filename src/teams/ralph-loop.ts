import * as fs from "fs"
import * as path from "path"
import { promisify } from "util"
import type { TeamManager } from "./team-manager.js"
import type { TaskContract } from "./types.js"

const readFileAsync = promisify(fs.readFile)
const writeFileAsync = promisify(fs.writeFile)

/**
 * Ralph Loop 事件类型
 */
export type RalphEvent =
  | { type: "start"; timestamp: number; config: RalphLoopConfig }
  | { type: "task_start"; timestamp: number; taskId: string; description: string }
  | { type: "task_complete"; timestamp: number; taskId: string; success: boolean; duration: number }
  | { type: "iteration"; timestamp: number; iteration: number; maxIterations: number }
  | { type: "heartbeat"; timestamp: number; stats: RalphLoopStats }
  | { type: "error"; timestamp: number; taskId: string; error: string }
  | { type: "complete"; timestamp: number; stats: RalphLoopStats }

/**
 * Ralph Loop 统计信息
 */
export interface RalphLoopStats {
  totalTasks: number
  completedTasks: number
  failedTasks: number
  startTime: number
  endTime?: number
  totalDuration: number
}

/**
 * 运行选项
 */
export interface RalphLoopRunOptions {
  /** Team Manager 实例 */
  teamManager?: TeamManager
  /** 任务合约 */
  taskContract?: Partial<TaskContract>
  /** 事件回调 */
  onEvent?: (event: RalphEvent) => void
  /** 任务开始回调 */
  onTaskStart?: (task: TaskItem) => void
  /** 任务完成回调 */
  onTaskComplete?: (task: TaskItem, success: boolean) => void
  /** 心跳回调 */
  onHeartbeat?: (stats: RalphLoopStats) => void
}

export interface RalphLoopConfig {
  enabled: boolean
  taskSource: "file" | "git-issues" | "stdin" | "api"
  taskFilePath: string  // e.g., TASKS.md
  progressFilePath: string  // e.g., PROGRESS.md
  maxIterations: number
  cooldownMs: number
  persistProgress: boolean
  /** 是否启用心跳 */
  heartbeatEnabled: boolean
  /** 心跳间隔（毫秒） */
  heartbeatIntervalMs: number
  /** 是否在完成后退出 */
  exitOnComplete: boolean
  /** 错误处理策略 */
  errorHandling: "continue" | "stop" | "retry"
  /** 最大重试次数 */
  maxRetries: number
}

export interface TaskItem {
  id: string
  description: string
  status: "pending" | "in-progress" | "completed" | "failed"
  assignedAgent?: string
  startedAt?: number
  completedAt?: number
}

export interface TaskQueue {
  pending: TaskItem[]
  inProgress: TaskItem[]
  completed: TaskItem[]
  failed: TaskItem[]
}

export class RalphLoop {
  private config: RalphLoopConfig
  private isRunning: boolean = false
  private currentIteration: number = 0
  private abortController?: AbortController
  private stats: RalphLoopStats
  private eventListeners: Array<(event: RalphEvent) => void> = []
  private heartbeatTimer?: NodeJS.Timeout

  constructor(config: Partial<RalphLoopConfig> = {}) {
    this.config = {
      enabled: false,
      taskSource: "file",
      taskFilePath: "TASKS.md",
      progressFilePath: "PROGRESS.md",
      maxIterations: 100,
      cooldownMs: 5000,
      persistProgress: true,
      heartbeatEnabled: true,
      heartbeatIntervalMs: 30000,
      exitOnComplete: true,
      errorHandling: "continue",
      maxRetries: 3,
      ...config,
    }
    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      startTime: 0,
      totalDuration: 0,
    }
  }

  /**
   * Parse TASKS.md format
   */
  async parseTaskFile(filePath?: string): Promise<TaskQueue> {
    const targetPath = filePath || this.config.taskFilePath

    try {
      const content = await readFileAsync(targetPath, "utf-8")
      return this.parseTasksContent(content)
    } catch (error) {
      // Return empty queue if file doesn't exist
      return {
        pending: [],
        inProgress: [],
        completed: [],
        failed: [],
      }
    }
  }

  /**
   * Parse tasks from markdown content
   */
  private parseTasksContent(content: string): TaskQueue {
    const queue: TaskQueue = {
      pending: [],
      inProgress: [],
      completed: [],
      failed: [],
    }

    const lines = content.split("\n")
    let currentSection: keyof TaskQueue | null = null

    for (const line of lines) {
      const trimmed = line.trim()

      // Detect sections
      if (trimmed.match(/^##?\s*Pending/i)) {
        currentSection = "pending"
        continue
      }
      if (trimmed.match(/^##?\s*In\s*Progress/i)) {
        currentSection = "inProgress"
        continue
      }
      if (trimmed.match(/^##?\s*Completed/i)) {
        currentSection = "completed"
        continue
      }
      if (trimmed.match(/^##?\s*Failed/i)) {
        currentSection = "failed"
        continue
      }

      // Parse task items
      if (currentSection && trimmed.match(/^[-*]\s*\[.\]/)) {
        const task = this.parseTaskLine(trimmed)
        if (task) {
          queue[currentSection].push(task)
        }
      }
    }

    return queue
  }

  /**
   * Parse a single task line
   */
  private parseTaskLine(line: string): TaskItem | null {
    // Match: - [ ] Task description
    // Match: - [~] Task description (agent-001)
    // Match: - [x] Task description
    const match = line.match(/^[-*]\s*\[(.)\]\s*(.+)$/)
    if (!match) return null

    const [, statusChar, description] = match

    let status: TaskItem["status"]
    let assignedAgent: string | undefined

    switch (statusChar) {
      case " ":
      case "-":
        status = "pending"
        break
      case "~":
      case "/":
        status = "in-progress"
        // Extract agent from description if present: "Task (agent-001)"
        const agentMatch = description.match(/\(([^)]+)\)$/)
        if (agentMatch) {
          assignedAgent = agentMatch[1]
        }
        break
      case "x":
      case "X":
        status = "completed"
        break
      case "!":
        status = "failed"
        break
      default:
        status = "pending"
    }

    return {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      description: description.replace(/\s*\([^)]+\)$/, "").trim(),
      status,
      assignedAgent,
    }
  }

  /**
   * Get next pending task
   */
  getNextTask(queue: TaskQueue): TaskItem | null {
    return queue.pending[0] || null
  }

  /**
   * Update task status and save to file
   */
  async updateTaskStatus(
    queue: TaskQueue,
    taskId: string,
    newStatus: TaskItem["status"],
    assignedAgent?: string
  ): Promise<void> {
    // Find task in all sections
    const allTasks = [
      ...queue.pending,
      ...queue.inProgress,
      ...queue.completed,
      ...queue.failed,
    ]

    const task = allTasks.find(t => t.id === taskId)
    if (!task) return

    // Update status
    task.status = newStatus
    if (assignedAgent) {
      task.assignedAgent = assignedAgent
    }

    if (newStatus === "completed" || newStatus === "failed") {
      task.completedAt = Date.now()
    }

    // Reorganize queue
    this.reorganizeQueue(queue)

    // Persist if enabled
    if (this.config.persistProgress) {
      await this.saveTaskFile(queue)
    }
  }

  /**
   * Reorganize tasks into correct sections based on status
   */
  private reorganizeQueue(queue: TaskQueue): void {
    const allTasks = [
      ...queue.pending,
      ...queue.inProgress,
      ...queue.completed,
      ...queue.failed,
    ]

    queue.pending = allTasks.filter(t => t.status === "pending")
    queue.inProgress = allTasks.filter(t => t.status === "in-progress")
    queue.completed = allTasks.filter(t => t.status === "completed")
    queue.failed = allTasks.filter(t => t.status === "failed")
  }

  /**
   * Save task queue to file
   */
  async saveTaskFile(queue: TaskQueue, filePath?: string): Promise<void> {
    const targetPath = filePath || this.config.taskFilePath
    const content = this.formatTaskQueue(queue)

    await writeFileAsync(targetPath, content, "utf-8")
  }

  /**
   * Format task queue as markdown
   */
  private formatTaskQueue(queue: TaskQueue): string {
    const lines: string[] = []

    lines.push("# Task Queue")
    lines.push("")

    lines.push("## Pending")
    for (const task of queue.pending) {
      lines.push(`- [ ] ${task.description}`)
    }
    lines.push("")

    lines.push("## In Progress")
    for (const task of queue.inProgress) {
      const agentInfo = task.assignedAgent ? ` (${task.assignedAgent})` : ""
      lines.push(`- [~] ${task.description}${agentInfo}`)
    }
    lines.push("")

    lines.push("## Completed")
    for (const task of queue.completed) {
      lines.push(`- [x] ${task.description}`)
    }
    lines.push("")

    lines.push("## Failed")
    for (const task of queue.failed) {
      lines.push(`- [!] ${task.description}`)
    }
    lines.push("")

    return lines.join("\n")
  }

  /**
   * Run the Ralph Loop
   */
  async run(options: RalphLoopRunOptions = {}): Promise<RalphLoopStats> {
    if (this.isRunning) {
      throw new Error("Ralph Loop is already running")
    }

    if (!this.config.enabled) {
      throw new Error("Ralph Loop is not enabled")
    }

    this.isRunning = true
    this.stats.startTime = Date.now()
    this.abortController = new AbortController()

    // Emit start event
    this.emitEvent({ type: "start", timestamp: Date.now(), config: this.config })

    // Start heartbeat
    if (this.config.heartbeatEnabled) {
      this.startHeartbeat(options.onHeartbeat)
    }

    try {
      const queue = await this.parseTaskFile()
      this.stats.totalTasks = queue.pending.length

      for (this.currentIteration = 1; this.currentIteration <= this.config.maxIterations; this.currentIteration++) {
        if (this.abortController?.signal.aborted) {
          break
        }

        // Emit iteration event
        this.emitEvent({
          type: "iteration",
          timestamp: Date.now(),
          iteration: this.currentIteration,
          maxIterations: this.config.maxIterations,
        })

        const task = this.getNextTask(queue)
        if (!task) {
          break // No more tasks
        }

        const taskStartTime = Date.now()

        // Emit task start event
        this.emitEvent({
          type: "task_start",
          timestamp: taskStartTime,
          taskId: task.id,
          description: task.description,
        })
        options.onTaskStart?.(task)

        // Update task status
        await this.updateTaskStatus(queue, task.id, "in-progress")

        // Execute task
        let success = false
        let retries = 0
        const maxRetries = this.config.errorHandling === "retry" ? this.config.maxRetries : 0

        while (retries <= maxRetries) {
          try {
            if (options.teamManager) {
              // Execute using TeamManager
              const taskContract: TaskContract = {
                taskId: task.id,
                objective: task.description,
                fileScope: options.taskContract?.fileScope || [],
                acceptanceChecks: options.taskContract?.acceptanceChecks || [],
                apiContracts: options.taskContract?.apiContracts,
              }
              const result = await options.teamManager.run(taskContract)
              success = result && typeof result === "object" && "success" in result
                ? (result as { success: boolean }).success
                : false
            } else {
              // Simple execution without TeamManager
              success = await this.executeSimpleTask(task)
            }

            if (success) break

            if (this.config.errorHandling === "stop") {
              throw new Error(`Task failed: ${task.description}`)
            }

            retries++
            if (retries <= maxRetries) {
              await this.sleep(this.config.cooldownMs)
            }
          } catch (error) {
            if (this.config.errorHandling === "stop") {
              throw error
            }
            retries++
            if (retries > maxRetries) {
              break
            }
            await this.sleep(this.config.cooldownMs)
          }
        }

        const duration = Date.now() - taskStartTime

        // Update task status
        await this.updateTaskStatus(queue, task.id, success ? "completed" : "failed")

        // Update stats
        if (success) {
          this.stats.completedTasks++
        } else {
          this.stats.failedTasks++
        }

        // Emit task complete event
        this.emitEvent({
          type: "task_complete",
          timestamp: Date.now(),
          taskId: task.id,
          success,
          duration,
        })
        options.onTaskComplete?.(task, success)

        // Cooldown between tasks
        if (this.config.cooldownMs > 0 && queue.pending.length > 0) {
          await this.sleep(this.config.cooldownMs)
        }
      }

      this.stats.endTime = Date.now()
      this.stats.totalDuration = this.stats.endTime - this.stats.startTime

      // Emit complete event
      this.emitEvent({
        type: "complete",
        timestamp: Date.now(),
        stats: { ...this.stats },
      })

      return { ...this.stats }
    } catch (error) {
      // Emit error event
      this.emitEvent({
        type: "error",
        timestamp: Date.now(),
        taskId: "loop",
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    } finally {
      this.stop()
      this.stopHeartbeat()
    }
  }

  /**
   * Execute a simple task without TeamManager
   */
  private async executeSimpleTask(task: TaskItem): Promise<boolean> {
    // Simple task execution - can be overridden or extended
    // For now, just simulate success
    await this.sleep(100)
    return true
  }

  /**
   * Add event listener
   */
  onEvent(listener: (event: RalphEvent) => void): () => void {
    this.eventListeners.push(listener)
    return () => {
      const index = this.eventListeners.indexOf(listener)
      if (index > -1) {
        this.eventListeners.splice(index, 1)
      }
    }
  }

  /**
   * Emit event to all listeners
   */
  private emitEvent(event: RalphEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event)
      } catch (error) {
        // Ignore listener errors
      }
    }
  }

  /**
   * Start heartbeat timer
   */
  private startHeartbeat(onHeartbeat?: (stats: RalphLoopStats) => void): void {
    this.heartbeatTimer = setInterval(() => {
      const stats = { ...this.stats }
      this.emitEvent({
        type: "heartbeat",
        timestamp: Date.now(),
        stats,
      })
      onHeartbeat?.(stats)
    }, this.config.heartbeatIntervalMs)
  }

  /**
   * Stop heartbeat timer
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
  }

  /**
   * Get current stats
   */
  getStats(): RalphLoopStats {
    return { ...this.stats }
  }

  /**
   * Sleep for ms
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Stop the loop
   */
  stop(): void {
    this.isRunning = false
    this.abortController?.abort()
  }

  /**
   * Check if loop is running
   */
  isActive(): boolean {
    return this.isRunning
  }
}

export function createRalphLoop(config?: Partial<RalphLoopConfig>): RalphLoop {
  return new RalphLoop(config)
}
