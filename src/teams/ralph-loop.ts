/**
 * Ralph Loop - 持续执行循环
 *
 * 基于 agent-teams-supplement.md 原则 8: Ralph Loop
 *
 * 支持从任务队列持续获取任务并执行，实现自动化持续工作。
 */

import * as fs from "fs"
import * as path from "path"
import type { Agent } from "../agent.js"
import type { TeamConfig, TeamResult } from "./types.js"
import { TeamExecutor } from "./team-executor.js"
import { ProgressFileManager, type ProgressTask } from "./progress-file.js"

/**
 * 任务源类型
 */
export type TaskSourceType = "file" | "git-issues" | "stdin" | "api"

/**
 * 输出格式
 */
export type RalphOutputFormat = "text" | "json" | "stream-json"

/**
 * Ralph Loop 事件（用于 stream-json 输出）
 */
export type RalphEvent =
  | { type: "start"; timestamp: number; config: RalphLoopConfig }
  | { type: "task_start"; timestamp: number; taskId: string; description: string; priority: string }
  | { type: "task_complete"; timestamp: number; taskId: string; success: boolean; duration: number; tokens: number; error?: string }
  | { type: "iteration"; timestamp: number; iteration: number; maxIterations: number }
  | { type: "heartbeat"; timestamp: number; stats: RalphLoopStats; runningTasks: number }
  | { type: "error"; timestamp: number; taskId: string; error: string }
  | { type: "complete"; timestamp: number; stats: RalphLoopStats }

/**
 * Ralph Loop 配置
 */
export interface RalphLoopConfig {
  /** 是否启用 */
  enabled: boolean
  /** 任务源类型 */
  taskSource: TaskSourceType
  /** 任务文件路径 (file 模式) */
  taskFilePath: string
  /** 进度文件路径 */
  progressFilePath: string
  /** 任务间隔 (毫秒) */
  cooldownMs: number
  /** 最大迭代次数 */
  maxIterations: number
  /** 是否持久化进度 */
  persistProgress: boolean
  /** 工作目录 */
  cwd: string
  /** 完成后是否退出 */
  exitOnComplete: boolean
  /** 错误处理策略 */
  errorHandling: "continue" | "stop" | "retry"
  /** 最大重试次数 */
  maxRetries: number
  /** 输出格式 */
  outputFormat: RalphOutputFormat
  /** 日志文件路径（可选） */
  logFile?: string
}

/**
 * 默认配置
 */
export const DEFAULT_RALPH_CONFIG: RalphLoopConfig = {
  enabled: true,
  taskSource: "file",
  taskFilePath: "TASKS.md",
  progressFilePath: "PROGRESS.md",
  cooldownMs: 5000,
  maxIterations: 100,
  persistProgress: true,
  cwd: process.cwd(),
  exitOnComplete: true,
  errorHandling: "continue",
  maxRetries: 3,
  outputFormat: "text",
}

/**
 * 任务定义
 */
export interface TaskDefinition {
  /** 任务 ID */
  id: string
  /** 任务描述 */
  description: string
  /** 优先级 */
  priority: "low" | "medium" | "high" | "critical"
  /** 标签 */
  tags?: string[]
  /** 依赖任务 ID */
  dependencies?: string[]
  /** 元数据 */
  metadata?: Record<string, unknown>
}

/**
 * 执行结果
 */
export interface TaskExecutionResult {
  /** 任务 ID */
  taskId: string
  /** 执行结果 */
  result: TeamResult
  /** 执行时间 */
  duration: number
  /** 重试次数 */
  retries: number
}

/**
 * Ralph Loop 统计
 */
export interface RalphLoopStats {
  /** 总任务数 */
  totalTasks: number
  /** 完成任务数 */
  completedTasks: number
  /** 失败任务数 */
  failedTasks: number
  /** 跳过任务数 */
  skippedTasks: number
  /** 总执行时间 */
  totalDuration: number
  /** 总成本 */
  totalCost: number
  /** 总 token 数 */
  totalTokens: number
}

/**
 * Ralph Loop 执行器
 */
