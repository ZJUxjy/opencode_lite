/**
 * Checkpoint System Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import {
  CheckpointManager,
  createCheckpointManager,
} from "../checkpoint.js"
import type { TeamState, TaskContract, WorkArtifact, ReviewArtifact } from "../types.js"

describe("CheckpointManager", () => {
  let tempDir: string
  let manager: CheckpointManager

  const mockTeamState: TeamState = {
    teamId: "team-123",
    mode: "worker-reviewer",
    status: "running",
    currentIteration: 2,
    startTime: Date.now(),
    tokensUsed: { input: 1000, output: 500 },
    costUsd: 0.05,
    lastProgressAt: Date.now(),
    consecutiveNoProgressRounds: 0,
    consecutiveFailures: 0,
    currentPhase: "reviewing",
    currentAgent: "reviewer-1",
  }

  const mockTaskContract: TaskContract = {
    taskId: "task-1",
    objective: "Implement feature X",
    fileScope: ["src/x.ts"],
    acceptanceChecks: ["npm test"],
  }

  const mockWorkArtifact: WorkArtifact = {
    taskId: "task-1",
    summary: "Implemented feature X",
    changedFiles: ["src/x.ts"],
    patchRef: "abc123",
    testResults: [{ command: "npm test", passed: true }],
    risks: [],
    assumptions: ["Node 18+"],
  }

  const mockReviewArtifact: ReviewArtifact = {
    status: "approved",
    severity: "P3",
    mustFix: [],
    suggestions: ["Add more docs"],
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "checkpoint-test-"))
    manager = createCheckpointManager("team-123", {
      checkpointDir: tempDir,
      autoCheckpointInterval: 1000,
      maxCheckpoints: 3,
      compression: false,
    })
  })

  afterEach(() => {
    // Cleanup temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe("initialization", () => {
    it("should create checkpoint manager", () => {
      expect(manager).toBeInstanceOf(CheckpointManager)
    })

    it("should create checkpoint directory", () => {
      expect(fs.existsSync(tempDir)).toBe(true)
    })

    it("should use default config when not provided", () => {
      const defaultManager = createCheckpointManager("team-456")
      expect(defaultManager).toBeInstanceOf(CheckpointManager)
    })
  })

  describe("createCheckpoint", () => {
    it("should create a checkpoint", async () => {
      const state = {
        teamState: mockTeamState,
        taskContract: mockTaskContract,
        workArtifacts: new Map([["worker-1", mockWorkArtifact]]),
        reviewArtifacts: new Map([["reviewer-1", mockReviewArtifact]]),
        blackboardState: new Map([["key", "value"]]),
      }

      const checkpoint = await manager.createCheckpoint(state)

      expect(checkpoint.id).toBeDefined()
      expect(checkpoint.teamId).toBe("team-123")
      expect(checkpoint.mode).toBe("worker-reviewer")
      expect(checkpoint.iteration).toBe(2)
      expect(checkpoint.phase).toBe("running")
      expect(checkpoint.progress).toBeGreaterThanOrEqual(0)
      expect(checkpoint.progress).toBeLessThanOrEqual(100)
    })

    it("should save checkpoint to file", async () => {
      const state = {
        teamState: mockTeamState,
        taskContract: mockTaskContract,
        workArtifacts: new Map(),
        reviewArtifacts: new Map(),
        blackboardState: new Map(),
      }

      const checkpoint = await manager.createCheckpoint(state)
      const checkpointPath = path.join(tempDir, `${checkpoint.id}.json`)

      expect(fs.existsSync(checkpointPath)).toBe(true)

      const data = fs.readFileSync(checkpointPath, "utf-8")
      const saved = JSON.parse(data)
      expect(saved.teamId).toBe("team-123")
      expect(saved.iteration).toBe(2)
    })

    it("should throw if checkpoint already in progress", async () => {
      const state = {
        teamState: mockTeamState,
        taskContract: mockTaskContract,
        workArtifacts: new Map(),
        reviewArtifacts: new Map(),
        blackboardState: new Map(),
      }

      // Start first checkpoint
      const promise1 = manager.createCheckpoint(state)

      // Try to create another while first is in progress
      await expect(manager.createCheckpoint(state)).rejects.toThrow("Checkpoint already in progress")

      // Wait for first to complete
      await promise1
    })

    it("should calculate progress correctly", async () => {
      const state = {
        teamState: { ...mockTeamState, currentIteration: 5 },
        taskContract: mockTaskContract,
        workArtifacts: new Map([
          ["worker-1", mockWorkArtifact],
          ["worker-2", mockWorkArtifact],
        ]),
        reviewArtifacts: new Map([
          ["reviewer-1", mockReviewArtifact],
        ]),
        blackboardState: new Map(),
      }

      const checkpoint = await manager.createCheckpoint(state)

      // Progress = min(iteration * 10, 50) + artifacts * 10 + reviews * 10
      // = min(50, 50) + 20 + 10 = 80
      expect(checkpoint.progress).toBe(80)
    })

    it("should cap progress at 100", async () => {
      const state = {
        teamState: { ...mockTeamState, currentIteration: 10 },
        taskContract: mockTaskContract,
        workArtifacts: new Map([
          ["w1", mockWorkArtifact],
          ["w2", mockWorkArtifact],
          ["w3", mockWorkArtifact],
          ["w4", mockWorkArtifact],
          ["w5", mockWorkArtifact],
        ]),
        reviewArtifacts: new Map([
          ["r1", mockReviewArtifact],
          ["r2", mockReviewArtifact],
          ["r3", mockReviewArtifact],
          ["r4", mockReviewArtifact],
          ["r5", mockReviewArtifact],
        ]),
        blackboardState: new Map(),
      }

      const checkpoint = await manager.createCheckpoint(state)
      expect(checkpoint.progress).toBe(100)
    })
  })

  describe("restoreCheckpoint", () => {
    it("should restore a checkpoint by id", async () => {
      const state = {
        teamState: mockTeamState,
        taskContract: mockTaskContract,
        workArtifacts: new Map([["worker-1", mockWorkArtifact]]),
        reviewArtifacts: new Map([["reviewer-1", mockReviewArtifact]]),
        blackboardState: new Map([["test-key", "test-value"]]),
      }

      const created = await manager.createCheckpoint(state)
      const restored = await manager.restoreCheckpoint(created.id)

      expect(restored).not.toBeNull()
      expect(restored!.id).toBe(created.id)
      expect(restored!.teamId).toBe("team-123")
      expect(restored!.iteration).toBe(2)
      expect(restored!.workArtifacts["worker-1"]).toEqual(mockWorkArtifact)
      expect(restored!.blackboardState["test-key"]).toBe("test-value")
    })

    it("should return null for non-existent checkpoint", async () => {
      const restored = await manager.restoreCheckpoint("non-existent-id")
      expect(restored).toBeNull()
    })

    it("should throw for team id mismatch", async () => {
      const state = {
        teamState: mockTeamState,
        taskContract: mockTaskContract,
        workArtifacts: new Map(),
        reviewArtifacts: new Map(),
        blackboardState: new Map(),
      }

      const created = await manager.createCheckpoint(state)

      // Create a different manager with different team id
      const otherManager = createCheckpointManager("team-456", {
        checkpointDir: tempDir,
      })

      await expect(otherManager.restoreCheckpoint(created.id)).rejects.toThrow("team ID mismatch")
    })
  })

  describe("restoreLatestCheckpoint", () => {
    it("should restore the latest checkpoint", async () => {
      const state1 = {
        teamState: { ...mockTeamState, currentIteration: 1 },
        taskContract: mockTaskContract,
        workArtifacts: new Map(),
        reviewArtifacts: new Map(),
        blackboardState: new Map(),
      }

      const state2 = {
        teamState: { ...mockTeamState, currentIteration: 2 },
        taskContract: mockTaskContract,
        workArtifacts: new Map(),
        reviewArtifacts: new Map(),
        blackboardState: new Map(),
      }

      await manager.createCheckpoint(state1)
      await new Promise(resolve => setTimeout(resolve, 10)) // Ensure different timestamps
      await manager.createCheckpoint(state2)

      const latest = await manager.restoreLatestCheckpoint()

      expect(latest).not.toBeNull()
      expect(latest!.iteration).toBe(2)
    })

    it("should return null when no checkpoints exist", async () => {
      const latest = await manager.restoreLatestCheckpoint()
      expect(latest).toBeNull()
    })
  })

  describe("listCheckpoints", () => {
    it("should list all checkpoints", async () => {
      const state = {
        teamState: mockTeamState,
        taskContract: mockTaskContract,
        workArtifacts: new Map(),
        reviewArtifacts: new Map(),
        blackboardState: new Map(),
      }

      await manager.createCheckpoint(state)
      await new Promise(resolve => setTimeout(resolve, 10))
      await manager.createCheckpoint(state)

      const checkpoints = await manager.listCheckpoints()

      expect(checkpoints).toHaveLength(2)
      expect(checkpoints[0].timestamp).toBeGreaterThanOrEqual(checkpoints[1].timestamp)
    })

    it("should return empty array when no checkpoints", async () => {
      const checkpoints = await manager.listCheckpoints()
      expect(checkpoints).toEqual([])
    })

    it("should ignore corrupted checkpoint files", async () => {
      // Create a corrupted file
      const corruptedPath = path.join(tempDir, "checkpoint-team-123-corrupted.json")
      fs.writeFileSync(corruptedPath, "not valid json")

      const checkpoints = await manager.listCheckpoints()
      expect(checkpoints).toEqual([])
    })
  })

  describe("deleteCheckpoint", () => {
    it("should delete a checkpoint", async () => {
      const state = {
        teamState: mockTeamState,
        taskContract: mockTaskContract,
        workArtifacts: new Map(),
        reviewArtifacts: new Map(),
        blackboardState: new Map(),
      }

      const created = await manager.createCheckpoint(state)
      const checkpointPath = path.join(tempDir, `${created.id}.json`)

      expect(fs.existsSync(checkpointPath)).toBe(true)

      const result = await manager.deleteCheckpoint(created.id)

      expect(result).toBe(true)
      expect(fs.existsSync(checkpointPath)).toBe(false)
    })

    it("should return false for non-existent checkpoint", async () => {
      const result = await manager.deleteCheckpoint("non-existent")
      expect(result).toBe(false)
    })
  })

  describe("cleanupOldCheckpoints", () => {
    it("should cleanup old checkpoints beyond max limit", async () => {
      const state = {
        teamState: mockTeamState,
        taskContract: mockTaskContract,
        workArtifacts: new Map(),
        reviewArtifacts: new Map(),
        blackboardState: new Map(),
      }

      // Create 5 checkpoints (max is 3)
      for (let i = 0; i < 5; i++) {
        await manager.createCheckpoint(state)
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      const checkpoints = await manager.listCheckpoints()
      expect(checkpoints).toHaveLength(3) // Should be limited to maxCheckpoints
    })
  })

  describe("shouldAutoCheckpoint", () => {
    it("should return true when interval has passed", async () => {
      // Initially should return true (never checkpointed)
      expect(manager.shouldAutoCheckpoint()).toBe(true)

      const state = {
        teamState: mockTeamState,
        taskContract: mockTaskContract,
        workArtifacts: new Map(),
        reviewArtifacts: new Map(),
        blackboardState: new Map(),
      }

      await manager.createCheckpoint(state)

      // Immediately after should return false
      expect(manager.shouldAutoCheckpoint()).toBe(false)
    })
  })
})
