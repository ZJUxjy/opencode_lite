/**
 * Agent Pool - Agent 实例复用管理
 *
 * 管理 Agent 实例的生命周期，实现成本优化和稳定性保障。
 *
 * 策略：
 * 1. Worker/Reviewer 复用长期实例（保留上下文，降低冷启动成本）
 * 2. Leader/Planner 可短会话实例（降低上下文污染）
 * 3. competitive 模式每个方案使用隔离实例，禁止共享可变内存
 *
 * 切换条件：
 * 1. 上下文压缩后仍超阈值 -> 轮换新实例
 * 2. 连续工具异常超过阈值 -> 销毁并重建实例
 * 3. 预算紧张 -> 优先复用低成本实例
 */

import type { AgentRole } from "./types.js"

// ============================================================================
// Types
// ============================================================================

export interface AgentInstance {
  /** 实例唯一ID */
  id: string
  /** Agent 角色 */
  role: AgentRole
  /** 使用的模型 */
  model: string
  /** 实例创建时间 */
  createdAt: number
  /** 最后使用时间 */
  lastUsedAt: number
  /** 累计使用次数 */
  useCount: number
  /** 累计 Token 消耗 */
  tokensUsed: { input: number; output: number }
  /** 实例状态 */
  status: "idle" | "busy" | "error" | "retired"
  /** 连续错误次数 */
  consecutiveErrors: number
  /** 上下文大小（字符数估算） */
  contextSize: number
  /** 实例类型 */
  instanceType: "long-lived" | "short-lived" | "isolated"
}

export interface AgentPoolConfig {
  /** 最大实例数 */
  maxInstances: number
  /** 长期实例最大存活时间（毫秒） */
  maxLifetimeMs: number
  /** 实例最大使用次数 */
  maxUseCount: number
  /** 上下文大小阈值（字符数） */
  contextThreshold: number
  /** 连续错误阈值 */
  maxConsecutiveErrors: number
  /** 实例空闲超时（毫秒） */
  idleTimeoutMs: number
  /** 是否优先复用低成本实例 */
  preferCheaperInstance: boolean
}

export interface InstanceRequest {
  role: AgentRole
  model: string
  preferredType?: "long-lived" | "short-lived" | "isolated"
  budgetTier?: "high" | "medium" | "low"
}

// ============================================================================
// Agent Pool
// ============================================================================

export class AgentPool {
  private instances: Map<string, AgentInstance> = new Map()
  private config: AgentPoolConfig
  private instanceCounter = 0

  constructor(config: Partial<AgentPoolConfig> = {}) {
    this.config = {
      maxInstances: 10,
      maxLifetimeMs: 30 * 60 * 1000, // 30 分钟
      maxUseCount: 50,
      contextThreshold: 100000, // 10万字符
      maxConsecutiveErrors: 3,
      idleTimeoutMs: 5 * 60 * 1000, // 5 分钟
      preferCheaperInstance: true,
      ...config,
    }
  }

  /**
   * 获取或创建 Agent 实例
   */
  acquire(request: InstanceRequest): AgentInstance {
    // 根据角色确定默认实例类型
    const instanceType = request.preferredType ?? this.getDefaultInstanceType(request.role)

    // 如果是隔离实例类型，总是创建新的
    if (instanceType === "isolated") {
      return this.createInstance(request, instanceType)
    }

    // 尝试找到可复用的实例
    const reusable = this.findReusableInstance(request, instanceType)
    if (reusable) {
      reusable.status = "busy"
      reusable.lastUsedAt = Date.now()
      reusable.useCount++
      return reusable
    }

    // 创建新实例
    return this.createInstance(request, instanceType)
  }

  /**
   * 释放实例（使用完毕）
   */
  release(instanceId: string): void {
    const instance = this.instances.get(instanceId)
    if (!instance) return

    // 检查是否需要退役
    if (this.shouldRetire(instance)) {
      this.retireInstance(instanceId)
      return
    }

    instance.status = "idle"
    instance.lastUsedAt = Date.now()
  }

  /**
   * 记录实例使用统计
   */
  recordUsage(instanceId: string, tokens: { input: number; output: number }, contextSize: number): void {
    const instance = this.instances.get(instanceId)
    if (!instance) return

    instance.tokensUsed.input += tokens.input
    instance.tokensUsed.output += tokens.output
    instance.contextSize = contextSize
  }

  /**
   * 记录错误
   */
  recordError(instanceId: string): void {
    const instance = this.instances.get(instanceId)
    if (!instance) return

    instance.consecutiveErrors++

    if (instance.consecutiveErrors >= this.config.maxConsecutiveErrors) {
      instance.status = "error"
      // 标记为需要重建
    }
  }

  /**
   * 记录成功
   */
  recordSuccess(instanceId: string): void {
    const instance = this.instances.get(instanceId)
    if (!instance) return

    instance.consecutiveErrors = 0
  }

