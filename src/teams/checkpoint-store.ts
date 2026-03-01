import { EventEmitter } from "events"
import * as fs from "fs/promises"
import * as path from "path"

// ============================================================================
// CheckpointStore - 检查点存储
// ============================================================================

/**
 * CheckpointStore - 检查点存储系统
 *
 * 职责：
 * - 保存基线 + 增量 patch（不保存全量快照）
 * - 管理检查点生命周期
 * - 支持回滚到任意检查点
 * - 三方合并策略
 */
export class CheckpointStore extends EventEmitter {
  private baseDir: string
  private maxCheckpoints: number
  private checkpoints: Map<string, Checkpoint> = new Map()

  constructor(baseDir: string, maxCheckpoints = 10) {
    super()
    this.baseDir = baseDir
    this.maxCheckpoints = maxCheckpoints
  }

  // ========================================================================
  // 检查点管理
  // ========================================================================

  /**
   * 创建检查点
   */
  async createCheckpoint(params: CreateCheckpointParams): Promise<Checkpoint> {
    const checkpoint: Checkpoint = {
      id: this.generateId(),
      timestamp: Date.now(),
      description: params.description,
      baseRef: params.baseRef,
      patchRefs: params.patchRefs || [],
      artifactRefs: params.artifactRefs || [],
      blackboardSnapshot: params.blackboardSnapshot,
      metadata: params.metadata || {},
    }

    // 保存到内存
    this.checkpoints.set(checkpoint.id, checkpoint)

    // 持久化
    await this.persistCheckpoint(checkpoint)

    // 清理旧检查点
    await this.cleanupOldCheckpoints()

    this.emit("checkpoint-created", checkpoint)
    return checkpoint
  }

  /**
   * 获取检查点
   */
  getCheckpoint(id: string): Checkpoint | undefined {
    return this.checkpoints.get(id)
  }

  /**
   * 获取最新检查点
   */
  getLatestCheckpoint(): Checkpoint | undefined {
    if (this.checkpoints.size === 0) return undefined

    let latest: Checkpoint | undefined
    let latestTime = 0

    for (const cp of this.checkpoints.values()) {
      if (cp.timestamp > latestTime) {
        latestTime = cp.timestamp
        latest = cp
      }
    }

    return latest
  }

  /**
   * 获取所有检查点
   */
  getAllCheckpoints(): Checkpoint[] {
    return Array.from(this.checkpoints.values()).sort((a, b) => b.timestamp - a.timestamp)
  }

  /**
   * 删除检查点
   */
  async deleteCheckpoint(id: string): Promise<boolean> {
    const checkpoint = this.checkpoints.get(id)
    if (!checkpoint) return false

    // 删除文件
    const filePath = this.getCheckpointPath(id)
    try {
      await fs.unlink(filePath)
    } catch {
      // 文件可能不存在
    }

    this.checkpoints.delete(id)
    this.emit("checkpoint-deleted", id)
    return true
  }

  // ========================================================================
  // 回滚操作
  // ========================================================================

