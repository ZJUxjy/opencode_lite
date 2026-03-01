import * as fs from "fs/promises"
import * as path from "path"
import type { TeamMode, TeamStatus } from "./types.js"

// ============================================================================
// TeamRunStore - 团队运行持久化
// ============================================================================

/**
 * TeamRunStore - 团队运行记录持久化
 *
 * 职责：
 * - 保存团队运行元数据
 * - 记录消息轨迹
 * - 索引检查点
 */
export class TeamRunStore {
  private dbPath: string
  private runs: Map<string, TeamRunRecord> = new Map()

  constructor(dbPath: string) {
    this.dbPath = dbPath
  }

  /**
   * 初始化存储
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.dbPath), { recursive: true })
      await this.load()
    } catch {
      // 首次运行，创建空存储
    }
  }

  /**
   * 创建团队运行记录
   */
  async createRun(record: TeamRunRecord): Promise<void> {
    this.runs.set(record.runId, record)
    await this.save()
  }

  /**
   * 更新团队运行状态
   */
  async updateRunStatus(runId: string, status: TeamStatus): Promise<void> {
    const run = this.runs.get(runId)
    if (run) {
      run.status = status
      run.updatedAt = Date.now()
      await this.save()
    }
  }

  /**
   * 添加消息到轨迹
   */
  async addMessage(runId: string, message: TeamRunMessage): Promise<void> {
    const run = this.runs.get(runId)
    if (run) {
      run.messages.push(message)
      run.updatedAt = Date.now()
      await this.save()
    }
  }

  /**
   * 添加检查点索引
   */
  async addCheckpoint(runId: string, checkpointId: string): Promise<void> {
    const run = this.runs.get(runId)
    if (run) {
      run.checkpoints.push(checkpointId)
      run.updatedAt = Date.now()
      await this.save()
    }
  }

  /**
   * 获取运行记录
   */
  getRun(runId: string): TeamRunRecord | undefined {
    return this.runs.get(runId)
  }

  /**
   * 获取所有运行记录
   */
  getAllRuns(): TeamRunRecord[] {
    return Array.from(this.runs.values())
  }

  /**
   * 获取最近的N条记录
   */
  getRecentRuns(limit: number): TeamRunRecord[] {
    return Array.from(this.runs.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
  }

  /**
   * 按状态筛选
   */
  getRunsByStatus(status: TeamStatus): TeamRunRecord[] {
    return Array.from(this.runs.values()).filter((r) => r.status === status)
  }

  /**
   * 删除运行记录
   */
  async deleteRun(runId: string): Promise<void> {
    this.runs.delete(runId)
    await this.save()
  }

  /**
   * 持久化到磁盘
   */
  private async save(): Promise<void> {
    const data = JSON.stringify(Array.from(this.runs.entries()), null, 2)
    await fs.writeFile(this.dbPath, data, "utf-8")
  }

  /**
   * 从磁盘加载
   */
  private async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.dbPath, "utf-8")
      const entries = JSON.parse(data)
      this.runs = new Map(entries)
    } catch {
      this.runs = new Map()
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): TeamRunStoreStats {
    const runs = Array.from(this.runs.values())

    let completed = 0
    let failed = 0
    let running = 0

    for (const run of runs) {
      switch (run.status) {
        case "completed":
          completed++
          break
        case "failed":
          failed++
          break
        case "running":
          running++
          break
      }
    }

    return {
      totalRuns: runs.length,
      completed,
      failed,
      running,
    }
  }
}

// ============================================================================
// 类型定义
// ============================================================================

export interface TeamRunRecord {
  runId: string
  teamId: string
  mode: TeamMode
  status: TeamStatus
  objective: string
  createdAt: number
  updatedAt: number
  completedAt?: number
  messages: TeamRunMessage[]
  checkpoints: string[]
  cost?: number
  tokens?: number
  duration?: number
  error?: string
}

export interface TeamRunMessage {
  id: string
  type: "task" | "result" | "review" | "artifact" | "error" | "system"
  content: string
  timestamp: number
  metadata?: Record<string, unknown>
}

export interface TeamRunStoreStats {
  totalRuns: number
  completed: number
  failed: number
  running: number
}
