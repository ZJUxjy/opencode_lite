/**
 * Task DAG - 任务依赖图
 *
 * 管理任务之间的依赖关系，支持：
 * - 拓扑排序（确定执行顺序）
 * - 并行层级划分（确定可并行任务）
 * - 依赖检测（避免循环依赖）
 * - 进度追踪（追踪已完成任务）
 */

import type { TaskContract } from "./contracts.js"

/**
 * 任务节点
 */
export interface TaskNode {
  /** 任务 ID */
  id: string
  /** 任务契约 */
  contract: TaskContract
  /** 依赖的任务 ID 列表 */
  dependencies: string[]
  /** 任务状态 */
  status: "pending" | "running" | "completed" | "failed" | "blocked"
  /** 分配的 Agent ID */
  assignedAgent?: string
  /** 优先级（数字越小优先级越高） */
  priority: number
}

/**
 * 并行层级
 */
export interface ParallelLevel {
  /** 层级索引（0 表示第一层） */
  level: number
  /** 该层级可并行执行的任务 */
  tasks: TaskNode[]
  /** 预计 token 消耗 */
  estimatedTokens: number
}

/**
 * DAG 执行计划
 */
export interface ExecutionPlan {
  /** 所有任务节点 */
  nodes: Map<string, TaskNode>
  /** 按层级排序的执行计划 */
  levels: ParallelLevel[]
  /** 总任务数 */
  totalTasks: number
  /** 最大并行度 */
  maxParallelism: number
  /** 预计总 token 消耗 */
  estimatedTotalTokens: number
  /** 是否有循环依赖 */
  hasCycle: boolean
  /** 拓扑排序结果 */
  topologicalOrder: string[]
}

/**
 * Task DAG 管理器
 */
export class TaskDAG {
  private nodes: Map<string, TaskNode> = new Map()
  private adjacencyList: Map<string, string[]> = new Map()
  private reverseAdjacency: Map<string, string[]> = new Map()

  /**
   * 添加任务节点
   */
  addTask(task: TaskNode): void {
    this.nodes.set(task.id, task)
    this.adjacencyList.set(task.id, [])
    this.reverseAdjacency.set(task.id, [])

    // 建立依赖关系
    for (const depId of task.dependencies) {
      this.adjacencyList.get(depId)?.push(task.id)
      this.reverseAdjacency.get(task.id)?.push(depId)
    }
  }

  /**
   * 获取任务节点
   */
  getTask(taskId: string): TaskNode | undefined {
    return this.nodes.get(taskId)
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): TaskNode[] {
    return Array.from(this.nodes.values())
  }

  /**
   * 更新任务状态
   */
  updateTaskStatus(taskId: string, status: TaskNode["status"]): void {
    const task = this.nodes.get(taskId)
    if (task) {
      task.status = status

      // 如果任务完成，检查是否有被阻塞的任务可以解除
      if (status === "completed") {
        this.unblockDependentTasks(taskId)
      }
    }
  }

  /**
   * 解除依赖任务的阻塞状态
   */
  private unblockDependentTasks(completedTaskId: string): void {
    const dependents = this.adjacencyList.get(completedTaskId) || []
    for (const depId of dependents) {
      const task = this.nodes.get(depId)
      if (task && task.status === "blocked") {
        // 检查所有依赖是否都已完成
        if (this.areAllDependenciesMet(depId)) {
          task.status = "pending"
        }
      }
    }
  }

  /**
   * 检查任务的所有依赖是否都已满足
   */
  areAllDependenciesMet(taskId: string): boolean {
    const task = this.nodes.get(taskId)
    if (!task) return false

    for (const depId of task.dependencies) {
      const depTask = this.nodes.get(depId)
      if (!depTask || depTask.status !== "completed") {
        return false
      }
    }
    return true
  }

  /**
   * 获取可执行的任务（依赖已满足且状态为 pending）
   */
  getExecutableTasks(): TaskNode[] {
    const executable: TaskNode[] = []

    for (const task of this.nodes.values()) {
      if (task.status === "pending" && this.areAllDependenciesMet(task.id)) {
        executable.push(task)
      }
    }

    // 按优先级排序
    executable.sort((a, b) => a.priority - b.priority)

    return executable
  }

  /**
   * 检测是否存在循环依赖
   */
  detectCycle(): { hasCycle: boolean; cyclePath: string[] } {
    const visited = new Set<string>()
    const recursionStack = new Set<string>()
    const path: string[] = []

    for (const taskId of this.nodes.keys()) {
      if (this.detectCycleDFS(taskId, visited, recursionStack, path)) {
        return { hasCycle: true, cyclePath: [...path] }
      }
    }

    return { hasCycle: false, cyclePath: [] }
  }

  /**
   * DFS 检测循环
   */
  private detectCycleDFS(
    taskId: string,
    visited: Set<string>,
    recursionStack: Set<string>,
    path: string[]
  ): boolean {
    if (recursionStack.has(taskId)) {
      path.push(taskId)
      return true
    }

    if (visited.has(taskId)) {
      return false
    }

    visited.add(taskId)
    recursionStack.add(taskId)
    path.push(taskId)

    const neighbors = this.adjacencyList.get(taskId) || []
    for (const neighbor of neighbors) {
      if (this.detectCycleDFS(neighbor, visited, recursionStack, path)) {
        return true
      }
    }

    recursionStack.delete(taskId)
    path.pop()

    return false
  }

