import { randomBytes } from "crypto"
import type {
  Subagent,
  SubagentConfig,
  SubagentManagerConfig,
  SubagentResult,
  SubagentStatus,
  SubagentEvents,
  ParallelExploreConfig,
  ExploreTask,
  AggregatedResult,
} from "./types.js"

/**
 * 子代理管理器
 *
 * 负责：
 * - 创建和管理子代理生命周期
 * - 执行子代理任务
 * - 支持并行执行
 * - 结果聚合
 */
export class SubagentManager {
  private subagents = new Map<string, Subagent>()
  private config: Required<SubagentManagerConfig>
  private events: SubagentEvents = {}

  constructor(config: SubagentManagerConfig = {}) {
    this.config = {
      maxConcurrent: config.maxConcurrent ?? 3,
      defaultTimeout: config.defaultTimeout ?? 60000,
      allowNesting: config.allowNesting ?? true,
      maxNestingDepth: config.maxNestingDepth ?? 3,
    }
  }

  /**
   * 设置事件监听器
   */
  setEvents(events: SubagentEvents): void {
    this.events = events
  }

  /**
   * 创建子代理
   */
  create(config: SubagentConfig): Subagent {
    // 检查嵌套深度
    if (config.parentId) {
      const parent = this.subagents.get(config.parentId)
      if (parent) {
        const depth = this.calculateDepth(parent)
        if (depth >= this.config.maxNestingDepth) {
          throw new Error(
            `Maximum nesting depth (${this.config.maxNestingDepth}) exceeded`
          )
        }
      }
    }

    const subagent: Subagent = {
      id: this.generateId(),
      type: config.type,
      status: "pending",
      prompt: config.prompt,
      createdAt: Date.now(),
      parentId: config.parentId,
      childrenIds: [],
      cwd: config.parentContext?.cwd ?? process.cwd(),
      messages: config.parentContext?.messages ?? [],
    }

    this.subagents.set(subagent.id, subagent)

    // 更新父代理的子代理列表
    if (config.parentId) {
      const parent = this.subagents.get(config.parentId)
      if (parent) {
        parent.childrenIds.push(subagent.id)
      }
    }

    this.events.onCreate?.(subagent)
    return subagent
  }

  /**
   * 获取子代理
   */
  get(id: string): Subagent | undefined {
    return this.subagents.get(id)
  }

  /**
   * 获取所有子代理
   */
  getAll(): Subagent[] {
    return Array.from(this.subagents.values())
  }

  /**
   * 获取指定状态的子代理
   */
  getByStatus(status: SubagentStatus): Subagent[] {
    return this.getAll().filter((s) => s.status === status)
  }

  /**
   * 获取子代理的子代理
   */
  getChildren(parentId: string): Subagent[] {
    const parent = this.subagents.get(parentId)
    if (!parent) return []
    return parent.childrenIds
      .map((id) => this.subagents.get(id))
      .filter((s): s is Subagent => s !== undefined)
  }

  /**
   * 更新子代理状态
   */
  updateStatus(id: string, status: SubagentStatus): void {
    const subagent = this.subagents.get(id)
    if (!subagent) return

    subagent.status = status

    if (status === "running" && !subagent.startedAt) {
      subagent.startedAt = Date.now()
    }

    if (status === "completed" || status === "failed" || status === "cancelled") {
      subagent.completedAt = Date.now()
    }
  }

  /**
   * 设置子代理结果
   */
  setResult(id: string, result: string): void {
    const subagent = this.subagents.get(id)
    if (!subagent) return

    subagent.result = result
    subagent.status = "completed"
    subagent.completedAt = Date.now()

    this.events.onComplete?.({
      id,
      status: "completed",
      result,
      duration: subagent.completedAt - (subagent.startedAt ?? subagent.createdAt),
    })
  }

  /**
   * 设置子代理错误
   */
  setError(id: string, error: string): void {
    const subagent = this.subagents.get(id)
    if (!subagent) return

    subagent.error = error
    subagent.status = "failed"
    subagent.completedAt = Date.now()

    this.events.onError?.(id, error)
  }

