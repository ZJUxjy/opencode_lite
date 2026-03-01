/**
 * Agent Pool - Agent Instance Reuse Management
 *
 * Manages the lifecycle of agent instances for cost optimization and stability.
 *
 * Strategies:
 * 1. Worker/Reviewer reuse long-lived instances (preserve context, reduce cold start costs)
 * 2. Leader/Planner can use short-lived instances (reduce context pollution)
 * 3. Competitive mode uses isolated instances per solution, no shared mutable memory
 *
 * Rotation conditions:
 * 1. Context compressed but still exceeds threshold -> rotate to new instance
 * 2. Consecutive tool errors exceed threshold -> destroy and recreate instance
 * 3. Budget tight -> prioritize reusing low-cost instances
 */

import type { AgentRole } from "../core/types.js"

// ============================================================================
// Types
// ============================================================================

export interface AgentInstance {
  /** Unique instance ID */
  id: string
  /** Agent role */
  role: AgentRole
  /** Model being used */
  model: string
  /** Instance creation time */
  createdAt: number
  /** Last used time */
  lastUsedAt: number
  /** Cumulative usage count */
  useCount: number
  /** Cumulative token consumption */
  tokensUsed: { input: number; output: number }
  /** Instance status */
  status: "idle" | "busy" | "error" | "retired"
  /** Consecutive error count */
  consecutiveErrors: number
  /** Context size (character estimate) */
  contextSize: number
  /** Instance type */
  instanceType: "long-lived" | "short-lived" | "isolated"
}

