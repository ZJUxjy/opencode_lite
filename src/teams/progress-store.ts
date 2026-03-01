import * as fs from "fs/promises"
import type { TaskProgress } from "./progress-tracker.js"

// ============================================================================
// ProgressStore - PROGRESS.md 持久化
// ============================================================================

/**
 * ProgressStore - 任务进度持久化到 PROGRESS.md
 *
 * 职责：
 * - 将任务进度写入 PROGRESS.md
 * - 支持断点续传
 * - 人工可读
 */
export class ProgressStore {
  private filePath: string
  private enabled: boolean

  constructor(options: ProgressStoreOptions = {}) {
    this.filePath = options.filePath || "PROGRESS.md"
    this.enabled = options.enabled ?? true
  }

  /**
   * 保存进度
   */
  async save(progress: {
    totalTasks: number
    completedTasks: number
    failedTasks: number
    pendingTasks: number
    progressPercent: number
    currentRound: number
    currentIteration: number
    maxIterations: number
    consecutiveNoProgressRounds: number
    consecutiveFailures: number
    tasks: TaskProgress[]
  }): Promise<void> {
    if (!this.enabled) return

    const content = this.formatProgress(progress)
    await fs.writeFile(this.filePath, content, "utf-8")
  }

  /**
   * 追加进度
   */
  async append(message: string): Promise<void> {
    if (!this.enabled) return

    const timestamp = new Date().toISOString()
    const entry = `- [${timestamp}] ${message}\n`

    try {
      const existing = await fs.readFile(this.filePath, "utf-8")
      await fs.writeFile(this.filePath, existing + entry, "utf-8")
    } catch {
      // 文件不存在，创建新的
      await fs.writeFile(this.filePath, `# Progress\n\n${entry}`, "utf-8")
    }
  }

  /**
   * 读取进度
   */
  async load(): Promise<string | null> {
    try {
      return await fs.readFile(this.filePath, "utf-8")
    } catch {
      return null
    }
  }

  /**
   * 格式化进度为Markdown
   */
  private formatProgress(progress: {
    totalTasks: number
    completedTasks: number
    failedTasks: number
    pendingTasks: number
    progressPercent: number
    currentRound: number
    currentIteration: number
    maxIterations: number
    consecutiveNoProgressRounds: number
    consecutiveFailures: number
    tasks: TaskProgress[]
  }): string {
    const lines: string[] = []

    lines.push("# Agent Teams Progress")
    lines.push("")
    lines.push(`**Last Updated**: ${new Date().toISOString()}`)
    lines.push("")

    // 总体进度
    lines.push("## Overall Progress")
    lines.push("")
    const percent = progress.progressPercent.toFixed(1)
    const bar = this.renderProgressBar(percent)
    lines.push(bar)
    lines.push(`**${progress.completedTasks}/${progress.totalTasks}** tasks completed (${percent}%)`)
    lines.push("")

    // 当前状态
    lines.push("## Current Status")
    lines.push("")
    lines.push(`- **Round**: ${progress.currentRound}`)
    lines.push(`- **Iteration**: ${progress.currentIteration}/${progress.maxIterations}`)
    lines.push(`- **No Progress Rounds**: ${progress.consecutiveNoProgressRounds}`)
    lines.push(`- **Consecutive Failures**: ${progress.consecutiveFailures}`)
    lines.push("")

    // 任务列表
    lines.push("## Tasks")
    lines.push("")

    for (const task of progress.tasks) {
      const statusIcon = this.getTaskIcon(task.status)
      const progressBar = this.renderProgressBar(task.progress.toString())

      lines.push(`### ${statusIcon} ${task.taskId}`)
      lines.push("")
      lines.push(`**Objective**: ${task.objective}`)
      lines.push(`**Status**: ${task.status}`)
      lines.push(`**Progress**: ${progressBar} ${task.progress}%`)
      lines.push(`**Attempts**: ${task.attempts}`)
      lines.push("")

      if (task.error) {
        lines.push(`**Error**: ${task.error}`)
        lines.push("")
      }
    }

    return lines.join("\n")
  }

  /**
   * 渲染进度条
   */
  private renderProgressBar(percent: string | number): string {
    const p = typeof percent === "string" ? parseFloat(percent) : percent
    const filled = Math.round(p / 10)
    const empty = 10 - filled

    return "[" + "█".repeat(filled) + "░".repeat(empty) + "]"
  }

  /**
   * 获取任务图标
   */
  private getTaskIcon(status: string): string {
    switch (status) {
      case "completed":
        return "✅"
      case "in_progress":
        return "🔄"
      case "failed":
        return "❌"
      default:
        return "⬜"
    }
  }

  /**
   * 清理进度文件
   */
  async clear(): Promise<void> {
    try {
      await fs.unlink(this.filePath)
    } catch {
      // 忽略错误
    }
  }
}

// ============================================================================
// 类型定义
// ============================================================================

export interface ProgressStoreOptions {
  filePath?: string
  enabled?: boolean
}
