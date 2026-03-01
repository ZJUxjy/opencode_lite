// ============================================================================
// ConflictDetector - 并发冲突检测
// ============================================================================

/**
 * ConflictDetector - 并发冲突检测器
 *
 * 职责：
 * - 检测文件修改冲突
 * - 分析冲突严重程度
 * - 提供冲突解决建议
 */
export class ConflictDetector {
  // 文件锁（正在被修改的文件）
  private lockedFiles: Map<string, string> = new Map() // file -> taskId

  // 文件修改记录
  private fileModifications: Map<string, FileModification> = new Map()

  // 文件分区映射
  private filePartitions: Map<string, string> = new Map() // file -> partitionId

  constructor() {}

  // ========================================================================
  // 文件锁管理
  // ========================================================================

  /**
   * 锁定文件（开始修改）
   */
  lockFile(file: string, taskId: string): boolean {
    if (this.isLocked(file)) {
      const owner = this.lockedFiles.get(file)
      if (owner === taskId) {
        // 自己的任务，可以重入
        return true
      }
      // 被其他任务锁定
      return false
    }

    this.lockedFiles.set(file, taskId)
    return true
  }

  /**
   * 解锁文件
   */
  unlockFile(file: string, taskId: string): boolean {
    const owner = this.lockedFiles.get(file)
    if (owner === taskId) {
      this.lockedFiles.delete(file)
      return true
    }
    return false
  }

  /**
   * 检查文件是否被锁定
   */
  isLocked(file: string): boolean {
    return this.lockedFiles.has(file)
  }

  /**
   * 获取文件锁定者
   */
  getLocker(file: string): string | undefined {
    return this.lockedFiles.get(file)
  }

  // ========================================================================
  // 文件分区
  // ========================================================================

  /**
   * 设置文件分区
   */
  setPartition(file: string, partitionId: string): void {
    this.filePartitions.set(file, partitionId)
  }

  /**
   * 获取文件分区
   */
  getPartition(file: string): string | undefined {
    return this.filePartitions.get(file)
  }

  /**
   * 检查两个文件是否在同一分区
   */
  isSamePartition(file1: string, file2: string): boolean {
    const p1 = this.filePartitions.get(file1)
    const p2 = this.filePartitions.get(file2)

    if (!p1 || !p2) return false
    return p1 === p2
  }

  // ========================================================================
  // 冲突检测
  // ========================================================================

  /**
   * 检测任务是否会与已锁定文件冲突
   */
  detectConflicts(taskId: string, files: string[]): ConflictResult {
    const conflicts: FileConflict[] = []

    for (const file of files) {
      if (this.isLocked(file)) {
        const locker = this.getLocker(file)
        if (locker !== taskId) {
          conflicts.push({
            file,
            type: "locked",
            severity: "high",
            ownerTaskId: locker!,
            message: `文件 ${file} 正在被任务 ${locker} 修改`,
            resolution: "等待或请求任务协调",
          })
        }
      }

      // 检查是否有分区冲突
      for (const [existingFile, partition] of this.filePartitions) {
        if (existingFile === file) continue

        // 检查是否有目录重叠
        if (this.hasDirectoryOverlap(file, existingFile)) {
          const existingPartition = this.filePartitions.get(existingFile)
          if (existingPartition && existingPartition !== partition) {
            conflicts.push({
              file,
              type: "partition-conflict",
              severity: "medium",
              ownerTaskId: partition,
              message: `文件 ${file} 与 ${existingFile} 存在目录重叠但分区不同`,
              resolution: "考虑重新划分分区或使用三方合并",
            })
          }
        }
      }

      // 检查修改历史
      const modification = this.fileModifications.get(file)
      if (modification && modification.taskId !== taskId) {
        // 之前被修改过，检查修改内容是否冲突
        const overlap = this.calculateOverlap(modification, files)
        if (overlap > 0.5) {
          conflicts.push({
            file,
            type: "content-overlap",
            severity: "high",
            ownerTaskId: modification.taskId,
            message: `与任务 ${modification.taskId} 的修改存在 ${Math.round(overlap * 100)}% 重叠`,
            resolution: "使用三方合并或人工仲裁",
          })
        }
      }
    }

    return {
      hasConflicts: conflicts.length > 0,
      conflicts,
      canProceed: conflicts.filter((c) => c.severity === "high").length === 0,
    }
  }

