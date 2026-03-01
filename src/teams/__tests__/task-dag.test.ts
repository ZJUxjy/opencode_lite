/**
 * Task DAG Tests
 */

import { describe, it, expect } from "vitest"
import {
  TaskDAG,
  ParallelTaskScheduler,
  createTaskDAG,
  createParallelScheduler,
  type TaskNode,
} from "../task-dag.js"

describe("TaskDAG", () => {
  describe("node management", () => {
    it("should add nodes", () => {
      const dag = createTaskDAG<string>()
      const node = dag.addNode({
        id: "task-1",
        name: "Task 1",
        dependencies: [],
      })

      expect(node.id).toBe("task-1")
      expect(node.status).toBe("pending")
    })

    it("should throw on duplicate node id", () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "task-1", name: "Task 1", dependencies: [] })

      expect(() => {
        dag.addNode({ id: "task-1", name: "Task 1 Duplicate", dependencies: [] })
      }).toThrow("already exists")
    })

    it("should get node by id", () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "task-1", name: "Task 1", dependencies: [] })

      const node = dag.getNode("task-1")
      expect(node?.name).toBe("Task 1")
    })

    it("should return undefined for non-existent node", () => {
      const dag = createTaskDAG<string>()
      expect(dag.getNode("non-existent")).toBeUndefined()
    })

    it("should remove node", () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "task-1", name: "Task 1", dependencies: [] })

      expect(dag.removeNode("task-1")).toBe(true)
      expect(dag.getNode("task-1")).toBeUndefined()
    })
  })

  describe("edge management", () => {
    it("should add edges", () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "a", name: "A", dependencies: [] })
      dag.addNode({ id: "b", name: "B", dependencies: [] })

      dag.addEdge("a", "b")

      expect(dag.getAllEdges()).toHaveLength(1)
      expect(dag.getAllEdges()[0]).toEqual({ from: "a", to: "b" })
    })

    it("should update dependencies when adding edge", () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "a", name: "A", dependencies: [] })
      dag.addNode({ id: "b", name: "B", dependencies: [] })

      dag.addEdge("a", "b")

      const nodeB = dag.getNode("b")!
      expect(nodeB.dependencies).toContain("a")
    })

    it("should throw on self-dependency", () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "a", name: "A", dependencies: [] })

      expect(() => {
        dag.addEdge("a", "a")
      }).toThrow("Self-dependencies are not allowed")
    })

    it("should detect cycles", () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "a", name: "A", dependencies: [] })
      dag.addNode({ id: "b", name: "B", dependencies: [] })
      dag.addNode({ id: "c", name: "C", dependencies: [] })

      dag.addEdge("a", "b")
      dag.addEdge("b", "c")

      expect(() => {
        dag.addEdge("c", "a")
      }).toThrow("would create a cycle")
    })
  })

  describe("status management", () => {
    it("should mark task as running", () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "task-1", name: "Task 1", dependencies: [] })

      dag.markRunning("task-1")

      expect(dag.getNode("task-1")?.status).toBe("running")
    })

    it("should mark task as completed", () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "task-1", name: "Task 1", dependencies: [] })

      dag.markRunning("task-1")
      dag.markCompleted("task-1", "result")

      const node = dag.getNode("task-1")!
      expect(node.status).toBe("completed")
      expect(node.result).toBe("result")
    })

    it("should mark task as failed", () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "task-1", name: "Task 1", dependencies: [] })

      dag.markFailed("task-1", "Error occurred")

      const node = dag.getNode("task-1")!
      expect(node.status).toBe("failed")
      expect(node.error).toBe("Error occurred")
    })

    it("should mark task as cancelled", () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "task-1", name: "Task 1", dependencies: [] })

      dag.markCancelled("task-1")

      expect(dag.getNode("task-1")?.status).toBe("cancelled")
    })

    it("should throw when completing non-running task", () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "task-1", name: "Task 1", dependencies: [] })

      expect(() => {
        dag.markCompleted("task-1", "result")
      }).toThrow("Cannot complete task")
    })
  })

  describe("ready tasks", () => {
    it("should return tasks with no dependencies as ready", () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "task-1", name: "Task 1", dependencies: [] })
      dag.addNode({ id: "task-2", name: "Task 2", dependencies: [] })

      const ready = dag.getReadyTasks()

      expect(ready).toHaveLength(2)
    })

    it("should return task when dependencies are completed", () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "a", name: "A", dependencies: [] })
      dag.addNode({ id: "b", name: "B", dependencies: ["a"] })

      dag.markRunning("a")
      dag.markCompleted("a", "done")

      const ready = dag.getReadyTasks()

      expect(ready).toHaveLength(1)
      expect(ready[0].id).toBe("b")
    })

    it("should not return tasks with incomplete dependencies", () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "a", name: "A", dependencies: [] })
      dag.addNode({ id: "b", name: "B", dependencies: ["a"] })

      const ready = dag.getReadyTasks()

      expect(ready).toHaveLength(1)
      expect(ready[0].id).toBe("a")
    })
  })

  describe("topological sort", () => {
    it("should return execution order respecting dependencies", () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "a", name: "A", dependencies: [] })
      dag.addNode({ id: "b", name: "B", dependencies: [] })
      dag.addNode({ id: "c", name: "C", dependencies: [] })

      dag.addEdge("a", "b")
      dag.addEdge("b", "c")

      const order = dag.getExecutionOrder()

      expect(order).toHaveLength(3)
      expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"))
      expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"))
    })

    it("should detect cycles in topological sort", () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "a", name: "A", dependencies: [] })
      dag.addNode({ id: "b", name: "B", dependencies: [] })

      // Manually create edges to simulate cycle without validation
      dag["edges"].push({ from: "a", to: "b" })
      dag["edges"].push({ from: "b", to: "a" })
      dag.getNode("b")!.dependencies.push("a")
      dag.getNode("a")!.dependencies.push("b")

      expect(() => {
        dag.getExecutionOrder()
      }).toThrow("Cycle detected")
    })
  })

  describe("statistics", () => {
    it("should return correct stats", () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "a", name: "A", dependencies: [] })
      dag.addNode({ id: "b", name: "B", dependencies: [] })
      dag.addNode({ id: "c", name: "C", dependencies: [] })

      dag.markRunning("a")
      dag.markCompleted("a", "done")
      dag.markFailed("b", "error")
      dag.markCancelled("c")

      const stats = dag.getStats()

      expect(stats.total).toBe(3)
      expect(stats.completed).toBe(1)
      expect(stats.failed).toBe(1)
      expect(stats.cancelled).toBe(1)
    })

    it("should calculate completion percentage", () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "a", name: "A", dependencies: [] })
      dag.addNode({ id: "b", name: "B", dependencies: [] })
      dag.addNode({ id: "c", name: "C", dependencies: [] })
      dag.addNode({ id: "d", name: "D", dependencies: [] })

      dag.markRunning("a")
      dag.markCompleted("a", "done")
      dag.markRunning("b")
      dag.markCompleted("b", "done")

      expect(dag.getCompletionPercentage()).toBe(50)
    })
  })

  describe("snapshot", () => {
    it("should create and restore snapshot", () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "a", name: "A", dependencies: [] })
      dag.addNode({ id: "b", name: "B", dependencies: ["a"] })
      dag.addEdge("a", "b")

      const snapshot = dag.snapshot()

      const newDag = createTaskDAG<string>()
      newDag.restore(snapshot)

      expect(newDag.getAllNodes()).toHaveLength(2)
      expect(newDag.getAllEdges()).toHaveLength(1)
    })
  })
})

