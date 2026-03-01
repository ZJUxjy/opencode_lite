/**
 * Fallback Handler Tests
 */

import { describe, it, expect } from "vitest"
import {
  TeamFallbackHandler,
  createFallbackHandler,
} from "../fallback.js"
import type {
  TaskContract,
  WorkArtifact,
  ReviewArtifact,
} from "../contracts.js"

describe("TeamFallbackHandler", () => {
  const mockContract: TaskContract = {
    taskId: "task-1",
    objective: "Test task",
    fileScope: ["src/test.ts"],
    acceptanceChecks: ["npm test", "npm run lint"],
  }

  describe("initialization", () => {
    it("should create fallback handler", () => {
      const handler = createFallbackHandler("team-1", mockContract)
      expect(handler).toBeInstanceOf(TeamFallbackHandler)
    })
  })

  describe("artifact recording", () => {
    it("should record work artifacts", () => {
      const handler = createFallbackHandler("team-1", mockContract)
      const artifact: WorkArtifact = {
        taskId: "task-1",
        summary: "Initial work",
        changedFiles: ["src/test.ts"],
        patchRef: "abc123",
        testResults: [{ command: "npm test", passed: true }],
        risks: ["Potential issue"],
        assumptions: ["Node 18+"],
      }

      handler.recordArtifact(artifact)
      expect(handler.getArtifacts()).toHaveLength(1)
      expect(handler.getArtifacts()[0]).toEqual(artifact)
    })

    it("should record review artifacts", () => {
      const handler = createFallbackHandler("team-1", mockContract)
      const review: ReviewArtifact = {
        status: "changes_requested",
        severity: "P1",
        mustFix: ["Fix typo"],
        suggestions: ["Add docs"],
      }

      handler.recordReview("reviewer-1", review)
      expect(handler.getReviews().has("reviewer-1")).toBe(true)
    })

    it("should accumulate multiple artifacts", () => {
      const handler = createFallbackHandler("team-1", mockContract)

      const artifact1: WorkArtifact = {
        taskId: "task-1",
        summary: "First iteration",
        changedFiles: ["src/a.ts"],
        patchRef: "ref1",
        testResults: [],
        risks: [],
        assumptions: [],
      }

      const artifact2: WorkArtifact = {
        taskId: "task-2",
        summary: "Second iteration",
        changedFiles: ["src/b.ts"],
        patchRef: "ref2",
        testResults: [{ command: "npm test", passed: true }],
        risks: [],
        assumptions: [],
      }

      handler.recordArtifact(artifact1)
      handler.recordArtifact(artifact2)

      expect(handler.getArtifacts()).toHaveLength(2)
    })
  })

  describe("failure report generation", () => {
    it("should generate failed status report", () => {
      const handler = createFallbackHandler("team-1", mockContract)
      const report = handler.generateFailureReport("failed", new Error("Test error"))

      expect(report.teamId).toBe("team-1")
      expect(report.reason).toBe("failed")
      expect(report.message).toBe("Test error")
      expect(report.timestamp).toBeGreaterThan(0)
    })

    it("should generate timeout report", () => {
      const handler = createFallbackHandler("team-1", mockContract)
      const report = handler.generateFailureReport("timeout")

      expect(report.reason).toBe("timeout")
      expect(report.message).toBe("Team execution timed out")
    })

    it("should generate cancelled report", () => {
      const handler = createFallbackHandler("team-1", mockContract)
      const report = handler.generateFailureReport("cancelled")

      expect(report.reason).toBe("cancelled")
      expect(report.message).toBe("Team execution was cancelled")
    })

    it("should generate circuit open report", () => {
      const handler = createFallbackHandler("team-1", mockContract)
      const report = handler.generateFailureReport("running", undefined, "Circuit breaker opened")

      expect(report.reason).toBe("circuit_open")
      expect(report.message).toBe("Circuit breaker opened")
    })

    it("should include completed artifacts in report", () => {
      const handler = createFallbackHandler("team-1", mockContract)
      const artifact: WorkArtifact = {
        taskId: "task-1",
        summary: "Work done",
        changedFiles: ["src/test.ts"],
        patchRef: "abc",
        testResults: [],
        risks: [],
        assumptions: [],
      }

      handler.recordArtifact(artifact)
      const report = handler.generateFailureReport("failed")

      expect(report.completedArtifacts).toHaveLength(1)
      expect(report.completedArtifacts[0].taskId).toBe("task-1")
    })

    it("should extract pending tasks from acceptance checks", () => {
      const handler = createFallbackHandler("team-1", mockContract)
      const report = handler.generateFailureReport("failed")

      // Both acceptance checks should be pending since no artifacts recorded
      expect(report.pendingTasks).toContain("npm test")
      expect(report.pendingTasks).toContain("npm run lint")
    })
  })

  describe("budget exceeded report", () => {
    it("should generate budget exceeded report", () => {
      const handler = createFallbackHandler("team-1", mockContract)
      const budgetStatus = {
        tokens: { used: 9000, limit: 10000, percentage: 90 },
        cost: { used: 0.5, limit: 1.0, percentage: 50 },
      }

      const report = handler.generateBudgetExceededReport(budgetStatus)

      expect(report.reason).toBe("budget_exceeded")
      expect(report.message).toContain("9,000")
      expect(report.message).toContain("10,000")
      expect(report.message).toContain("90.0%")
    })
  })

  describe("fallback context", () => {
    it("should create fallback context", () => {
      const handler = createFallbackHandler("team-1", mockContract)
      const report = handler.generateFailureReport("failed", new Error("Test"))
      const context = handler.createFallbackContext(report)

      expect(context.executionMode).toBe("fallback-single-agent")
      expect(context.originalContract).toEqual(mockContract)
      expect(context.failureReport).toEqual(report)
      expect(context.accumulatedArtifacts).toEqual([])
      expect(context.finalReview).toBeNull()
    })

    it("should include final review in context", () => {
      const handler = createFallbackHandler("team-1", mockContract)
      const review: ReviewArtifact = {
        status: "approved",
        severity: "P3",
        mustFix: [],
        suggestions: ["Good job"],
      }

      handler.recordReview("reviewer-1", review)

      const report = handler.generateFailureReport("failed")
      const context = handler.createFallbackContext(report)

      expect(context.finalReview).toEqual(review)
    })
  })

  describe("agent input generation", () => {
    it("should generate agent input from context", async () => {
      const handler = createFallbackHandler("team-1", mockContract)
      const report = handler.generateFailureReport("failed", new Error("Test"))
      const context = handler.createFallbackContext(report)
      const input = handler.generateAgentInput(context)

      expect(input.mode).toBe("fallback-single-agent")
      expect(input.taskContract).toEqual(mockContract)
      expect(input.systemPrompt).toContain("FALLBACK mode")
      expect(input.systemPrompt).toContain("failed")
      expect(input.failureReport).toEqual(report)
    })

    it("should include work summary in agent input", async () => {
      const handler = createFallbackHandler("team-1", mockContract)
      const artifact: WorkArtifact = {
        taskId: "task-1",
        summary: "Work completed",
        changedFiles: ["src/a.ts", "src/b.ts"],
        patchRef: "ref",
        testResults: [{ command: "npm test", passed: true }],
        risks: ["Risk 1"],
        assumptions: ["Assumption 1"],
      }

      handler.recordArtifact(artifact)

      const report = handler.generateFailureReport("failed")
      const context = handler.createFallbackContext(report)
      const input = handler.generateAgentInput(context)

      expect(input.workContext).toContain("Work completed")
      expect(input.workContext).toContain("src/a.ts")
      expect(input.workContext).toContain("1/1 passed")
    })

    it("should include review feedback in agent input", async () => {
      const handler = createFallbackHandler("team-1", mockContract)
      const review: ReviewArtifact = {
        status: "changes_requested",
        severity: "P1",
        mustFix: ["Fix this", "Fix that"],
        suggestions: ["Consider this"],
      }

      handler.recordReview("reviewer-1", review)

      const report = handler.generateFailureReport("failed")
      const context = handler.createFallbackContext(report)
      const input = handler.generateAgentInput(context)

      expect(input.reviewFeedback).toContain("CHANGES_REQUESTED")
      expect(input.reviewFeedback).toContain("Fix this")
      expect(input.reviewFeedback).toContain("Consider this")
    })
  })

  describe("execute fallback", () => {
    it("should execute full fallback workflow", async () => {
      const handler = createFallbackHandler("team-1", mockContract)
      const artifact: WorkArtifact = {
        taskId: "task-1",
        summary: "Partial work",
        changedFiles: ["src/test.ts"],
        patchRef: "abc",
        testResults: [],
        risks: [],
        assumptions: [],
      }

      handler.recordArtifact(artifact)

      const input = await handler.executeFallback("failed", { error: new Error("Team failed") })

      expect(input.mode).toBe("fallback-single-agent")
      expect(input.failureReport.reason).toBe("failed")
      expect(input.failureReport.message).toBe("Team failed")
      expect(input.workContext).toContain("Partial work")
    })

    it("should handle budget exceeded fallback", async () => {
      const handler = createFallbackHandler("team-1", mockContract)
      const budgetStatus = {
        tokens: { used: 10000, limit: 10000, percentage: 100 },
        cost: { used: 1.0, limit: 1.0, percentage: 100 },
      }

      const input = await handler.executeFallback("failed", { budgetStatus })

      expect(input.failureReport.reason).toBe("budget_exceeded")
      expect(input.failureReport.message).toContain("10,000")
    })
  })

  describe("getters", () => {
    it("should return artifacts copy", () => {
      const handler = createFallbackHandler("team-1", mockContract)
      const artifact: WorkArtifact = {
        taskId: "task-1",
        summary: "Test",
        changedFiles: [],
        patchRef: "ref",
        testResults: [],
        risks: [],
        assumptions: [],
      }

      handler.recordArtifact(artifact)
      const artifacts = handler.getArtifacts()

      // Modifying returned array should not affect internal state
      artifacts.pop()
      expect(handler.getArtifacts()).toHaveLength(1)
    })

    it("should return reviews copy", () => {
      const handler = createFallbackHandler("team-1", mockContract)
      const review: ReviewArtifact = {
        status: "approved",
        severity: "P3",
        mustFix: [],
        suggestions: [],
      }

      handler.recordReview("r1", review)
      const reviews = handler.getReviews()

      // Modifying returned map should not affect internal state
      reviews.clear()
      expect(handler.getReviews().has("r1")).toBe(true)
    })
  })
})
