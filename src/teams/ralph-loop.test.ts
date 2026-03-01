import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { RalphLoop } from "./ralph-loop.js"

describe("RalphLoop", () => {
  const testDir = path.join(os.tmpdir(), "test-ralph-" + Date.now())
  const taskFile = path.join(testDir, "TASKS.md")

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  it("should parse TASKS.md with pending tasks", async () => {
    await fs.writeFile(taskFile, `
# Task Queue

## Pending
- [ ] Task 1
- [ ] Task 2

## Completed
- [x] Task 0
`, "utf-8")

    const loop = new RalphLoop({
      taskFilePath: taskFile,
    })

    const tasks = await loop.parseTasksFile()

    expect(tasks).toHaveLength(2)
    expect(tasks[0].name).toBe("Task 1")
    expect(tasks[0].status).toBe("pending")
    expect(tasks[1].name).toBe("Task 2")
  })

  it("should return empty array when no pending tasks", async () => {
    await fs.writeFile(taskFile, `
# Task Queue

## Completed
- [x] Task 1
- [x] Task 2
`, "utf-8")

    const loop = new RalphLoop({
      taskFilePath: taskFile,
    })

    const tasks = await loop.parseTasksFile()

    expect(tasks).toHaveLength(0)
  })

  it("should handle different task status markers", async () => {
    await fs.writeFile(taskFile, `
# Task Queue

## Pending
- [ ] Pending task

## In Progress
- [~] In progress task

## Completed
- [x] Completed task

## Failed
- [-] Failed task
`, "utf-8")

    const loop = new RalphLoop({
      taskFilePath: taskFile,
    })

    const tasks = await loop.parseTasksFile()

    expect(tasks).toHaveLength(1)
    expect(tasks[0].name).toBe("Pending task")
    expect(tasks[0].status).toBe("pending")
  })
})
