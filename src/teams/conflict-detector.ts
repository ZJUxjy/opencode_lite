/**
 * Conflict Detector - 冲突检测器
 *
 * 检测和解决多 Agent 并行执行时的文件冲突：
 * - 文件级冲突检测（多个 Agent 修改同一文件）
 * - 区域级冲突检测（修改同一区域）
 * - 自动合并策略
 * - 冲突仲裁
 */

import type { WorkArtifact } from "./contracts.js"

/**
 * 文件变更记录
 */
export interface FileChange {
  /** 文件路径 */
  filePath: string
  /** Agent ID */
  agentId: string
  /** 任务 ID */
  taskId: string
  /** 变更类型 */
  changeType: "create" | "modify" | "delete"
  /** 变更区域（行号范围） */
  regions?: ChangeRegion[]
  /** 时间戳 */
  timestamp: number
}

/**
 * 变更区域
 */
export interface ChangeRegion {
  /** 起始行 */
  startLine: number
  /** 结束行 */
  endLine: number
  /** 变更摘要 */
  summary?: string
}

/**
 * 冲突类型
 */
export type ConflictType =
  | "file-level"      // 多个 Agent 修改同一文件
  | "region-overlap"  // 修改区域重叠
  | "semantic"        // 语义冲突（逻辑不兼容）
  | "dependency"      // 依赖冲突

/**
 * 冲突记录
 */
export interface Conflict {
  /** 冲突 ID */
  id: string
  /** 冲突类型 */
  type: ConflictType
  /** 涉及的文件 */
  filePath: string
  /** 涉及的变更记录 */
  changes: FileChange[]
  /** 冲突严重程度 */
  severity: "low" | "medium" | "high"
  /** 冲突描述 */
  description: string
  /** 建议的解决策略 */
  resolution: ConflictResolution
  /** 检测时间 */
  detectedAt: number
}

/**
 * 冲突解决策略
 */
export interface ConflictResolution {
  /** 策略类型 */
  strategy: "auto-merge" | "prefer-first" | "prefer-last" | "manual" | "abort"
  /** 策略参数 */
  params?: {
    /** 优先的 Agent ID */
    preferredAgent?: string
    /** 合并基准 */
    baseContent?: string
    /** 冲突标记 */
    conflictMarkers?: boolean
  }
  /** 解决说明 */
  notes?: string
}

/**
 * 冲突检测结果
 */
export interface ConflictDetectionResult {
  /** 是否检测到冲突 */
  hasConflicts: boolean
  /** 检测到的冲突列表 */
  conflicts: Conflict[]
  /** 无冲突的文件列表 */
  safeFiles: string[]
  /** 检测统计 */
  stats: {
    totalFiles: number
    conflictedFiles: number
    autoResolvable: number
    requiresManual: number
  }
}

/**
 * 冲突检测器
 */
export class ConflictDetector {
  private fileChanges: Map<string, FileChange[]> = new Map()
  private conflicts: Map<string, Conflict> = new Map()

  /**
   * 注册文件变更
   */
  registerChange(change: FileChange): void {
    const filePath = change.filePath

    if (!this.fileChanges.has(filePath)) {
      this.fileChanges.set(filePath, [])
    }

    this.fileChanges.get(filePath)!.push(change)
  }

  /**
   * 从 WorkArtifact 批量注册变更
   */
  registerArtifact(artifact: WorkArtifact): void {
    for (const filePath of artifact.changedFiles) {
      this.registerChange({
        filePath,
        agentId: artifact.agentId,
        taskId: artifact.taskId,
        changeType: "modify",
        timestamp: artifact.createdAt,
      })
    }
  }

