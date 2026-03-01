/**
 * Artifact Store Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { ArtifactStore, createArtifactStore } from "../artifact-store.js"

describe("ArtifactStore", () => {
  let tempDir: string
  let store: ArtifactStore

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-test-"))
    store = createArtifactStore({
      outputDir: path.join(tempDir, "artifacts"),
      retainDays: 7,
      maxArtifacts: 100,
      autoCleanup: false,
    })
  })

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe("store", () => {
    it("should store artifact to filesystem", async () => {
      const artifact = await store.store({
        name: "test-artifact",
        outputPath: "task-001/output.md",
        format: "markdown",
        content: "# Test Output\n\nThis is a test.",
        metadata: {
          agentId: "worker-001",
          taskId: "task-001",
        },
      })

      expect(artifact.id).toBeDefined()
      expect(artifact.outputPath).toBe("task-001/output.md")
      expect(artifact.metadata.agentId).toBe("worker-001")
      expect(artifact.metadata.taskId).toBe("task-001")
      expect(artifact.metadata.format).toBe("markdown")
      expect(artifact.metadata.size).toBeGreaterThan(0)
      expect(artifact.metadata.checksum).toBeDefined()
    })

    it("should create parent directories", async () => {
      await store.store({
        name: "deep-artifact",
        outputPath: "a/b/c/d/output.json",
        format: "json",
        content: '{"key": "value"}',
        metadata: {
          agentId: "worker-001",
          taskId: "task-001",
        },
      })

      const fullPath = path.join(tempDir, "artifacts", "a", "b", "c", "d", "output.json")
      expect(fs.existsSync(fullPath)).toBe(true)
    })

    it("should write metadata file", async () => {
      await store.store({
        name: "test-artifact",
        outputPath: "output.md",
        format: "markdown",
        content: "Test content",
        metadata: {
          agentId: "worker-001",
          taskId: "task-001",
          tags: ["test", "example"],
        },
      })

      const metadataPath = path.join(tempDir, "artifacts", "output.md.meta.json")
      expect(fs.existsSync(metadataPath)).toBe(true)

      const metaContent = fs.readFileSync(metadataPath, "utf-8")
      const metadata = JSON.parse(metaContent)
      expect(metadata.agentId).toBe("worker-001")
      expect(metadata.tags).toEqual(["test", "example"])
    })
  })

  describe("read", () => {
    it("should read stored artifact", async () => {
      const content = "# Test Content\n\nHello World"

      await store.store({
        name: "readable-artifact",
        outputPath: "readable.md",
        format: "markdown",
        content,
        metadata: {
          agentId: "worker-001",
          taskId: "task-001",
        },
      })

      const result = await store.read("readable.md")
      expect(result.content).toBe(content)
      expect(result.metadata.agentId).toBe("worker-001")
      expect(result.metadata.taskId).toBe("task-001")
    })

    it("should throw for non-existent artifact", async () => {
      await expect(store.read("non-existent.md")).rejects.toThrow("Artifact not found")
    })

    it("should verify checksum", async () => {
      await store.store({
        name: "checksum-artifact",
        outputPath: "checksum.md",
        format: "markdown",
        content: "Original content",
        metadata: {
          agentId: "worker-001",
          taskId: "task-001",
        },
      })

      // Corrupt the file
      const fullPath = path.join(tempDir, "artifacts", "checksum.md")
      fs.writeFileSync(fullPath, "Corrupted content")

      await expect(store.read("checksum.md")).rejects.toThrow("checksum mismatch")
    })
  })

  describe("query", () => {
    beforeEach(async () => {
      // Create test artifacts
      await store.store({
        name: "artifact-1",
        outputPath: "task-001/a.md",
        format: "markdown",
        content: "Content A",
        metadata: {
          agentId: "worker-001",
          taskId: "task-001",
          tags: ["tag1"],
        },
      })

      await new Promise(resolve => setTimeout(resolve, 10))

      await store.store({
        name: "artifact-2",
        outputPath: "task-001/b.json",
        format: "json",
        content: '{"key": "value"}',
        metadata: {
          agentId: "worker-002",
          taskId: "task-001",
          tags: ["tag2"],
        },
      })

      await new Promise(resolve => setTimeout(resolve, 10))

      await store.store({
        name: "artifact-3",
        outputPath: "task-002/c.md",
        format: "markdown",
        content: "Content C",
        metadata: {
          agentId: "worker-001",
          taskId: "task-002",
          tags: ["tag1", "tag3"],
        },
      })
    })

    it("should query by taskId", async () => {
      const results = await store.query({ taskId: "task-001" })
      expect(results).toHaveLength(2)
      expect(results.every(r => r.metadata.taskId === "task-001")).toBe(true)
    })

    it("should query by agentId", async () => {
      const results = await store.query({ agentId: "worker-001" })
      expect(results).toHaveLength(2)
      expect(results.every(r => r.metadata.agentId === "worker-001")).toBe(true)
    })

    it("should query by format", async () => {
      const results = await store.query({ format: "json" })
      expect(results).toHaveLength(1)
      expect(results[0].metadata.format).toBe("json")
    })

    it("should query by tags", async () => {
      const results = await store.query({ tags: ["tag1"] })
      expect(results).toHaveLength(2)
    })

    it("should return all artifacts when no filters", async () => {
      const results = await store.query()
      expect(results).toHaveLength(3)
    })

    it("should sort by createdAt desc", async () => {
      const results = await store.query()
      expect(results[0].metadata.createdAt).toBeGreaterThanOrEqual(results[1].metadata.createdAt)
      expect(results[1].metadata.createdAt).toBeGreaterThanOrEqual(results[2].metadata.createdAt)
    })
  })

  describe("getTaskArtifacts", () => {
    it("should get artifacts for specific task", async () => {
      await store.store({
        name: "task-artifact",
        outputPath: "task-x/output.md",
        format: "markdown",
        content: "Task content",
        metadata: {
          agentId: "worker-001",
          taskId: "task-x",
        },
      })

      const results = await store.getTaskArtifacts("task-x")
      expect(results).toHaveLength(1)
      expect(results[0].metadata.taskId).toBe("task-x")
    })
  })

  describe("delete", () => {
    it("should delete artifact and metadata", async () => {
      await store.store({
        name: "deletable",
        outputPath: "delete-me.md",
        format: "markdown",
        content: "Delete me",
        metadata: {
          agentId: "worker-001",
          taskId: "task-001",
        },
      })

      const deleted = await store.delete("delete-me.md")
      expect(deleted).toBe(true)

      const artifactPath = path.join(tempDir, "artifacts", "delete-me.md")
      const metadataPath = path.join(tempDir, "artifacts", "delete-me.md.meta.json")

      expect(fs.existsSync(artifactPath)).toBe(false)
      expect(fs.existsSync(metadataPath)).toBe(false)
    })

    it("should return false for non-existent artifact", async () => {
      const deleted = await store.delete("non-existent.md")
      expect(deleted).toBe(false)
    })
  })

  describe("cleanup", () => {
    it("should remove expired artifacts", async () => {
      // Create store with 0 retention days
      const shortStore = createArtifactStore({
        outputDir: path.join(tempDir, "short-artifacts"),
        retainDays: 0,
        autoCleanup: false,
      })

      // Create an artifact by directly writing files with old timestamp
      const artifactDir = path.join(tempDir, "short-artifacts")
      fs.mkdirSync(artifactDir, { recursive: true })

      const oldMetadata = {
        createdAt: Date.now() - 24 * 60 * 60 * 1000, // 1 day ago
        agentId: "worker-001",
        taskId: "task-001",
        checksum: "abc123",
        size: 100,
        format: "markdown",
      }

      fs.writeFileSync(path.join(artifactDir, "old.md"), "Old content")
      fs.writeFileSync(path.join(artifactDir, "old.md.meta.json"), JSON.stringify(oldMetadata))

      const deletedCount = await shortStore.cleanup()
      expect(deletedCount).toBe(1)

      const results = await shortStore.query()
      expect(results).toHaveLength(0)
    })
  })

  describe("getStats", () => {
    it("should return storage statistics", async () => {
      await store.store({
        name: "stat-artifact-1",
        outputPath: "stats/a.md",
        format: "markdown",
        content: "Content A",
        metadata: {
          agentId: "worker-001",
          taskId: "task-001",
        },
      })

      await store.store({
        name: "stat-artifact-2",
        outputPath: "stats/b.json",
        format: "json",
        content: '{"key": "value"}',
        metadata: {
          agentId: "worker-001",
          taskId: "task-001",
        },
      })

      const stats = await store.getStats()

      expect(stats.totalArtifacts).toBe(2)
      expect(stats.totalSize).toBeGreaterThan(0)
      expect(stats.formats.markdown).toBe(1)
      expect(stats.formats.json).toBe(1)
    })
  })
})
