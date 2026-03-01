/**
 * Agent Teams - Task DAG (Directed Acyclic Graph)
 *
 * Manages task dependencies and parallel execution scheduling.
 * Ensures tasks are executed in topological order with dependency awareness.
 */

// ============================================================================
// Task Node Types
// ============================================================================

export type TaskStatus = "pending" | "ready" | "running" | "completed" | "failed" | "cancelled"

export interface TaskNode<T = unknown> {
  id: string
  name: string
  description?: string
  dependencies: string[]
  status: TaskStatus
  result?: T
  error?: string
  startTime?: number
  endTime?: number
  metadata?: Record<string, unknown>
}

export interface TaskEdge {
  from: string
  to: string
}

// ============================================================================
// Task DAG Class
// ============================================================================

export class TaskDAG<T = unknown> {
  private nodes: Map<string, TaskNode<T>> = new Map()
  private edges: TaskEdge[] = []
  private executionOrder: string[] | null = null

  /**
   * Add a task node to the DAG
   */
  addNode(node: Omit<TaskNode<T>, "status">): TaskNode<T> {
    if (this.nodes.has(node.id)) {
      throw new Error(`Task node with id '${node.id}' already exists`)
    }

    const fullNode: TaskNode<T> = {
      ...node,
      status: "pending",
    }

    this.nodes.set(node.id, fullNode)
    this.executionOrder = null // Invalidate cached order

    return fullNode
  }

  /**
   * Add a dependency edge between two tasks
   */
  addEdge(from: string, to: string): void {
    // Verify both nodes exist
    if (!this.nodes.has(from)) {
      throw new Error(`Source task '${from}' does not exist`)
    }
    if (!this.nodes.has(to)) {
      throw new Error(`Target task '${to}' does not exist`)
    }

    // Check for self-dependency
    if (from === to) {
      throw new Error("Self-dependencies are not allowed")
    }

    // Check if edge already exists
    const exists = this.edges.some((e) => e.from === from && e.to === to)
    if (exists) {
      return // Edge already exists, silently ignore
    }

    // Add edge
    this.edges.push({ from, to })

    // Update target node's dependencies
    const targetNode = this.nodes.get(to)!
    if (!targetNode.dependencies.includes(from)) {
      targetNode.dependencies.push(from)
    }

    // Check for cycles
    if (this.hasCycle()) {
      // Remove the edge that caused the cycle
      this.edges = this.edges.filter((e) => !(e.from === from && e.to === to))
      targetNode.dependencies = targetNode.dependencies.filter((d) => d !== from)
      throw new Error(`Adding dependency '${from}' -> '${to}' would create a cycle`)
    }

    this.executionOrder = null // Invalidate cached order
  }

  /**
   * Get a task node by ID
   */
  getNode(id: string): TaskNode<T> | undefined {
    return this.nodes.get(id)
  }

  /**
   * Get all task nodes
   */
  getAllNodes(): TaskNode<T>[] {
    return Array.from(this.nodes.values())
  }

  /**
   * Get all edges
   */
  getAllEdges(): TaskEdge[] {
    return [...this.edges]
  }

  /**
   * Get tasks that are ready to execute (dependencies met)
   */
  getReadyTasks(): TaskNode<T>[] {
    return this.getAllNodes().filter((node) => {
      if (node.status !== "pending") return false

      // Check if all dependencies are completed
      return node.dependencies.every((depId) => {
        const dep = this.nodes.get(depId)
        return dep?.status === "completed"
      })
    })
  }

  /**
   * Mark a task as running
   */
  markRunning(id: string): void {
    const node = this.nodes.get(id)
    if (!node) {
      throw new Error(`Task '${id}' not found`)
    }

    if (node.status !== "pending" && node.status !== "ready") {
      throw new Error(`Cannot mark task '${id}' as running from status '${node.status}'`)
    }

    node.status = "running"
    node.startTime = Date.now()
  }

  /**
   * Mark a task as completed with result
   */
  markCompleted(id: string, result: T): void {
    const node = this.nodes.get(id)
    if (!node) {
      throw new Error(`Task '${id}' not found`)
    }

    if (node.status !== "running") {
      throw new Error(`Cannot complete task '${id}' from status '${node.status}'`)
    }

    node.status = "completed"
    node.result = result
    node.endTime = Date.now()
  }

  /**
   * Mark a task as failed
   */
  markFailed(id: string, error: string): void {
    const node = this.nodes.get(id)
    if (!node) {
      throw new Error(`Task '${id}' not found`)
    }

    node.status = "failed"
    node.error = error
    node.endTime = Date.now()
  }