  /**
   * 拓扑排序
   */
  topologicalSort(): string[] {
    const cycleCheck = this.detectCycle()
    if (cycleCheck.hasCycle) {
      return [] // 有循环依赖，无法拓扑排序
    }

    const result: string[] = []
    const visited = new Set<string>()

    for (const taskId of this.nodes.keys()) {
      this.topologicalSortDFS(taskId, visited, result)
    }

    return result.reverse()
  }

  /**
   * DFS 拓扑排序
   */
  private topologicalSortDFS(
    taskId: string,
    visited: Set<string>,
    result: string[]
  ): void {
    if (visited.has(taskId)) return

    visited.add(taskId)

    const neighbors = this.adjacencyList.get(taskId) || []
    for (const neighbor of neighbors) {
      this.topologicalSortDFS(neighbor, visited, result)
    }

    result.push(taskId)
  }

  /**
   * 生成并行执行计划
   */
  generateExecutionPlan(): ExecutionPlan {
    const cycleCheck = this.detectCycle()
    const topologicalOrder = this.topologicalSort()
    const levels: ParallelLevel[] = []

    if (!cycleCheck.hasCycle) {
      // 计算每个任务的层级（基于依赖深度）
      const taskLevels = new Map<string, number>()

      for (const taskId of topologicalOrder) {
        const task = this.nodes.get(taskId)!
        if (task.dependencies.length === 0) {
          taskLevels.set(taskId, 0)
        } else {
          const maxDepLevel = Math.max(
            ...task.dependencies.map(depId => taskLevels.get(depId) ?? 0)
          )
          taskLevels.set(taskId, maxDepLevel + 1)
        }
      }

      // 按层级分组
      const maxLevel = Math.max(...taskLevels.values(), 0)
      for (let level = 0; level <= maxLevel; level++) {
        const levelTasks = Array.from(this.nodes.values())
          .filter(task => taskLevels.get(task.id) === level)

        const estimatedTokens = levelTasks.reduce(
          (sum, task) => sum + (task.contract.estimatedTokens || 0),
          0
        )

        levels.push({
          level,
          tasks: levelTasks,
          estimatedTokens,
        })
      }
    }

    // 计算最大并行度
    const maxParallelism = levels.reduce(
      (max, level) => Math.max(max, level.tasks.length),
      0
    )

    // 计算预计总 token
    const estimatedTotalTokens = Array.from(this.nodes.values()).reduce(
      (sum, task) => sum + (task.contract.estimatedTokens || 0),
      0
    )

    return {
      nodes: this.nodes,
      levels,
      totalTasks: this.nodes.size,
      maxParallelism,
      estimatedTotalTokens,
      hasCycle: cycleCheck.hasCycle,
      topologicalOrder,
    }
  }

  /**
   * 获取任务的依赖链（所有上游任务）
   */
  getDependencyChain(taskId: string): string[] {
    const chain: string[] = []
    const visited = new Set<string>()

    this.collectDependencies(taskId, chain, visited)

    return chain
  }

  /**
   * 递归收集依赖
   */
  private collectDependencies(
    taskId: string,
    chain: string[],
    visited: Set<string>
  ): void {
    if (visited.has(taskId)) return

    visited.add(taskId)

    const dependencies = this.reverseAdjacency.get(taskId) || []
    for (const depId of dependencies) {
      this.collectDependencies(depId, chain, visited)
      chain.push(depId)
    }
  }

  /**
   * 获取任务的影响范围（所有下游任务）
   */
  getImpactScope(taskId: string): string[] {
    const scope: string[] = []
    const visited = new Set<string>()

    this.collectImpact(taskId, scope, visited)

    return scope
  }

  /**
   * 递归收集影响范围
   */
  private collectImpact(
    taskId: string,
    scope: string[],
    visited: Set<string>
  ): void {
    if (visited.has(taskId)) return

    visited.add(taskId)

    const dependents = this.adjacencyList.get(taskId) || []
    for (const depId of dependents) {
      scope.push(depId)
      this.collectImpact(depId, scope, visited)
    }
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
    blocked: number
  } {
    const stats = {
      total: this.nodes.size,
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      blocked: 0,
    }

    for (const task of this.nodes.values()) {
      stats[task.status]++
    }

    return stats
  }

  /**
   * 清空 DAG
   */
  clear(): void {
    this.nodes.clear()
    this.adjacencyList.clear()
    this.reverseAdjacency.clear()
  }
}

/**
 * 创建任务节点的工厂函数
 */
export function createTaskNode(
  contract: TaskContract,
  dependencies: string[] = [],
  priority: number = 10
): TaskNode {
  return {
    id: contract.taskId,
    contract,
    dependencies,
    status: "pending",
    priority,
  }
}

/**
 * 从任务契约列表创建 DAG
 */
export function createDAGFromContracts(
  contracts: TaskContract[],
  dependencyResolver?: (contract: TaskContract) => string[]
): TaskDAG {
  const dag = new TaskDAG()

  for (const contract of contracts) {
    const dependencies = dependencyResolver
      ? dependencyResolver(contract)
      : contract.dependencies || []

    const node = createTaskNode(
      contract,
      dependencies,
      contracts.indexOf(contract)
    )

    dag.addTask(node)
  }

  return dag
}
