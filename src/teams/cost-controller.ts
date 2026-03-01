/**
 * CostController - 成本控制器
 *
 * 职责：
 * - 实时追踪token和成本消耗
 * - 按Agent/Role/Task维度聚合
 * - 预算控制和降级策略
 * - 动态价格表支持
 */

import type { CostRecord, CostSummary, AgentRole } from "./types.js"

/**
 * 价格表
 */
export interface PricingTable {
  [model: string]: {
    inputPer1M: number   // 每百万输入token的价格（USD）
    outputPer1M: number  // 每百万输出token的价格（USD）
    updatedAt: number
  }
}

/**
 * 默认价格表（2026年3月）
 */
const DEFAULT_PRICING: PricingTable = {
  "claude-opus-4": {
    inputPer1M: 15.0,
    outputPer1M: 75.0,
    updatedAt: Date.now(),
  },
  "claude-sonnet-4": {
    inputPer1M: 3.0,
    outputPer1M: 15.0,
    updatedAt: Date.now(),
  },
  "claude-haiku-4": {
    inputPer1M: 0.25,
    outputPer1M: 1.25,
    updatedAt: Date.now(),
  },
}

/**
 * 降级策略
 */
export type DegradationAction =
  | { type: "reduce-concurrency"; from: number; to: number }
  | { type: "switch-model"; from: string; to: string }
  | { type: "stop-new-tasks" }

/**
 * 成本控制器
 */
export class CostController {
  private records: CostRecord[] = []
  private pricing: PricingTable
  private maxTokens?: number
  private maxCostUsd?: number
  private maxParallelAgents?: number

  constructor(options?: {
    maxTokens?: number
    maxCostUsd?: number
    maxParallelAgents?: number
    customPricing?: PricingTable
  }) {
    this.maxTokens = options?.maxTokens
    this.maxCostUsd = options?.maxCostUsd
    this.maxParallelAgents = options?.maxParallelAgents
    this.pricing = options?.customPricing || DEFAULT_PRICING
  }

  /**
   * 记录一次模型调用
   */
  record(record: CostRecord): void {
    this.records.push(record)
  }

  /**
   * 计算成本
   */
  private calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const price = this.pricing[model]
    if (!price) {
      console.warn(`No pricing found for model: ${model}, using default`)
      return 0
    }

    const inputCost = (inputTokens / 1_000_000) * price.inputPer1M
    const outputCost = (outputTokens / 1_000_000) * price.outputPer1M
    return inputCost + outputCost
  }

  /**
   * 获取成本汇总
   */
  getSummary(): CostSummary {
    const byAgent = new Map<string, number>()
    const byRole = new Map<AgentRole, number>()
    const byTask = new Map<string, number>()
    let total = 0

    for (const record of this.records) {
      const cost = record.costUsd

      // 按Agent聚合
      byAgent.set(record.agentId, (byAgent.get(record.agentId) || 0) + cost)

      // 按Role聚合
      byRole.set(record.agentRole, (byRole.get(record.agentRole) || 0) + cost)

      // 按Task聚合
      if (record.taskId) {
        byTask.set(record.taskId, (byTask.get(record.taskId) || 0) + cost)
      }

      total += cost
    }

    return { total, byAgent, byRole, byTask }
  }

  /**
   * 获取总token消耗
   */
  getTotalTokens(): number {
    return this.records.reduce(
      (sum, record) => sum + record.inputTokens + record.outputTokens,
      0
    )
  }

  /**
   * 检查是否超预算
   */
  checkBudget(): {
    exceeded: boolean
    reason?: "tokens" | "cost"
    current: number
    limit: number
  } {
    // 检查token限制
    if (this.maxTokens) {
      const totalTokens = this.getTotalTokens()
      if (totalTokens >= this.maxTokens) {
        return {
          exceeded: true,
          reason: "tokens",
          current: totalTokens,
          limit: this.maxTokens,
        }
      }
    }

    // 检查成本限制
    if (this.maxCostUsd) {
      const summary = this.getSummary()
      if (summary.total >= this.maxCostUsd) {
        return {
          exceeded: true,
          reason: "cost",
          current: summary.total,
          limit: this.maxCostUsd,
        }
      }
    }

    return { exceeded: false, current: 0, limit: 0 }
  }

  /**
   * 获取预算使用率
   */
  getBudgetUsage(): {
    tokenUsage: number  // 0-1
    costUsage: number   // 0-1
  } {
    const tokenUsage = this.maxTokens
      ? this.getTotalTokens() / this.maxTokens
      : 0

    const costUsage = this.maxCostUsd
      ? this.getSummary().total / this.maxCostUsd
      : 0

    return { tokenUsage, costUsage }
  }

  /**
   * 建议降级策略
   */
  suggestDegradation(currentConcurrency: number): DegradationAction | null {
    const usage = this.getBudgetUsage()
    const maxUsage = Math.max(usage.tokenUsage, usage.costUsage)

    // 80-90%: 降低并发
    if (maxUsage >= 0.8 && maxUsage < 0.9) {
      const newConcurrency = Math.max(1, Math.floor(currentConcurrency * 0.7))
      return {
        type: "reduce-concurrency",
        from: currentConcurrency,
        to: newConcurrency,
      }
    }

    // 90-95%: 切换到更小的模型
    if (maxUsage >= 0.9 && maxUsage < 0.95) {
      // 简化：建议从Sonnet切到Haiku
      return {
        type: "switch-model",
        from: "claude-sonnet-4",
        to: "claude-haiku-4",
      }
    }

    // 95%+: 停止新任务
    if (maxUsage >= 0.95) {
      return {
        type: "stop-new-tasks",
      }
    }

    return null
  }

  /**
   * 更新价格表
   */
  updatePricing(pricing: Partial<PricingTable>): void {
    Object.assign(this.pricing, pricing)
  }

  /**
   * 导出记录（用于审计）
   */
  exportRecords(): CostRecord[] {
    return [...this.records]
  }

  /**
   * 清空记录
   */
  clear(): void {
    this.records = []
  }
}
