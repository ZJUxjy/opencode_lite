/**
 * SharedBlackboard 单元测试
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { SharedBlackboard } from "../blackboard.js"
import type { TaskContract, WorkArtifact, ReviewArtifact } from "../contracts.js"
import type { AgentStatus } from "../blackboard.js"

describe("SharedBlackboard", () => {
  let blackboard: SharedBlackboard

  beforeEach(() => {
    blackboard = new SharedBlackboard()
  })

  describe("publishTask", () => {
    it("should publish task and emit event", () => {
      const contract: TaskContract = {
        taskId: "task-1",
        objective: "Test task",
        fileScope: [],
        acceptanceChecks: [],
      }

      const listener = vi.fn()
      blackboard.on("task-assigned", listener)

      blackboard.publishTask(contract, "worker-1")

      expect(listener).toHaveBeenCalledWith({
        contract,
        assignedTo: "worker-1",
      })

      const retrieved = blackboard.getTask("task-1")
      expect(retrieved).toEqual(contract)
    })
  })

  describe("submitWork", () => {
    it("should submit work artifact and emit event", () => {
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

      const listener = vi.fn()
      blackboard.on("work-submitted", listener)

      blackboard.submitWork(artifact)

      expect(listener).toHaveBeenCalledWith(artifact)

      const retrieved = blackboard.getWork("task-1")
      expect(retrieved).toEqual(artifact)
    })
  })

  describe("submitReview", () => {
    it("should submit review artifact and emit event", () => {
      const review: ReviewArtifact = {
        workArtifactId: "task-1",
        reviewerId: "reviewer-1",
        status: "approved",
        severity: "P1",
        mustFix: [],
        suggestions: [],
        createdAt: Date.now(),
      }

      const listener = vi.fn()
      blackboard.on("review-completed", listener)

      blackboard.submitReview(review)

      expect(listener).toHaveBeenCalledWith(review)

      const retrieved = blackboard.getReview("task-1")
      expect(retrieved).toEqual(review)
    })
  })

  describe("updateAgentStatus", () => {
    it("should update agent status and emit event", () => {
      const status: AgentStatus = {
        agentId: "worker-1",
        role: "worker",
        status: "working",
        currentTask: "task-1",
        lastUpdate: Date.now(),
      }

      const listener = vi.fn()
      blackboard.on("agent-status-changed", listener)

      blackboard.updateAgentStatus(status)

      expect(listener).toHaveBeenCalledWith(status)

      const retrieved = blackboard.getAgentStatus("worker-1")
      expect(retrieved).toEqual(status)
    })

    it("should get all agent statuses", () => {
      const status1: AgentStatus = {
        agentId: "worker-1",
        role: "worker",
        status: "working",
        lastUpdate: Date.now(),
      }

      const status2: AgentStatus = {
        agentId: "reviewer-1",
        role: "reviewer",
        status: "waiting",
        lastUpdate: Date.now(),
      }

      blackboard.updateAgentStatus(status1)
      blackboard.updateAgentStatus(status2)

      const allStatuses = blackboard.getAllAgentStatuses()
      expect(allStatuses).toHaveLength(2)
    })
  })

  describe("reportConflict", () => {
    it("should report conflict and emit event", () => {
      const listener = vi.fn()
      blackboard.on("conflict-detected", listener)

      blackboard.reportConflict(["file1.ts", "file2.ts"], ["worker-1", "worker-2"])

      expect(listener).toHaveBeenCalledWith({
        files: ["file1.ts", "file2.ts"],
        involvedAgents: ["worker-1", "worker-2"],
      })
    })
  })

  describe("clear", () => {
    it("should clear all data and listeners", () => {
      const contract: TaskContract = {
        taskId: "task-1",
        objective: "Test task",
        fileScope: [],
        acceptanceChecks: [],
      }

      const listener = vi.fn()
      blackboard.on("task-assigned", listener)

      blackboard.publishTask(contract, "worker-1")
      blackboard.clear()

      expect(blackboard.getTask("task-1")).toBeUndefined()
      expect(blackboard.getAllAgentStatuses()).toHaveLength(0)

      // 验证listeners被清除
      blackboard.publishTask(contract, "worker-1")
      expect(listener).toHaveBeenCalledTimes(1) // 只有clear前的调用
    })
  })
})
