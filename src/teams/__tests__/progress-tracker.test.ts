import { describe, it, expect, beforeEach, vi } from "vitest"
import { ProgressTracker } from "../progress-tracker.js"
import type { CircuitBreakerConfig } from "../types.js"

describe("ProgressTracker", () => {
  let progressTracker: ProgressTracker
  const defaultConfig: CircuitBreakerConfig = {
    maxConsecutiveFailures: 3,
    maxNoProgressRounds: 2,
    cooldownMs: 60000,
  }

  beforeEach(() => {
    progressTracker = new ProgressTracker(defaultConfig, 3)
  })

  describe("constructor", () => {
    it("should create with default config", () => {
      expect(progressTracker).toBeDefined()
    })

    it("should create with custom max iterations", () => {
      const pt = new ProgressTracker(defaultConfig, 5)
      expect(pt).toBeDefined()
    })
  })

  describe("task management", () => {
    it("should add task", () => {
      progressTracker.addTask("task-1", "Test task")
      const task = progressTracker.getTaskProgress("task-1")
      expect(task).toBeDefined()
      expect(task?.taskId).toBe("task-1")
      expect(task?.objective).toBe("Test task")
      expect(task?.status).toBe("pending")
    })

    it("should update task status", () => {
      progressTracker.addTask("task-1", "Test task")
      progressTracker.updateTaskStatus("task-1", "in_progress", 50)
      const task = progressTracker.getTaskProgress("task-1")
      expect(task?.status).toBe("in_progress")
      expect(task?.progress).toBe(50)
    })

    it("should complete task", () => {
      progressTracker.addTask("task-1", "Test task")
      progressTracker.updateTaskStatus("task-1", "completed", 100)
      const progress = progressTracker.getProgress()
      expect(progress.completedTasks).toBe(1)
    })

    it("should fail task", () => {
      progressTracker.addTask("task-1", "Test task")
      progressTracker.updateTaskStatus("task-1", "failed")
      const progress = progressTracker.getProgress()
      expect(progress.failedTasks).toBe(1)
    })
  })

  describe("round management", () => {
    it("should start round", () => {
      const round = progressTracker.startRound()
      expect(round).toBe(1)
    })

    it("should increment round", () => {
      progressTracker.startRound()
      const round = progressTracker.startRound()
      expect(round).toBe(2)
    })

    it("should calculate iteration correctly", () => {
      progressTracker.startRound() // round 1 -> iteration 1
      progressTracker.startRound() // round 2 -> iteration 1
      progressTracker.startRound() // round 3 -> iteration 2
      expect(progressTracker.getCurrentIteration()).toBe(2)
    })
  })

  describe("no progress detection", () => {
    it("should detect no progress when no files changed", () => {
      progressTracker.checkNoProgress({
        changedFilesCount: 0,
        mustFixCount: 0,
        passedChecks: [],
      })

      const hasNoProgress = progressTracker.checkNoProgress({
        changedFilesCount: 0,
        mustFixCount: 0,
        passedChecks: [],
      })

      expect(hasNoProgress).toBe(true)
      expect(progressTracker.getConsecutiveNoProgressRounds()).toBe(2)
    })

    it("should not detect no progress when files changed", () => {
      const hasNoProgress = progressTracker.checkNoProgress({
        changedFilesCount: 5,
        mustFixCount: 0,
        passedChecks: [],
      })

      expect(hasNoProgress).toBe(false)
    })

    it("should detect no progress when mustFix not reduced", () => {
      progressTracker.checkNoProgress({
        changedFilesCount: 3,
        mustFixCount: 5,
        passedChecks: ["test"],
      })

      const hasNoProgress = progressTracker.checkNoProgress({
        changedFilesCount: 3,
        mustFixCount: 5,
        passedChecks: ["test"],
      })

      expect(hasNoProgress).toBe(true)
    })
  })

  describe("failure tracking", () => {
    it("should record failures", () => {
      progressTracker.recordFailure()
      expect(progressTracker.getConsecutiveFailures()).toBe(1)
    })

    it("should accumulate failures", () => {
      progressTracker.recordFailure()
      progressTracker.recordFailure()
      expect(progressTracker.getConsecutiveFailures()).toBe(2)
    })

    it("should reset failures", () => {
      progressTracker.recordFailure()
      progressTracker.resetFailures()
      expect(progressTracker.getConsecutiveFailures()).toBe(0)
    })
  })

  describe("progress calculation", () => {
    it("should calculate progress correctly", () => {
      progressTracker.addTask("task-1", "Task 1")
      progressTracker.addTask("task-2", "Task 2")
      progressTracker.updateTaskStatus("task-1", "completed", 100)

      const progress = progressTracker.getProgress()
      expect(progress.totalTasks).toBe(2)
      expect(progress.completedTasks).toBe(1)
      expect(progress.pendingTasks).toBe(1)
      expect(progress.progressPercent).toBe(50)
    })

    it("should handle zero tasks", () => {
      const progress = progressTracker.getProgress()
      expect(progress.progressPercent).toBe(0)
    })
  })

  describe("shouldContinue", () => {
    it("should return true when running and under limits", () => {
      expect(progressTracker.shouldContinue("running")).toBe(true)
    })

    it("should return false when not running", () => {
      expect(progressTracker.shouldContinue("completed")).toBe(false)
    })

    it("should return false when max iterations reached", () => {
      progressTracker.startRound()
      progressTracker.startRound()
      progressTracker.startRound()
      progressTracker.startRound()
      progressTracker.startRound()
      progressTracker.startRound()
      expect(progressTracker.shouldContinue("running")).toBe(false)
    })
  })

  describe("reset", () => {
    it("should reset all state", () => {
      progressTracker.addTask("task-1", "Task 1")
      progressTracker.startRound()
      progressTracker.recordFailure()

      progressTracker.reset()

      const progress = progressTracker.getProgress()
      expect(progress.totalTasks).toBe(0)
      expect(progress.currentRound).toBe(0)
      expect(progressTracker.getConsecutiveNoProgressRounds()).toBe(0)
    })
  })

  describe("getStats", () => {
    it("should return complete stats", () => {
      progressTracker.addTask("task-1", "Task 1")
      const stats = progressTracker.getStats()

      expect(stats).toHaveProperty("totalTasks")
      expect(stats).toHaveProperty("completedTasks")
      expect(stats).toHaveProperty("failedTasks")
      expect(stats).toHaveProperty("currentRound")
      expect(stats).toHaveProperty("currentIteration")
      expect(stats).toHaveProperty("consecutiveNoProgressRounds")
      expect(stats).toHaveProperty("consecutiveFailures")
      expect(stats).toHaveProperty("tasks")
    })
  })
})
