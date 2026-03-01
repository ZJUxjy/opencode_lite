/**
 * Checkpoint Store 单元测试
 */

import { describe, it, expect, beforeEach } from "vitest"
import { CheckpointStore, type Checkpoint } from "../checkpoint-store.js"

describe("CheckpointStore", () => {
  let store: CheckpointStore

  beforeEach(() => {
    store = new CheckpointStore(5) // 测试用较小的最大值
  })

  describe("createCheckpoint", () => {
    it("should create a checkpoint with default values", () => {
      const checkpoint = store.createCheckpoint("Test checkpoint")

      expect(checkpoint.id).toMatch(/^checkpoint-\d+-\d+$/)
      expect(checkpoint.description).toBe("Test checkpoint")
      expect(checkpoint.status).toBe("pending")
      expect(checkpoint.riskLevel).toBe("low")
      expect(checkpoint.patchRefs).toEqual([])
      expect(checkpoint.artifactRefs).toEqual([])
    })

    it("should create a checkpoint with all parameters", () => {
      const checkpoint = store.createCheckpoint(
        "Full checkpoint",
        "baseline-123",
        ["patch-1", "patch-2"],
        ["artifact-1"],
        "blackboard-snapshot-1"
      )

      expect(checkpoint.baselineRef).toBe("baseline-123")
      expect(checkpoint.patchRefs).toEqual(["patch-1", "patch-2"])
      expect(checkpoint.artifactRefs).toEqual(["artifact-1"])
      expect(checkpoint.blackboardSnapshotRef).toBe("blackboard-snapshot-1")
    })

    it("should store the checkpoint", () => {
      const checkpoint = store.createCheckpoint("Stored checkpoint")
      const retrieved = store.getCheckpoint(checkpoint.id)

      expect(retrieved).toEqual(checkpoint)
    })
  })

  describe("getCheckpoint", () => {
    it("should return undefined for non-existent checkpoint", () => {
      const result = store.getCheckpoint("non-existent")
      expect(result).toBeUndefined()
    })

    it("should return the checkpoint if exists", () => {
      const checkpoint = store.createCheckpoint("Test")
      const result = store.getCheckpoint(checkpoint.id)
      expect(result).toEqual(checkpoint)
    })
  })

  describe("getRecentCheckpoints", () => {
    it("should return empty array when no checkpoints", () => {
      const result = store.getRecentCheckpoints(5)
      expect(result).toEqual([])
    })

    it("should return checkpoints sorted by timestamp descending", async () => {
      // 创建多个检查点，确保时间戳不同
      const cp1 = store.createCheckpoint("First")
      await new Promise(r => setTimeout(r, 10))
      const cp2 = store.createCheckpoint("Second")
      await new Promise(r => setTimeout(r, 10))
      const cp3 = store.createCheckpoint("Third")

      const result = store.getRecentCheckpoints(10)

      expect(result.length).toBe(3)
      expect(result[0].id).toBe(cp3.id) // 最新
      expect(result[1].id).toBe(cp2.id)
      expect(result[2].id).toBe(cp1.id) // 最旧
    })

    it("should limit the number of returned checkpoints", () => {
      store.createCheckpoint("1")
      store.createCheckpoint("2")
      store.createCheckpoint("3")

      const result = store.getRecentCheckpoints(2)
      expect(result.length).toBe(2)
    })
  })

  describe("rollback", () => {
    it("should return false for non-existent checkpoint", async () => {
      const result = await store.rollback("non-existent")
      expect(result).toBe(false)
    })

    it("should mark checkpoint as completed", async () => {
      const checkpoint = store.createCheckpoint("To rollback")
      expect(checkpoint.status).toBe("pending")

      const result = await store.rollback(checkpoint.id)

      expect(result).toBe(true)
      const updated = store.getCheckpoint(checkpoint.id)
      expect(updated?.status).toBe("completed")
    })
  })

  describe("getBaseline / setBaseline", () => {
    it("should return null initially", () => {
      expect(store.getBaseline()).toBeNull()
    })

    it("should set and get baseline", () => {
      store.setBaseline("baseline-ref-123")
      expect(store.getBaseline()).toBe("baseline-ref-123")
    })
  })

  describe("needsCleanup", () => {
    it("should return false when below limit", () => {
      store.createCheckpoint("1")
      store.createCheckpoint("2")
      expect(store.needsCleanup()).toBe(false)
    })

    it("should return true when at or above limit", () => {
      for (let i = 0; i < 5; i++) {
        store.createCheckpoint(`Checkpoint ${i}`)
      }
      expect(store.needsCleanup()).toBe(true)
    })
  })

  describe("cleanup", () => {
    it("should clear all checkpoints", () => {
      store.createCheckpoint("1")
      store.createCheckpoint("2")
      store.createCheckpoint("3")

      store.cleanup()

      expect(store.getRecentCheckpoints(10)).toEqual([])
    })

    it("should clear baseline", () => {
      store.setBaseline("baseline-123")
      store.cleanup()
      expect(store.getBaseline()).toBeNull()
    })
  })

  describe("maxCheckpoints configuration", () => {
    it("should use default maxCheckpoints when not specified", () => {
      const defaultStore = new CheckpointStore()
      // 默认是 20，需要创建 20 个才能触发 needsCleanup
      for (let i = 0; i < 20; i++) {
        defaultStore.createCheckpoint(`CP ${i}`)
      }
      expect(defaultStore.needsCleanup()).toBe(true)
    })

    it("should respect custom maxCheckpoints", () => {
      const customStore = new CheckpointStore(3)
      for (let i = 0; i < 3; i++) {
        customStore.createCheckpoint(`CP ${i}`)
      }
      expect(customStore.needsCleanup()).toBe(true)
    })
  })
})
