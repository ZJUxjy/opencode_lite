import { describe, it, expect, beforeEach } from "vitest"
import { CheckpointResumer, createCheckpointResumer } from "../checkpoint-resume.js"
import type { Checkpoint } from "../checkpoint.js"

describe("CheckpointResumer", () => {
  let resumer: CheckpointResumer

  beforeEach(() => {
    resumer = createCheckpointResumer()
  })

  const mockCheckpoint: Checkpoint = {
    id: "checkpoint-001",
    teamId: "team-001",
    mode: "worker-reviewer",
    timestamp: Date.now(),
    version: "1.0.0",
    teamState: {
      teamId: "team-001",
      mode: "worker-reviewer",
      status: "failed",
      currentIteration: 2,
      startTime: Date.now() - 3600000,
      tokensUsed: { input: 1000, output: 500 },
      costUsd: 0.05,
      lastProgressAt: Date.now() - 1800000,
      consecutiveNoProgressRounds: 0,
      consecutiveFailures: 1,
    },
    taskContract: {
      taskId: "task-001",
      objective: "Implement feature",
      fileScope: ["src/feature.ts"],
      acceptanceChecks: ["npm test"],
    },
    workArtifacts: {
      "worker-001": {
        taskId: "task-001",
        summary: "Implemented core logic",
        changedFiles: ["src/feature.ts"],
        patchRef: "abc123",
        testResults: [{ command: "npm test", passed: true }],
        risks: [],
        assumptions: [],
      },
    },
    reviewArtifacts: {},
    blackboardState: {},
    iteration: 2,
    phase: "review",
    progress: 50,
  }

  describe("resume with restart-task strategy", () => {
    it("should restart from current iteration with empty artifacts", async () => {
      const result = await resumer.resume(mockCheckpoint, {
        checkpointId: mockCheckpoint.id,
        strategy: "restart-task",
        contextInjection: {
          includePreviousThinking: false,
          includePreviousArtifacts: true,
          maxContextTokens: 4000,
        },
      })

      expect(result.teamState.currentIteration).toBe(2)
      expect(result.teamState.status).toBe("running")
      expect(result.workArtifacts.size).toBe(0)
      expect(result.resumeStrategy).toBe("restart-task")
    })
  })

  describe("resume with continue-iteration strategy", () => {
    it("should continue with all checkpoint state", async () => {
      const result = await resumer.resume(mockCheckpoint, {
        checkpointId: mockCheckpoint.id,
        strategy: "continue-iteration",
        contextInjection: {
          includePreviousThinking: true,
          includePreviousArtifacts: true,
          maxContextTokens: 4000,
        },
      })

      expect(result.teamState.status).toBe("failed")
      expect(result.workArtifacts.size).toBe(1)
      expect(result.workArtifacts.has("worker-001")).toBe(true)
    })
  })

  describe("resume with skip-completed strategy", () => {
    it("should skip completed tasks and increment iteration", async () => {
      const result = await resumer.resume(mockCheckpoint, {
        checkpointId: mockCheckpoint.id,
        strategy: "skip-completed",
        contextInjection: {
          includePreviousThinking: false,
          includePreviousArtifacts: false,
          maxContextTokens: 4000,
        },
      })

      expect(result.teamState.currentIteration).toBe(3)
      expect(result.workArtifacts.size).toBe(0)
    })
  })

  describe("buildResumeContext", () => {
    it("should build context with pending and completed tasks", async () => {
      const context = await resumer.buildResumeContext(mockCheckpoint, {
        checkpointId: mockCheckpoint.id,
        strategy: "continue-iteration",
        contextInjection: {
          includePreviousThinking: true,
          includePreviousArtifacts: true,
          maxContextTokens: 4000,
        },
      })

      expect(context.checkpoint.id).toBe("checkpoint-001")
      expect(context.completedTasks).toContain("worker-001")
      expect(context.contextSummary).toContain("50%")
    })
  })
})
