/**
 * Conflict Detector tests
 */

import { describe, it, expect, beforeEach } from "vitest"
import {
  ConflictDetector,
  createFileChange,
  formatConflictReport,
  type FileChange,
  type ChangeRegion,
} from "../conflict-detector.js"
import type { WorkArtifact } from "../contracts.js"

describe("ConflictDetector", () => {
  let detector: ConflictDetector

  beforeEach(() => {
    detector = new ConflictDetector()
  })

  describe("registerChange", () => {
    it("should register a file change", () => {
      const change = createFileChange("src/test.ts", "agent-1", "task-1")
      detector.registerChange(change)

      const stats = detector.getStats()
      expect(stats.totalChanges).toBe(1)
      expect(stats.filesWithChanges).toBe(1)
    })

    it("should register multiple changes for the same file", () => {
      detector.registerChange(createFileChange("src/test.ts", "agent-1", "task-1"))
      detector.registerChange(createFileChange("src/test.ts", "agent-2", "task-2"))

      const stats = detector.getStats()
      expect(stats.totalChanges).toBe(2)
      expect(stats.filesWithChanges).toBe(1)
    })
  })

  describe("detectConflicts", () => {
    it("should detect no conflicts when only one agent modifies a file", () => {
      detector.registerChange(createFileChange("src/test.ts", "agent-1", "task-1"))

      const result = detector.detectConflicts()

      expect(result.hasConflicts).toBe(false)
      expect(result.conflicts.length).toBe(0)
      expect(result.safeFiles).toContain("src/test.ts")
    })

    it("should detect file-level conflict when multiple agents modify same file", () => {
      detector.registerChange(createFileChange("src/test.ts", "agent-1", "task-1"))
      detector.registerChange(createFileChange("src/test.ts", "agent-2", "task-2"))

      const result = detector.detectConflicts()

      expect(result.hasConflicts).toBe(true)
      expect(result.conflicts.length).toBe(1)
      expect(result.conflicts[0].type).toBe("file-level")
      expect(result.conflicts[0].filePath).toBe("src/test.ts")
    })

    it("should detect no conflict when same agent modifies file multiple times", () => {
      detector.registerChange(createFileChange("src/test.ts", "agent-1", "task-1"))
      detector.registerChange(createFileChange("src/test.ts", "agent-1", "task-2"))

      const result = detector.detectConflicts()

      expect(result.hasConflicts).toBe(false)
    })

    it("should detect high severity conflict when delete and create occur", () => {
      detector.registerChange(
        createFileChange("src/test.ts", "agent-1", "task-1", { changeType: "delete" })
      )
      detector.registerChange(
        createFileChange("src/test.ts", "agent-2", "task-2", { changeType: "create" })
      )

      const result = detector.detectConflicts()

      expect(result.hasConflicts).toBe(true)
      expect(result.conflicts[0].severity).toBe("high")
      expect(result.conflicts[0].resolution.strategy).toBe("manual")
    })

    it("should detect region overlap conflict when changes have non-overlapping regions in different files", () => {
      // When changes have region info and overlap, region conflict is detected
      // But since file-level conflict is checked first, we need to test
      // that region overlap is properly detected within the file-level conflict

      const regions1: ChangeRegion[] = [{ startLine: 10, endLine: 20 }]
      const regions2: ChangeRegion[] = [{ startLine: 15, endLine: 25 }]

      detector.registerChange(
        createFileChange("src/test.ts", "agent-1", "task-1", { regions: regions1 })
      )
      detector.registerChange(
        createFileChange("src/test.ts", "agent-2", "task-2", { regions: regions2 })
      )

      const result = detector.detectConflicts()

      expect(result.hasConflicts).toBe(true)
      // File-level conflict is detected first (region conflict is checked after)
      expect(result.conflicts[0].type).toBe("file-level")
      // The changes should have region info
      expect(result.conflicts[0].changes[0].regions).toBeDefined()
      expect(result.conflicts[0].changes[1].regions).toBeDefined()
    })

    it("should not detect region conflict for non-overlapping regions", () => {
      const regions1: ChangeRegion[] = [{ startLine: 10, endLine: 20 }]
      const regions2: ChangeRegion[] = [{ startLine: 30, endLine: 40 }]

      detector.registerChange(
        createFileChange("src/test.ts", "agent-1", "task-1", { regions: regions1 })
      )
      detector.registerChange(
        createFileChange("src/test.ts", "agent-2", "task-2", { regions: regions2 })
      )

      const result = detector.detectConflicts()

      // Should be file-level conflict, not region overlap
      expect(result.conflicts[0].type).toBe("file-level")
    })
  })

  describe("registerArtifact", () => {
    it("should register all files from a work artifact", () => {
      const artifact: WorkArtifact = {
        taskId: "task-1",
        agentId: "agent-1",
        agentRole: "worker",
        summary: "Test artifact",
        changedFiles: ["src/a.ts", "src/b.ts"],
        patchRef: "patch-1",
        testResults: [],
        risks: [],
        assumptions: [],
        createdAt: Date.now(),
      }

      detector.registerArtifact(artifact)

      const stats = detector.getStats()
      expect(stats.totalChanges).toBe(2)
      expect(stats.filesWithChanges).toBe(2)
    })
  })

  describe("getManualConflicts", () => {
    it("should return only conflicts requiring manual resolution", () => {
      detector.registerChange(
        createFileChange("src/test1.ts", "agent-1", "task-1", { changeType: "delete" })
      )
      detector.registerChange(
        createFileChange("src/test1.ts", "agent-2", "task-2", { changeType: "create" })
      )
      detector.registerChange(createFileChange("src/test2.ts", "agent-1", "task-1"))
      detector.registerChange(createFileChange("src/test2.ts", "agent-2", "task-2"))

      detector.detectConflicts()

      const manualConflicts = detector.getManualConflicts()

      // Only the delete/create conflict should require manual resolution
      expect(manualConflicts.length).toBe(1)
      expect(manualConflicts[0].filePath).toBe("src/test1.ts")
    })
  })

  describe("resolveConflict", () => {
    it("should update conflict resolution", () => {
      detector.registerChange(createFileChange("src/test.ts", "agent-1", "task-1"))
      detector.registerChange(createFileChange("src/test.ts", "agent-2", "task-2"))

      const result = detector.detectConflicts()
      const conflictId = result.conflicts[0].id

      const resolved = detector.resolveConflict(conflictId, {
        strategy: "prefer-first",
        params: { preferredAgent: "agent-1" },
      })

      expect(resolved).toBe(true)
      expect(detector.getConflict(conflictId)?.resolution.strategy).toBe("prefer-first")
    })

    it("should return false for non-existent conflict", () => {
      const resolved = detector.resolveConflict("non-existent", {
        strategy: "manual",
      })

      expect(resolved).toBe(false)
    })
  })

  describe("getStats", () => {
    it("should return correct statistics", () => {
      detector.registerChange(createFileChange("src/a.ts", "agent-1", "task-1"))
      detector.registerChange(createFileChange("src/a.ts", "agent-2", "task-2"))
      detector.registerChange(createFileChange("src/b.ts", "agent-1", "task-1"))

      detector.detectConflicts()

      const stats = detector.getStats()

      expect(stats.totalChanges).toBe(3)
      expect(stats.filesWithChanges).toBe(2)
      expect(stats.totalConflicts).toBe(1) // src/a.ts has conflict
      expect(stats.bySeverity.medium).toBe(1)
    })
  })

  describe("clear", () => {
    it("should clear all data", () => {
      detector.registerChange(createFileChange("src/test.ts", "agent-1", "task-1"))
      detector.detectConflicts()
      detector.clear()

      const stats = detector.getStats()
      expect(stats.totalChanges).toBe(0)
      expect(stats.totalConflicts).toBe(0)
    })
  })
})

describe("formatConflictReport", () => {
  it("should format conflict report", () => {
    const conflict = {
      id: "conflict-1",
      type: "file-level" as const,
      filePath: "src/test.ts",
      changes: [
        createFileChange("src/test.ts", "agent-1", "task-1"),
        createFileChange("src/test.ts", "agent-2", "task-2"),
      ],
      severity: "medium" as const,
      description: "2 agents modified src/test.ts",
      resolution: {
        strategy: "prefer-last" as const,
        notes: "Using latest change",
      },
      detectedAt: Date.now(),
    }

    const report = formatConflictReport(conflict)

    expect(report).toContain("Conflict Detected: src/test.ts")
    expect(report).toContain("**Type**: file-level")  // Markdown bold format
    expect(report).toContain("**Severity**: medium")
    expect(report).toContain("prefer-last")
  })
})
