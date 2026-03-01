import { EventEmitter } from "events"
import type { BudgetConfig } from "./types.js"

// ============================================================================
// PricingTable - 动态价格表
// ============================================================================

/**
 * 模型价格表（单位：每百万 token）
 */
export interface PricingTable {
  [model: string]: {
    inputPer1M: number
    outputPer1M: number
    updatedAt: number
  }
}

// 默认价格表（2024年参考价）
export const DEFAULT_PRICING: PricingTable = {
  "claude-opus-4-20250514": { inputPer1M: 15, outputPer1M: 75, updatedAt: Date.now() },
  "claude-sonnet-4-20250514": { inputPer1M: 3, outputPer1M: 15, updatedAt: Date.now() },
  "claude-haiku-4-20250514": { inputPer1M: 0.25, outputPer1M: 1.25, updatedAt: Date.now() },
  "gpt-4o": { inputPer1M: 5, outputPer1M: 15, updatedAt: Date.now() },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6, updatedAt: Date.now() },
  "miniMax-M2.1": { inputPer1M: 0.1, outputPer1M: 0.4, updatedAt: Date.now() },
}

// ============================================================================
// CostController - 成本控制
// ============================================================================

/**
 * 成本控制器
 *
 * 职责：
 * - 追踪 token 使用
 * - 计算成本
 * - 预算触达时触发降级策略
 */
export class CostController extends EventEmitter {
  private budget: BudgetConfig | undefined
  private pricing: PricingTable

  // 实际使用统计
  private inputTokens = 0
  private outputTokens = 0
  private callCount = 0

  // 降级策略触发状态
  private downgradeLevel: "normal" | "reduced-concurrency" | "smaller-model" | "stopped" = "normal"

  constructor(budget?: BudgetConfig, pricing: PricingTable = DEFAULT_PRICING) {
    super()
    this.budget = budget
    this.pricing = pricing
  }

  // ========================================================================
  // 成本记录
  // ========================================================================

  /**
   * 记录模型调用
   */
  recordCall(model: string, inputTokens: number, outputTokens: number): void {
    this.inputTokens += inputTokens
    this.outputTokens += outputTokens
    this.callCount++

    // 触发检查
    this.checkBudget()
  }

  /**
   * 获取当前使用量（token）
   */
  getUsage(): { input: number; output: number; total: number } {
    return {
      input: this.inputTokens,
      output: this.outputTokens,
      total: this.inputTokens + this.outputTokens,
    }
  }

  /**
   * 获取当前成本（USD）
   */
  getCost(): number {
    let totalCost = 0

    // 遍历已知的模型，按比例计算
    // 这里简化处理，实际应该记录每次调用的模型
    const avgCostPerToken = 0.00001 // 简化估算

    totalCost = (this.inputTokens + this.outputTokens) * avgCostPerToken

    return totalCost
  }

  /**
   * 计算单次调用的成本
   */
  calculateCallCost(model: string, inputTokens: number, outputTokens: number): number {
    const modelPricing = this.pricing[model]
    if (!modelPricing) {
      // 未知模型，使用默认估算
      return ((inputTokens + outputTokens) / 1_000_000) * 0.5
    }

    const inputCost = (inputTokens / 1_000_000) * modelPricing.inputPer1M
    const outputCost = (outputTokens / 1_000_000) * modelPricing.outputPer1M

    return inputCost + outputCost
  }

  // ========================================================================
  // 预算检查
  // ========================================================================

  /**
   * 检查预算
   */
  private checkBudget(): void {
    if (!this.budget) return

    const usage = this.getUsage()
    const cost = this.getCost()

    // 检查 token 预算
    if (this.budget.maxTokens && usage.total >= this.budget.maxTokens * 0.9) {
      this.emit("budget-warning", {
        type: "tokens",
        used: usage.total,
        limit: this.budget.maxTokens,
        percentage: (usage.total / this.budget.maxTokens) * 100,
      })
    }

    // 检查成本预算
    if (this.budget.maxCostUsd && cost >= this.budget.maxCostUsd * 0.9) {
      this.emit("budget-warning", {
        type: "cost",
        used: cost,
        limit: this.budget.maxCostUsd,
        percentage: (cost / this.budget.maxCostUsd) * 100,
      })
    }

    // 超预算
    if (this.budget.maxTokens && usage.total >= this.budget.maxTokens) {
      this.triggerDowngrade("stopped")
      this.emit("budget-exceeded", { type: "tokens", used: usage.total, limit: this.budget.maxTokens })
    }

    if (this.budget.maxCostUsd && cost >= this.budget.maxCostUsd) {
      this.triggerDowngrade("stopped")
      this.emit("budget-exceeded", { type: "cost", used: cost, limit: this.budget.maxCostUsd })
    }
  }

  /**
   * 触发降级策略
   */
  private triggerDowngrade(level: typeof this.downgradeLevel): void {
    if (level === this.downgradeLevel) return

    this.downgradeLevel = level

    switch (level) {
      case "reduced-concurrency":
        this.emit("downgrade", { level: "reduced-concurrency", reason: "budget_warning" })
        break
      case "smaller-model":
        this.emit("downgrade", { level: "smaller-model", reason: "budget_low" })
        break
      case "stopped":
        this.emit("downgrade", { level: "stopped", reason: "budget_exceeded" })
        break
    }
  }

  /**
   * 获取降级级别
   */
  getDowngradeLevel(): typeof this.downgradeLevel {
    return this.downgradeLevel
  }

  /**
   * 是否允许新任务
   */
  canStartNewTask(): boolean {
    if (!this.budget) return true

    const usage = this.getUsage()
    const cost = this.getCost()

    // 预留 10% 缓冲
    const tokenLimit = this.budget.maxTokens ? this.budget.maxTokens * 0.9 : Infinity
    const costLimit = this.budget.maxCostUsd ? this.budget.maxCostUsd * 0.9 : Infinity

    return usage.total < tokenLimit && cost < costLimit && this.downgradeLevel !== "stopped"
  }

  /**
   * 获取最大并发数
   */
  getMaxParallelAgents(): number {
    if (!this.budget?.maxParallelAgents) return 2

    // 根据降级级别调整
    switch (this.downgradeLevel) {
      case "reduced-concurrency":
        return Math.max(1, Math.floor(this.budget.maxParallelAgents / 2))
      case "smaller-model":
        return Math.max(1, Math.floor(this.budget.maxParallelAgents / 2))
      case "stopped":
        return 0
      default:
        return this.budget.maxParallelAgents
    }
  }

  // ========================================================================
  // 重置
  // ========================================================================

  /**
   * 重置统计
   */
  reset(): void {
    this.inputTokens = 0
    this.outputTokens = 0
    this.callCount = 0
    this.downgradeLevel = "normal"
  }

  /**
   * 更新预算
   */
  setBudget(budget: BudgetConfig): void {
    this.budget = budget
  }

  /**
   * 更新价格表
   */
  updatePricing(pricing: PricingTable): void {
    this.pricing = { ...this.pricing, ...pricing }
  }

  /**
   * 获取统计摘要
   */
  getStats(): {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    callCount: number
    estimatedCost: number
    budget: BudgetConfig | undefined
    downgradeLevel: string
  } {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: this.inputTokens + this.outputTokens,
      callCount: this.callCount,
      estimatedCost: this.getCost(),
      budget: this.budget,
      downgradeLevel: this.downgradeLevel,
    }
  }
}
