import { describe, it, expect, beforeEach } from "vitest"
import { ConflictDetector } from "../conflict-detector.js"

describe("ConflictDetector", () => {
  let detector: ConflictDetector

  beforeEach(() => {
    detector = new ConflictDetector()
  })

  describe("file locking", () => {
    it("should lock file", () => {
      const result = detector.lockFile("src/file.ts", "task-1")
      expect(result).toBe(true)
      expect(detector.isLocked("src/file.ts")).toBe(true)
    })

    it("should not allow locking already locked file", () => {
      detector.lockFile("src/file.ts", "task-1")
      const result = detector.lockFile("src/file.ts", "task-2")
      expect(result).toBe(false)
    })

    it("should allow reentrant locking", () => {
      detector.lockFile("src/file.ts", "task-1")
      const result = detector.lockFile("src/file.ts", "task-1")
      expect(result).toBe(true)
    })

    it("should unlock file", () => {
      detector.lockFile("src/file.ts", "task-1")
      detector.unlockFile("src/file.ts", "task-1")
      expect(detector.isLocked("src/file.ts")).toBe(false)
    })

    it("should not unlock file owned by other task", () => {
      detector.lockFile("src/file.ts", "task-1")
      const result = detector.unlockFile("src/file.ts", "task-2")
      expect(result).toBe(false)
      expect(detector.isLocked("src/file.ts")).toBe(true)
    })
  })

  describe("file partition", () => {
    it("should set partition", () => {
      detector.setPartition("src/file.ts", "partition-1")
      expect(detector.getPartition("src/file.ts")).toBe("partition-1")
    })

    it("should check same partition", () => {
      detector.setPartition("src/a.ts", "partition-1")
      detector.setPartition("src/b.ts", "partition-1")
      expect(detector.isSamePartition("src/a.ts", "src/b.ts")).toBe(true)
    })

    it("should return false for different partitions", () => {
      detector.setPartition("src/a.ts", "partition-1")
      detector.setPartition("src/b.ts", "partition-2")
      expect(detector.isSamePartition("src/a.ts", "src/b.ts")).toBe(false)
    })
  })

  describe("conflict detection", () => {
    it("should detect locked file conflict", () => {
      detector.lockFile("src/file.ts", "task-1")
      const result = detector.detectConflicts("task-2", ["src/file.ts"])

      expect(result.hasConflicts).toBe(true)
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0].type).toBe("locked")
      expect(result.conflicts[0].severity).toBe("high")
    })

    it("should not conflict with own task", () => {
      detector.lockFile("src/file.ts", "task-1")
      const result = detector.detectConflicts("task-1", ["src/file.ts"])

      expect(result.hasConflicts).toBe(false)
      expect(result.canProceed).toBe(true)
    })

    it("should not detect conflict for unlocked files", () => {
      const result = detector.detectConflicts("task-1", ["src/file.ts"])

      expect(result.hasConflicts).toBe(false)
      expect(result.canProceed).toBe(true)
    })
  })

  describe("batch conflict detection", () => {
    it("should detect conflicts in batch", () => {
      detector.lockFile("src/file.ts", "task-1")

      const tasks = [
        { taskId: "task-1", files: ["src/file.ts"] },
        { taskId: "task-2", files: ["src/file.ts"] },
      ]

      const result = detector.detectBatchConflicts(tasks)
      expect(result.hasConflicts).toBe(true)
      expect(result.requiresResolution).toBe(true)
    })

    it("should identify parallelizable tasks", () => {
      const tasks = [
        { taskId: "task-1", files: ["src/a.ts"] },
        { taskId: "task-2", files: ["src/b.ts"] },
      ]

      const result = detector.detectBatchConflicts(tasks)
      expect(result.parallelizableTasks).toHaveLength(2)
    })
  })

  describe("modification recording", () => {
    it("should record modification", () => {
      detector.recordModification("src/file.ts", "task-1", {
        content: "modified content",
      })

      const mod = detector.getModification("src/file.ts")
      expect(mod).toBeDefined()
      expect(mod?.taskId).toBe("task-1")
    })
  })

  describe("cleanup", () => {
    it("should cleanup task", () => {
      detector.lockFile("src/file.ts", "task-1")
      detector.recordModification("src/file.ts", "task-1", { content: "test" })

      detector.cleanupTask("task-1")

      expect(detector.isLocked("src/file.ts")).toBe(false)
    })

    it("should clear all", () => {
      detector.lockFile("src/file.ts", "task-1")
      detector.setPartition("src/file.ts", "partition-1")

      detector.clear()

      expect(detector.isLocked("src/file.ts")).toBe(false)
      expect(detector.getPartition("src/file.ts")).toBeUndefined()
    })
  })

  describe("stats", () => {
    it("should return stats", () => {
      detector.lockFile("src/file1.ts", "task-1")
      detector.lockFile("src/file2.ts", "task-1")
      detector.setPartition("src/file1.ts", "partition-1")

      const stats = detector.getStats()
      expect(stats.lockedFilesCount).toBe(2)
      expect(stats.partitionsCount).toBe(1)
    })
  })
})
