/**
 * TeamBlackboard Tests
 */

import { describe, it, expect, vi } from "vitest"
import { TeamBlackboard } from "../blackboard.js"
import type { TaskContract, WorkArtifact, ReviewArtifact } from "../contracts.js"

describe("TeamBlackboard", () => {
  describe("basic operations", () => {
    it("should store and retrieve values", () => {
      const board = new TeamBlackboard()
      board.set("key", "value")
      expect(board.get("key")).toBe("value")
    })

    it("should return undefined for missing keys", () => {
      const board = new TeamBlackboard()
      expect(board.get("missing")).toBeUndefined()
    })

    it("should check if key exists", () => {
      const board = new TeamBlackboard()
      board.set("key", "value")
      expect(board.has("key")).toBe(true)
      expect(board.has("missing")).toBe(false)
    })

    it("should delete keys", () => {
      const board = new TeamBlackboard()
      board.set("key", "value")
      expect(board.delete("key")).toBe(true)
      expect(board.has("key")).toBe(false)
      expect(board.delete("key")).toBe(false)
    })

    it("should list all keys", () => {
      const board = new TeamBlackboard()
      board.set("key1", "value1")
      board.set("key2", "value2")
      expect(board.keys()).toContain("key1")
      expect(board.keys()).toContain("key2")
    })
  })

  describe("snapshot and restore", () => {
    it("should create and restore snapshot", () => {
      const board = new TeamBlackboard()
      board.set("key1", "value1")
      board.set("key2", 123)

      const snapshot = board.snapshot()
      board.clear()

      expect(board.has("key1")).toBe(false)

      board.restore(snapshot)
      expect(board.get("key1")).toBe("value1")
      expect(board.get("key2")).toBe(123)
    })
  })

  describe("events", () => {
    it("should emit and listen to events", () => {
      const board = new TeamBlackboard()
      const listener = vi.fn()

      board.on("status-changed", listener)
      board.emit("status-changed", "running", "initializing")

      expect(listener).toHaveBeenCalledWith("running", "initializing")
    })

    it("should support once listener", () => {
      const board = new TeamBlackboard()
      const listener = vi.fn()

      board.once("status-changed", listener)
      board.emit("status-changed", "running", "initializing")
      board.emit("status-changed", "completed", "running")

      expect(listener).toHaveBeenCalledTimes(1)
    })
  })

  describe("contract helpers", () => {
    it("should store and retrieve task contract", () => {
      const board = new TeamBlackboard()
      const contract: TaskContract = {
        taskId: "task-1",
        objective: "Test task",
        fileScope: ["src/test.ts"],
        acceptanceChecks: ["npm test"],
      }

      board.setTaskContract(contract)
      const retrieved = board.getTaskContract()

      expect(retrieved).toEqual(contract)
    })

    it("should store and retrieve work artifacts", () => {
      const board = new TeamBlackboard()
      const artifact: WorkArtifact = {
        taskId: "task-1",
        summary: "Test work",
        changedFiles: ["src/test.ts"],
        patchRef: "patch-1",
        testResults: [],
        risks: [],
        assumptions: [],
      }

      board.setWorkArtifact("worker-1", artifact)
      const retrieved = board.getWorkArtifact("worker-1")

      expect(retrieved).toEqual(artifact)
    })

    it("should store and retrieve review artifacts", () => {
      const board = new TeamBlackboard()
      const artifact: ReviewArtifact = {
        status: "approved",
        severity: "P3",
        mustFix: [],
        suggestions: ["Good job"],
      }

      board.setReviewArtifact("reviewer-1", artifact)
      const retrieved = board.getReviewArtifact("reviewer-1")

      expect(retrieved).toEqual(artifact)
    })
  })

  describe("message passing", () => {
    it("should post and retrieve messages", () => {
      const board = new TeamBlackboard()

      board.postMessage({ type: "task-assign", task: { taskId: "t1", objective: "test", fileScope: [], acceptanceChecks: [] } }, "system", "worker")

      const messages = board.getMessages()
      expect(messages).toHaveLength(1)
      expect(messages[0].from).toBe("system")
      expect(messages[0].to).toBe("worker")
    })

    it("should filter messages by type", () => {
      const board = new TeamBlackboard()

      board.postMessage({ type: "task-result", artifact: { taskId: "t1", summary: "", changedFiles: [], patchRef: "", testResults: [], risks: [], assumptions: [] } }, "worker")
      board.postMessage({ type: "review-result", review: { status: "approved", severity: "P3", mustFix: [], suggestions: [] } }, "reviewer")

      const taskMessages = board.getMessages({ type: "task-result" })
      expect(taskMessages).toHaveLength(1)
    })
  })

  describe("audit log", () => {
    it("should log events", () => {
      const board = new TeamBlackboard()
      board.logEvent("test-event", { key: "value" })

      const logs = board.getAuditLog()
      expect(logs.length).toBeGreaterThan(0)
      expect(logs[logs.length - 1].event).toBe("test-event")
    })
  })
})
