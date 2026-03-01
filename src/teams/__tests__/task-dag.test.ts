import { describe, it, expect, beforeEach } from "vitest"
import { TaskDAG } from "../task-dag.js"
import type { TaskContract } from "../contracts.js"

describe("TaskDAG", () => {
  let dag: TaskDAG

  const createTask = (id: string): TaskContract => ({
    taskId: id,
    objective: `Task ${id}`,
    fileScope: [`src/${id}.ts`],
    acceptanceChecks: ["test"],
  })

  beforeEach(() => {
    dag = new TaskDAG()
  })

  describe("addTask", () => {
    it("should add task without dependencies", () => {
      dag.addTask(createTask("task-1"))
      const tasks = dag.getAllTasks()
      expect(tasks).toHaveLength(1)
      expect(tasks[0].taskId).toBe("task-1")
    })

    it("should add task with dependencies", () => {
      dag.addTask(createTask("task-1"))
      dag.addTask(createTask("task-2"), ["task-1"])
      const deps = dag.getDependencies("task-2")
      expect(deps).toContain("task-1")
    })

    it("should reject duplicate task", () => {
      dag.addTask(createTask("task-1"))
      expect(() => dag.addTask(createTask("task-1"))).toThrow()
    })

    it("should reject self-dependency", () => {
      expect(() => dag.addTask(createTask("task-1"), ["task-1"])).toThrow()
    })

    it("should reject non-existent dependency", () => {
      expect(() => dag.addTask(createTask("task-2"), ["task-1"])).toThrow()
    })
  })

  describe("topologicalSort", () => {
    it("should sort linear dependencies", () => {
      dag.addTask(createTask("task-1"))
      dag.addTask(createTask("task-2"), ["task-1"])
      dag.addTask(createTask("task-3"), ["task-2"])

      const sorted = dag.topologicalSort()
      expect(sorted).toEqual(["task-1", "task-2", "task-3"])
    })

    it("should sort parallel tasks first", () => {
      dag.addTask(createTask("task-1"))
      dag.addTask(createTask("task-2"))
      dag.addTask(createTask("task-3"), ["task-1", "task-2"])

      const sorted = dag.topologicalSort()
      const idx1 = sorted.indexOf("task-1")
      const idx2 = sorted.indexOf("task-2")
      const idx3 = sorted.indexOf("task-3")

      expect(idx3).toBeGreaterThan(idx1)
      expect(idx3).toBeGreaterThan(idx2)
    })

    it("should prevent adding circular dependencies", () => {
      // DAG 先添加 task-1 -> task-2 -> task-3
      dag.addTask(createTask("task-1"))
      dag.addTask(createTask("task-2"), ["task-1"])
      dag.addTask(createTask("task-3"), ["task-2"])

      // 尝试添加反向依赖会形成循环
      expect(() => dag.addTask(createTask("task-1"), ["task-3"])).toThrow()
    })
  })

  describe("getParallelizableTasks", () => {
    it("should return tasks with no dependencies", () => {
      dag.addTask(createTask("task-1"))
      dag.addTask(createTask("task-2"))
      dag.addTask(createTask("task-3"), ["task-1"])

      const parallel = dag.getParallelizableTasks(new Set())
      expect(parallel).toHaveLength(2)
      expect(parallel).toContain("task-1")
      expect(parallel).toContain("task-2")
    })

    it("should return completed dependencies tasks", () => {
      dag.addTask(createTask("task-1"))
      dag.addTask(createTask("task-2"), ["task-1"])

      const parallel = dag.getParallelizableTasks(new Set(["task-1"]))
      expect(parallel).toContain("task-2")
    })
  })

  describe("getCriticalPath", () => {
    it("should return longest dependency chain", () => {
      dag.addTask(createTask("task-1"))
      dag.addTask(createTask("task-2"), ["task-1"])
      dag.addTask(createTask("task-3"), ["task-1"])
      dag.addTask(createTask("task-4"), ["task-2", "task-3"])

      const path = dag.getCriticalPath()
      expect(path).toContain("task-1")
      expect(path).toContain("task-4")
    })
  })

  describe("task status", () => {
    it("should update task status", () => {
      dag.addTask(createTask("task-1"))
      dag.updateTaskStatus("task-1", "in_progress")
      expect(dag.getTaskStatus("task-1")).toBe("in_progress")
    })

    it("should complete task", () => {
      dag.addTask(createTask("task-1"))
      dag.updateTaskStatus("task-1", "completed")
      expect(dag.getTaskStatus("task-1")).toBe("completed")
    })
  })

  describe("getStats", () => {
    it("should return correct stats", () => {
      dag.addTask(createTask("task-1"))
      dag.addTask(createTask("task-2"))
      dag.updateTaskStatus("task-1", "completed")

      const stats = dag.getStats()
      expect(stats.totalTasks).toBe(2)
      expect(stats.completed).toBe(1)
      expect(stats.pending).toBe(1)
    })
  })

  describe("serialization", () => {
    it("should serialize and deserialize", () => {
      dag.addTask(createTask("task-1"))
      dag.addTask(createTask("task-2"), ["task-1"])
      dag.updateTaskStatus("task-1", "completed")

      const snapshot = dag.toJSON()
      const restored = TaskDAG.fromJSON(snapshot)

      expect(restored.getAllTasks()).toHaveLength(2)
      expect(restored.getTaskStatus("task-1")).toBe("completed")
    })
  })

  describe("hasCycle", () => {
    it("should return false for DAG", () => {
      dag.addTask(createTask("task-1"))
      dag.addTask(createTask("task-2"), ["task-1"])
      expect(dag.hasCycle()).toBe(false)
    })

    it("should prevent cycle creation", () => {
      dag.addTask(createTask("task-1"))
      dag.addTask(createTask("task-2"), ["task-1"])
      // 尝试添加 task-1 -> task-2 会形成循环
      expect(() => dag.addTask(createTask("task-2"), ["task-1"])).toThrow()
      expect(dag.hasCycle()).toBe(false)
    })
  })
})
