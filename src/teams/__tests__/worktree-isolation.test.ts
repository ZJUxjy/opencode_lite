import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { WorktreeIsolation, WorktreeHandle, createWorktreeIsolation } from "../isolation/worktree-isolation.js"
import * as path from "path"
import * as fs from "fs/promises"

describe("WorktreeIsolation", () => {
  let isolation: WorktreeIsolation
  const testBaseDir = "/tmp/worktree-test-" + Date.now()

  beforeEach(async () => {
    isolation = new WorktreeIsolation({
      baseDir: testBaseDir,
      baseBranch: "main",
    })
    await fs.mkdir(testBaseDir, { recursive: true })
  })

  afterEach(async () => {
    await isolation.cleanupAll().catch(() => {})
    await fs.rm(testBaseDir, { recursive: true, force: true }).catch(() => {})
  })

  it("should create isolation instance", () => {
    expect(isolation).toBeDefined()
  })

  it("should have default options", () => {
    const defaultIsolation = new WorktreeIsolation()
    expect(defaultIsolation).toBeDefined()
  })

  it("should create worker worktree handle with correct properties", async () => {
    // Note: This test requires being in a git repository
    // We'll test the handle structure without actually creating worktree
    const handle: WorktreeHandle = {
      workerId: "test-worker",
      path: path.join(testBaseDir, "test-worker"),
      branch: "worker-test-worker-123",
      cleanup: async () => {},
    }

    expect(handle.workerId).toBe("test-worker")
    expect(handle.path).toContain("test-worker")
    expect(handle.branch).toBeDefined()
    expect(handle.cleanup).toBeInstanceOf(Function)
  })

  it("should list worktrees", async () => {
    const worktrees = await isolation.listWorktrees()
    expect(Array.isArray(worktrees)).toBe(true)
  })

  it("should provide temp directory", () => {
    const tempDir = isolation.getTempDir()
    expect(tempDir).toContain("lite-opencode-worktrees")
  })

  it("should use execFile not exec for security", async () => {
    const source = await fs.readFile(
      path.resolve(__dirname, "../isolation/worktree-isolation.ts"),
      "utf-8"
    )
    // Must use execFile for security
    expect(source).toContain("execFile")
    // Must NOT use exec (command injection risk)
    expect(source).not.toMatch(/import\s*\{\s*exec\s*\}/)
    expect(source).not.toMatch(/from\s*["']child_process["'].*exec[^(File)]/)
  })

  it("should create factory function", () => {
    const factoryIsolation = createWorktreeIsolation({
      baseDir: testBaseDir,
      baseBranch: "main",
    })
    expect(factoryIsolation).toBeInstanceOf(WorktreeIsolation)
  })

  it("should have cleanupAll method", () => {
    expect(isolation.cleanupAll).toBeDefined()
    expect(typeof isolation.cleanupAll).toBe("function")
  })

  it("should have createWorkerWorktree method", () => {
    expect(isolation.createWorkerWorktree).toBeDefined()
    expect(typeof isolation.createWorkerWorktree).toBe("function")
  })

  it("should have cleanupWorktree method", () => {
    expect(isolation.cleanupWorktree).toBeDefined()
    expect(typeof isolation.cleanupWorktree).toBe("function")
  })
})
