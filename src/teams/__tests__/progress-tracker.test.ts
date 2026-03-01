/**
 * ProgressTracker 单元测试
 */

import { describe, it, expect, beforeEach } from "vitest"
import { ProgressTracker } from "../progress-tracker.js"
import type { TaskContract, WorkArtifact } from "../contracts.js"

describe("ProgressTracker", () => {
  let tracker: ProgressTracker

  beforeEach(() => {
    tracker = new ProgressTracker(3)
  })

  describe("registerTask and startTask", () => {
    it("should register and start a task", () => {
      const contract: TaskContract = {
        taskId: "task-1",
        objective: "Test task",
        fileScope: [],
        acceptanceChecks: [],
      }

      tracker.registerTask(contract, "worker-1")
      tracker.startTask("task-1")

      const tasks = tracker.getAllTasks()
      expect(tasks).toHaveLength(1)
      expect(tasks[0].status).toBe("in-progress")
      expect(tasks[0].attempts).toBe(1)
    })
  })

  describe("completeTask", () => {
    it("should mark task as completed", () => {
      const contract: TaskContract = {
        taskId: "task-1",
        objective: "Test task",
        fileScope: [],
        acceptanceChecks: [],
      }

      const artifact: WorkArtifact = {
        taskId: "task-1",
        agentId: "worker-1",
        agentRole: "worker",
        summary: "Completed",
        changedFiles: ["file1.ts"],
        patchRef: "patch-1",
        testResults: [],
        risks: [],
        assumptions: [],
        createdAt: Date.now(),
      }

      tracker.registerTask(contract, "worker-1")
      tracker.startTask("task-1")
      tracker.completeTask("task-1", artifact)

      const tasks = tracker.getAllTasks()
      expect(tasks[0].status).toBe("completed")
    })

    it("should record changed files", () => {
      const contract: TaskContract = {
        taskId: "task-1",
        objective: "Test task",
        fileScope: [],
        acceptanceChecks: [],
      }

      const artifact: WorkArtifact = {
        taskId: "task-1",
        agentId: "worker-1",
        agentRole: "worker",
        summary: "Completed",
        changedFiles: ["file1.ts", "file2.ts"],
        patchRef: "patch-1",
        testResults: [],
        risks: [],
        assumptions: [],
        createdAt: Date.now(),
      }

      tracker.registerTask(contract, "worker-1")
      tracker.completeTask("task-1", artifact)

      const changedFiles = tracker.getChangedFiles()
      expect(changedFiles).toContain("file1.ts")
      expect(changedFiles).toContain("file2.ts")
    })
  })

  describe("failTask", () => {
    it("should mark task as failed", () => {
      const contract: TaskContract = {
        taskId: "task-1",
        objective: "Test task",
        fileScope: [],
        acceptanceChecks: [],
      }

      tracker.registerTask(contract, "worker-1")
      tracker.startTask("task-1")
      tracker.failTask("task-1")

      const tasks = tracker.getAllTasks()
      expect(tasks[0].status).toBe("failed")
    })
  })

  describe("iterations", () => {
    it("should track iterations", () => {
      tracker.startIteration()
      tracker.recordChange(["file1.ts"])
      tracker.completeIteration()

      const iterations = tracker.getIterations()
      expect(iterations).toHaveLength(1)
      expect(iterations[0].iteration).toBe(1)
      expect(iterations[0].hasProgress).toBe(true)
    })

    it("should detect no progress", () => {
      tracker.startIteration()
      tracker.completeIteration()

      tracker.startIteration()
      tracker.completeIteration()

      const noProgress = tracker.detectNoProgress(2)
      expect(noProgress).toBe(true)
    })

    it("should not detect no progress when there are changes", () => {
      tracker.startIteration()
      tracker.recordChange(["file1.ts"])
      tracker.completeIteration()

      tracker.startIteration()
      tracker.completeIteration()

      const noProgress = tracker.detectNoProgress(2)
      expect(noProgress).toBe(false)
    })
  })

  describe("getSnapshot", () => {
    it("should provide progress snapshot", () => {
      const contract1: TaskContract = {
        taskId: "task-1",
        objective: "Test task 1",
        fileScope: [],
        acceptanceChecks: [],
      }

      const contract2: TaskContract = {
        taskId: "task-2",
        objective: "Test task 2",
        fileScope: [],
        acceptanceChecks: [],
      }

      tracker.registerTask(contract1, "worker-1")
      tracker.registerTask(contract2, "worker-1")

      const artifact: WorkArtifact = {
        taskId: "task-1",
        agentId: "worker-1",
        agentRole: "worker",
        summary: "Completed",
        changedFiles: [],
        patchRef: "patch-1",
        testResults: [],
        risks: [],
        assumptions: [],
        createdAt: Date.now(),
      }

      tracker.completeTask("task-1", artifact)

      const snapshot = tracker.getSnapshot()
      expect(snapshot.totalTasks).toBe(2)
      expect(snapshot.completedTasks).toBe(1)
      expect(snapshot.failedTasks).toBe(0)
      expect(snapshot.progressPercentage).toBe(50)
    })
  })

  describe("isMaxIterationsReached", () => {
    it("should detect max iterations", () => {
      tracker.startIteration()
      tracker.completeIteration()

      tracker.startIteration()
      tracker.completeIteration()

      tracker.startIteration()
      tracker.completeIteration()

      expect(tracker.isMaxIterationsReached()).toBe(true)
    })

    it("should not detect max iterations when not reached", () => {
      tracker.startIteration()
      tracker.completeIteration()

      expect(tracker.isMaxIterationsReached()).toBe(false)
    })
  })

  describe("clear", () => {
    it("should clear all data", () => {
      const contract: TaskContract = {
        taskId: "task-1",
        objective: "Test task",
        fileScope: [],
        acceptanceChecks: [],
      }

      tracker.registerTask(contract, "worker-1")
      tracker.startIteration()
      tracker.completeIteration()

      tracker.clear()

      expect(tracker.getAllTasks()).toHaveLength(0)
      expect(tracker.getIterations()).toHaveLength(0)
      expect(tracker.getChangedFiles()).toHaveLength(0)
    })
  })
})
