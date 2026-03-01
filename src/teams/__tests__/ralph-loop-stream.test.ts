import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import { RalphLoop, type RalphEvent, type RalphLoopConfig } from "../index.js"

describe("RalphLoop Stream JSON Output", () => {
  const testDir = path.resolve(process.cwd(), ".test-ralph-stream")

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true })
    }
    // Create empty TASKS.md
    fs.writeFileSync(path.join(testDir, "TASKS.md"), "")
  })

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe("emitEvent", () => {
    it("should emit events to console in stream-json mode", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})

      const loop = new RalphLoop(
        { run: async () => "done" } as any,
        null,
        { cwd: testDir, outputFormat: "stream-json", maxIterations: 0 }
      )

      const event: RalphEvent = {
        type: "heartbeat",
        timestamp: Date.now(),
        stats: {
          totalTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
          skippedTasks: 0,
          totalDuration: 0,
          totalCost: 0,
          totalTokens: 0,
        },
        runningTasks: 0,
      }

      loop.emitEvent(event)

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(event))

      consoleSpy.mockRestore()
    })

    it("should emit events to file when logFile is set", () => {
      const logFile = path.join(testDir, "ralph.log")

      const loop = new RalphLoop(
        { run: async () => "done" } as any,
        null,
        { cwd: testDir, outputFormat: "stream-json", logFile, maxIterations: 0 }
      )

      const event: RalphEvent = {
        type: "heartbeat",
        timestamp: Date.now(),
        stats: {
          totalTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
          skippedTasks: 0,
          totalDuration: 0,
          totalCost: 0,
          totalTokens: 0,
        },
        runningTasks: 0,
      }

      loop.emitEvent(event)

      expect(fs.existsSync(logFile)).toBe(true)
      const content = fs.readFileSync(logFile, "utf-8")
      expect(content).toContain('"type":"heartbeat"')
    })

    it("should not emit to console in text mode", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {})

      const loop = new RalphLoop(
        { run: async () => "done" } as any,
        null,
        { cwd: testDir, outputFormat: "text", maxIterations: 0 }
      )

      const event: RalphEvent = {
        type: "heartbeat",
        timestamp: Date.now(),
        stats: {
          totalTasks: 0,
          completedTasks: 0,
          failedTasks: 0,
          skippedTasks: 0,
          totalDuration: 0,
          totalCost: 0,
          totalTokens: 0,
        },
        runningTasks: 0,
      }

      loop.emitEvent(event)

      // Should not have been called with JSON
      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('"type":"heartbeat"'))

      consoleSpy.mockRestore()
    })
  })
})

describe("RalphEvent types", () => {
    it("should define start event type", () => {
      const event: RalphEvent = {
        type: "start",
        timestamp: Date.now(),
        config: { maxIterations: 10 } as RalphLoopConfig,
      }
      expect(event.type).toBe("start")
    })

    it("should define task_start event type", () => {
      const event: RalphEvent = {
        type: "task_start",
        timestamp: Date.now(),
        taskId: "task-1",
        description: "Test task",
        priority: "high",
      }
      expect(event.type).toBe("task_start")
    })

    it("should define task_complete event type", () => {
      const event: RalphEvent = {
        type: "task_complete",
        timestamp: Date.now(),
        taskId: "task-1",
        success: true,
        duration: 1000,
        tokens: 500,
      }
      expect(event.type).toBe("task_complete")
    })

    it("should define heartbeat event type", () => {
      const event: RalphEvent = {
        type: "heartbeat",
        timestamp: Date.now(),
        stats: {
          totalTasks: 1,
          completedTasks: 1,
          failedTasks: 0,
          skippedTasks: 0,
          totalDuration: 1000,
          totalCost: 0.01,
          totalTokens: 500,
        },
        runningTasks: 0,
      }
      expect(event.type).toBe("heartbeat")
    })

    it("should define complete event type", () => {
      const event: RalphEvent = {
        type: "complete",
        timestamp: Date.now(),
        stats: {
          totalTasks: 1,
          completedTasks: 1,
          failedTasks: 0,
          skippedTasks: 0,
          totalDuration: 1000,
          totalCost: 0.01,
          totalTokens: 500,
        },
      }
      expect(event.type).toBe("complete")
    })
})
