import type { LLMConfig } from "../llm.js"
import type { Agent } from "../agent.js"
import type { AgentConfig } from "../agent.js"

// ============================================================================
// AgentPool - Agent 实例池
// ============================================================================

/**
 * AgentPool - Agent 实例池
 *
 * 职责：
 * - 复用Agent实例，降低冷启动成本
 * - 隔离不同任务的Agent内存
 * - 支持实例轮换和销毁
 */
export class AgentPool {
  private config: AgentPoolConfig
  private availableAgents: AgentInstance[] = []
  private inUseAgents: Map<string, AgentInstance> = new Map()
  private createAgentFn: (config: AgentConfig) => Agent

  constructor(config: AgentPoolConfig, createAgentFn: (config: AgentConfig) => Agent) {
    this.config = config
    this.createAgentFn = createAgentFn

    // 预热实例
    this.warmup()
  }

  /**
   * 预热Agent实例
   */
  private warmup(): void {
    const count = this.config.warmupCount || 2
    for (let i = 0; i < count; i++) {
      const instance = this.createInstance(`pool-${i}`)
      this.availableAgents.push(instance)
    }
  }

  /**
   * 创建新实例
   */
  private createInstance(instanceId: string): AgentInstance {
    const agent = this.createAgentFn({
      cwd: this.config.cwd,
      dbPath: this.config.dbPath,
      llm: this.config.llm,
      strategy: this.config.strategy,
    })

    return {
      id: instanceId,
      agent,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      useCount: 0,
      status: "available",
    }
  }

  /**
   * 获取Agent实例
   */
  async acquire(taskId: string): Promise<Agent> {
    // 尝试从可用池获取
    if (this.availableAgents.length > 0) {
      const instance = this.availableAgents.pop()!
      instance.status = "in-use"
      instance.useCount++
      instance.lastUsedAt = Date.now()
      this.inUseAgents.set(taskId, instance)
      return instance.agent
    }

    // 检查是否允许创建新实例
    if (this.inUseAgents.size < (this.config.maxPoolSize || 5)) {
      const newInstance = this.createInstance(`pool-${Date.now()}`)
      newInstance.status = "in-use"
      newInstance.useCount = 1
      this.inUseAgents.set(taskId, newInstance)
      return newInstance.agent
    }

    // 等待可用实例
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(this.acquire(taskId))
      }, this.config.waitTimeout || 1000)
    })
  }

  /**
   * 释放Agent实例
   */
  release(taskId: string): void {
    const instance = this.inUseAgents.get(taskId)
    if (!instance) return

    // 检查是否需要销毁（使用次数过多）
    if (instance.useCount > (this.config.maxUsesBeforeRecycle || 10)) {
      this.destroyInstance(instance.id)
      return
    }

    // 检查上下文是否过大
    // 简化处理：直接回收

    instance.status = "available"
    instance.lastUsedAt = Date.now()
    this.availableAgents.push(instance)
    this.inUseAgents.delete(taskId)
  }

  /**
   * 销毁实例
   */
  private destroyInstance(instanceId: string): void {
    const index = this.availableAgents.findIndex((a) => a.id === instanceId)
    if (index >= 0) {
      this.availableAgents.splice(index, 1)
    }
  }

  /**
   * 强制轮换实例
   */
  async rotate(taskId: string): Promise<Agent> {
    this.release(taskId)
    return this.acquire(taskId)
  }

  /**
   * 获取实例状态
   */
  getStatus(): AgentPoolStatus {
    return {
      available: this.availableAgents.length,
      inUse: this.inUseAgents.size,
      maxPoolSize: this.config.maxPoolSize || 5,
    }
  }

  /**
   * 清理长时间未使用的实例
   */
  cleanup(): void {
    const now = Date.now()
    const threshold = this.config.idleTimeout || 300000 // 5分钟

    this.availableAgents = this.availableAgents.filter((instance) => {
      if (now - instance.lastUsedAt > threshold) {
        this.destroyInstance(instance.id)
        return false
      }
      return true
    })
  }

  /**
   * 销毁所有实例
   */
  destroy(): void {
    this.availableAgents.forEach((instance) => {
      this.destroyInstance(instance.id)
    })
    this.inUseAgents.forEach((instance) => {
      this.destroyInstance(instance.id)
    })
    this.availableAgents = []
    this.inUseAgents.clear()
  }
}

// ============================================================================
// 类型定义
// ============================================================================

export interface AgentPoolConfig {
  cwd: string
  dbPath: string
  llm: LLMConfig
  strategy?: "auto" | "fc" | "cot"
  warmupCount?: number
  maxPoolSize?: number
  maxUsesBeforeRecycle?: number
  idleTimeout?: number
  waitTimeout?: number
}

export interface AgentInstance {
  id: string
  agent: Agent
  createdAt: number
  lastUsedAt: number
  useCount: number
  status: "available" | "in-use" | "recycling"
}

export interface AgentPoolStatus {
  available: number
  inUse: number
  maxPoolSize: number
}
