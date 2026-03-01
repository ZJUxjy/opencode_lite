/**
 * Progress File - PROGRESS.md 持久化
 *
 * 基于 agent-teams-supplement.md 原则 8: Ralph Loop
 *
 * 提供任务进度追踪和持久化，支持断点续传和进度可视化。
 */

import * as fs from "fs"
import * as path from "path"

/**
 * 任务状态
 */
export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked" | "failed"

/**
 * 任务优先级
 */
export type TaskPriority = "low" | "medium" | "high" | "critical"

/**
 * 进度任务
 */
export interface ProgressTask {
  /** 任务 ID */
  id: string
  /** 任务描述 */
  description: string
  /** 状态 */
  status: TaskStatus
  /** 优先级 */
  priority: TaskPriority
  /** 分配给 */
  assignee?: string
  /** 开始时间 */
  startedAt?: number
  /** 完成时间 */
  completedAt?: number
  /** 备注 */
  notes?: string
  /** 依赖任务 ID */
  dependencies?: string[]
  /** 标签 */
  tags?: string[]
}

/**
 * 进度文件内容
 */
export interface ProgressFile {
  /** 版本 */
  version: string
  /** 最后更新时间 */
  lastUpdated: number
  /** 项目名称 */
  projectName?: string
  /** 当前会话 ID */
  currentSessionId?: string
  /** 活跃的 Agent */
  activeAgent?: string
  /** 任务列表 */
  tasks: ProgressTask[]
  /** 统计信息 */
  stats: {
    total: number
    completed: number
    inProgress: number
    blocked: number
    failed: number
  }
  /** 备注 */
  notes?: string[]
}

/**
 * 进度文件管理器
 */
export class ProgressFileManager {
  private filePath: string
  private progress: ProgressFile

  constructor(cwd: string = process.cwd(), filename: string = "PROGRESS.md") {
    this.filePath = path.resolve(cwd, filename)
    this.progress = this.loadOrCreate()
  }

  /**
   * 加载或创建进度文件
   */
  private loadOrCreate(): ProgressFile {
    if (fs.existsSync(this.filePath)) {
      const content = fs.readFileSync(this.filePath, "utf-8")
      return this.parseMarkdown(content)
    }

    return {
      version: "1.0.0",
      lastUpdated: Date.now(),
      tasks: [],
      stats: {
        total: 0,
        completed: 0,
        inProgress: 0,
        blocked: 0,
        failed: 0,
      },
    }
  }

