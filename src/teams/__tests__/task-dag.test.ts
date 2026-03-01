/**
 * Task DAG tests
 */

import { describe, it, expect, beforeEach } from "vitest"
import {
  TaskDAG,
  createTaskNode,
  createDAGFromContracts,
  type TaskNode,
} from "../task-dag.js"
import type { TaskContract } from "../contracts.js"

describe("TaskDAG", () => {
  let dag: TaskDAG

  beforeEach(() => {
    dag = new TaskDAG()
  })

  describe("addTask", () => {
    it("should add a task node", () => {
      const contract: TaskContract = {
        taskId: "task-1",
        objective: "Test task",
        fileScope: [],
        acceptanceChecks: [],
      }

      const node = createTaskNode(contract)
      dag.addTask(node)

      expect(dag.getTask("task-1")).toBe(node)
    })

    it("should add multiple tasks with dependencies", () => {
      const contract1: TaskContract = {
        taskId: "task-1",
        objective: "First task",
        fileScope: [],
        acceptanceChecks: [],
      }

      const contract2: TaskContract = {
        taskId: "task-2",
        objective: "Second task",
        fileScope: [],
        acceptanceChecks: [],
        dependencies: ["task-1"],
      }

      dag.addTask(createTaskNode(contract1))
      dag.addTask(createTaskNode(contract2, ["task-1"]))

      expect(dag.getTask("task-1")).toBeDefined()
      expect(dag.getTask("task-2")).toBeDefined()
    })
  })

  describe("detectCycle", () => {
    it("should detect no cycle in a simple DAG", () => {
      const contract1: TaskContract = {
        taskId: "task-1",
        objective: "First",
        fileScope: [],
        acceptanceChecks: [],
      }

      const contract2: TaskContract = {
        taskId: "task-2",
        objective: "Second",
        fileScope: [],
        acceptanceChecks: [],
        dependencies: ["task-1"],
      }

      dag.addTask(createTaskNode(contract1))
      dag.addTask(createTaskNode(contract2, ["task-1"]))

      const result = dag.detectCycle()
      expect(result.hasCycle).toBe(false)
    })

    it("should detect a cycle", () => {
      // Create a simple 2-node cycle: task-1 -> task-2 -> task-1
      const contract1: TaskContract = {
        taskId: "task-1",
        objective: "First",
        fileScope: [],
        acceptanceChecks: [],
      }

      const contract2: TaskContract = {
        taskId: "task-2",
        objective: "Second",
        fileScope: [],
        acceptanceChecks: [],
      }

      // Add task-1 first (no dependencies initially)
      dag.addTask(createTaskNode(contract1))
      // Add task-2 depending on task-1
      dag.addTask(createTaskNode(contract2, ["task-1"]))

      // Now manually create the cycle by making task-1 depend on task-2
      const task1 = dag.getTask("task-1")!
      task1.dependencies = ["task-2"]

      // Manually update the adjacency lists to reflect the cycle
      const adj = (dag as any).adjacencyList as Map<string, string[]>
      const revAdj = (dag as any).reverseAdjacency as Map<string, string[]>

      // task-2 now points to task-1 (task-1 depends on task-2)
      adj.get("task-2")?.push("task-1")
      revAdj.get("task-1")?.push("task-2")

      const result = dag.detectCycle()
      expect(result.hasCycle).toBe(true)
    })
  })

  describe("topologicalSort", () => {
    it("should return correct order for simple DAG", () => {
      const contract1: TaskContract = {
        taskId: "task-1",
        objective: "First",
        fileScope: [],
        acceptanceChecks: [],
      }

      const contract2: TaskContract = {
        taskId: "task-2",
        objective: "Second",
        fileScope: [],
        acceptanceChecks: [],
        dependencies: ["task-1"],
      }

      const contract3: TaskContract = {
        taskId: "task-3",
        objective: "Third",
        fileScope: [],
        acceptanceChecks: [],
        dependencies: ["task-2"],
      }

      dag.addTask(createTaskNode(contract1))
      dag.addTask(createTaskNode(contract2, ["task-1"]))
      dag.addTask(createTaskNode(contract3, ["task-2"]))

      const order = dag.topologicalSort()

      expect(order.indexOf("task-1")).toBeLessThan(order.indexOf("task-2"))
      expect(order.indexOf("task-2")).toBeLessThan(order.indexOf("task-3"))
    })

    it("should return empty array for cyclic DAG", () => {
      const contract1: TaskContract = {
        taskId: "task-1",
        objective: "First",
        fileScope: [],
        acceptanceChecks: [],
      }

      const contract2: TaskContract = {
        taskId: "task-2",
        objective: "Second",
        fileScope: [],
        acceptanceChecks: [],
      }

      // Create a cycle: task-1 -> task-2 -> task-1
      dag.addTask(createTaskNode(contract1))
      dag.addTask(createTaskNode(contract2, ["task-1"]))

      // Add task-1 dependency on task-2 to complete the cycle
      const task1 = dag.getTask("task-1")!
      task1.dependencies = ["task-2"]
      const adj = (dag as any).adjacencyList as Map<string, string[]>
      adj.get("task-2")?.push("task-1")
      const revAdj = (dag as any).reverseAdjacency as Map<string, string[]>
      revAdj.get("task-1")?.push("task-2")

      const order = dag.topologicalSort()
      expect(order).toEqual([])
    })
  })

  describe("generateExecutionPlan", () => {
    it("should generate correct execution plan", () => {
      const contract1: TaskContract = {
        taskId: "task-1",
        objective: "First",
        fileScope: ["file1.ts"],
        acceptanceChecks: [],
        estimatedTokens: 1000,
      }

      const contract2: TaskContract = {
        taskId: "task-2",
        objective: "Second",
        fileScope: ["file2.ts"],
        acceptanceChecks: [],
        dependencies: ["task-1"],
        estimatedTokens: 2000,
      }

      const contract3: TaskContract = {
        taskId: "task-3",
        objective: "Third (parallel with task-2)",
        fileScope: ["file3.ts"],
        acceptanceChecks: [],
        dependencies: ["task-1"],
        estimatedTokens: 1500,
      }

      dag.addTask(createTaskNode(contract1))
      dag.addTask(createTaskNode(contract2, ["task-1"]))
      dag.addTask(createTaskNode(contract3, ["task-1"]))

      const plan = dag.generateExecutionPlan()

      expect(plan.hasCycle).toBe(false)
      expect(plan.totalTasks).toBe(3)
      expect(plan.levels.length).toBe(2)
      expect(plan.levels[0].tasks.length).toBe(1) // task-1
      expect(plan.levels[1].tasks.length).toBe(2) // task-2, task-3
      expect(plan.maxParallelism).toBe(2)
      expect(plan.estimatedTotalTokens).toBe(4500)
    })
  })

  describe("getExecutableTasks", () => {
    it("should return tasks with all dependencies met", () => {
      const contract1: TaskContract = {
        taskId: "task-1",
        objective: "First",
        fileScope: [],
        acceptanceChecks: [],
      }

      const contract2: TaskContract = {
        taskId: "task-2",
        objective: "Second",
        fileScope: [],
        acceptanceChecks: [],
        dependencies: ["task-1"],
      }

      dag.addTask(createTaskNode(contract1))
      dag.addTask(createTaskNode(contract2, ["task-1"]))

      // Initially only task-1 is executable
      let executable = dag.getExecutableTasks()
      expect(executable.length).toBe(1)
      expect(executable[0].id).toBe("task-1")

      // Complete task-1
      dag.updateTaskStatus("task-1", "completed")

      // Now task-2 should be executable
      executable = dag.getExecutableTasks()
      expect(executable.length).toBe(1)
      expect(executable[0].id).toBe("task-2")
    })
  })

  describe("getDependencyChain", () => {
    it("should return all upstream dependencies", () => {
      const contract1: TaskContract = {
        taskId: "task-1",
        objective: "First",
        fileScope: [],
        acceptanceChecks: [],
      }

      const contract2: TaskContract = {
        taskId: "task-2",
        objective: "Second",
        fileScope: [],
        acceptanceChecks: [],
        dependencies: ["task-1"],
      }

      const contract3: TaskContract = {
        taskId: "task-3",
        objective: "Third",
        fileScope: [],
        acceptanceChecks: [],
        dependencies: ["task-2"],
      }

      dag.addTask(createTaskNode(contract1))
      dag.addTask(createTaskNode(contract2, ["task-1"]))
      dag.addTask(createTaskNode(contract3, ["task-2"]))

      const chain = dag.getDependencyChain("task-3")

      expect(chain).toContain("task-1")
      expect(chain).toContain("task-2")
    })
  })

  describe("getImpactScope", () => {
    it("should return all downstream affected tasks", () => {
      const contract1: TaskContract = {
        taskId: "task-1",
        objective: "First",
        fileScope: [],
        acceptanceChecks: [],
      }

      const contract2: TaskContract = {
        taskId: "task-2",
        objective: "Second",
        fileScope: [],
        acceptanceChecks: [],
        dependencies: ["task-1"],
      }

      const contract3: TaskContract = {
        taskId: "task-3",
        objective: "Third",
        fileScope: [],
        acceptanceChecks: [],
        dependencies: ["task-2"],
      }

      dag.addTask(createTaskNode(contract1))
      dag.addTask(createTaskNode(contract2, ["task-1"]))
      dag.addTask(createTaskNode(contract3, ["task-2"]))

      const scope = dag.getImpactScope("task-1")

      expect(scope).toContain("task-2")
      expect(scope).toContain("task-3")
    })
  })

  describe("getStats", () => {
    it("should return correct statistics", () => {
      const contract1: TaskContract = {
        taskId: "task-1",
        objective: "First",
        fileScope: [],
        acceptanceChecks: [],
      }

      const contract2: TaskContract = {
        taskId: "task-2",
        objective: "Second",
        fileScope: [],
        acceptanceChecks: [],
      }

      dag.addTask(createTaskNode(contract1))
      dag.addTask(createTaskNode(contract2))

      dag.updateTaskStatus("task-1", "completed")

      const stats = dag.getStats()

      expect(stats.total).toBe(2)
      expect(stats.completed).toBe(1)
      expect(stats.pending).toBe(1)
    })
  })
})

describe("createDAGFromContracts", () => {
  it("should create DAG from contracts", () => {
    const contracts: TaskContract[] = [
      {
        taskId: "task-1",
        objective: "First",
        fileScope: [],
        acceptanceChecks: [],
      },
      {
        taskId: "task-2",
        objective: "Second",
        fileScope: [],
        acceptanceChecks: [],
        dependencies: ["task-1"],
      },
    ]

    const dag = createDAGFromContracts(contracts)

    expect(dag.getTask("task-1")).toBeDefined()
    expect(dag.getTask("task-2")).toBeDefined()
    expect(dag.detectCycle().hasCycle).toBe(false)
  })
})
