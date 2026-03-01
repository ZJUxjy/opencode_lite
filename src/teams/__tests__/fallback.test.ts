import { describe, it, expect, beforeEach } from "vitest"
import { FallbackExecutor } from "../fallback.js"
import type { TaskContract, WorkArtifact, ReviewArtifact } from "../contracts.js"

describe("FallbackExecutor", () => {
  let fallbackExecutor: FallbackExecutor
  const teamId = "team-001"

  beforeEach(() => {
    fallbackExecutor = new FallbackExecutor(teamId)
  })

  describe("generateFailureReport", () => {
    it("should generate failure report for failed status", () => {
      const completedTasks: TaskContract[] = [
        { taskId: "task-1", objective: "Task 1", fileScope: ["file1.ts"], acceptanceChecks: ["test"] },
      ]
      const pendingTasks: TaskContract[] = [
        { taskId: "task-2", objective: "Task 2", fileScope: ["file2.ts"], acceptanceChecks: ["test"] },
      ]
      const lastArtifact: WorkArtifact = {
        taskId: "task-1",
        summary: "Completed task 1",
        changedFiles: ["file1.ts"],
        patchRef: "abc123",
        testResults: [{ command: "test", passed: true }],
        risks: [],
        assumptions: [],
      }
      const lastReview: ReviewArtifact = {
        status: "approved",
        severity: "P2",
        mustFix: [],
        suggestions: [],
      }

      const report = fallbackExecutor.generateFailureReport({
        status: "failed",
        completedTasks,
        pendingTasks,
        lastArtifact,
        lastReview,
        currentObjective: "Complete all tasks",
      })

      expect(report.teamId).toBe(teamId)
      expect(report.reason).toBe("failed")
      expect(report.completedTasks).toEqual(["task-1"])
      expect(report.pendingTasks).toEqual(["task-2"])
      expect(report.lastArtifact).toBeDefined()
      expect(report.recoveryPrompt).toContain("Team执行失败")
    })

    it("should generate report for timeout status", () => {
      const report = fallbackExecutor.generateFailureReport({
        status: "timeout",
        completedTasks: [],
        pendingTasks: [],
        currentObjective: "Complete task",
      })

      expect(report.reason).toBe("timeout")
      expect(report.recoveryPrompt).toContain("timeout")
    })

    it("should handle cancelled status", () => {
      const report = fallbackExecutor.generateFailureReport({
        status: "cancelled",
        completedTasks: [],
        pendingTasks: [],
        currentObjective: "Complete task",
      })

      expect(report.reason).toBe("cancelled")
    })
  })

  describe("createFallbackContext", () => {
    it("should create fallback context", () => {
      const report = fallbackExecutor.generateFailureReport({
        status: "failed",
        completedTasks: [],
        pendingTasks: [{ taskId: "task-1", objective: "Task 1", fileScope: [], acceptanceChecks: [] }],
        currentObjective: "Test",
      })

      const context = fallbackExecutor.createFallbackContext(report)

      expect(context.teamId).toBe(teamId)
      expect(context.executionMode).toBe("fallback-single-agent")
      expect(context.shouldResume).toBe(true)
      expect(context.recoveryPrompt).toBeDefined()
    })
  })

  describe("canFallback", () => {
    it("should return true when there are pending tasks", () => {
      const report = fallbackExecutor.generateFailureReport({
        status: "failed",
        completedTasks: [],
        pendingTasks: [{ taskId: "task-1", objective: "Task 1", fileScope: [], acceptanceChecks: [] }],
        currentObjective: "Test",
      })

      expect(fallbackExecutor.canFallback(report)).toBe(true)
    })

    it("should return false when no pending tasks", () => {
      const report = fallbackExecutor.generateFailureReport({
        status: "failed",
        completedTasks: [{ taskId: "task-1", objective: "Task 1", fileScope: [], acceptanceChecks: [] }],
        pendingTasks: [],
        currentObjective: "Test",
      })

      expect(fallbackExecutor.canFallback(report)).toBe(false)
    })

    it("should return false when budget exceeded", () => {
      const report = fallbackExecutor.generateFailureReport({
        status: "failed",
        completedTasks: [],
        pendingTasks: [{ taskId: "task-1", objective: "Task 1", fileScope: [], acceptanceChecks: [] }],
        currentObjective: "Test",
      })
      report.reason = "budget_exceeded"

      expect(fallbackExecutor.canFallback(report)).toBe(false)
    })
  })

  describe("recovery prompt", () => {
    it("should include completed tasks in prompt", () => {
      const completedTasks: TaskContract[] = [
        { taskId: "task-1", objective: "Task 1", fileScope: ["file1.ts"], acceptanceChecks: [] },
      ]

      const report = fallbackExecutor.generateFailureReport({
        status: "failed",
        completedTasks,
        pendingTasks: [],
        currentObjective: "Test",
      })

      expect(report.recoveryPrompt).toContain("已完成任务")
      expect(report.recoveryPrompt).toContain("task-1")
    })

    it("should include pending tasks in prompt", () => {
      const pendingTasks: TaskContract[] = [
        { taskId: "task-2", objective: "Task 2", fileScope: ["file2.ts"], acceptanceChecks: [] },
      ]

      const report = fallbackExecutor.generateFailureReport({
        status: "failed",
        completedTasks: [],
        pendingTasks,
        currentObjective: "Test",
      })

      expect(report.recoveryPrompt).toContain("待完成任务")
      expect(report.recoveryPrompt).toContain("task-2")
    })

    it("should include last review mustFix in prompt", () => {
      const lastReview: ReviewArtifact = {
        status: "changes_requested",
        severity: "P1",
        mustFix: ["Fix bug in login"],
        suggestions: ["Add unit test"],
      }

      const report = fallbackExecutor.generateFailureReport({
        status: "failed",
        completedTasks: [],
        pendingTasks: [],
        lastReview,
        currentObjective: "Test",
      })

      expect(report.recoveryPrompt).toContain("最后Review结果")
      expect(report.recoveryPrompt).toContain("必须修复")
      expect(report.recoveryPrompt).toContain("Fix bug in login")
    })

    it("should include original objective in prompt", () => {
      const report = fallbackExecutor.generateFailureReport({
        status: "failed",
        completedTasks: [],
        pendingTasks: [],
        currentObjective: "Implement user authentication",
      })

      expect(report.recoveryPrompt).toContain("原始目标")
      expect(report.recoveryPrompt).toContain("Implement user authentication")
    })
  })
})