  /**
   * Mark a task as cancelled
   */
  markCancelled(id: string): void {
    const node = this.nodes.get(id)
    if (!node) {
      throw new Error(`Task '${id}' not found`)
    }

    if (node.status === "completed" || node.status === "failed") {
      return // Already finished
    }

    node.status = "cancelled"
    node.endTime = Date.now()
  }

  /**
   * Get the execution order using topological sort
   */
  getExecutionOrder(): string[] {
    if (this.executionOrder) {
      return [...this.executionOrder]
    }

    // Kahn's algorithm for topological sort
    const inDegree = new Map<string, number>()
    const adjacencyList = new Map<string, string[]>()

    // Initialize
    for (const nodeId of this.nodes.keys()) {
      inDegree.set(nodeId, 0)
      adjacencyList.set(nodeId, [])
    }

    // Build adjacency list and calculate in-degrees
    for (const edge of this.edges) {
      const current = inDegree.get(edge.to) || 0
      inDegree.set(edge.to, current + 1)

      const neighbors = adjacencyList.get(edge.from) || []
      neighbors.push(edge.to)
      adjacencyList.set(edge.from, neighbors)
    }

    // Find all nodes with no dependencies
    const queue: string[] = []
    for (const [nodeId, degree] of inDegree.entries()) {
      if (degree === 0) {
        queue.push(nodeId)
      }
    }

    const result: string[] = []

    while (queue.length > 0) {
      const current = queue.shift()!
      result.push(current)

      const neighbors = adjacencyList.get(current) || []
      for (const neighbor of neighbors) {
        const newDegree = (inDegree.get(neighbor) || 0) - 1
        inDegree.set(neighbor, newDegree)

        if (newDegree === 0) {
          queue.push(neighbor)
        }
      }
    }

    if (result.length !== this.nodes.size) {
      throw new Error("Cycle detected in task graph")
    }

    this.executionOrder = result
    return [...result]
  }

  /**
   * Check if the graph has a cycle
   */
  hasCycle(): boolean {
    try {
      this.getExecutionOrder()
      return false
    } catch {
      return true
    }
  }

  /**
   * Get tasks that can run in parallel at the current state
   */
  getParallelBatch(): TaskNode<T>[] {
    const ready = this.getReadyTasks()
    return ready
  }

  /**
   * Get completion percentage
   */
  getCompletionPercentage(): number {
    const nodes = this.getAllNodes()
    if (nodes.length === 0) return 100

    const completed = nodes.filter((n) => n.status === "completed").length
    return Math.round((completed / nodes.length) * 100)
  }

  /**
   * Get summary statistics
   */
  getStats(): {
    total: number
    pending: number
    ready: number
    running: number
    completed: number
    failed: number
    cancelled: number
  } {
    const nodes = this.getAllNodes()

    return {
      total: nodes.length,
      pending: nodes.filter((n) => n.status === "pending").length,
      ready: nodes.filter((n) => n.status === "ready").length,
      running: nodes.filter((n) => n.status === "running").length,
      completed: nodes.filter((n) => n.status === "completed").length,
      failed: nodes.filter((n) => n.status === "failed").length,
      cancelled: nodes.filter((n) => n.status === "cancelled").length,
    }
  }

  /**
   * Reset all tasks to pending status
   */
  reset(): void {
    for (const node of this.nodes.values()) {
      node.status = "pending"
      node.result = undefined
      node.error = undefined
      node.startTime = undefined
      node.endTime = undefined
    }
  }

  /**
   * Remove a task node and its edges
   */
  removeNode(id: string): boolean {
    if (!this.nodes.has(id)) {
      return false
    }

    // Remove edges connected to this node
    this.edges = this.edges.filter((e) => e.from !== id && e.to !== id)

    // Remove from other nodes' dependencies
    for (const node of this.nodes.values()) {
      node.dependencies = node.dependencies.filter((d) => d !== id)
    }

    // Remove the node
    this.nodes.delete(id)
    this.executionOrder = null

    return true
  }

  /**
   * Create a snapshot of the DAG state
   */
  snapshot(): {
    nodes: TaskNode<T>[]
    edges: TaskEdge[]
  } {
    return {
      nodes: this.getAllNodes(),
      edges: this.getAllEdges(),
    }
  }

  /**
   * Restore from a snapshot
   */
  restore(snapshot: { nodes: TaskNode<T>[]; edges: TaskEdge[] }): void {
    this.nodes.clear()
    this.edges = [...snapshot.edges]

    for (const node of snapshot.nodes) {
      this.nodes.set(node.id, { ...node })
    }

    this.executionOrder = null
  }
}

// ============================================================================
// Parallel Task Scheduler
// ============================================================================

export interface TaskExecutor<T, R> {
  (task: TaskNode<T>): Promise<R>
}