  /**
   * 检测所有冲突
   */
  detectConflicts(): ConflictDetectionResult {
    const conflicts: Conflict[] = []
    const safeFiles: string[] = []

    for (const [filePath, changes] of this.fileChanges) {
      if (changes.length <= 1) {
        // 只有一个 Agent 修改，无冲突
        safeFiles.push(filePath)
        continue
      }

      // 检测文件级冲突
      const fileConflict = this.detectFileLevelConflict(filePath, changes)
      if (fileConflict) {
        conflicts.push(fileConflict)
        continue
      }

      // 检测区域重叠冲突
      const regionConflict = this.detectRegionConflict(filePath, changes)
      if (regionConflict) {
        conflicts.push(regionConflict)
        continue
      }

      // 无冲突
      safeFiles.push(filePath)
    }

    // 存储冲突
    for (const conflict of conflicts) {
      this.conflicts.set(conflict.id, conflict)
    }

    return {
      hasConflicts: conflicts.length > 0,
      conflicts,
      safeFiles,
      stats: {
        totalFiles: this.fileChanges.size,
        conflictedFiles: conflicts.length,
        autoResolvable: conflicts.filter(c => c.resolution.strategy === "auto-merge").length,
        requiresManual: conflicts.filter(c => c.resolution.strategy === "manual").length,
      },
    }
  }

  /**
   * 检测文件级冲突（多个 Agent 修改同一文件）
   */
  private detectFileLevelConflict(
    filePath: string,
    changes: FileChange[]
  ): Conflict | null {
    const uniqueAgents = new Set(changes.map(c => c.agentId))

    if (uniqueAgents.size <= 1) {
      return null // 同一 Agent 的多次修改不算冲突
    }

    // 检查是否有删除操作
    const hasDelete = changes.some(c => c.changeType === "delete")
    const hasCreate = changes.some(c => c.changeType === "create")

    let resolution: ConflictResolution

    if (hasDelete && hasCreate) {
      // 同时删除和创建 - 高风险
      resolution = {
        strategy: "manual",
        notes: "File was both deleted and modified by different agents",
      }
    } else if (this.canAutoMerge(changes)) {
      resolution = {
        strategy: "auto-merge",
        params: {
          conflictMarkers: true,
        },
        notes: "Changes may be automatically mergeable",
      }
    } else {
      // 根据时间戳选择最新
      const sortedChanges = [...changes].sort((a, b) => b.timestamp - a.timestamp)
      resolution = {
        strategy: "prefer-last",
        params: {
          preferredAgent: sortedChanges[0].agentId,
        },
        notes: "Multiple agents modified the same file",
      }
    }

    return {
      id: `conflict-${filePath}-${Date.now()}`,
      type: "file-level",
      filePath,
      changes,
      severity: hasDelete || hasCreate ? "high" : "medium",
      description: `${uniqueAgents.size} agents modified ${filePath}`,
      resolution,
      detectedAt: Date.now(),
    }
  }

  /**
   * 检测区域重叠冲突
   */
  private detectRegionConflict(
    filePath: string,
    changes: FileChange[]
  ): Conflict | null {
    // 过滤有区域信息的变更
    const changesWithRegions = changes.filter(c => c.regions && c.regions.length > 0)

    if (changesWithRegions.length < 2) {
      return null
    }

    // 检测区域重叠
    for (let i = 0; i < changesWithRegions.length; i++) {
      for (let j = i + 1; j < changesWithRegions.length; j++) {
        const change1 = changesWithRegions[i]
        const change2 = changesWithRegions[j]

        if (this.regionsOverlap(change1.regions!, change2.regions!)) {
          return {
            id: `conflict-${filePath}-region-${Date.now()}`,
            type: "region-overlap",
            filePath,
            changes: [change1, change2],
            severity: "high",
            description: `Overlapping changes in ${filePath} at lines ${change1.regions![0].startLine}-${change1.regions![0].endLine}`,
            resolution: {
              strategy: "manual",
              notes: "Overlapping regions require manual resolution",
            },
            detectedAt: Date.now(),
          }
        }
      }
    }

    return null
  }

  /**
   * 检查区域是否重叠
   */
  private regionsOverlap(regions1: ChangeRegion[], regions2: ChangeRegion[]): boolean {
    for (const r1 of regions1) {
      for (const r2 of regions2) {
        if (r1.startLine <= r2.endLine && r2.startLine <= r1.endLine) {
          return true
        }
      }
    }
    return false
  }

