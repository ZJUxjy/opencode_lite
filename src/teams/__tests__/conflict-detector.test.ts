/**
 * Conflict Detector Tests
 */

import { describe, it, expect, vi } from "vitest"
import {
  ConflictDetector,
  createConflictDetector,
  ResolutionStrategies,
  type FileChange,
  type WorkArtifact,
} from "../index.js"

describe("ConflictDetector", () => {
  describe("initialization", () => {
    it("should create conflict detector", () => {
      const detector = createConflictDetector()
      expect(detector).toBeInstanceOf(ConflictDetector)
    })

    it("should accept config options", () => {
      const detector = createConflictDetector({
        autoResolve: true,
        maxConflicts: 5,
        semanticAnalysis: false,
      })

      expect(detector).toBeInstanceOf(ConflictDetector)
    })
  })

  describe("change registration", () => {
    it("should register file changes", () => {
      const detector = createConflictDetector()

      detector.registerChange({
        agentId: "agent-1",
        filePath: "src/file.ts",
        changeType: "modified",
      })

      const stats = detector.getStats()
      expect(stats.total).toBe(0) // No conflict yet
    })

    it("should detect file-level conflicts", () => {
      const detector = createConflictDetector()

      detector.registerChange({
        agentId: "agent-1",
        filePath: "src/file.ts",
        changeType: "modified",
      })

      const conflicts = detector.registerChange({
        agentId: "agent-2",
        filePath: "src/file.ts",
        changeType: "modified",
      })

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].type).toBe("file")
      expect(conflicts[0].files).toContain("src/file.ts")
    })

    it("should not detect conflict for same agent", () => {
      const detector = createConflictDetector()

      detector.registerChange({
        agentId: "agent-1",
        filePath: "src/file.ts",
        changeType: "modified",
      })

      const conflicts = detector.registerChange({
        agentId: "agent-1",
        filePath: "src/file.ts",
        changeType: "modified",
      })

      expect(conflicts).toHaveLength(0)
    })
  })

  describe("artifact registration", () => {
    it("should register work artifacts", () => {
      const detector = createConflictDetector()

      const artifact: WorkArtifact = {
        taskId: "task-1",
        summary: "Test",
        changedFiles: ["src/a.ts", "src/b.ts"],
        patchRef: "ref-1",
        testResults: [],
        risks: [],
        assumptions: [],
      }

      const conflicts = detector.registerArtifact("agent-1", artifact)
      expect(conflicts).toHaveLength(0)
    })

    it("should detect conflicts from artifacts", () => {
      const detector = createConflictDetector()

      const artifact1: WorkArtifact = {
        taskId: "task-1",
        summary: "Test",
        changedFiles: ["src/shared.ts"],
        patchRef: "ref-1",
        testResults: [],
        risks: [],
        assumptions: [],
      }

      const artifact2: WorkArtifact = {
        taskId: "task-2",
        summary: "Test 2",
        changedFiles: ["src/shared.ts"],
        patchRef: "ref-2",
        testResults: [],
        risks: [],
        assumptions: [],
      }

      detector.registerArtifact("agent-1", artifact1)
      const conflicts = detector.registerArtifact("agent-2", artifact2)

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].agents).toContain("agent-1")
      expect(conflicts[0].agents).toContain("agent-2")
    })
  })

  describe("severity detection", () => {
    it("should mark delete conflicts as critical", () => {
      const detector = createConflictDetector()

      detector.registerChange({
        agentId: "agent-1",
        filePath: "src/file.ts",
        changeType: "deleted",
      })

      const conflicts = detector.registerChange({
        agentId: "agent-2",
        filePath: "src/file.ts",
        changeType: "modified",
      })

      expect(conflicts[0].severity).toBe("critical")
    })

    it("should mark dual modify as major", () => {
      const detector = createConflictDetector()

      detector.registerChange({
        agentId: "agent-1",
        filePath: "src/file.ts",
        changeType: "modified",
      })

      const conflicts = detector.registerChange({
        agentId: "agent-2",
        filePath: "src/file.ts",
        changeType: "modified",
      })

      expect(conflicts[0].severity).toBe("major")
    })
  })

  describe("conflict resolution", () => {
    it("should resolve conflict", () => {
      const detector = createConflictDetector()

      detector.registerChange({
        agentId: "agent-1",
        filePath: "src/file.ts",
        changeType: "modified",
      })

      const conflicts = detector.registerChange({
        agentId: "agent-2",
        filePath: "src/file.ts",
        changeType: "modified",
      })

      const conflictId = conflicts[0].id
      const resolved = detector.resolveConflict(conflictId)

      expect(resolved).toBe(true)
      expect(detector.getConflict(conflictId)?.status).toBe("resolved")
    })

    it("should return false for non-existent conflict", () => {
      const detector = createConflictDetector()
      const resolved = detector.resolveConflict("non-existent")
      expect(resolved).toBe(false)
    })
  })

  describe("filtering", () => {
    it("should filter by status", () => {
      const detector = createConflictDetector({ semanticAnalysis: false })

      detector.registerChange({
        agentId: "agent-1",
        filePath: "src/file1.ts",
        changeType: "modified",
      })
      detector.registerChange({
        agentId: "agent-2",
        filePath: "src/file1.ts",
        changeType: "modified",
      })

      detector.registerChange({
        agentId: "agent-1",
        filePath: "src/file2.ts",
        changeType: "modified",
      })
      const conflicts = detector.registerChange({
        agentId: "agent-2",
        filePath: "src/file2.ts",
        changeType: "modified",
      })

      detector.resolveConflict(conflicts[0].id)

      const detected = detector.getConflicts({ status: "detected" })
      const resolved = detector.getConflicts({ status: "resolved" })

      expect(detected).toHaveLength(1)
      expect(resolved).toHaveLength(1)
    })

    it("should filter by type", () => {
      const detector = createConflictDetector({ semanticAnalysis: true })

      detector.registerChange({
        agentId: "agent-1",
        filePath: "src/dir/file1.ts",
        changeType: "modified",
      })
      detector.registerChange({
        agentId: "agent-2",
        filePath: "src/dir/file2.ts",
        changeType: "modified",
      })

      const fileConflicts = detector.getConflicts({ type: "file" })
      const depConflicts = detector.getConflicts({ type: "dependency" })

      expect(depConflicts.length).toBeGreaterThan(0)
    })
  })

  describe("critical conflicts", () => {
    it("should detect critical conflicts", () => {
      const detector = createConflictDetector()

      detector.registerChange({
        agentId: "agent-1",
        filePath: "src/file.ts",
        changeType: "deleted",
      })

      detector.registerChange({
        agentId: "agent-2",
        filePath: "src/file.ts",
        changeType: "modified",
      })

      expect(detector.hasCriticalConflicts()).toBe(true)
    })

    it("should return false when no critical conflicts", () => {
      const detector = createConflictDetector()

      detector.registerChange({
        agentId: "agent-1",
        filePath: "src/file.ts",
        changeType: "added",
      })

      detector.registerChange({
        agentId: "agent-2",
        filePath: "src/file.ts",
        changeType: "added",
      })

      expect(detector.hasCriticalConflicts()).toBe(false)
    })
  })

  describe("statistics", () => {
    it("should return accurate stats", () => {
      const detector = createConflictDetector({ semanticAnalysis: false })

      // Create conflicts
      detector.registerChange({
        agentId: "agent-1",
        filePath: "src/file1.ts",
        changeType: "modified",
      })
      const conflicts = detector.registerChange({
        agentId: "agent-2",
        filePath: "src/file1.ts",
        changeType: "modified",
      })

      detector.registerChange({
        agentId: "agent-1",
        filePath: "src/file2.ts",
        changeType: "deleted",
      })
      detector.registerChange({
        agentId: "agent-2",
        filePath: "src/file2.ts",
        changeType: "modified",
      })

      // Resolve one
      detector.resolveConflict(conflicts[0].id)

      const stats = detector.getStats()

      expect(stats.total).toBe(2)
      expect(stats.resolved).toBe(1)
      expect(stats.unresolved).toBe(1)
      expect(stats.bySeverity.major).toBe(1)
      expect(stats.bySeverity.critical).toBe(1)
    })
  })

  describe("auto resolution", () => {
    it("should auto-resolve non-critical when enabled", () => {
      const detector = createConflictDetector({
        autoResolve: true,
      })

      detector.registerChange({
        agentId: "agent-1",
        filePath: "src/file.ts",
        changeType: "modified",
      })
      detector.registerChange({
        agentId: "agent-2",
        filePath: "src/file.ts",
        changeType: "modified",
      })

      const resolved = detector.autoResolve()

      expect(resolved.length).toBeGreaterThan(0)
      expect(detector.getConflicts({ status: "resolved" }).length).toBeGreaterThan(0)
    })

    it("should not auto-resolve when disabled", () => {
      const detector = createConflictDetector({
        autoResolve: false,
      })

      detector.registerChange({
        agentId: "agent-1",
        filePath: "src/file.ts",
        changeType: "modified",
      })
      detector.registerChange({
        agentId: "agent-2",
        filePath: "src/file.ts",
        changeType: "modified",
      })

      const resolved = detector.autoResolve()

      expect(resolved).toHaveLength(0)
    })

    it("should not auto-resolve critical conflicts", () => {
      const detector = createConflictDetector({
        autoResolve: true,
      })

      detector.registerChange({
        agentId: "agent-1",
        filePath: "src/file.ts",
        changeType: "deleted",
      })
      detector.registerChange({
        agentId: "agent-2",
        filePath: "src/file.ts",
        changeType: "modified",
      })

      const resolved = detector.autoResolve()

      expect(resolved).toHaveLength(0)
      expect(detector.hasCriticalConflicts()).toBe(true)
    })
  })

  describe("max conflicts limit", () => {
    it("should respect max conflicts limit", () => {
      const detector = createConflictDetector({
        maxConflicts: 2,
      })

      // Create more than max conflicts
      for (let i = 0; i < 5; i++) {
        detector.registerChange({
          agentId: "agent-1",
          filePath: `src/file${i}.ts`,
          changeType: "modified",
        })
        detector.registerChange({
          agentId: "agent-2",
          filePath: `src/file${i}.ts`,
          changeType: "modified",
        })
      }

      const stats = detector.getStats()
      expect(stats.total).toBeLessThanOrEqual(2)
    })
  })

  describe("clear", () => {
    it("should clear all conflicts", () => {
      const detector = createConflictDetector()

      detector.registerChange({
        agentId: "agent-1",
        filePath: "src/file.ts",
        changeType: "modified",
      })
      detector.registerChange({
        agentId: "agent-2",
        filePath: "src/file.ts",
        changeType: "modified",
      })

      expect(detector.getStats().total).toBeGreaterThan(0)

      detector.clear()

      expect(detector.getStats().total).toBe(0)
    })
  })
})

describe("ResolutionStrategies", () => {
  describe("manual strategy", () => {
    it("should return null for manual resolution", () => {
      const result = ResolutionStrategies.manual.apply(
        { id: "c1", type: "file", severity: "major", status: "detected", agents: ["a1", "a2"], files: ["f.ts"], description: "", detectedAt: 0 },
        []
      )

      expect(result).toBeNull()
    })
  })

  describe("timestamp strategy", () => {
    it("should return most recent artifact", () => {
      const artifacts: WorkArtifact[] = [
        {
          taskId: "t1",
          summary: "First",
          changedFiles: ["src/file.ts"],
          patchRef: "ref-1",
          testResults: [],
          risks: [],
          assumptions: [],
        },
        {
          taskId: "t2",
          summary: "Second",
          changedFiles: ["src/file.ts"],
          patchRef: "ref-2",
          testResults: [],
          risks: [],
          assumptions: [],
        },
      ]

      const result = ResolutionStrategies.timestamp.apply(
        { id: "c1", type: "file", severity: "major", status: "detected", agents: ["a1", "a2"], files: ["src/file.ts"], description: "", detectedAt: 0 },
        artifacts
      )

      expect(result).toBeDefined()
      expect(result?.taskId).toBe("t2")
    })
  })
})