export interface SchedulerConfig {
  maxConcurrency: number
  failFast: boolean
  retryCount: number
}

export class ParallelTaskScheduler<T, R> {
  private dag: TaskDAG<T>
  private executor: TaskExecutor<T, R>
  private config: SchedulerConfig
  private runningTasks: Map<string, Promise<void>> = new Map()
  private abortController: AbortController

  constructor(
    dag: TaskDAG<T>,
    executor: TaskExecutor<T, R>,
    config: Partial<SchedulerConfig> = {}
  ) {
    this.dag = dag
    this.executor = executor
    this.config = {
      maxConcurrency: 3,
      failFast: true,
      retryCount: 0,
      ...config,
    }
    this.abortController = new AbortController()
  }

  /**
   * Execute all tasks in the DAG respecting dependencies
   */
  async execute(): Promise<{
    success: boolean
    completed: string[]
    failed: Array<{ id: string; error: string }>
  }> {
    const completed: string[] = []
    const failed: Array<{ id: string; error: string }> = []

    this.dag.reset()

    while (this.shouldContinue()) {
      if (this.abortController.signal.aborted) {
        throw new Error("Execution cancelled")
      }

      // Check for failed tasks if failFast is enabled
      if (this.config.failFast && failed.length > 0) {
        this.cancelRemaining()
        break
      }

      // Get ready tasks
      const readyTasks = this.dag.getReadyTasks()

      // Start new tasks up to maxConcurrency
      const availableSlots = this.config.maxConcurrency - this.runningTasks.size
      const tasksToStart = readyTasks.slice(0, availableSlots)

      for (const task of tasksToStart) {
        this.startTask(task, completed, failed)
      }

      // Wait for at least one task to complete
      if (this.runningTasks.size > 0) {
        await Promise.race(this.runningTasks.values())
      }

      // Clean up completed running tasks
      await this.cleanupRunningTasks()
    }

    // Wait for all remaining tasks
    if (this.runningTasks.size > 0) {
      await Promise.all(this.runningTasks.values())
    }

    return {
      success: failed.length === 0,
      completed,
      failed,
    }
  }

  /**
   * Cancel execution
   */
  cancel(): void {
    this.abortController.abort()
    for (const node of this.dag.getAllNodes()) {
      if (node.status === "running" || node.status === "pending") {
        this.dag.markCancelled(node.id)
      }
    }
  }

  private shouldContinue(): boolean {
    const stats = this.dag.getStats()
    return stats.pending > 0 || stats.ready > 0 || this.runningTasks.size > 0
  }

  private startTask(
    task: TaskNode<T>,
    completed: string[],
    failed: Array<{ id: string; error: string }>
  ): void {
    this.dag.markRunning(task.id)

    const promise = this.runTaskWithRetry(task, completed, failed)
    this.runningTasks.set(task.id, promise)
  }

  private async runTaskWithRetry(
    task: TaskNode<T>,
    completed: string[],
    failed: Array<{ id: string; error: string }>
  ): Promise<void> {
    let lastError: string | undefined

    for (let attempt = 0; attempt <= this.config.retryCount; attempt++) {
      if (this.abortController.signal.aborted) {
        return
      }

      try {
        const result = await this.executor(task)
        this.dag.markCompleted(task.id, result as T)
        completed.push(task.id)
        return
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)

        if (attempt < this.config.retryCount) {
          // Wait before retry (exponential backoff)
          await this.delay(Math.pow(2, attempt) * 1000)
        }
      }
    }

    this.dag.markFailed(task.id, lastError!)
    failed.push({ id: task.id, error: lastError! })
  }

  private async cleanupRunningTasks(): Promise<void> {
    const completedTasks: string[] = []

    for (const [id, promise] of this.runningTasks) {
      try {
        await Promise.race([promise, Promise.resolve()])
        const node = this.dag.getNode(id)
        if (node?.status === "completed" || node?.status === "failed" || node?.status === "cancelled") {
          completedTasks.push(id)
        }
      } catch {
        // Task failed, will be handled in the next iteration
      }
    }

    for (const id of completedTasks) {
      this.runningTasks.delete(id)
    }
  }

  private cancelRemaining(): void {
    for (const node of this.dag.getAllNodes()) {
      if (node.status === "pending") {
        this.dag.markCancelled(node.id)
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createTaskDAG<T>(): TaskDAG<T> {
  return new TaskDAG<T>()
}

export function createParallelScheduler<T, R>(
  dag: TaskDAG<T>,
  executor: TaskExecutor<T, R>,
  config?: Partial<SchedulerConfig>
): ParallelTaskScheduler<T, R> {
  return new ParallelTaskScheduler(dag, executor, config)
}
