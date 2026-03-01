/**
 * Checkpoint Store - 保存检查点用于回滚
 *
 * 设计原则
 * 1. 不保存全量文件快照
采用"基线 + 巻加补丁"格式
 * 2. 按需保留检查点(默认最近 N 个)
 * 3. 合并策略: 三方合并失败转人工仲裁
 */

import type { WorkArtifact } from "./contracts.js"

/**
 * 检查点定义
 */
export interface Checkpoint {
  /** 检查点 ID */
  id: string
  /** 创建时间 */
  timestamp: number
  /** 描述 */
  description: string
  /** 壴量点基准(可选) */
  baselineRef?: string
  /** 添加补丁列表 */
  patchRefs: string[]
  /** 产物引用 */
  artifactRefs: string[]
  /** 黑板快照引用 */
  blackboardSnapshotRef?: string
  /** 检查点状态 */
  status: "pending" | "completed" | "failed"
  /** 风险等级 */
  riskLevel?: "low" | "medium" | "high"
}

/**
 * 检查点管理器
 */
export class CheckpointStore {
  private checkpoints: Map<string, Checkpoint> = new Map()
  private maxCheckpoints: number
  private currentBaseline: string | null
  private idCounter: number = 0

  constructor(maxCheckpoints: number = 20) {
    this.maxCheckpoints = maxCheckpoints
    this.checkpoints = new Map()
    this.currentBaseline = null
  }

  /**
   * 创建检查点
   */
  createCheckpoint(
    description: string,
    baselineRef?: string,
    patchRefs: string[] = [],
    artifactRefs: string[] = [],
    blackboardSnapshotRef?: string
  ): Checkpoint {
    // 使用时间戳 + 计数器确保唯一性
    const timestamp = Date.now()
    const id = `checkpoint-${timestamp}-${++this.idCounter}`
    const checkpoint: Checkpoint = {
      id,
      timestamp,
      description,
      baselineRef,
      patchRefs,
      artifactRefs,
      blackboardSnapshotRef,
      status: "pending",
      riskLevel: "low",
    }

    this.checkpoints.set(id, checkpoint)
    return checkpoint
  }

  /**
   * 获取检查点
   */
  getCheckpoint(id: string): Checkpoint | undefined {
    return this.checkpoints.get(id)
  }

  /**
   * 获取最近的 N 个检查点
   */
  getRecentCheckpoints(n: number): Checkpoint[] {
    const sorted = Array.from(this.checkpoints.values()).sort(
      (a, b) => b.timestamp - a.timestamp
    )
    return sorted.slice(0, n)
  }

  /**
   * 回滚到检查点
   */
  async rollback(checkpointId: string): Promise<boolean> {
    const checkpoint = this.checkpoints.get(checkpointId)
    if (!checkpoint) {
      return false
    }

    // 标记为已完成
    checkpoint.status = "completed"
    return true
  }

  /**
   * 获取当前基线
   */
  getBaseline(): string | null {
    return this.currentBaseline
  }

  /**
   * 设置当前基线
   */
  setBaseline(ref: string): void {
    this.currentBaseline = ref
  }

  /**
   * 检查是否需要清理
   */
  needsCleanup(): boolean {
    return this.checkpoints.size >= this.maxCheckpoints
  }

  /**
   * 清理旧检查点
   */
  cleanup(): void {
    this.checkpoints.clear()
    this.currentBaseline = null
    this.idCounter = 0
  }
}
