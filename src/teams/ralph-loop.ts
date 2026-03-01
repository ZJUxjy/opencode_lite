import { EventEmitter } from "events"
import * as fs from "fs/promises"

// ============================================================================
// RalphLoop - 任务队列持续执行循环
// ============================================================================

/**
 * RalphLoop - Ralph 任务队列循环执行器
 *
 * 功能:
 * - 从 TASKS.md 读取任务队列
 * - 调用 Agent Teams 执行任务
 * - 支持无人值守运行
 * - 输出 PROGRESS.md + JSON 结果
 */
export class RalphLoop extends EventEmitter {
  private config: RalphLoopConfig

  constructor(config: RalphLoopConfig) {
    super()
    this.config = {
      taskFilePath: config.taskFilePath || "TASKS.md",
      progressFilePath: config.progressFilePath || "PROGRESS.md",
      teamMode: config.teamMode || "worker-reviewer",
      maxRetries: config.maxRetries ?? 1,
      cooldownMs: config.cooldownMs ?? 0,
      notifyOnFailure: config.notifyOnFailure ?? true,
      ...config,
    }
  }

  /**
   * 解析 TASKS.md 文件
   */
  async parseTasksFile(): Promise<ParsedTask[]> {
    const content = await fs.readFile(this.config.taskFilePath!, "utf-8")
    return this.parseMarkdown(content)
  }

  /**
   * 解析 Markdown 内容
   */
  private parseMarkdown(content: string): ParsedTask[] {
    const tasks: ParsedTask[] = []
    const lines = content.split("\n")

    let currentSection = "pending"

    for (const line of lines) {
      // 检测章节
      if (line.startsWith("## ")) {
        const section = line.replace("## ", "").toLowerCase()
        if (section.includes("pending")) currentSection = "pending"
        else if (section.includes("progress") || section.includes("in progress")) currentSection = "in_progress"
        else if (section.includes("completed")) currentSection = "completed"
        else if (section.includes("failed")) currentSection = "failed"
        continue
      }

      // 解析任务行
      const taskMatch = line.match(/^-\s*\[([ x~~-])\]\s*(.+)$/)
      if (taskMatch) {
        const status = taskMatch[1]
        const name = taskMatch[2].trim()

        if (status === " ") {
          // [ ] pending
          tasks.push({
            name,
            status: "pending",
            section: currentSection,
          })
        }
      }
    }

    return tasks
  }

  /**
   * 执行单个任务
   */
  async executeTask(task: ParsedTask): Promise<TaskResult> {
    const startTime = Date.now()
    let attempts = 0
    let lastError: string | undefined

    while (attempts < (this.config.maxRetries ?? 1)) {
      attempts++

      try {
        // 更新任务状态为 in_progress
        await this.updateTaskStatus(task.name, "in_progress")

        // 执行任务 (调用 Agent)
        const response = await this.runAgentTask(task.name)

        // 检查完成关键词
        if (this.isCompleted(response)) {
          await this.updateTaskStatus(task.name, "completed")

          return {
            taskName: task.name,
            status: "completed",
            duration: Date.now() - startTime,
            attempts,
          }
        }

        // 未完成，标记为失败
        throw new Error("Task not completed")

      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)

        // 如果还有重试次数，等待后重试
        if (attempts < (this.config.maxRetries ?? 1)) {
          console.log(`Task failed, retrying... (${attempts}/${this.config.maxRetries})`)
          await this.sleep(1000)
        }
      }
    }

    // 重试耗尽，失败处理
    if (this.config.notifyOnFailure) {
      await this.notifyFailure(task.name, lastError!)
    }

    await this.updateTaskStatus(task.name, "failed", lastError)