describe("ParallelTaskScheduler", () => {
  describe("execution", () => {
    it("should execute all tasks", async () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "a", name: "A", dependencies: [] })
      dag.addNode({ id: "b", name: "B", dependencies: [] })

      const executed: string[] = []
      const executor = async (task: TaskNode<string>) => {
        executed.push(task.id)
        return `result-${task.id}`
      }

      const scheduler = createParallelScheduler(dag, executor, { maxConcurrency: 2 })
      const result = await scheduler.execute()

      expect(result.success).toBe(true)
      expect(result.completed).toHaveLength(2)
      expect(executed).toHaveLength(2)
    })

    it("should respect dependencies", async () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "a", name: "A", dependencies: [] })
      dag.addNode({ id: "b", name: "B", dependencies: ["a"] })
      dag.addEdge("a", "b")

      const executionOrder: string[] = []
      const executor = async (task: TaskNode<string>) => {
        executionOrder.push(task.id)
        return `result-${task.id}`
      }

      const scheduler = createParallelScheduler(dag, executor, { maxConcurrency: 2 })
      await scheduler.execute()

      expect(executionOrder.indexOf("a")).toBeLessThan(executionOrder.indexOf("b"))
    })

    it("should handle task failures", async () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "a", name: "A", dependencies: [] })
      dag.addNode({ id: "b", name: "B", dependencies: [] })

      const executor = async (task: TaskNode<string>) => {
        if (task.id === "a") {
          throw new Error("Task A failed")
        }
        return `result-${task.id}`
      }

      const scheduler = createParallelScheduler(dag, executor, { maxConcurrency: 2 })
      const result = await scheduler.execute()

      expect(result.success).toBe(false)
      expect(result.failed).toHaveLength(1)
      expect(result.failed[0].id).toBe("a")
      expect(result.completed).toHaveLength(1)
    })

    it("should fail fast when configured", async () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "a", name: "A", dependencies: [] })
      dag.addNode({ id: "b", name: "B", dependencies: [] })

      const executor = async (task: TaskNode<string>) => {
        if (task.id === "a") {
          throw new Error("Task A failed")
        }
        // Add delay to ensure b doesn't complete before cancellation
        await new Promise((resolve) => setTimeout(resolve, 100))
        return `result-${task.id}`
      }

      const scheduler = createParallelScheduler(dag, executor, {
        maxConcurrency: 2,
        failFast: true,
      })
      const result = await scheduler.execute()

      expect(result.success).toBe(false)
      expect(result.failed).toHaveLength(1)
    })

    it("should support retry", async () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "a", name: "A", dependencies: [] })

      let attemptCount = 0
      const executor = async (task: TaskNode<string>) => {
        attemptCount++
        if (attemptCount < 2) {
          throw new Error("Temporary error")
        }
        return "success"
      }

      const scheduler = createParallelScheduler(dag, executor, {
        maxConcurrency: 1,
        retryCount: 2,
      })
      const result = await scheduler.execute()

      expect(result.success).toBe(true)
      expect(attemptCount).toBe(2)
    })

    it("should respect max concurrency", async () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "a", name: "A", dependencies: [] })
      dag.addNode({ id: "b", name: "B", dependencies: [] })
      dag.addNode({ id: "c", name: "C", dependencies: [] })

      let runningCount = 0
      let maxRunning = 0

      const executor = async (task: TaskNode<string>) => {
        runningCount++
        maxRunning = Math.max(maxRunning, runningCount)
        await new Promise((resolve) => setTimeout(resolve, 50))
        runningCount--
        return `result-${task.id}`
      }

      const scheduler = createParallelScheduler(dag, executor, {
        maxConcurrency: 2,
      })
      await scheduler.execute()

      expect(maxRunning).toBeLessThanOrEqual(2)
    })
  })

  describe("cancellation", () => {
    it("should cancel execution", async () => {
      const dag = createTaskDAG<string>()
      dag.addNode({ id: "a", name: "A", dependencies: [] })

      const executor = async (task: TaskNode<string>) => {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        return "result"
      }

      const scheduler = createParallelScheduler(dag, executor)

      // Cancel after 50ms
      setTimeout(() => scheduler.cancel(), 50)

      const result = await scheduler.execute()
      // Cancellation marks tasks as cancelled, execution completes but with cancelled/failed tasks
      expect(result.success).toBe(false)
      expect(result.completed).toHaveLength(0)
    })
  })
})
