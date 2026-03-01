import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  WorktreeIsolationManager,
  createWorktreeIsolationManager,
} from "../worktree-isolation.js"

describe("WorktreeIsolationManager", () => {
  let manager: WorktreeIsolationManager

  beforeEach(() => {
    manager = createWorktreeIsolationManager({
      enabled: false, // Disable actual git operations in tests
      baseBranch: "main",
      worktreeDir: ".test-worktrees",
    })
  })

  describe("createWorktreeIsolationManager", () => {
    it("should create manager with default config", () => {
      const m = createWorktreeIsolationManager()
      expect(m).toBeInstanceOf(WorktreeIsolationManager)
    })

    it("should create manager with custom config", () => {
      const m = createWorktreeIsolationManager({
        baseBranch: "develop",
        cleanupOnComplete: false,
      })
      expect(m).toBeInstanceOf(WorktreeIsolationManager)
    })
  })

  describe("getWorktree", () => {
    it("should return undefined for non-existent worktree", () => {
      expect(manager.getWorktree("non-existent")).toBeUndefined()
    })
  })

  describe("listWorktrees", () => {
    it("should return empty array initially", () => {
      expect(manager.listWorktrees()).toEqual([])
    })
  })

  describe("isSupported", () => {
    it("should return boolean", async () => {
      const result = await manager.isSupported()
      expect(typeof result).toBe("boolean")
    })
  })
})