  /**
   * 检测批量任务的冲突
   */
  detectBatchConflicts(tasks: Array<{ taskId: string; files: string[] }>): BatchConflictResult {
    const allConflicts: Array<{ taskId: string; result: ConflictResult }> = []

    for (const task of tasks) {
      const result = this.detectConflicts(task.taskId, task.files)
      if (result.hasConflicts) {
        allConflicts.push({ taskId: task.taskId, result })
      }
    }

    // 找出无法并行执行的任务
    const cannotParallel: string[] = []
    for (const { taskId, result } of allConflicts) {
      if (!result.canProceed) {
        cannotParallel.push(taskId)
      }
    }

    return {
      hasConflicts: allConflicts.length > 0,
      taskConflicts: allConflicts,
      parallelizableTasks: tasks
        .filter((t) => !cannotParallel.includes(t.taskId))
        .map((t) => t.taskId),
      requiresResolution: cannotParallel.length > 0,
    }
  }

  // ========================================================================
  // 修改记录
  // ========================================================================

  /**
   * 记录文件修改
   */
  recordModification(file: string, taskId: string, modification: Partial<FileModification>): void {
    const existing = this.fileModifications.get(file) || {
      taskId,
      modifiedAt: Date.now(),
      lineRanges: [],
      content: "",
    }

    this.fileModifications.set(file, {
      ...existing,
      ...modification,
      taskId,
      modifiedAt: Date.now(),
    })
  }

  /**
   * 获取文件修改记录
   */
  getModification(file: string): FileModification | undefined {
    return this.fileModifications.get(file)
  }

  // ========================================================================
  // 清理
  // ========================================================================

  /**
   * 清理任务相关的所有锁定和记录
   */
  cleanupTask(taskId: string): void {
    // 清理锁定
    for (const [file, locker] of this.lockedFiles) {
      if (locker === taskId) {
        this.lockedFiles.delete(file)
      }
    }

    // 清理修改记录
    for (const [file, mod] of this.fileModifications) {
      if (mod.taskId === taskId) {
        this.fileModifications.delete(file)
      }
    }
  }

  /**
   * 清空所有状态
   */
  clear(): void {
    this.lockedFiles.clear()
    this.fileModifications.clear()
    this.filePartitions.clear()
  }

  // ========================================================================
  // 辅助方法
  // ========================================================================

  /**
   * 检查两个文件是否有目录重叠
   */
  private hasDirectoryOverlap(file1: string, file2: string): boolean {
    const parts1 = file1.split("/")
    const parts2 = file2.split("/")

    // 去掉文件名
    parts1.pop()
    parts2.pop()

    // 检查是否有共同前缀
    const minLen = Math.min(parts1.length, parts2.length)
    for (let i = 0; i < minLen; i++) {
      if (parts1[i] === parts2[i]) {
        return true
      }
    }

    return false
  }

  /**
   * 计算修改内容的重叠度（简化版）
   */
  private calculateOverlap(mod1: FileModification, files: string[]): number {
    // 简化实现：只检查是否修改了相同文件
    // 实际应该比较行范围
    if (files.includes(mod1.content)) {
      return 1
    }
    return 0
  }

  // ========================================================================
  // 状态查询
  // ========================================================================

  /**
   * 获取统计信息
   */
  getStats(): ConflictStats {
    return {
      lockedFilesCount: this.lockedFiles.size,
      modificationsCount: this.fileModifications.size,
      partitionsCount: this.filePartitions.size,
    }
  }
}

// ============================================================================
// 类型定义
// ============================================================================

export interface FileConflict {
  file: string
  type: "locked" | "partition-conflict" | "content-overlap"
  severity: "low" | "medium" | "high"
  ownerTaskId: string
  message: string
  resolution: string
}

export interface ConflictResult {
  hasConflicts: boolean
  conflicts: FileConflict[]
  canProceed: boolean
}

export interface BatchConflictResult {
  hasConflicts: boolean
  taskConflicts: Array<{ taskId: string; result: ConflictResult }>
  parallelizableTasks: string[]
  requiresResolution: boolean
}

export interface FileModification {
  taskId: string
  modifiedAt: number
  lineRanges: Array<{ start: number; end: number }>
  content: string
}

export interface ConflictStats {
  lockedFilesCount: number
  modificationsCount: number
  partitionsCount: number
}