  /**
   * 回滚到指定检查点
   */
  async rollbackTo(checkpointId: string): Promise<RollbackResult> {
    const checkpoint = this.checkpoints.get(checkpointId)
    if (!checkpoint) {
      return { success: false, error: "Checkpoint not found" }
    }

    try {
      // 应用反向补丁
      const rollbackPatches = await this.generateRollbackPatches(checkpoint)

      return {
        success: true,
        checkpointId,
        patchesToApply: rollbackPatches,
      }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }

  /**
   * 生成回滚补丁
   */
  private async generateRollbackPatches(checkpoint: Checkpoint): Promise<string[]> {
    // 反向应用补丁
    const patches: string[] = []

    // 从最新检查点回滚到目标检查点
    const latest = this.getLatestCheckpoint()
    if (!latest) return patches

    // 简单实现：返回需要撤销的patch引用
    // 实际实现需要比较patch序列
    for (const patchRef of checkpoint.patchRefs) {
      patches.push(`revert:${patchRef}`)
    }

    return patches
  }

  // ========================================================================
  // 合并操作
  // ========================================================================

  /**
   * 尝试三方合并
   */
  async attemptMerge(params: MergeParams): Promise<MergeResult> {
    const { baseRef, ours, theirs } = params

    try {
      // 模拟三方合并
      // 实际应该调用 git merge 或自定义合并逻辑

      const conflicts = this.detectConflicts(ours, theirs)

      if (conflicts.length > 0) {
        return {
          success: false,
          conflicts,
          needsManualResolution: true,
        }
      }

      // 无冲突，自动合并
      return {
        success: true,
        mergedRef: `merge-${Date.now()}`,
        conflicts: [],
        needsManualResolution: false,
      }
    } catch (error) {
      return {
        success: false,
        conflicts: [],
        needsManualResolution: true,
        error: String(error),
      }
    }
  }

  /**
   * 检测冲突
   */
  private detectConflicts(ours: string[], theirs: string[]): FileConflict[] {
    const conflicts: FileConflict[] = []

    // 简单实现：检查修改的文件是否有重叠
    const ourSet = new Set(ours)
    const theirSet = new Set(theirs)

    for (const file of ourSet) {
      if (theirSet.has(file)) {
        conflicts.push({
          file,
          type: "modify-modify",
          base: file,
          ours: file,
          theirs: file,
        })
      }
    }

    return conflicts
  }

  // ========================================================================
  // 生命周期管理
  // ========================================================================

  /**
   * 清理旧检查点
   */
  private async cleanupOldCheckpoints(): Promise<void> {
    if (this.checkpoints.size <= this.maxCheckpoints) return

    const sorted = this.getAllCheckpoints()

    // 保留最新的 N 个
    const toDelete = sorted.slice(this.maxCheckpoints)

    for (const cp of toDelete) {
      await this.deleteCheckpoint(cp.id)
    }
  }

  /**
   * 加载检查点
   */
  async loadCheckpoints(): Promise<void> {
    try {
      const files = await fs.readdir(this.baseDir)

      for (const file of files) {
        if (!file.endsWith(".json")) continue

        const filePath = path.join(this.baseDir, file)
        const content = await fs.readFile(filePath, "utf-8")
        const checkpoint: Checkpoint = JSON.parse(content)

        this.checkpoints.set(checkpoint.id, checkpoint)
      }
    } catch (error) {
      // 目录可能不存在
    }
  }

  // ========================================================================
  // 持久化
  // ========================================================================

  /**
   * 持久化检查点
   */
  private async persistCheckpoint(checkpoint: Checkpoint): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true })

    const filePath = this.getCheckpointPath(checkpoint.id)
    await fs.writeFile(filePath, JSON.stringify(checkpoint, null, 2))
  }

  /**
   * 获取检查点文件路径
   */
  private getCheckpointPath(id: string): string {
    return path.join(this.baseDir, `checkpoint-${id}.json`)
  }

  /**
   * 生成检查点ID
   */
  private generateId(): string {
    return `cp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  // ========================================================================
  // 工具方法
  // ========================================================================

  /**
   * 获取统计信息
   */
  getStats(): CheckpointStats {
    return {
      totalCheckpoints: this.checkpoints.size,
      maxCheckpoints: this.maxCheckpoints,
      oldestCheckpoint: this.getOldestTimestamp(),
      newestCheckpoint: this.getNewestTimestamp(),
    }
  }

  private getOldestTimestamp(): number | undefined {
    if (this.checkpoints.size === 0) return undefined

    let oldest = Date.now()
    for (const cp of this.checkpoints.values()) {
      if (cp.timestamp < oldest) oldest = cp.timestamp
    }

    return oldest
  }

  private getNewestTimestamp(): number | undefined {
    return this.getLatestCheckpoint()?.timestamp
  }

  /**
   * 清空所有检查点
   */
  async clear(): Promise<void> {
    for (const id of this.checkpoints.keys()) {
      await this.deleteCheckpoint(id)
    }
  }
}

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 检查点
 */
export interface Checkpoint {
  id: string
  timestamp: number
  description: string
  baseRef: string // git commit / tree hash
  patchRefs: string[] // 增量补丁引用
  artifactRefs: string[] // 产物引用
  blackboardSnapshot?: string // 序列化摘要
  metadata?: Record<string, unknown>
}

/**
 * 创建检查点参数
 */
export interface CreateCheckpointParams {
  description: string
  baseRef: string
  patchRefs?: string[]
  artifactRefs?: string[]
  blackboardSnapshot?: string
  metadata?: Record<string, unknown>
}

/**
 * 回滚结果
 */
export interface RollbackResult {
  success: boolean
  checkpointId?: string
  patchesToApply?: string[]
  error?: string
}

/**
 * 合并参数
 */
export interface MergeParams {
  baseRef: string
  ours: string[] // 我们的修改文件
  theirs: string[] // 他们的修改文件
}

/**
 * 合并结果
 */
export interface MergeResult {
  success: boolean
  mergedRef?: string
  conflicts: FileConflict[]
  needsManualResolution: boolean
  error?: string
}

/**
 * 文件冲突
 */
export interface FileConflict {
  file: string
  type: "modify-delete" | "delete-modify" | "modify-modify"
  base?: string
  ours?: string
  theirs?: string
}

/**
 * 检查点统计
 */
export interface CheckpointStats {
  totalCheckpoints: number
  maxCheckpoints: number
  oldestCheckpoint: number | undefined
  newestCheckpoint: number | undefined
}