  /**
   * 解析 PROGRESS.md 文件
   */
  private parseMarkdown(content: string): ProgressFile {
    const progress: ProgressFile = {
      version: "1.0.0",
      lastUpdated: Date.now(),
      tasks: [],
      stats: {
        total: 0,
        completed: 0,
        inProgress: 0,
        blocked: 0,
        failed: 0,
      },
    }

    const lines = content.split("\n")
    let currentSection = ""
    let currentTask: Partial<ProgressTask> | null = null

    for (const line of lines) {
      // 解析项目名称
      if (line.startsWith("# ")) {
        progress.projectName = line.substring(2).trim()
        continue
      }

      // 解析章节
      if (line.startsWith("## ")) {
        currentSection = line.substring(3).trim().toLowerCase()
        continue
      }

      // 解析元数据
      if (line.startsWith("- **Session**:")) {
        progress.currentSessionId = line.split(":")[1]?.trim()
        continue
      }
      if (line.startsWith("- **Active Agent**:")) {
        progress.activeAgent = line.split(":")[1]?.trim()
        continue
      }
      if (line.startsWith("- **Last Updated**:")) {
        const dateStr = line.split(":")[1]?.trim()
        if (dateStr) {
          progress.lastUpdated = new Date(dateStr).getTime() || Date.now()
        }
        continue
      }

      // 解析任务
      const taskMatch = line.match(/^- \[([ x~!])\] (.+)$/)
      if (taskMatch) {
        // 保存之前的任务
        if (currentTask && currentTask.id && currentTask.description) {
          progress.tasks.push(currentTask as ProgressTask)
        }

        const statusChar = taskMatch[1]
        let description = taskMatch[2]

        let status: TaskStatus
        switch (statusChar) {
          case "x":
            status = "completed"
            break
          case "~":
            status = "in_progress"
            break
          case "!":
            status = "blocked"
            break
          case "-":
            status = "failed"
            break
          default:
            status = "pending"
        }

        // 解析任务 ID (如果存在)
        const idMatch = description.match(/^\[([^\]]+)\]\s*/)
        if (idMatch) {
          description = description.substring(idMatch[0].length)
        }

        // 解析优先级 (如果存在)
        const priorityMatch = description.match(/\s*\((low|medium|high|critical)\)\s*$/)
        let priority: TaskPriority = "medium"
        if (priorityMatch) {
          priority = priorityMatch[1] as TaskPriority
          description = description.substring(0, description.length - priorityMatch[0].length)
        }

        currentTask = {
          id: idMatch ? idMatch[1] : `task-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          description: description.trim(),
          status,
          priority,
        }

        // 根据当前章节确定状态
        if (currentSection.includes("pending")) {
          currentTask.status = "pending"
        } else if (currentSection.includes("progress")) {
          currentTask.status = currentTask.status === "pending" ? "in_progress" : currentTask.status
        } else if (currentSection.includes("completed")) {
          currentTask.status = "completed"
        } else if (currentSection.includes("blocked")) {
          currentTask.status = "blocked"
        }
      }

      // 解析任务备注
      if (currentTask && line.startsWith("  - ")) {
        const note = line.substring(4).trim()
        if (note.startsWith("Assignee:")) {
          currentTask.assignee = note.split(":")[1]?.trim()
        } else if (note.startsWith("Priority:")) {
          currentTask.priority = note.split(":")[1]?.trim() as TaskPriority
        } else if (note.startsWith("Started:")) {
          const dateStr = note.split(":")[1]?.trim()
          if (dateStr) {
            currentTask.startedAt = new Date(dateStr).getTime()
          }
        } else {
          currentTask.notes = currentTask.notes ? `${currentTask.notes}\n${note}` : note
        }
      }
    }

    // 保存最后一个任务
    if (currentTask && currentTask.id && currentTask.description) {
      progress.tasks.push(currentTask as ProgressTask)
    }

    // 计算统计信息
    progress.stats = this.calculateStats(progress.tasks)

    return progress
  }

  /**
   * 计算统计信息
   */
  private calculateStats(tasks: ProgressTask[]): ProgressFile["stats"] {
    return {
      total: tasks.length,
      completed: tasks.filter(t => t.status === "completed").length,
      inProgress: tasks.filter(t => t.status === "in_progress").length,
      blocked: tasks.filter(t => t.status === "blocked").length,
      failed: tasks.filter(t => t.status === "failed").length,
    }
  }

  /**
   * 生成 Markdown 内容
   */
  private generateMarkdown(): string {
    const lines: string[] = []

    // 标题
    lines.push(`# ${this.progress.projectName || "Project Progress"}`)
    lines.push("")

    // 元数据
    lines.push("## 📊 Status")
    lines.push("")
    lines.push(`- **Session**: ${this.progress.currentSessionId || "N/A"}`)
    lines.push(`- **Active Agent**: ${this.progress.activeAgent || "N/A"}`)
    lines.push(`- **Last Updated**: ${new Date(this.progress.lastUpdated).toISOString()}`)
    lines.push("")
    lines.push(`**Progress**: ${this.progress.stats.completed}/${this.progress.stats.total} tasks completed (${((this.progress.stats.completed / Math.max(this.progress.stats.total, 1)) * 100).toFixed(0)}%)`)
    lines.push("")

    // 统计摘要
    lines.push("```")
    lines.push(`Total: ${this.progress.stats.total}`)
    lines.push(`Completed: ${this.progress.stats.completed}`)
    lines.push(`In Progress: ${this.progress.stats.inProgress}`)
    lines.push(`Blocked: ${this.progress.stats.blocked}`)
    lines.push(`Failed: ${this.progress.stats.failed}`)
    lines.push("```")
    lines.push("")

    // 按状态分组任务
    const pending = this.progress.tasks.filter(t => t.status === "pending")
    const inProgress = this.progress.tasks.filter(t => t.status === "in_progress")
    const completed = this.progress.tasks.filter(t => t.status === "completed")
    const blocked = this.progress.tasks.filter(t => t.status === "blocked")
    const failed = this.progress.tasks.filter(t => t.status === "failed")

    // Pending
    if (pending.length > 0) {
      lines.push("## 📋 Pending")
      lines.push("")
      for (const task of pending) {
        lines.push(this.formatTaskLine(task, " "))
      }
      lines.push("")
    }

    // In Progress
    if (inProgress.length > 0) {
      lines.push("## 🔄 In Progress")
      lines.push("")
      for (const task of inProgress) {
        lines.push(this.formatTaskLine(task, "~"))
      }
      lines.push("")
    }

    // Blocked
    if (blocked.length > 0) {
      lines.push("## 🚫 Blocked")
      lines.push("")
      for (const task of blocked) {
        lines.push(this.formatTaskLine(task, "!"))
      }
      lines.push("")
    }

    // Failed
    if (failed.length > 0) {
      lines.push("## ❌ Failed")
      lines.push("")
      for (const task of failed) {
        lines.push(this.formatTaskLine(task, "-"))
      }
      lines.push("")
    }

    // Completed
    if (completed.length > 0) {
      lines.push("## ✅ Completed")
      lines.push("")
      for (const task of completed) {
        lines.push(this.formatTaskLine(task, "x"))
      }
      lines.push("")
    }

    // 备注
    if (this.progress.notes && this.progress.notes.length > 0) {
      lines.push("## 📝 Notes")
      lines.push("")
      for (const note of this.progress.notes) {
        lines.push(`- ${note}`)
      }
      lines.push("")
    }

    return lines.join("\n")
  }

  /**
   * 格式化任务行
   */
  private formatTaskLine(task: ProgressTask, statusChar: string): string {
    let line = `- [${statusChar}] [${task.id}] ${task.description}`

    if (task.assignee || task.priority !== "medium" || task.startedAt) {
      line += ` (${task.priority})`
    }

    const result = [line]

    if (task.assignee) {
      result.push(`  - Assignee: ${task.assignee}`)
    }
    if (task.startedAt) {
      result.push(`  - Started: ${new Date(task.startedAt).toISOString()}`)
    }
    if (task.completedAt) {
      result.push(`  - Completed: ${new Date(task.completedAt).toISOString()}`)
    }
    if (task.notes) {
      result.push(`  - ${task.notes}`)
    }

    return result.join("\n")
  }

  /**
   * 保存进度文件
   */
  save(): void {
    this.progress.lastUpdated = Date.now()
    this.progress.stats = this.calculateStats(this.progress.tasks)
    const content = this.generateMarkdown()
    fs.writeFileSync(this.filePath, content, "utf-8")
  }

  /**
   * 添加任务
   */
  addTask(description: string, options?: Partial<ProgressTask>): ProgressTask {
    const task: ProgressTask = {
      id: options?.id || `task-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      description,
      status: options?.status || "pending",
      priority: options?.priority || "medium",
      assignee: options?.assignee,
      tags: options?.tags,
      dependencies: options?.dependencies,
    }

    this.progress.tasks.push(task)
    this.save()

    return task
  }

  /**
   * 更新任务状态
   */
  updateTaskStatus(taskId: string, status: TaskStatus, notes?: string): boolean {
    const task = this.progress.tasks.find(t => t.id === taskId)
    if (!task) return false

    task.status = status
    if (status === "in_progress" && !task.startedAt) {
      task.startedAt = Date.now()
    }
    if (status === "completed") {
      task.completedAt = Date.now()
    }
    if (notes) {
      task.notes = notes
    }

    this.save()
    return true
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): ProgressTask | undefined {
    return this.progress.tasks.find(t => t.id === taskId)
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): ProgressTask[] {
    return [...this.progress.tasks]
  }

  /**
   * 获取进度信息
   */
  getProgress(): ProgressFile {
    return { ...this.progress }
  }

  /**
   * 设置当前会话
   */
  setCurrentSession(sessionId: string, agentName?: string): void {
    this.progress.currentSessionId = sessionId
    this.progress.activeAgent = agentName
    this.save()
  }

  /**
   * 添加备注
   */
  addNote(note: string): void {
    if (!this.progress.notes) {
      this.progress.notes = []
    }
    this.progress.notes.push(note)
    this.save()
  }

  /**
   * 清除已完成任务
   */
  clearCompleted(): number {
    const initialCount = this.progress.tasks.length
    this.progress.tasks = this.progress.tasks.filter(t => t.status !== "completed")
    this.save()
    return initialCount - this.progress.tasks.length
  }

  /**
   * 获取下一个待处理任务
   */
  getNextTask(): ProgressTask | undefined {
    // 优先级排序
    const priorityOrder: Record<TaskPriority, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    }

    const pending = this.progress.tasks
      .filter(t => t.status === "pending")
      .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

    // 检查依赖
    for (const task of pending) {
      if (!task.dependencies || task.dependencies.length === 0) {
        return task
      }

      const allDepsCompleted = task.dependencies.every(depId => {
        const dep = this.progress.tasks.find(t => t.id === depId)
        return dep?.status === "completed"
      })

      if (allDepsCompleted) {
        return task
      }
    }

    return pending[0]
  }

  /**
   * 获取所有待处理任务
   */
  getPendingTasks(): ProgressTask[] {
    // 优先级排序
    const priorityOrder: Record<TaskPriority, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    }

    return this.progress.tasks
      .filter(t => t.status === "pending")
      .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
  }

  /**
   * 获取文件路径
   */
  getFilePath(): string {
    return this.filePath
  }
}

/**
 * 创建进度文件管理器
 */
export function createProgressManager(cwd?: string, filename?: string): ProgressFileManager {
  return new ProgressFileManager(cwd, filename)
}
