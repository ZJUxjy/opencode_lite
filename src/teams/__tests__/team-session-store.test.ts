/**
 * TeamSessionStore 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { TeamSessionStore, formatTeamStatus, formatTeamMode } from "../team-session-store.js"
import type { TeamAgentRecord, Checkpoint } from "../index.js"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

describe("TeamSessionStore", () => {
  let store: TeamSessionStore
  let dbPath: string

  beforeEach(() => {
    // 使用临时目录
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "team-session-test-"))
    dbPath = path.join(tmpDir, "test.db")
    store = new TeamSessionStore(dbPath)
  })

  afterEach(() => {
    store.close()
    // 清理临时文件
    const tmpDir = path.dirname(dbPath)
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // 忽略清理错误
    }
  })

  describe("createTeamSession", () => {
    it("should create a team session with default values", () => {
      const agents: TeamAgentRecord[] = [
        { id: "worker-0", role: "worker", model: "claude-sonnet", inputTokens: 0, outputTokens: 0, costUsd: 0, status: "idle" },
        { id: "reviewer-0", role: "reviewer", model: "claude-sonnet", inputTokens: 0, outputTokens: 0, costUsd: 0, status: "idle" },
      ]

      const session = store.createTeamSession("session-123", "worker-reviewer", agents)

      expect(session.sessionId).toBe("session-123")
      expect(session.mode).toBe("worker-reviewer")
      expect(session.status).toBe("initializing")
      expect(session.agents).toHaveLength(2)
      expect(session.agents[0].role).toBe("worker")
      expect(session.agents[1].role).toBe("reviewer")
    })

    it("should create a team session with strategy for leader-workers mode", () => {
      const agents: TeamAgentRecord[] = [
        { id: "leader-0", role: "leader", model: "claude-sonnet", inputTokens: 0, outputTokens: 0, costUsd: 0, status: "idle" },
      ]

      const session = store.createTeamSession(
        "session-456",
        "leader-workers",
        agents,
        "collaborative"
      )

      expect(session.strategy).toBe("collaborative")
    })
  })

  describe("getTeamSession", () => {
    it("should return null for non-existent session", () => {
      const result = store.getTeamSession("non-existent")
      expect(result).toBeNull()
    })

    it("should return the team session if exists", () => {
      const agents: TeamAgentRecord[] = [
        { id: "worker-0", role: "worker", model: "default", inputTokens: 0, outputTokens: 0, costUsd: 0, status: "idle" },
      ]
      store.createTeamSession("session-789", "hotfix-guardrail", agents)

      const result = store.getTeamSession("session-789")

      expect(result).not.toBeNull()
      expect(result?.mode).toBe("hotfix-guardrail")
    })
  })

  describe("updateTeamSessionStatus", () => {
    it("should update status to running", () => {
      const agents: TeamAgentRecord[] = [
        { id: "worker-0", role: "worker", model: "default", inputTokens: 0, outputTokens: 0, costUsd: 0, status: "idle" },
      ]
      store.createTeamSession("session-status", "worker-reviewer", agents)

      store.updateTeamSessionStatus("session-status", "running")

      const session = store.getTeamSession("session-status")
      expect(session?.status).toBe("running")
      expect(session?.completedAt).toBeUndefined()
    })

    it("should set completedAt when status is completed", () => {
      const agents: TeamAgentRecord[] = [
        { id: "worker-0", role: "worker", model: "default", inputTokens: 0, outputTokens: 0, costUsd: 0, status: "idle" },
      ]
      store.createTeamSession("session-complete", "worker-reviewer", agents)

      store.updateTeamSessionStatus("session-complete", "completed", {
        status: "success",
        summary: "Task completed",
        artifacts: [],
        stats: { duration: 1000, iterations: 2, totalCost: 0.5, totalTokens: 10000 },
      })

      const session = store.getTeamSession("session-complete")
      expect(session?.status).toBe("completed")
      expect(session?.completedAt).toBeDefined()
      expect(session?.resultSummary).toBe("Task completed")
      expect(session?.stats?.iterations).toBe(2)
    })
  })

  describe("updateAgentStats", () => {
    it("should update agent statistics", () => {
      const agents: TeamAgentRecord[] = [
        { id: "worker-0", role: "worker", model: "default", inputTokens: 0, outputTokens: 0, costUsd: 0, status: "idle" },
        { id: "reviewer-0", role: "reviewer", model: "default", inputTokens: 0, outputTokens: 0, costUsd: 0, status: "idle" },
      ]
      store.createTeamSession("session-agent", "worker-reviewer", agents)

      store.updateAgentStats("session-agent", "worker-0", {
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 0.05,
        status: "completed",
      })

      const session = store.getTeamSession("session-agent")
      expect(session?.agents[0].inputTokens).toBe(1000)
      expect(session?.agents[0].outputTokens).toBe(500)
      expect(session?.agents[0].costUsd).toBe(0.05)
      expect(session?.agents[0].status).toBe("completed")
      expect(session?.agents[1].inputTokens).toBe(0) // 未改变
    })
  })

  describe("recordMessageTrace", () => {
    it("should record an agent message trace", () => {
      const agents: TeamAgentRecord[] = [
        { id: "worker-0", role: "worker", model: "default", inputTokens: 0, outputTokens: 0, costUsd: 0, status: "idle" },
      ]
      store.createTeamSession("session-trace", "worker-reviewer", agents)

      const trace = store.recordMessageTrace({
        teamSessionId: "session-trace",
        agentId: "worker-0",
        agentRole: "worker",
        type: "task-assign",
        content: { task: "Implement feature X" },
        timestamp: Date.now(),
      })

      expect(trace.id).toBeDefined()
      expect(trace.type).toBe("task-assign")
      expect(trace.content).toEqual({ task: "Implement feature X" })
    })
  })

  describe("getMessageTraces", () => {
    it("should return all traces for a session in order", async () => {
      const agents: TeamAgentRecord[] = [
        { id: "worker-0", role: "worker", model: "default", inputTokens: 0, outputTokens: 0, costUsd: 0, status: "idle" },
      ]
      store.createTeamSession("session-traces", "worker-reviewer", agents)

      store.recordMessageTrace({
        teamSessionId: "session-traces",
        agentId: "worker-0",
        agentRole: "worker",
        type: "task-assign",
        content: { first: true },
        timestamp: Date.now(),
      })

      await new Promise(r => setTimeout(r, 10))

      store.recordMessageTrace({
        teamSessionId: "session-traces",
        agentId: "worker-0",
        agentRole: "worker",
        type: "task-result",
        content: { second: true },
        timestamp: Date.now(),
      })

      const traces = store.getMessageTraces("session-traces")

      expect(traces).toHaveLength(2)
      expect(traces[0].type).toBe("task-assign")
      expect(traces[1].type).toBe("task-result")
    })

    it("should return empty array for non-existent session", () => {
      const traces = store.getMessageTraces("non-existent")
      expect(traces).toEqual([])
    })
  })

  describe("getAgentMessageTraces", () => {
    it("should return traces for a specific agent", () => {
      const agents: TeamAgentRecord[] = [
        { id: "worker-0", role: "worker", model: "default", inputTokens: 0, outputTokens: 0, costUsd: 0, status: "idle" },
        { id: "reviewer-0", role: "reviewer", model: "default", inputTokens: 0, outputTokens: 0, costUsd: 0, status: "idle" },
      ]
      store.createTeamSession("session-agent-traces", "worker-reviewer", agents)

      store.recordMessageTrace({
        teamSessionId: "session-agent-traces",
        agentId: "worker-0",
        agentRole: "worker",
        type: "task-assign",
        content: {},
        timestamp: Date.now(),
      })

      store.recordMessageTrace({
        teamSessionId: "session-agent-traces",
        agentId: "reviewer-0",
        agentRole: "reviewer",
        type: "review-request",
        content: {},
        timestamp: Date.now(),
      })

      const workerTraces = store.getAgentMessageTraces("session-agent-traces", "worker-0")
      expect(workerTraces).toHaveLength(1)
      expect(workerTraces[0].agentId).toBe("worker-0")
    })
  })

  describe("saveCheckpointIndex", () => {
    it("should save a checkpoint index", () => {
      const agents: TeamAgentRecord[] = [
        { id: "worker-0", role: "worker", model: "default", inputTokens: 0, outputTokens: 0, costUsd: 0, status: "idle" },
      ]
      store.createTeamSession("session-checkpoint", "worker-reviewer", agents)

      const checkpoint: Checkpoint = {
        id: "checkpoint-123",
        timestamp: Date.now(),
        description: "Before risky change",
        patchRefs: [],
        artifactRefs: [],
        status: "pending",
      }

      store.saveCheckpointIndex("session-checkpoint", checkpoint)

      const checkpoints = store.getCheckpoints("session-checkpoint")
      expect(checkpoints).toHaveLength(1)
      expect(checkpoints[0].id).toBe("checkpoint-123")
      expect(checkpoints[0].description).toBe("Before risky change")
    })

    it("should update existing checkpoint", () => {
      const agents: TeamAgentRecord[] = [
        { id: "worker-0", role: "worker", model: "default", inputTokens: 0, outputTokens: 0, costUsd: 0, status: "idle" },
      ]
      store.createTeamSession("session-cp-update", "worker-reviewer", agents)

      const checkpoint1: Checkpoint = {
        id: "checkpoint-456",
        timestamp: Date.now(),
        description: "Initial",
        patchRefs: [],
        artifactRefs: [],
        status: "pending",
      }

      store.saveCheckpointIndex("session-cp-update", checkpoint1)

      const checkpoint2: Checkpoint = {
        ...checkpoint1,
        description: "Updated",
        status: "completed",
      }

      store.saveCheckpointIndex("session-cp-update", checkpoint2)

      const checkpoints = store.getCheckpoints("session-cp-update")
      expect(checkpoints).toHaveLength(1)
      expect(checkpoints[0].description).toBe("Updated")
      expect(checkpoints[0].status).toBe("completed")
    })
  })

  describe("listTeamSessions", () => {
    it("should list all team sessions", () => {
      const agents: TeamAgentRecord[] = [
        { id: "worker-0", role: "worker", model: "default", inputTokens: 0, outputTokens: 0, costUsd: 0, status: "idle" },
      ]

      store.createTeamSession("session-1", "worker-reviewer", agents)
      store.createTeamSession("session-2", "leader-workers", agents)

      const sessions = store.listTeamSessions()

      expect(sessions).toHaveLength(2)
    })

    it("should filter by mode", () => {
      const agents: TeamAgentRecord[] = [
        { id: "worker-0", role: "worker", model: "default", inputTokens: 0, outputTokens: 0, costUsd: 0, status: "idle" },
      ]

      store.createTeamSession("session-a", "worker-reviewer", agents)
      store.createTeamSession("session-b", "council", agents)

      const sessions = store.listTeamSessions({ mode: "council" })

      expect(sessions).toHaveLength(1)
      expect(sessions[0].mode).toBe("council")
    })

    it("should filter by status", () => {
      const agents: TeamAgentRecord[] = [
        { id: "worker-0", role: "worker", model: "default", inputTokens: 0, outputTokens: 0, costUsd: 0, status: "idle" },
      ]

      store.createTeamSession("session-running", "worker-reviewer", agents)
      store.createTeamSession("session-completed", "worker-reviewer", agents)
      store.updateTeamSessionStatus("session-completed", "completed")

      const sessions = store.listTeamSessions({ status: "completed" })

      expect(sessions).toHaveLength(1)
      expect(sessions[0].status).toBe("completed")
    })

    it("should limit results", () => {
      const agents: TeamAgentRecord[] = [
        { id: "worker-0", role: "worker", model: "default", inputTokens: 0, outputTokens: 0, costUsd: 0, status: "idle" },
      ]

      for (let i = 0; i < 5; i++) {
        store.createTeamSession(`session-limit-${i}`, "worker-reviewer", agents)
      }

      const sessions = store.listTeamSessions({ limit: 2 })

      expect(sessions).toHaveLength(2)
    })
  })

  describe("getTeamSessionSummary", () => {
    it("should return summary for a session", () => {
      const agents: TeamAgentRecord[] = [
        { id: "worker-0", role: "worker", model: "default", inputTokens: 1000, outputTokens: 500, costUsd: 0.05, status: "completed" },
        { id: "reviewer-0", role: "reviewer", model: "default", inputTokens: 800, outputTokens: 200, costUsd: 0.03, status: "completed" },
      ]
      store.createTeamSession("session-summary", "worker-reviewer", agents)

      store.recordMessageTrace({
        teamSessionId: "session-summary",
        agentId: "worker-0",
        agentRole: "worker",
        type: "task-assign",
        content: {},
        timestamp: Date.now(),
      })

      const summary = store.getTeamSessionSummary("session-summary")

      expect(summary.agentCount).toBe(2)
      expect(summary.totalInputTokens).toBe(1800)
      expect(summary.totalOutputTokens).toBe(700)
      expect(summary.totalCost).toBeCloseTo(0.08)
      expect(summary.traceCount).toBe(1)
    })

    it("should return zeros for non-existent session", () => {
      const summary = store.getTeamSessionSummary("non-existent")

      expect(summary.agentCount).toBe(0)
      expect(summary.totalInputTokens).toBe(0)
      expect(summary.totalCost).toBe(0)
    })
  })

  describe("deleteTeamSession", () => {
    it("should delete a team session and its related data", () => {
      const agents: TeamAgentRecord[] = [
        { id: "worker-0", role: "worker", model: "default", inputTokens: 0, outputTokens: 0, costUsd: 0, status: "idle" },
      ]
      store.createTeamSession("session-delete", "worker-reviewer", agents)

      store.recordMessageTrace({
        teamSessionId: "session-delete",
        agentId: "worker-0",
        agentRole: "worker",
        type: "task-assign",
        content: {},
        timestamp: Date.now(),
      })

      const result = store.deleteTeamSession("session-delete")

      expect(result).toBe(true)
      expect(store.getTeamSession("session-delete")).toBeNull()
      expect(store.getMessageTraces("session-delete")).toHaveLength(0)
    })

    it("should return false for non-existent session", () => {
      const result = store.deleteTeamSession("non-existent")
      expect(result).toBe(false)
    })
  })
})

describe("formatTeamStatus", () => {
  it("should format initializing status", () => {
    expect(formatTeamStatus("initializing")).toContain("初始化")
  })

  it("should format running status", () => {
    expect(formatTeamStatus("running")).toContain("运行")
  })

  it("should format completed status", () => {
    expect(formatTeamStatus("completed")).toContain("完成")
  })

  it("should format failed status", () => {
    expect(formatTeamStatus("failed")).toContain("失败")
  })

  it("should format timeout status", () => {
    expect(formatTeamStatus("timeout")).toContain("超时")
  })

  it("should format cancelled status", () => {
    expect(formatTeamStatus("cancelled")).toContain("取消")
  })
})

describe("formatTeamMode", () => {
  it("should format worker-reviewer mode", () => {
    expect(formatTeamMode("worker-reviewer")).toBe("Worker-Reviewer")
  })

  it("should format planner-executor-reviewer mode", () => {
    expect(formatTeamMode("planner-executor-reviewer")).toBe("Planner-Executor-Reviewer")
  })

  it("should format leader-workers mode", () => {
    expect(formatTeamMode("leader-workers")).toBe("Leader-Workers")
  })

  it("should format hotfix-guardrail mode", () => {
    expect(formatTeamMode("hotfix-guardrail")).toBe("Hotfix Guardrail")
  })

  it("should format council mode", () => {
    expect(formatTeamMode("council")).toBe("Council")
  })
})