    return {
      taskName: task.name,
      status: "failed",
      duration: Date.now() - startTime,
      error: lastError,
      attempts,
    }
  }

  /**
   * 运行 Agent 任务 (placeholder - 需要集成 Agent)
   */
  private async runAgentTask(taskName: string): Promise<string> {
    // TODO: 集成 Agent 执行器
    console.log(`[Ralph] Executing task: ${taskName}`)
    return ""
  }

  /**
   * 检查 Agent 响应是否完成
   */
  private isCompleted(response: string): boolean {
    const keywords = [
      "task completed",
      "task done",
      "completed successfully",
      "all done",
      "done!",
    ]

    const lowerResponse = response.toLowerCase()
    return keywords.some(keyword => lowerResponse.includes(keyword))
  }

  /**
   * 通知失败
   */
  private async notifyFailure(taskName: string, error: string): Promise<void> {
    console.log(`[Ralph] Task failed: ${taskName}`)
    console.log(`[Ralph] Error: ${error}`)
    console.log(`[Ralph] Waiting for main agent assessment...`)
    // TODO: 通知主Agent评估
  }

  /**
   * 更新任务状态
   */
  private async updateTaskStatus(
    taskName: string,
    status: "in_progress" | "completed" | "failed",
    error?: string
  ): Promise<void> {
    if (!this.config.taskFilePath) return

    // 读取当前 TASKS.md
    let content = await fs.readFile(this.config.taskFilePath, "utf-8")

    // 替换状态标记
    const newPattern = status === "in_progress"
      ? `- [~] ${taskName}`
      : status === "completed"
      ? `- [x] ${taskName}`
      : `[-] ${taskName}${error ? ` (${error})` : ""}`

    // 简单替换：找到第一个匹配的任务
    const lines = content.split("\n")
    const newLines = lines.map(line => {
      if (line.includes(`- [ ] ${taskName}`) || line.includes(`- [~] ${taskName}`)) {
        return newPattern
      }
      return line
    })

    await fs.writeFile(this.config.taskFilePath, newLines.join("\n"), "utf-8")
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * 运行 Ralph Loop
   */
  async run(): Promise<RalphLoopResult> {
    const startTime = Date.now()
    console.log("[Ralph] Starting Ralph Loop...")
    console.log(`[Ralph] Task file: ${this.config.taskFilePath}`)
    console.log(`[Ralph] Team mode: ${this.config.teamMode}`)
    console.log("")

    // 解析任务
    const tasks = await this.parseTasksFile()
    const pendingTasks = tasks.filter(t => t.status === "pending")

    console.log(`[Ralph] Found ${pendingTasks.length} pending tasks`)

    if (pendingTasks.length === 0) {
      console.log("[Ralph] No pending tasks")
      return {
        timestamp: new Date().toISOString(),
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        duration: 0,
        results: [],
      }
    }

    const results: TaskResult[] = []

    // 执行每个任务
    for (let i = 0; i < pendingTasks.length; i++) {
      const task = pendingTasks[i]

      // 检查最大迭代次数
      if (this.config.maxIterations && i >= this.config.maxIterations) {
        console.log(`[Ralph] Reached max iterations: ${this.config.maxIterations}`)
        break
      }

      console.log(`\n[Ralph] Task ${i + 1}/${pendingTasks.length}: ${task.name}`)

      const result = await this.executeTask(task)
      results.push(result)

      // 任务间隔
      if (this.config.cooldownMs && this.config.cooldownMs > 0 && i < pendingTasks.length - 1) {
        console.log(`[Ralph] Cooldown: ${this.config.cooldownMs}ms`)
        await this.sleep(this.config.cooldownMs)
      }
    }

    const duration = Date.now() - startTime
    const completedTasks = results.filter(r => r.status === "completed").length
    const failedTasks = results.filter(r => r.status === "failed").length

    // 生成结果
    const result: RalphLoopResult = {
      timestamp: new Date().toISOString(),
      totalTasks: pendingTasks.length,
      completedTasks,
      failedTasks,
      duration,
      results,
    }

    // 输出结果
    console.log("\n" + "=".repeat(50))
    console.log("[Ralph] Loop Complete")
    console.log("=".repeat(50))
    console.log(`Total: ${pendingTasks.length} | Completed: ${completedTasks} | Failed: ${failedTasks}`)
    console.log(`Duration: ${(duration / 1000).toFixed(1)}s`)

    // 保存 JSON 结果
    await this.saveJsonResult(result)

    return result
  }

  /**
   * 保存 JSON 结果
   */
  private async saveJsonResult(result: RalphLoopResult): Promise<void> {
    const outputPath = "ralph-loop-result.json"
    await fs.writeFile(outputPath, JSON.stringify(result, null, 2), "utf-8")
    console.log(`Results saved to: ${outputPath}`)
  }
}

/**
 * 解析后的任务
 */
interface ParsedTask {
  name: string
  status: "pending" | "in_progress" | "completed" | "failed"
  section: string
}

// ============================================================================
// 类型定义
// ============================================================================

export interface RalphLoopConfig {
  taskFilePath?: string
  progressFilePath?: string
  teamMode?: "worker-reviewer" | "leader-workers"
  teamConfig?: unknown
  maxRetries?: number
  cooldownMs?: number
  maxIterations?: number
  notifyOnFailure?: boolean
}

export interface RalphLoopResult {
  timestamp: string
  totalTasks: number
  completedTasks: number
  failedTasks: number
  duration: number
  results: TaskResult[]
}

export interface TaskResult {
  taskName: string
  status: "completed" | "failed" | "skipped"
  workerId?: string
  duration: number
  error?: string
  attempts: number
}
