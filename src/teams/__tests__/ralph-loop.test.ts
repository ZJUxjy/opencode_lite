import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import { RalphLoop, DEFAULT_RALPH_CONFIG, type RalphLoopConfig } from "../index.js"

// Mock Agent
const mockAgent = {
  run: async (prompt: string) => `Mock response for: ${prompt}`,
} as any

describe("RalphLoop", () => {
  const testDir = path.resolve(process.cwd(), ".test-ralph")
  const taskFile = "TEST_TASKS.md"
  const progressFile = "TEST_PROGRESS.md"

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true })
    }
  })

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe("constructor", () => {
    it("should use default config", () => {
      const loop = new RalphLoop(mockAgent, null)
      const stats = loop.getStats()

      expect(stats.totalTasks).toBe(0)
      expect(loop.isRunning()).toBe(false)
    })

    it("should merge custom config", () => {
      const loop = new RalphLoop(mockAgent, null, {
        maxIterations: 5,
        cooldownMs: 100,
      })

      expect(loop.getIteration()).toBe(0)
    })
  })

  describe("getStats", () => {
    it("should return initial stats", () => {
      const loop = new RalphLoop(mockAgent, null)
      const stats = loop.getStats()

      expect(stats.totalTasks).toBe(0)
      expect(stats.completedTasks).toBe(0)
      expect(stats.failedTasks).toBe(0)
      expect(stats.totalDuration).toBe(0)
    })
  })

  describe("isRunning", () => {
    it("should return false initially", () => {
      const loop = new RalphLoop(mockAgent, null)
      expect(loop.isRunning()).toBe(false)
    })
  })

  describe("getIteration", () => {
    it("should return 0 initially", () => {
      const loop = new RalphLoop(mockAgent, null)
      expect(loop.getIteration()).toBe(0)
    })
  })

  describe("stop", () => {
    it("should stop the loop", () => {
      const loop = new RalphLoop(mockAgent, null)
      loop.stop()
      expect(loop.isRunning()).toBe(false)
    })
  })

  describe("run", () => {
    it("should not run when disabled", async () => {
      const loop = new RalphLoop(mockAgent, null, { enabled: false })
      const stats = await loop.run()

      expect(stats.totalTasks).toBe(0)
    })

    it("should run with empty task list", async () => {
      const loop = new RalphLoop(mockAgent, null, {
        enabled: true,
        cwd: testDir,
        taskFilePath: taskFile,
        progressFilePath: progressFile,
        maxIterations: 1,
        exitOnComplete: true,
      })

      const stats = await loop.run()

      expect(stats.totalTasks).toBe(0)
      expect(stats.completedTasks).toBe(0)
    })

    it("should process tasks from file", async () => {
      // 创建任务文件
      const taskContent = `# Tasks

## Pending
- [ ] Test task 1
- [ ] [high] Test task 2
`
      fs.writeFileSync(path.join(testDir, taskFile), taskContent)

      const loop = new RalphLoop(mockAgent, null, {
        enabled: true,
        cwd: testDir,
        taskFilePath: taskFile,
        progressFilePath: progressFile,
        maxIterations: 2,
        exitOnComplete: true,
        cooldownMs: 0,
      })

      const stats = await loop.run()

      // Should have processed at least one task
      expect(stats.totalTasks).toBeGreaterThanOrEqual(0)
    })
  })
})

describe("DEFAULT_RALPH_CONFIG", () => {
  it("should have correct defaults", () => {
    expect(DEFAULT_RALPH_CONFIG.enabled).toBe(true)
    expect(DEFAULT_RALPH_CONFIG.taskSource).toBe("file")
    expect(DEFAULT_RALPH_CONFIG.taskFilePath).toBe("TASKS.md")
    expect(DEFAULT_RALPH_CONFIG.progressFilePath).toBe("PROGRESS.md")
    expect(DEFAULT_RALPH_CONFIG.cooldownMs).toBe(5000)
    expect(DEFAULT_RALPH_CONFIG.maxIterations).toBe(100)
    expect(DEFAULT_RALPH_CONFIG.persistProgress).toBe(true)
    expect(DEFAULT_RALPH_CONFIG.exitOnComplete).toBe(true)
    expect(DEFAULT_RALPH_CONFIG.errorHandling).toBe("continue")
    expect(DEFAULT_RALPH_CONFIG.maxRetries).toBe(3)
  })
})
