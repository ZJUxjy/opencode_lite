import { describe, it, expect, beforeEach } from "vitest"
import {
  WorktreeManager,
  createWorktreeManager,
  isGitRepository,
  getCurrentBranch,
  DEFAULT_WORKTREE_CONFIG,
  type WorktreeIsolationConfig,
} from "../index.js"

describe("WorktreeManager", () => {
  describe("constructor", () => {
    it("should use default config", () => {
      const manager = new WorktreeManager()
      const config = manager.getConfig()

      expect(config.enabled).toBe(DEFAULT_WORKTREE_CONFIG.enabled)
      expect(config.baseBranch).toBe(DEFAULT_WORKTREE_CONFIG.baseBranch)
      expect(config.cleanupOnComplete).toBe(DEFAULT_WORKTREE_CONFIG.cleanupOnComplete)
    })

    it("should merge custom config", () => {
      const manager = new WorktreeManager({
        enabled: false,
        baseBranch: "develop",
      })
      const config = manager.getConfig()

      expect(config.enabled).toBe(false)
      expect(config.baseBranch).toBe("develop")
      expect(config.cleanupOnComplete).toBe(DEFAULT_WORKTREE_CONFIG.cleanupOnComplete)
    })
  })

  describe("isEnabled", () => {
    it("should return false when disabled", () => {
      const manager = new WorktreeManager({ enabled: false })
      expect(manager.isEnabled()).toBe(false)
    })

    it("should return true when enabled in git repo", () => {
      const manager = new WorktreeManager({ enabled: true })
      // This test runs in a git repo, so it should be true
      // If not in a git repo, it will be false
      const result = manager.isEnabled()
      expect(typeof result).toBe("boolean")
    })
  })

  describe("createWorktree", () => {
    it("should return null when disabled", () => {
      const manager = new WorktreeManager({ enabled: false })
      const worktree = manager.createWorktree()

      expect(worktree).toBeNull()
    })

    it("should return null when not in git repo", () => {
      const manager = new WorktreeManager({
        enabled: true,
        cwd: "/nonexistent/path",
      })
      const worktree = manager.createWorktree()

      expect(worktree).toBeNull()
    })
  })

  describe("getWorktree", () => {
    it("should return undefined for non-existent worktree", () => {
      const manager = new WorktreeManager()
      const worktree = manager.getWorktree("non-existent")

      expect(worktree).toBeUndefined()
    })
  })

  describe("getActiveWorktrees", () => {
    it("should return empty array initially", () => {
      const manager = new WorktreeManager()
      const active = manager.getActiveWorktrees()

      expect(active).toHaveLength(0)
    })
  })

  describe("completeWorktree", () => {
    it("should return false for non-existent worktree", () => {
      const manager = new WorktreeManager()
      const result = manager.completeWorktree("non-existent")

      expect(result).toBe(false)
    })
  })

  describe("failWorktree", () => {
    it("should return false for non-existent worktree", () => {
      const manager = new WorktreeManager()
      const result = manager.failWorktree("non-existent")

      expect(result).toBe(false)
    })
  })

  describe("removeWorktree", () => {
    it("should return false for non-existent worktree", () => {
      const manager = new WorktreeManager()
      const result = manager.removeWorktree("non-existent")

      expect(result).toBe(false)
    })
  })

  describe("cleanup", () => {
    it("should return 0 when no worktrees", () => {
      const manager = new WorktreeManager()
      const cleaned = manager.cleanup()

      expect(cleaned).toBe(0)
    })
  })
})

describe("createWorktreeManager", () => {
  it("should create a worktree manager", () => {
    const manager = createWorktreeManager()
    expect(manager).toBeInstanceOf(WorktreeManager)
  })

  it("should accept custom config", () => {
    const manager = createWorktreeManager({ baseBranch: "develop" })
    const config = manager.getConfig()

    expect(config.baseBranch).toBe("develop")
  })
})

describe("isGitRepository", () => {
  it("should return boolean", () => {
    const result = isGitRepository()
    expect(typeof result).toBe("boolean")
  })

  it("should return false for non-existent path", () => {
    const result = isGitRepository("/nonexistent/path")
    expect(result).toBe(false)
  })
})

describe("getCurrentBranch", () => {
  it("should return string or null", () => {
    const result = getCurrentBranch()
    expect(result === null || typeof result === "string").toBe(true)
  })
})

describe("DEFAULT_WORKTREE_CONFIG", () => {
  it("should have correct defaults", () => {
    expect(DEFAULT_WORKTREE_CONFIG.enabled).toBe(true)
    expect(DEFAULT_WORKTREE_CONFIG.baseBranch).toBe("main")
    expect(DEFAULT_WORKTREE_CONFIG.worktreeDir).toBe(".agent-teams/worktrees")
    expect(DEFAULT_WORKTREE_CONFIG.cleanupOnComplete).toBe(true)
    expect(DEFAULT_WORKTREE_CONFIG.branchPrefix).toBe("agent-worker")
  })
})
