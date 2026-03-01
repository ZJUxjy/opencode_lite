import type { TaskContract } from "./contracts.js"

// ============================================================================
// TaskDAG - 任务依赖有向无环图
// ============================================================================

/**
 * TaskDAG - 任务依赖有向无环图
 *
 * 职责：
 * - 管理任务依赖关系
 * - 检测循环依赖
 * - 拓扑排序
 * - 并行任务识别
 */
export class TaskDAG {
  private tasks: Map<string, TaskNode> = new Map()
  private adjacencyList: Map<string, Set<string>> = new Map() // task -> dependents
  private reverseList: Map<string, Set<string>> = new Map() // task -> dependencies

  /**
   * 添加任务
   */
  addTask(task: TaskContract, dependencies: string[] = []): void {
    if (this.tasks.has(task.taskId)) {
      throw new Error(`Task ${task.taskId} already exists`)
    }

    // 检查循环依赖
    if (dependencies.includes(task.taskId)) {
      throw new Error(`Task ${task.taskId} cannot depend on itself`)
    }

    // 检查所有依赖是否存在
    for (const dep of dependencies) {
      if (!this.tasks.has(dep)) {
        throw new Error(`Dependency ${dep} does not exist`)
      }
    }

    // 检查是否会形成循环
    if (this.willCreateCycle(task.taskId, dependencies)) {
      throw new Error(`Adding task ${task.taskId} with dependencies [${dependencies}] would create a cycle`)
    }

    // 创建节点
    const node: TaskNode = {
      task,
      status: "pending",
      dependencies: new Set(dependencies),
      dependents: new Set(),
    }

    this.tasks.set(task.taskId, node)

    // 更新依赖关系
    for (const dep of dependencies) {
      // 添加正向边 (dependency -> task)
      if (!this.adjacencyList.has(dep)) {
        this.adjacencyList.set(dep, new Set())
      }
      this.adjacencyList.get(dep)!.add(task.taskId)

      // 添加反向边 (task -> dependency)
      if (!this.reverseList.has(task.taskId)) {
        this.reverseList.set(task.taskId, new Set())
      }
      this.reverseList.get(task.taskId)!.add(dep)

      // 更新依赖节点的dependents
      const depNode = this.tasks.get(dep)
      if (depNode) {
        depNode.dependents.add(task.taskId)
      }
    }
  }

  /**
   * 检查是否会形成循环
   */
  private willCreateCycle(taskId: string, dependencies: string[]): boolean {
    // 从每个依赖出发，检查是否能到达taskId
    for (const dep of dependencies) {
      const visited = new Set<string>()
      if (this.canReach(dep, taskId, visited)) {
        return true
      }
    }
    return false
  }

  /**
   * 检查从start能否到达target
   */
  private canReach(start: string, target: string, visited: Set<string>): boolean {
    if (start === target) return true
    if (visited.has(start)) return false

    visited.add(start)

    const dependents = this.adjacencyList.get(start)
    if (dependents) {
      for (const dependent of dependents) {
        if (this.canReach(dependent, target, visited)) {
          return true
        }
      }
    }

    return false
  }

  /**
   * 获取任务的依赖
   */
  getDependencies(taskId: string): string[] {
    const node = this.tasks.get(taskId)
    return node ? Array.from(node.dependencies) : []
  }

  /**
   * 获取任务的依赖（递归，包括传递依赖）
   */
  getAllDependencies(taskId: string): string[] {
    const result = new Set<string>()
    const visited = new Set<string>()

    const traverse = (id: string) => {
      if (visited.has(id)) return
      visited.add(id)

      const deps = this.getDependencies(id)
      for (const dep of deps) {
        result.add(dep)
        traverse(dep)
      }
    }

    traverse(taskId)
    return Array.from(result)
  }

  /**
   * 获取任务的直接依赖者
   */
  getDependents(taskId: string): string[] {
    const node = this.tasks.get(taskId)
    return node ? Array.from(node.dependents) : []
  }

  /**
   * 拓扑排序（Kahn算法）
   */
  topologicalSort(): string[] {
    const inDegree = new Map<string, number>()
    const queue: string[] = []
    const result: string[] = []

    // 初始化入度
    for (const [taskId, node] of this.tasks) {
      inDegree.set(taskId, node.dependencies.size)
      if (node.dependencies.size === 0) {
        queue.push(taskId)
      }
    }

    // BFS
    while (queue.length > 0) {
      const taskId = queue.shift()!
      result.push(taskId)

      const dependents = this.adjacencyList.get(taskId)
      if (dependents) {
        for (const dependent of dependents) {
          const degree = inDegree.get(dependent)! - 1
          inDegree.set(dependent, degree)
          if (degree === 0) {
            queue.push(dependent)
          }
        }
      }
    }

    // 检查是否有环
    if (result.length !== this.tasks.size) {
      throw new Error("Circular dependency detected")
    }

    return result
  }

