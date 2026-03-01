/**
 * Team Run Store Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { TeamRunStore, createTeamRunStore } from "../team-run-store.js"

describe("TeamRunStore", () => {
  let tempDir: string
  let store: TeamRunStore

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "team-run-test-"))
    store = createTeamRunStore(path.join(tempDir, "test.db"))
  })

  afterEach(() => {
    store.close()
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe("initialization", () => {
    it("should create team run store", () => {
      expect(store).toBeInstanceOf(TeamRunStore)
    })
  })

  describe("create", () => {
    it("should create a team run record", () => {
      const run = store.create({
        sessionId: "session-123",
        mode: "worker-reviewer",
        objective: "Implement feature X",
        fileScope: ["src/x.ts"],
        agentCount: 2,
      })

      expect(run.id).toBeDefined()
      expect(run.sessionId).toBe("session-123")
      expect(run.mode).toBe("worker-reviewer")
      expect(run.status).toBe("running")
      expect(run.agentCount).toBe(2)
      expect(run.tokensUsed).toEqual({ input: 0, output: 0 })
      expect(run.costUsd).toBe(0)
      expect(run.isFallback).toBe(false)
    })

    it("should create with strategy for leader-workers", () => {
      const run = store.create({
        sessionId: "session-123",
        mode: "leader-workers",
        strategy: "collaborative",
        agentCount: 3,
      })

      expect(run.mode).toBe("leader-workers")
      expect(run.strategy).toBe("collaborative")
      expect(run.agentCount).toBe(3)
    })

    it("should store file scope as array", () => {
      const run = store.create({
        sessionId: "session-123",
        mode: "worker-reviewer",
        fileScope: ["src/a.ts", "src/b.ts"],
        agentCount: 2,
      })

      expect(run.fileScope).toEqual(["src/a.ts", "src/b.ts"])
    })
  })

  describe("get", () => {
    it("should retrieve a team run by id", () => {
      const created = store.create({
        sessionId: "session-123",
        mode: "worker-reviewer",
        agentCount: 2,
      })

      const retrieved = store.get(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe(created.id)
      expect(retrieved!.sessionId).toBe("session-123")
    })

    it("should return null for non-existent id", () => {
      const retrieved = store.get("non-existent-id")
      expect(retrieved).toBeNull()
    })
  })

  describe("list", () => {
    it("should list all team runs", () => {
      store.create({ sessionId: "s1", mode: "worker-reviewer", agentCount: 2 })
      store.create({ sessionId: "s1", mode: "planner-executor-reviewer", agentCount: 3 })
      store.create({ sessionId: "s2", mode: "council", agentCount: 3 })

      const runs = store.list()
      expect(runs).toHaveLength(3)
    })

    it("should filter by session id", () => {
      store.create({ sessionId: "s1", mode: "worker-reviewer", agentCount: 2 })
      store.create({ sessionId: "s1", mode: "worker-reviewer", agentCount: 2 })
      store.create({ sessionId: "s2", mode: "worker-reviewer", agentCount: 2 })

      const runs = store.list({ sessionId: "s1" })
      expect(runs).toHaveLength(2)
    })

    it("should filter by mode", () => {
      store.create({ sessionId: "s1", mode: "worker-reviewer", agentCount: 2 })
      store.create({ sessionId: "s1", mode: "council", agentCount: 3 })
      store.create({ sessionId: "s1", mode: "council", agentCount: 3 })

      const runs = store.list({ mode: "council" })
      expect(runs).toHaveLength(2)
    })

    it("should filter by status", () => {
      const run1 = store.create({ sessionId: "s1", mode: "worker-reviewer", agentCount: 2 })
      const run2 = store.create({ sessionId: "s1", mode: "worker-reviewer", agentCount: 2 })
      store.complete(run1.id, { tokensUsed: { input: 100, output: 50 }, costUsd: 0.01, iterations: 3 })
      store.fail(run2.id, "timeout")

      const completed = store.list({ status: "completed" })
      expect(completed).toHaveLength(1)
    })

    it("should limit results", () => {
      for (let i = 0; i < 10; i++) {
        store.create({ sessionId: "s1", mode: "worker-reviewer", agentCount: 2 })
      }

      const runs = store.list({ limit: 5 })
      expect(runs).toHaveLength(5)
    })
  })

  describe("update", () => {
    it("should update tokens used", () => {
      const run = store.create({
        sessionId: "s1",
        mode: "worker-reviewer",
        agentCount: 2,
      })

      store.update(run.id, {
        tokensUsed: { input: 1000, output: 500 },
        costUsd: 0.05,
        iterations: 3,
      })

      const updated = store.get(run.id)
      expect(updated!.tokensUsed).toEqual({ input: 1000, output: 500 })
      expect(updated!.costUsd).toBe(0.05)
      expect(updated!.iterations).toBe(3)
    })

    it("should update status", () => {
      const run = store.create({
        sessionId: "s1",
        mode: "worker-reviewer",
        agentCount: 2,
      })

      store.update(run.id, { status: "completed", endedAt: Date.now() })

      const updated = store.get(run.id)
      expect(updated!.status).toBe("completed")
      expect(updated!.endedAt).toBeDefined()
    })
  })

  describe("complete", () => {
    it("should mark run as completed", () => {
      const run = store.create({
        sessionId: "s1",
        mode: "worker-reviewer",
        agentCount: 2,
      })

      store.complete(run.id, {
        tokensUsed: { input: 2000, output: 1000 },
        costUsd: 0.1,
        iterations: 3,
      })

      const completed = store.get(run.id)
      expect(completed!.status).toBe("completed")
      expect(completed!.tokensUsed.input).toBe(2000)
      expect(completed!.costUsd).toBe(0.1)
      expect(completed!.endedAt).toBeDefined()
    })
  })

  describe("fail", () => {
    it("should mark run as failed with reason", () => {
      const run = store.create({
        sessionId: "s1",
        mode: "worker-reviewer",
        agentCount: 2,
      })

      store.fail(run.id, "Budget exceeded", {
        tokensUsed: { input: 50000, output: 20000 },
        costUsd: 2.5,
        iterations: 5,
      })

      const failed = store.get(run.id)
      expect(failed!.status).toBe("failed")
      expect(failed!.failureReason).toBe("Budget exceeded")
      expect(failed!.tokensUsed.input).toBe(50000)
    })

    it("should mark run as failed without stats", () => {
      const run = store.create({
        sessionId: "s1",
        mode: "worker-reviewer",
        agentCount: 2,
      })

      store.fail(run.id, "Circuit breaker opened")

      const failed = store.get(run.id)
      expect(failed!.status).toBe("failed")
      expect(failed!.failureReason).toBe("Circuit breaker opened")
    })
  })

  describe("markAsFallback", () => {
    it("should mark run as fallback", () => {
      const run = store.create({
        sessionId: "s1",
        mode: "worker-reviewer",
        agentCount: 2,
      })

      store.markAsFallback(run.id)

      const updated = store.get(run.id)
      expect(updated!.isFallback).toBe(true)
    })
  })

  describe("delete", () => {
    it("should delete a team run", () => {
      const run = store.create({
        sessionId: "s1",
        mode: "worker-reviewer",
        agentCount: 2,
      })

      const deleted = store.delete(run.id)
      expect(deleted).toBe(true)
      expect(store.get(run.id)).toBeNull()
    })

    it("should return false for non-existent id", () => {
      const deleted = store.delete("non-existent")
      expect(deleted).toBe(false)
    })

    it("should delete associated checkpoint refs", () => {
      const run = store.create({
        sessionId: "s1",
        mode: "worker-reviewer",
        agentCount: 2,
      })

      store.createCheckpointRef({
        teamRunId: run.id,
        teamId: "team-123",
        iteration: 1,
        progress: 50,
        phase: "running",
        filePath: "/tmp/checkpoint-1.json",
      })

      store.delete(run.id)

      const refs = store.getCheckpointRefs(run.id)
      expect(refs).toHaveLength(0)
    })
  })

  describe("checkpoint refs", () => {
    it("should create checkpoint ref", () => {
      const run = store.create({
        sessionId: "s1",
        mode: "worker-reviewer",
        agentCount: 2,
      })

      const ref = store.createCheckpointRef({
        teamRunId: run.id,
        teamId: "team-123",
        iteration: 2,
        progress: 75,
        phase: "reviewing",
        filePath: "/tmp/checkpoint-team-123-xxx.json",
      })

      expect(ref.id).toBeDefined()
      expect(ref.teamRunId).toBe(run.id)
      expect(ref.teamId).toBe("team-123")
      expect(ref.iteration).toBe(2)
      expect(ref.progress).toBe(75)
      expect(ref.phase).toBe("reviewing")
      expect(ref.filePath).toBe("/tmp/checkpoint-team-123-xxx.json")
    })

    it("should list checkpoint refs for a run", async () => {
      const run = store.create({
        sessionId: "s1",
        mode: "worker-reviewer",
        agentCount: 2,
      })

      const ref1 = store.createCheckpointRef({
        teamRunId: run.id,
        teamId: "team-123",
        iteration: 1,
        progress: 30,
        phase: "working",
        filePath: "/tmp/cp1.json",
      })
      // Wait 1.1 seconds to ensure different created_at timestamps
      await new Promise(resolve => setTimeout(resolve, 1100))
      const ref2 = store.createCheckpointRef({
        teamRunId: run.id,
        teamId: "team-123",
        iteration: 2,
        progress: 60,
        phase: "reviewing",
        filePath: "/tmp/cp2.json",
      })

      // Verify both refs were created with different IDs
      expect(ref1.id).not.toBe(ref2.id)

      const refs = store.getCheckpointRefs(run.id)
      expect(refs).toHaveLength(2)
      // Should be sorted by created_at DESC
      expect(refs[0].iteration).toBe(2)
      expect(refs[1].iteration).toBe(1)
    })

    it("should get latest checkpoint ref", async () => {
      const run = store.create({
        sessionId: "s1",
        mode: "worker-reviewer",
        agentCount: 2,
      })

      store.createCheckpointRef({
        teamRunId: run.id,
        teamId: "team-123",
        iteration: 1,
        progress: 30,
        phase: "working",
        filePath: "/tmp/cp1.json",
      })
      // Wait 1.1 seconds to ensure different created_at timestamps
      await new Promise(resolve => setTimeout(resolve, 1100))
      store.createCheckpointRef({
        teamRunId: run.id,
        teamId: "team-123",
        iteration: 2,
        progress: 60,
        phase: "reviewing",
        filePath: "/tmp/cp2.json",
      })

      const latest = store.getLatestCheckpointRef(run.id)
      expect(latest).not.toBeNull()
      expect(latest!.iteration).toBe(2)
      expect(latest!.progress).toBe(60)
    })

    it("should return null when no checkpoint refs exist", () => {
      const run = store.create({
        sessionId: "s1",
        mode: "worker-reviewer",
        agentCount: 2,
      })

      const latest = store.getLatestCheckpointRef(run.id)
      expect(latest).toBeNull()
    })

    it("should delete checkpoint ref", () => {
      const run = store.create({
        sessionId: "s1",
        mode: "worker-reviewer",
        agentCount: 2,
      })

      const ref = store.createCheckpointRef({
        teamRunId: run.id,
        teamId: "team-123",
        iteration: 1,
        progress: 30,
        phase: "working",
        filePath: "/tmp/cp1.json",
      })

      const deleted = store.deleteCheckpointRef(ref.id)
      expect(deleted).toBe(true)
      expect(store.getCheckpointRefs(run.id)).toHaveLength(0)
    })
  })

  describe("getSessionStats", () => {
    it("should calculate session statistics", () => {
      const run1 = store.create({ sessionId: "s1", mode: "worker-reviewer", agentCount: 2 })
      const run2 = store.create({ sessionId: "s1", mode: "council", agentCount: 3 })
      const run3 = store.create({ sessionId: "s1", mode: "worker-reviewer", agentCount: 2 })

      store.complete(run1.id, { tokensUsed: { input: 1000, output: 500 }, costUsd: 0.05, iterations: 3 })
      store.fail(run2.id, "timeout", { tokensUsed: { input: 2000, output: 1000 }, costUsd: 0.1, iterations: 2 })
      store.complete(run3.id, { tokensUsed: { input: 1500, output: 700 }, costUsd: 0.07, iterations: 3 })

      const stats = store.getSessionStats("s1")
      expect(stats.totalRuns).toBe(3)
      expect(stats.completedRuns).toBe(2)
      expect(stats.failedRuns).toBe(1)
      expect(stats.totalCostUsd).toBeCloseTo(0.22, 2)
      expect(stats.totalTokens).toBe(6700)
    })

    it("should return zeros for empty session", () => {
      const stats = store.getSessionStats("non-existent-session")
      expect(stats.totalRuns).toBe(0)
      expect(stats.completedRuns).toBe(0)
      expect(stats.failedRuns).toBe(0)
      expect(stats.totalCostUsd).toBe(0)
      expect(stats.totalTokens).toBe(0)
    })
  })
})