  /**
   * 取消子代理
   */
  cancel(id: string): void {
    const subagent = this.subagents.get(id)
    if (!subagent) return

    if (subagent.status === "pending" || subagent.status === "running") {
      subagent.status = "cancelled"
      subagent.completedAt = Date.now()

      // 递归取消子代理
      for (const childId of subagent.childrenIds) {
        this.cancel(childId)
      }
    }
  }

  /**
   * 删除子代理
   */
  delete(id: string): boolean {
    const subagent = this.subagents.get(id)
    if (!subagent) return false

    // 递归删除子代理
    for (const childId of [...subagent.childrenIds]) {
      this.delete(childId)
    }

    // 从父代理中移除
    if (subagent.parentId) {
      const parent = this.subagents.get(subagent.parentId)
      if (parent) {
        parent.childrenIds = parent.childrenIds.filter((cid) => cid !== id)
      }
    }

    return this.subagents.delete(id)
  }

  /**
   * 执行子代理（模拟执行，实际需要集成 Agent）
   */
  async execute(id: string): Promise<SubagentResult> {
    const subagent = this.subagents.get(id)
    if (!subagent) {
      return { id, status: "failed", error: "Subagent not found" }
    }

    if (subagent.status === "running") {
      return { id, status: "failed", error: "Subagent already running" }
    }

    this.updateStatus(id, "running")
    this.events.onStart?.(subagent)

    try {
      // TODO: 实际集成 Agent 执行逻辑
      // 这里先返回模拟结果
      const result = await this.simulateExecution(subagent)

      this.setResult(id, result)

      return {
        id,
        status: "completed",
        result,
        duration: Date.now() - (subagent.startedAt ?? subagent.createdAt),
      }
    } catch (error: any) {
      const errorMsg = error.message || String(error)
      this.setError(id, errorMsg)

      return {
        id,
        status: "failed",
        error: errorMsg,
        duration: Date.now() - (subagent.startedAt ?? subagent.createdAt),
      }
    }
  }

  /**
   * 并行执行多个子代理
   */
  async executeParallel(ids: string[]): Promise<SubagentResult[]> {
    // 限制并行数
    const limitedIds = ids.slice(0, this.config.maxConcurrent)

    // 并行执行
    const promises = limitedIds.map((id) => this.execute(id))
    return Promise.all(promises)
  }

  /**
   * 并行探索（专门用于 Plan Mode Phase 1）
   */
  async runParallelExploration(
    tasks: ExploreTask[],
    config: Partial<ParallelExploreConfig> = {}
  ): Promise<AggregatedResult> {
    const fullConfig: ParallelExploreConfig = {
      maxAgents: config.maxAgents ?? 3,
      timeout: config.timeout ?? 60000,
      aggregationStrategy: config.aggregationStrategy ?? "merge",
    }

    // 限制任务数
    const limitedTasks = tasks.slice(0, fullConfig.maxAgents)

    // 创建探索子代理
    const subagents = limitedTasks.map((task) =>
      this.create({
        type: "explore",
        prompt: this.buildExplorePrompt(task),
      })
    )

    // 并行执行
    const startTime = Date.now()
    const results = await this.executeParallel(subagents.map((s) => s.id))
    const duration = Date.now() - startTime

    // 聚合结果
    const content = this.aggregateResults(results, fullConfig.aggregationStrategy)

    return {
      results,
      content,
      stats: {
        total: results.length,
        completed: results.filter((r) => r.status === "completed").length,
        failed: results.filter((r) => r.status === "failed").length,
        duration,
      },
    }
  }

