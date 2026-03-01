import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { RalphLoopManager, RalphTaskQueue, RalphLoopConfig } from "../loop/ralph-loop.js"
import * as fs from "fs/promises"
import * as path from "path"

describe("RalphLoopManager", () => {
  let manager: RalphLoopManager
  const testDir = "/tmp/ralph-test-" + Date.now()

  beforeEach(async () => {
    manager = new RalphLoopManager()
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true }).catch(() => {})
  })

  it("should create manager instance", () => {
    expect(manager).toBeDefined()
  })

  it("should parse empty queue", () => {
    const queue = manager.loadQueue("/nonexistent/path.md")
    expect(queue.pending).toEqual([])
    expect(queue.inProgress).toEqual([])
    expect(queue.completed).toEqual([])
  })

  it("should save and load queue", async () => {
    const queue: RalphTaskQueue = {
      pending: ["task-1", "task-2"],
      inProgress: ["task-3"],
      completed: ["task-0"],
    }
    const filePath = path.join(testDir, "queue.md")
    manager.saveQueue(filePath, queue)
    const loaded = manager.loadQueue(filePath)
    expect(loaded.pending).toEqual(["task-1", "task-2"])
    expect(loaded.inProgress).toEqual(["task-3"])
    expect(loaded.completed).toEqual(["task-0"])
  })

  it("should dequeue pending task", () => {
    const queue: RalphTaskQueue = {
      pending: ["task-1", "task-2"],
      inProgress: [],
      completed: [],
    }
    const task = manager.dequeuePending(queue)
    expect(task).toBe("task-1")
    expect(queue.pending).toEqual(["task-2"])
    expect(queue.inProgress).toEqual(["task-1"])
  })

  it("should mark task completed", () => {
    const queue: RalphTaskQueue = {
      pending: [],
      inProgress: ["task-1"],
      completed: [],
    }
    manager.markCompleted(queue, "task-1")
    expect(queue.inProgress).toEqual([])
    expect(queue.completed).toEqual(["task-1"])
  })

  it("should mark task failed (requeue)", () => {
    const queue: RalphTaskQueue = {
      pending: [],
      inProgress: ["task-1"],
      completed: [],
    }
    manager.markFailed(queue, "task-1")
    expect(queue.inProgress).toEqual([])
    expect(queue.pending).toEqual(["task-1"])
  })

  it("should append progress", async () => {
    const progressPath = path.join(testDir, "progress.md")
    manager.appendProgress(progressPath, "Task completed: task-1")
    manager.appendProgress(progressPath, "Task completed: task-2")
    const content = await fs.readFile(progressPath, "utf-8")
    expect(content).toContain("Task completed: task-1")
    expect(content).toContain("Task completed: task-2")
  })

  it("should parse markdown format queue", async () => {
    const queueContent = `# Task Queue

## Pending
- [ ] task-a
- [ ] task-b

## In Progress
- [~] task-c

## Completed
- [x] task-d
`
    const filePath = path.join(testDir, "queue2.md")
    await fs.writeFile(filePath, queueContent, "utf-8")
    const queue = manager.loadQueue(filePath)
    expect(queue.pending).toEqual(["task-a", "task-b"])
    expect(queue.inProgress).toEqual(["task-c"])
    expect(queue.completed).toEqual(["task-d"])
  })
})
