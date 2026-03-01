import { describe, it, expect } from "vitest"
import { RalphLoop, type RalphEvent, type RalphLoopConfig } from "../index.js"

describe("RalphLoop Stream JSON Output", () => {
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
})
