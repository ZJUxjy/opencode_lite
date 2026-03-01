import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import { RalphLoop, ParallelExecutor, type ParallelConfig, type TaskDefinition } from "../index.js"

describe("RalphLoop Parallel Execution", () => {
  const testDir = path.resolve(process.cwd(), ".test-ralph-parallel")

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

  describe("ParallelConfig", () => {
    it("should define parallel configuration", () => {
      const config: ParallelConfig = {
        enabled: true,
        maxWorkers: 3,
        worktreeEnabled: true,
      }
      expect(config.maxWorkers).toBe(3)
    })

    it("should have default parallelWorkers of 1", () => {
      const loop = new RalphLoop(
        { run: async () => "done" } as any,
        null,
        { cwd: testDir, maxIterations: 0 }
      )

      const config = loop.getConfig()
      expect(config.parallelWorkers).toBe(1)
    })

    it("should have worktreeEnabled false by default", () => {
      const loop = new RalphLoop(
        { run: async () => "done" } as any,
        null,
        { cwd: testDir, maxIterations: 0 }
      )

      const config = loop.getConfig()
      expect(config.worktreeEnabled).toBe(false)
    })
  })

  describe("ParallelExecutor", () => {
    it("should execute tasks in parallel", async () => {
      const executor = new ParallelExecutor({
        maxWorkers: 3,
        worktreeEnabled: false,
      })

      const tasks: TaskDefinition[] = [
        { id: "1", description: "Task 1", priority: "medium" },
        { id: "2", description: "Task 2", priority: "medium" },
        { id: "3", description: "Task 3", priority: "medium" },
      ]

      const executionTimes: { id: string; start: number; end: number }[] = []

      const results = await executor.executeParallel(tasks, async (task) => {
        const start = Date.now()
        await new Promise(r => setTimeout(r, 50))
        const end = Date.now()
        executionTimes.push({ id: task.id, start, end })
        return {
          taskId: task.id,
          success: true,
          result: `Completed ${task.id}`,
        }
      })

      expect(results).toHaveLength(3)
      expect(results.every(r => r.success)).toBe(true)

      // Check overlap - all should have overlapping execution times
      const sortedByStart = [...executionTimes].sort((a, b) => a.start - b.start)
      // First task should start before last task ends (parallel execution)
      expect(sortedByStart[0].end).toBeGreaterThan(sortedByStart[2].start - 50)
    })

    it("should limit concurrent workers", async () => {
      let concurrentCount = 0
      let maxConcurrent = 0

      const executor = new ParallelExecutor({
        maxWorkers: 2,
        worktreeEnabled: false,
      })

      const tasks: TaskDefinition[] = Array.from({ length: 5 }, (_, i) => ({
        id: `${i + 1}`,
        description: `Task ${i + 1}`,
        priority: "medium" as const,
      }))

      await executor.executeParallel(tasks, async (task, workerId) => {
        concurrentCount++
        maxConcurrent = Math.max(maxConcurrent, concurrentCount)
        await new Promise(r => setTimeout(r, 30))
        concurrentCount--
        return { taskId: task.id, success: true, result: "done", workerId }
      })

      expect(maxConcurrent).toBeLessThanOrEqual(2)
    })

    it("should handle empty task list", async () => {
      const executor = new ParallelExecutor({
        maxWorkers: 3,
        worktreeEnabled: false,
      })

      const results = await executor.executeParallel([], async (task) => ({
        taskId: task.id,
        success: true,
        result: "done",
      }))

      expect(results).toHaveLength(0)
    })
  })
})