  /**
   * 清除所有子代理
   */
  clear(): void {
    this.subagents.clear()
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    total: number
    pending: number
    running: number
    completed: number
    failed: number
    cancelled: number
  } {
    const all = this.getAll()
    return {
      total: all.length,
      pending: all.filter((s) => s.status === "pending").length,
      running: all.filter((s) => s.status === "running").length,
      completed: all.filter((s) => s.status === "completed").length,
      failed: all.filter((s) => s.status === "failed").length,
      cancelled: all.filter((s) => s.status === "cancelled").length,
    }
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `subagent-${Date.now()}-${randomBytes(4).toString("hex")}`
  }

  /**
   * 计算嵌套深度
   */
  private calculateDepth(subagent: Subagent): number {
    let depth = 0
    let current = subagent
    while (current.parentId) {
      depth++
      const parent = this.subagents.get(current.parentId)
      if (!parent) break
      current = parent
    }
    return depth
  }

  /**
   * 模拟执行（实际项目中替换为真实 Agent 执行）
   */
  private async simulateExecution(subagent: Subagent): Promise<string> {
    // 模拟异步执行
    await new Promise((resolve) => setTimeout(resolve, 1000))

    return `# ${subagent.type.toUpperCase()} Agent Result

Task: ${subagent.prompt.slice(0, 100)}...

## Summary
This is a simulated result. In production, this would be the actual output from the AI agent.

## Files Examined
- Simulated file paths would be listed here

## Key Findings
- Simulated findings would be listed here

Status: ${subagent.status}
Execution Time: ${Date.now() - subagent.createdAt}ms`
  }

  /**
   * 构建探索 Prompt
   */
  private buildExplorePrompt(task: ExploreTask): string {
    return `You are an Explore Agent specialized in code exploration.

Your task: ${task.focus}

Focus areas:
${task.scope.map((s) => `- ${s}`).join("\n")}

Questions to answer:
${task.questions.map((q) => `- ${q}`).join("\n")}

Rules:
- You can ONLY use read tools: read, glob, grep
- Do NOT make any changes to files
- Be thorough but concise
- Report specific file paths and line numbers
- Note any patterns or conventions you discover`
  }

  /**
   * 聚合结果
   */
  private aggregateResults(
    results: SubagentResult[],
    strategy: ParallelExploreConfig["aggregationStrategy"]
  ): string {
    const successfulResults = results.filter((r) => r.status === "completed" && r.result)

    switch (strategy) {
      case "concat":
        return successfulResults.map((r) => r.result).join("\n\n---\n\n")

      case "merge":
        // 简单合并，去重分割线
        return this.mergeResults(successfulResults.map((r) => r.result || ""))

      case "summary":
        // 生成摘要（实际项目中可以用 AI 生成）
        return this.summarizeResults(successfulResults)

      default:
        return successfulResults.map((r) => r.result).join("\n\n")
    }
  }

  /**
   * 合并结果（简单去重）
   */
  private mergeResults(results: string[]): string {
    // 简单的合并策略：去除重复的分割线
    const cleaned = results.map((r) => r.replace(/\n{3,}/g, "\n\n").trim())
    return cleaned.join("\n\n---\n\n")
  }

  /**
   * 生成摘要
   */
  private summarizeResults(results: SubagentResult[]): string {
    const sections = [
      "# Parallel Exploration Summary",
      "",
      `Total agents: ${results.length}`,
      `Successful: ${results.filter((r) => r.status === "completed").length}`,
      `Failed: ${results.filter((r) => r.status === "failed").length}`,
      "",
      "## Key Findings",
      "",
      ...results
        .filter((r) => r.status === "completed")
        .map((r, i) => `### Agent ${i + 1}\n${r.result?.slice(0, 500)}...`),
    ]

    return sections.join("\n")
  }
}

/**
 * 全局子代理管理器实例
 */
let globalSubagentManager: SubagentManager | null = null

export function getSubagentManager(config?: SubagentManagerConfig): SubagentManager {
  if (!globalSubagentManager) {
    globalSubagentManager = new SubagentManager(config)
  }
  return globalSubagentManager
}

/**
 * 重置全局实例（用于测试）
 */
export function resetSubagentManager(): void {
  globalSubagentManager?.clear()
  globalSubagentManager = null
}