  /**
   * 获取可并行执行的任务
   */
  getParallelizableTasks(completedTasks: Set<string>): string[] {
    const result: string[] = []

    for (const [taskId, node] of this.tasks) {
      if (node.status !== "pending") continue

      // 检查所有依赖是否都已完成
      const allDepsCompleted = Array.from(node.dependencies).every((dep) =>
        completedTasks.has(dep)
      )

      if (allDepsCompleted) {
        result.push(taskId)
      }
    }

    return result
  }

  /**
   * 更新任务状态
   */
  updateTaskStatus(taskId: string, status: TaskNodeStatus): void {
    const node = this.tasks.get(taskId)
    if (!node) {
      throw new Error(`Task ${taskId} not found`)
    }
    node.status = status
  }

  /**
   * 获取任务状态
   */
  getTaskStatus(taskId: string): TaskNodeStatus | undefined {
    return this.tasks.get(taskId)?.status
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): TaskContract[] {
    return Array.from(this.tasks.values()).map((n) => n.task)
  }

  /**
   * 获取关键路径（最长依赖链）
   */
  getCriticalPath(): string[] {
    const sorted = this.topologicalSort()
    const dist = new Map<string, number>()
    const prev = new Map<string, string | null>()

    // 初始化
    for (const taskId of sorted) {
      dist.set(taskId, 0)
      prev.set(taskId, null)
    }

    // DP计算最长路径
    for (const taskId of sorted) {
      const dependents = this.adjacencyList.get(taskId)
      if (dependents) {
        for (const dependent of dependents) {
          const newDist = dist.get(taskId)! + 1
          if (newDist > dist.get(dependent)!) {
            dist.set(dependent, newDist)
            prev.set(dependent, taskId)
          }
        }
      }
    }

    // 找到最长路径的终点
    let maxDist = -1
    let endNode: string | null = null
    for (const [taskId, d] of dist) {
      if (d > maxDist) {
        maxDist = d
        endNode = taskId
      }
    }

    // 回溯
    const path: string[] = []
    let current: string | null = endNode
    while (current) {
      path.unshift(current)
      current = prev.get(current) ?? null
    }

    return path
  }

  /**
   * 检查是否有环
   */
  hasCycle(): boolean {
    try {
      this.topologicalSort()
      return false
    } catch {
      return true
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): DAGStats {
    let pending = 0
    let inProgress = 0
    let completed = 0
    let failed = 0

    for (const node of this.tasks.values()) {
      switch (node.status) {
        case "pending":
          pending++
          break
        case "in_progress":
          inProgress++
          break
        case "completed":
          completed++
          break
        case "failed":
          failed++
          break
      }
    }

    return {
      totalTasks: this.tasks.size,
      pending,
      inProgress,
      completed,
      failed,
      hasCycle: this.hasCycle(),
      criticalPathLength: this.getCriticalPath().length,
    }
  }

  /**
   * 清空DAG
   */
  clear(): void {
    this.tasks.clear()
    this.adjacencyList.clear()
    this.reverseList.clear()
  }

  /**
   * 序列化
   */
  toJSON(): DAGSnapshot {
    const nodes: DAGSnapshotNode[] = []

    for (const [taskId, node] of this.tasks) {
      nodes.push({
        taskId,
        task: node.task,
        status: node.status,
        dependencies: Array.from(node.dependencies),
        dependents: Array.from(node.dependents),
      })
    }

    return {
      nodes,
      sortedOrder: this.topologicalSort(),
    }
  }

  /**
   * 反序列化
   */
  static fromJSON(snapshot: DAGSnapshot): TaskDAG {
    const dag = new TaskDAG()

    // 按依赖顺序添加
    for (const node of snapshot.nodes) {
      dag.addTask(node.task, node.dependencies)
    }

    // 更新状态
    for (const node of snapshot.nodes) {
      dag.updateTaskStatus(node.taskId, node.status)
    }

    return dag
  }
}

// ============================================================================
// 类型定义
// ============================================================================

export type TaskNodeStatus = "pending" | "in_progress" | "completed" | "failed"

export interface TaskNode {
  task: TaskContract
  status: TaskNodeStatus
  dependencies: Set<string>
  dependents: Set<string>
}

export interface DAGStats {
  totalTasks: number
  pending: number
  inProgress: number
  completed: number
  failed: number
  hasCycle: boolean
  criticalPathLength: number
}

export interface DAGSnapshotNode {
  taskId: string
  task: TaskContract
  status: TaskNodeStatus
  dependencies: string[]
  dependents: string[]
}

export interface DAGSnapshot {
  nodes: DAGSnapshotNode[]
  sortedOrder: string[]
}