  /**
   * 获取实例统计
   */
  getStats(): {
    totalInstances: number
    idleInstances: number
    busyInstances: number
    errorInstances: number
    totalTokensUsed: { input: number; output: number }
  } {
    let idleCount = 0
    let busyCount = 0
    let errorCount = 0
    let totalInput = 0
    let totalOutput = 0

    for (const instance of this.instances.values()) {
      if (instance.status === "idle") idleCount++
      if (instance.status === "busy") busyCount++
      if (instance.status === "error") errorCount++
      totalInput += instance.tokensUsed.input
      totalOutput += instance.tokensUsed.output
    }

    return {
      totalInstances: this.instances.size,
      idleInstances: idleCount,
      busyInstances: busyCount,
      errorInstances: errorCount,
      totalTokensUsed: { input: totalInput, output: totalOutput },
    }
  }

  /**
   * 清理过期实例
   */
  cleanup(): void {
    const now = Date.now()
    const toDelete: string[] = []

    for (const [id, instance] of this.instances.entries()) {
      // 清理退役实例
      if (instance.status === "retired") {
        toDelete.push(id)
        continue
      }

      // 清理超时空闲实例
      if (instance.status === "idle" && now - instance.lastUsedAt > this.config.idleTimeoutMs) {
        toDelete.push(id)
        continue
      }

      // 清理超寿实例
      if (now - instance.createdAt > this.config.maxLifetimeMs) {
        toDelete.push(id)
        continue
      }
    }

    for (const id of toDelete) {
      this.instances.delete(id)
    }
  }

  /**
   * 获取所有实例
   */
  getAllInstances(): AgentInstance[] {
    return Array.from(this.instances.values())
  }

  /**
   * 销毁所有实例
   */
  destroyAll(): void {
    this.instances.clear()
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private getDefaultInstanceType(role: AgentRole): "long-lived" | "short-lived" | "isolated" {
    switch (role) {
      case "worker":
      case "reviewer":
        return "long-lived"
      case "leader":
      case "planner":
        return "short-lived"
      case "member":
      case "speaker":
        return "isolated"
      default:
        return "short-lived"
    }
  }

  private findReusableInstance(
    request: InstanceRequest,
    instanceType: "long-lived" | "short-lived"
  ): AgentInstance | null {
    const candidates: AgentInstance[] = []

    for (const instance of this.instances.values()) {
      // 基本匹配条件
      if (instance.status !== "idle") continue
      if (instance.role !== request.role) continue
      if (instance.instanceType !== instanceType) continue
      if (instance.model !== request.model) continue

      // 健康检查
      if (instance.consecutiveErrors >= this.config.maxConsecutiveErrors) continue
      if (instance.useCount >= this.config.maxUseCount) continue

      // 上下文大小检查
      if (instance.contextSize > this.config.contextThreshold) continue

      candidates.push(instance)
    }

    if (candidates.length === 0) return null

    // 排序策略
    if (this.config.preferCheaperInstance && request.budgetTier) {
      // 预算紧张时优先使用已存在的实例（成本低）
      candidates.sort((a, b) => a.useCount - b.useCount)
    } else {
      // 默认优先使用最近使用的（缓存友好）
      candidates.sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    }

    return candidates[0]
  }

  private createInstance(request: InstanceRequest, instanceType: "long-lived" | "short-lived" | "isolated"): AgentInstance {
    // 检查是否达到上限
    if (this.instances.size >= this.config.maxInstances) {
      // 尝试清理一个最老的空闲实例
      this.cleanupOldestIdle()
    }

    const instance: AgentInstance = {
      id: `agent-${++this.instanceCounter}-${Date.now()}`,
      role: request.role,
      model: request.model,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      useCount: 1,
      tokensUsed: { input: 0, output: 0 },
      status: "busy",
      consecutiveErrors: 0,
      contextSize: 0,
      instanceType,
    }

    this.instances.set(instance.id, instance)
    return instance
  }

  private shouldRetire(instance: AgentInstance): boolean {
    // 使用次数超限
    if (instance.useCount >= this.config.maxUseCount) return true

    // 连续错误过多
    if (instance.consecutiveErrors >= this.config.maxConsecutiveErrors) return true

    // 上下文过大
    if (instance.contextSize > this.config.contextThreshold) return true

    // 超时
    if (Date.now() - instance.createdAt > this.config.maxLifetimeMs) return true

    return false
  }

  private retireInstance(instanceId: string): void {
    const instance = this.instances.get(instanceId)
    if (instance) {
      instance.status = "retired"
    }
  }

  private cleanupOldestIdle(): void {
    let oldest: AgentInstance | null = null

    for (const instance of this.instances.values()) {
      if (instance.status !== "idle") continue
      if (!oldest || instance.lastUsedAt < oldest.lastUsedAt) {
        oldest = instance
      }
    }

    if (oldest) {
      this.instances.delete(oldest.id)
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createAgentPool(config?: Partial<AgentPoolConfig>): AgentPool {
  return new AgentPool(config)
}