export interface AgentPoolConfig {
  /** Maximum number of instances */
  maxInstances: number
  /** Maximum lifetime for long-lived instances (milliseconds) */
  maxLifetimeMs: number
  /** Maximum usage count per instance */
  maxUseCount: number
  /** Context size threshold (characters) */
  contextThreshold: number
  /** Consecutive error threshold */
  maxConsecutiveErrors: number
  /** Instance idle timeout (milliseconds) */
  idleTimeoutMs: number
  /** Whether to prefer cheaper instances */
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
      maxLifetimeMs: 30 * 60 * 1000, // 30 minutes
      maxUseCount: 50,
      contextThreshold: 100000, // 100k characters
      maxConsecutiveErrors: 3,
      idleTimeoutMs: 5 * 60 * 1000, // 5 minutes
      preferCheaperInstance: true,
      ...config,
    }
  }

  /**
   * Acquire or create an agent instance
   */
  acquire(request: InstanceRequest): AgentInstance {
    // Determine default instance type based on role
    const instanceType = request.preferredType ?? this.getDefaultInstanceType(request.role)

    // For isolated instances, always create new
    if (instanceType === "isolated") {
      return this.createInstance(request, instanceType)
    }

    // Try to find a reusable instance
    const reusable = this.findReusableInstance(request, instanceType)
    if (reusable) {
      reusable.status = "busy"
      reusable.lastUsedAt = Date.now()
      reusable.useCount++
      return reusable
    }

    // Create new instance
    return this.createInstance(request, instanceType)
  }

  /**
   * Release instance (done using)
   */
  release(instanceId: string): void {
    const instance = this.instances.get(instanceId)
    if (!instance) return

    // Check if retirement is needed
    if (this.shouldRetire(instance)) {
      this.retireInstance(instanceId)
      return
    }

    instance.status = "idle"
    instance.lastUsedAt = Date.now()
  }

  /**
   * Record instance usage statistics
   */
  recordUsage(
    instanceId: string,
    tokens: { input: number; output: number },
    contextSize?: number
  ): void {
    const instance = this.instances.get(instanceId)
    if (!instance) return

    instance.tokensUsed.input += tokens.input
    instance.tokensUsed.output += tokens.output
    if (contextSize !== undefined) {
      instance.contextSize = contextSize
    }
  }

  /**
   * Record error
   */
  recordError(instanceId: string): void {
    const instance = this.instances.get(instanceId)
    if (!instance) return

    instance.consecutiveErrors++

    if (instance.consecutiveErrors >= this.config.maxConsecutiveErrors) {
      instance.status = "error"
      // Mark for rebuild
    }
  }

  /**
   * Record success
   */
  recordSuccess(instanceId: string): void {
    const instance = this.instances.get(instanceId)
    if (!instance) return

    instance.consecutiveErrors = 0
  }

  /**
   * Get instance statistics
   */
  getStats(): {
    totalInstances: number
    idleInstances: number
    busyInstances: number
    errorInstances: number
    retiredInstances: number
    totalTokensUsed: { input: number; output: number }
  } {
    let idleCount = 0
    let busyCount = 0
    let errorCount = 0
    let retiredCount = 0
    let totalInput = 0
    let totalOutput = 0

    for (const instance of this.instances.values()) {
      if (instance.status === "idle") idleCount++
      if (instance.status === "busy") busyCount++
      if (instance.status === "error") errorCount++
      if (instance.status === "retired") retiredCount++
      totalInput += instance.tokensUsed.input
      totalOutput += instance.tokensUsed.output
    }

    return {
      totalInstances: this.instances.size,
      idleInstances: idleCount,
      busyInstances: busyCount,
      errorInstances: errorCount,
      retiredInstances: retiredCount,
      totalTokensUsed: { input: totalInput, output: totalOutput },
    }
  }

  /**
   * Clean up expired instances
   */
  cleanup(): void {
    const now = Date.now()
    const toDelete: string[] = []

    for (const [id, instance] of this.instances.entries()) {
      // Clean up retired instances
      if (instance.status === "retired") {
        toDelete.push(id)
        continue
      }

      // Clean up idle instances past timeout
      if (instance.status === "idle" && now - instance.lastUsedAt > this.config.idleTimeoutMs) {
        toDelete.push(id)
        continue
      }

      // Clean up instances past max lifetime
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
   * Get all instances
   */
  getAllInstances(): AgentInstance[] {
    return Array.from(this.instances.values())
  }

  /**
   * Get instance by ID
   */
  getInstance(instanceId: string): AgentInstance | undefined {
    return this.instances.get(instanceId)
  }

  /**
   * Destroy all instances
   */
  destroyAll(): void {
    this.instances.clear()
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private getDefaultInstanceType(
    role: AgentRole
  ): "long-lived" | "short-lived" | "isolated" {
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
      // Basic matching conditions
      if (instance.status !== "idle") continue
      if (instance.role !== request.role) continue
      if (instance.instanceType !== instanceType) continue
      if (instance.model !== request.model) continue

      // Health check
      if (instance.consecutiveErrors >= this.config.maxConsecutiveErrors) continue
      if (instance.useCount >= this.config.maxUseCount) continue

      // Context size check
      if (instance.contextSize > this.config.contextThreshold) continue

      candidates.push(instance)
    }

    if (candidates.length === 0) return null

    // Sorting strategy
    if (this.config.preferCheaperInstance && request.budgetTier) {
      // When budget is tight, prefer existing instances (lower cost)
      candidates.sort((a, b) => a.useCount - b.useCount)
    } else {
      // Default: prefer most recently used (cache friendly)
      candidates.sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    }

    return candidates[0]
  }

  private createInstance(
    request: InstanceRequest,
    instanceType: "long-lived" | "short-lived" | "isolated"
  ): AgentInstance {
    // Check if limit reached
    if (this.instances.size >= this.config.maxInstances) {
      // Try to clean up oldest idle instance
      const cleaned = this.cleanupOldestIdle()
      if (!cleaned) {
        throw new Error(
          `Agent pool reached maximum instances limit (${this.config.maxInstances})`
        )
      }
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
    // Usage count exceeded
    if (instance.useCount >= this.config.maxUseCount) return true

    // Too many consecutive errors
    if (instance.consecutiveErrors >= this.config.maxConsecutiveErrors) return true

    // Context too large
    if (instance.contextSize > this.config.contextThreshold) return true

    // Timeout
    if (Date.now() - instance.createdAt > this.config.maxLifetimeMs) return true

    return false
  }

  private retireInstance(instanceId: string): void {
    const instance = this.instances.get(instanceId)
    if (instance) {
      instance.status = "retired"
    }
  }

  private cleanupOldestIdle(): boolean {
    let oldest: AgentInstance | null = null

    for (const instance of this.instances.values()) {
      if (instance.status !== "idle") continue
      if (!oldest || instance.lastUsedAt < oldest.lastUsedAt) {
        oldest = instance
      }
    }

    if (oldest) {
      this.instances.delete(oldest.id)
      return true
    }

    return false
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createAgentPool(config?: Partial<AgentPoolConfig>): AgentPool {
  return new AgentPool(config)
}
