import { describe, it, expect, beforeEach } from "vitest"
import { RalphLoop, createRalphLoop } from "../ralph-loop.js"

describe("RalphLoop", () => {
  let loop: RalphLoop

  beforeEach(() => {
    loop = createRalphLoop({
      enabled: true,
      persistProgress: false,
    })
  })

  describe("createRalphLoop", () => {
    it("should create loop with default config", () => {
      const l = createRalphLoop()
      expect(l).toBeInstanceOf(RalphLoop)
    })
  })

  describe("parseTasksContent", () => {
    it("should parse pending tasks", () => {
      const content = `
# Task Queue

## Pending
- [ ] Task 1
- [ ] Task 2

## Completed
- [x] Task 0
`
      // @ts-expect-error - accessing private method for testing
      const queue = loop.parseTasksContent(content)

      expect(queue.pending).toHaveLength(2)
      expect(queue.pending[0].description).toBe("Task 1")
      expect(queue.completed).toHaveLength(1)
    })

    it("should parse in-progress tasks with agent", () => {
      const content = `
## In Progress
- [~] Task 3 (worker-001)
`
      // @ts-expect-error - accessing private method for testing
      const queue = loop.parseTasksContent(content)

      expect(queue.inProgress).toHaveLength(1)
      expect(queue.inProgress[0].assignedAgent).toBe("worker-001")
    })
  })

  describe("getNextTask", () => {
    it("should return first pending task", () => {
      const queue = {
        pending: [{ id: "1", description: "Task 1", status: "pending" as const }],
        inProgress: [],
        completed: [],
        failed: [],
      }

      const next = loop.getNextTask(queue)
      expect(next?.description).toBe("Task 1")
    })

    it("should return null when no pending tasks", () => {
      const queue = {
        pending: [],
        inProgress: [],
        completed: [],
        failed: [],
      }

      const next = loop.getNextTask(queue)
      expect(next).toBeNull()
    })
  })

  describe("formatTaskQueue", () => {
    it("should format queue as markdown", () => {
      const queue = {
        pending: [{ id: "1", description: "Task 1", status: "pending" as const }],
        inProgress: [],
        completed: [{ id: "0", description: "Task 0", status: "completed" as const }],
        failed: [],
      }

      // @ts-expect-error - accessing private method for testing
      const content = loop.formatTaskQueue(queue)

      expect(content).toContain("## Pending")
      expect(content).toContain("- [ ] Task 1")
      expect(content).toContain("## Completed")
      expect(content).toContain("- [x] Task 0")
    })
  })
})