  /**
   * 判断是否可以自动合并
   */
  private canAutoMerge(changes: FileChange[]): boolean {
    // 如果有删除操作，不能自动合并
    if (changes.some(c => c.changeType === "delete")) {
      return false
    }

    // 如果所有变更都有区域信息，且不重叠，可以自动合并
    const allHaveRegions = changes.every(
      c => c.regions && c.regions.length > 0
    )

    if (allHaveRegions) {
      // 检查所有区域是否不重叠
      const allRegions = changes.flatMap(c => c.regions!)
      for (let i = 0; i < allRegions.length; i++) {
        for (let j = i + 1; j < allRegions.length; j++) {
          if (this.regionsOverlap([allRegions[i]], [allRegions[j]])) {
            return false
          }
        }
      }
      return true
    }

    return false
  }

  /**
   * 获取冲突
   */
  getConflict(conflictId: string): Conflict | undefined {
    return this.conflicts.get(conflictId)
  }

  /**
   * 获取所有冲突
   */
  getAllConflicts(): Conflict[] {
    return Array.from(this.conflicts.values())
  }

  /**
   * 解决冲突
   */
  resolveConflict(
    conflictId: string,
    resolution: ConflictResolution
  ): boolean {
    const conflict = this.conflicts.get(conflictId)
    if (!conflict) {
      return false
    }

    conflict.resolution = resolution

    // 如果选择了中止策略，标记冲突已解决
    if (resolution.strategy === "abort") {
      this.conflicts.delete(conflictId)
    }

    return true
  }

  /**
   * 获取需要手动解决的冲突
   */
  getManualConflicts(): Conflict[] {
    return Array.from(this.conflicts.values()).filter(
      c => c.resolution.strategy === "manual"
    )
  }

  /**
   * 清空检测器
   */
  clear(): void {
    this.fileChanges.clear()
    this.conflicts.clear()
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalChanges: number
    filesWithChanges: number
    totalConflicts: number
    bySeverity: { low: number; medium: number; high: number }
  } {
    let totalChanges = 0
    for (const changes of this.fileChanges.values()) {
      totalChanges += changes.length
    }

    const conflicts = Array.from(this.conflicts.values())

    return {
      totalChanges,
      filesWithChanges: this.fileChanges.size,
      totalConflicts: conflicts.length,
      bySeverity: {
        low: conflicts.filter(c => c.severity === "low").length,
        medium: conflicts.filter(c => c.severity === "medium").length,
        high: conflicts.filter(c => c.severity === "high").length,
      },
    }
  }
}

/**
 * 创建文件变更记录
 */
export function createFileChange(
  filePath: string,
  agentId: string,
  taskId: string,
  options?: {
    changeType?: FileChange["changeType"]
    regions?: ChangeRegion[]
  }
): FileChange {
  return {
    filePath,
    agentId,
    taskId,
    changeType: options?.changeType || "modify",
    regions: options?.regions,
    timestamp: Date.now(),
  }
}

/**
 * 格式化冲突报告
 */
export function formatConflictReport(conflict: Conflict): string {
  const lines: string[] = []

  lines.push(`⚠️ Conflict Detected: ${conflict.filePath}`)
  lines.push(``)
  lines.push(`**Type**: ${conflict.type}`)
  lines.push(`**Severity**: ${conflict.severity}`)
  lines.push(`**Description**: ${conflict.description}`)
  lines.push(``)

  lines.push(`**Involved Agents**:`)
  const uniqueAgents = new Set(conflict.changes.map(c => c.agentId))
  for (const agentId of uniqueAgents) {
    lines.push(`  - ${agentId}`)
  }
  lines.push(``)

  lines.push(`**Resolution Strategy**: ${conflict.resolution.strategy}`)
  if (conflict.resolution.notes) {
    lines.push(`**Notes**: ${conflict.resolution.notes}`)
  }

  return lines.join("\n")
}