export class RalphLoop {
  private config: RalphLoopConfig
  private agent: Agent
  private teamConfig: TeamConfig | null
  private progressManager: ProgressFileManager
  private stats: RalphLoopStats
  private running: boolean = false
  private iteration: number = 0

  constructor(
    agent: Agent,
    teamConfig: TeamConfig | null,
    config: Partial<RalphLoopConfig> = {}
  ) {
    this.agent = agent
    this.teamConfig = teamConfig
    this.config = { ...DEFAULT_RALPH_CONFIG, ...config }
    this.progressManager = new ProgressFileManager(this.config.cwd, this.config.progressFilePath)
    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      skippedTasks: 0,
      totalDuration: 0,
      totalCost: 0,
      totalTokens: 0,
    }
  }

  /**
   * 发送事件
   */
  emitEvent(event: RalphEvent): void {
    const eventStr = JSON.stringify(event)

    // 输出到控制台
    if (this.config.outputFormat === "stream-json") {
      console.log(eventStr)
    }

    // 输出到文件
    if (this.config.logFile) {
      const logPath = path.resolve(this.config.cwd, this.config.logFile)
      fs.appendFileSync(logPath, eventStr + "\n", "utf-8")
    }
  }

  /**
   * 从文件加载任务
   */
  private loadTasksFromFile(): TaskDefinition[] {
    const taskPath = path.resolve(this.config.cwd, this.config.taskFilePath)

    if (!fs.existsSync(taskPath)) {
      return []
    }

    const content = fs.readFileSync(taskPath, "utf-8")
    return this.parseTaskFile(content)
  }

  /**
   * 解析任务文件 (Markdown 格式)
   *
   * 格式示例:
   * # Tasks
   *
   * ## Pending
   * - [ ] Task 1 description
   * - [ ] [high] Task 2 description (high priority)
   *
   * ## In Progress
   * - [~] Task 3 description
   */
  private parseTaskFile(content: string): TaskDefinition[] {
    const tasks: TaskDefinition[] = []
    const lines = content.split("\n")
    let idCounter = 0

    for (const line of lines) {
      // 匹配待办任务
      const match = line.match(/^- \[ \] (.+)$/)
      if (match) {
        let description = match[1]
        let priority: TaskDefinition["priority"] = "medium"

        // 检查是否有优先级标记
        const priorityMatch = description.match(/^\[(low|medium|high|critical)\]\s*/)
        if (priorityMatch) {
          priority = priorityMatch[1] as TaskDefinition["priority"]
          description = description.substring(priorityMatch[0].length)
        }

        tasks.push({
          id: `task-${Date.now()}-${++idCounter}`,
          description: description.trim(),
          priority,
        })
      }
    }

    return tasks
  }

  /**
   * 获取下一个任务
   */
  private getNextTask(): TaskDefinition | null {
    // 首先检查进度文件中的待处理任务
    const progressTask = this.progressManager.getNextTask()
    if (progressTask) {
      return {
        id: progressTask.id,
        description: progressTask.description,
        priority: progressTask.priority,
      }
    }

    // 然后从任务文件加载
    const tasks = this.loadTasksFromFile()

    // 按优先级排序
    const priorityOrder: Record<string, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    }

    tasks.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

    return tasks[0] || null
  }

  /**
   * 执行单个任务
   */
  private async executeTask(task: TaskDefinition): Promise<TaskExecutionResult> {
    const startTime = Date.now()
    let retries = 0
    let result: TeamResult

    // 标记任务为进行中
    this.progressManager.updateTaskStatus(task.id, "in_progress")

    do {
      if (this.teamConfig) {
        // 使用 Team 模式执行
        const executor = new TeamExecutor({
          mainAgent: this.agent,
          teamConfig: this.teamConfig,
          sessionId: `ralph-${task.id}-${Date.now()}`,
        })
        result = await executor.execute(task.description)
      } else {
        // 使用单 Agent 执行
        const response = await this.agent.run(task.description)
        result = {
          status: "success",
          summary: response,
          artifacts: [],
          stats: {
            duration: Date.now() - startTime,
            iterations: 1,
            totalCost: 0,
            totalTokens: 0,
          },
        }
      }

      if (result.status === "success" || retries >= this.config.maxRetries) {
        break
      }

      retries++
      await this.sleep(this.config.cooldownMs)
    } while (this.config.errorHandling === "retry" && retries < this.config.maxRetries)

    const duration = Date.now() - startTime

    // 更新任务状态
    if (result.status === "success") {
      this.progressManager.updateTaskStatus(task.id, "completed")
    } else {
      this.progressManager.updateTaskStatus(task.id, "failed", result.summary)
    }

    // 保存进度
    if (this.config.persistProgress) {
      this.progressManager.save()
    }

    return {
      taskId: task.id,
      result,
      duration,
      retries,
    }
  }

  /**
   * 休眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * 运行 Ralph Loop
   */
  async run(): Promise<RalphLoopStats> {
    if (!this.config.enabled) {
      console.log("[RalphLoop] Disabled, not running")
      return this.stats
    }

    this.running = true
    console.log("[RalphLoop] Starting continuous execution loop")

    while (this.running && this.iteration < this.config.maxIterations) {
      this.iteration++
      console.log(`[RalphLoop] Iteration ${this.iteration}/${this.config.maxIterations}`)

      const task = this.getNextTask()

      if (!task) {
        console.log("[RalphLoop] No more tasks to execute")

        if (this.config.exitOnComplete) {
          break
        }

        await this.sleep(this.config.cooldownMs)
        continue
      }

      console.log(`[RalphLoop] Executing task: ${task.description.substring(0, 50)}...`)
      this.stats.totalTasks++

      try {
        const executionResult = await this.executeTask(task)

        this.stats.totalDuration += executionResult.duration
        this.stats.totalCost += executionResult.result.stats.totalCost
        this.stats.totalTokens += executionResult.result.stats.totalTokens

        if (executionResult.result.status === "success") {
          this.stats.completedTasks++
          console.log(`[RalphLoop] Task completed successfully`)
        } else {
          this.stats.failedTasks++
          console.log(`[RalphLoop] Task failed: ${executionResult.result.summary}`)

          if (this.config.errorHandling === "stop") {
            console.log("[RalphLoop] Stopping due to error")
            break
          }
        }
      } catch (error) {
        this.stats.failedTasks++
        console.error(`[RalphLoop] Task error: ${error}`)

        if (this.config.errorHandling === "stop") {
          break
        }
      }

      // 任务间冷却
      if (this.config.cooldownMs > 0) {
        await this.sleep(this.config.cooldownMs)
      }
    }

    this.running = false
    console.log("[RalphLoop] Execution loop completed")
    this.printStats()

    return this.stats
  }

  /**
   * 停止循环
   */
  stop(): void {
    this.running = false
    console.log("[RalphLoop] Stopping...")
  }

  /**
   * 打印统计信息
   */
  private printStats(): void {
    console.log("\n[RalphLoop] Statistics:")
    console.log(`  Total Tasks: ${this.stats.totalTasks}`)
    console.log(`  Completed: ${this.stats.completedTasks}`)
    console.log(`  Failed: ${this.stats.failedTasks}`)
    console.log(`  Total Duration: ${(this.stats.totalDuration / 1000).toFixed(1)}s`)
    console.log(`  Total Cost: $${this.stats.totalCost.toFixed(4)}`)
    console.log(`  Total Tokens: ${this.stats.totalTokens}`)
  }

  /**
   * 获取统计信息
   */
  getStats(): RalphLoopStats {
    return { ...this.stats }
  }

  /**
   * 是否正在运行
   */
  isRunning(): boolean {
    return this.running
  }

  /**
   * 获取当前迭代次数
   */
  getIteration(): number {
    return this.iteration
  }
}

/**
 * 创建 Ralph Loop
 */
export function createRalphLoop(
  agent: Agent,
  teamConfig: TeamConfig | null,
  config?: Partial<RalphLoopConfig>
): RalphLoop {
  return new RalphLoop(agent, teamConfig, config)
}
