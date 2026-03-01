import { describe, it, expect, beforeEach } from "vitest"
import {
  CheckpointResumeManager,
  DEFAULT_RESUME_CONFIG,
  createCheckpointResumeManager,
  type Checkpoint,
  type TeamResult,
} from "../index.js"

describe("CheckpointResumeManager", () => {
  let manager: CheckpointResumeManager

  beforeEach(() => {
    manager = createCheckpointResumeManager()
  })

  describe("buildResumeContext", () => {
    it("should build context from checkpoint", () => {
      const checkpoint: Checkpoint = {
        id: "checkpoint-001",
        timestamp: Date.now(),
        description: "Test checkpoint",
        patchRefs: [],
        artifactRefs: [],
        status: "pending",
      }

      const context = manager.buildResumeContext(
        checkpoint,
        "Add a hello world function",
        undefined
      )

      expect(context.originalRequirement).toBe("Add a hello world function")
      expect(context.iterationsCompleted).toBe(0)
      expect(context.recoveryPrompt).toContain("任务恢复上下文")
      expect(context.recoveryPrompt).toContain("Add a hello world function")
    })

    it("should include previous result information", () => {
      const checkpoint: Checkpoint = {
        id: "checkpoint-002",
        timestamp: Date.now(),
        description: "Test checkpoint with result",
        patchRefs: [],
        artifactRefs: [],
        status: "completed",
      }

      const previousResult: TeamResult = {
        status: "failure",
        summary: "Task failed due to missing imports",
        artifacts: [
          {
            taskId: "task-001",
            agentId: "worker-1",
            agentRole: "worker",
            summary: "Added helloWorld function",
            changedFiles: ["src/utils.ts"],
            patchRef: "abc123",
            testResults: [],
            risks: [],
            assumptions: [],
            createdAt: Date.now(),
          },
        ],
        stats: {
          duration: 1000,
          iterations: 2,
          totalCost: 0.01,
          totalTokens: 1000,
        },
      }

      const context = manager.buildResumeContext(
        checkpoint,
        "Add a hello world function",
        previousResult
      )

      expect(context.iterationsCompleted).toBe(2)
      expect(context.completedArtifacts.length).toBeGreaterThan(0)
      expect(context.lastReviewSummary).toContain("failed")
    })

    it("should mark failure for failed checkpoints", () => {
      const checkpoint: Checkpoint = {
        id: "checkpoint-003",
        timestamp: Date.now(),
        description: "Failed checkpoint",
        patchRefs: [],
        artifactRefs: [],
        status: "failed",
      }

      const context = manager.buildResumeContext(
        checkpoint,
        "Test task",
        undefined
      )

      expect(context.failureReason).toBe("Checkpoint marked as failed")
      expect(context.recoveryPrompt).toContain("上次执行失败")
    })
  })

  describe("buildStrategyPrompt", () => {
    const checkpoint: Checkpoint = {
      id: "checkpoint-004",
      timestamp: Date.now(),
      description: "Test",
      patchRefs: [],
      artifactRefs: [],
      status: "pending",
    }

    it("should build restart-task strategy prompt", () => {
      const context = manager.buildResumeContext(checkpoint, "Test task")
      const prompt = manager.buildStrategyPrompt(context, "restart-task")

      expect(prompt).toContain("重新开始任务")
      expect(prompt).toContain("从零开始执行")
    })

    it("should build continue-iteration strategy prompt", () => {
      const previousResult: TeamResult = {
        status: "failure",
        summary: "Needs more work",
        artifacts: [],
        stats: {
          duration: 1000,
          iterations: 3,
          totalCost: 0.01,
          totalTokens: 1000,
        },
      }

      const context = manager.buildResumeContext(checkpoint, "Test task", previousResult)
      const prompt = manager.buildStrategyPrompt(context, "continue-iteration")

      expect(prompt).toContain("继续当前迭代")
      expect(prompt).toContain("3 次迭代")
    })

    it("should build skip-completed strategy prompt", () => {
      const previousResult: TeamResult = {
        status: "failure",
        summary: "Partial completion",
        artifacts: [
          {
            taskId: "task-001",
            agentId: "worker-1",
            agentRole: "worker",
            summary: "Completed part A",
            changedFiles: [],
            patchRef: "",
            testResults: [],
            risks: [],
            assumptions: [],
            createdAt: Date.now(),
          },
        ],
        stats: {
          duration: 1000,
          iterations: 1,
          totalCost: 0.01,
          totalTokens: 1000,
        },
      }

      const context = manager.buildResumeContext(checkpoint, "Test task", previousResult)
      const prompt = manager.buildStrategyPrompt(context, "skip-completed")

      expect(prompt).toContain("跳过已完成部分")
      expect(prompt).toContain("Completed part A")
    })
  })
})

describe("DEFAULT_RESUME_CONFIG", () => {
  it("should have correct default values", () => {
    expect(DEFAULT_RESUME_CONFIG.strategy).toBe("continue-iteration")
    expect(DEFAULT_RESUME_CONFIG.contextInjection.includePreviousThinking).toBe(true)
    expect(DEFAULT_RESUME_CONFIG.contextInjection.includePreviousArtifacts).toBe(true)
    expect(DEFAULT_RESUME_CONFIG.contextInjection.maxContextTokens).toBe(50000)
    expect(DEFAULT_RESUME_CONFIG.maxRetryAttempts).toBe(3)
  })
})
