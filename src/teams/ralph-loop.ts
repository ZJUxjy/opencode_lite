import * as fs from "fs"
import * as path from "path"
import { promisify } from "util"

const readFileAsync = promisify(fs.readFile)
const writeFileAsync = promisify(fs.writeFile)

export interface RalphLoopConfig {
  enabled: boolean
  taskSource: "file" | "git-issues" | "stdin" | "api"
  taskFilePath: string  // e.g., TASKS.md
  progressFilePath: string  // e.g., PROGRESS.md
  maxIterations: number
  cooldownMs: number
  persistProgress: boolean
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

  constructor(config: Partial<RalphLoopConfig> = {}) {
    this.config = {
      enabled: false,
      taskSource: "file",
      taskFilePath: "TASKS.md",
      progressFilePath: "PROGRESS.md",
      maxIterations: 100,
      cooldownMs: 5000,
      persistProgress: true,
      ...config,
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
