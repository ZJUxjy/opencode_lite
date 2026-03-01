import { describe, expect, it } from "vitest"
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { RalphLoopManager } from "../ralph-loop.js"

describe("RalphLoopManager", () => {
  it("loads markdown task queue and transitions states", () => {
    const dir = mkdtempSync(join(tmpdir(), "ralph-loop-"))
    const taskFile = join(dir, "TASKS.md")
    const progressFile = join(dir, "PROGRESS.md")
    writeFileSync(
      taskFile,
      [
        "# Task Queue",
        "",
        "## Pending",
        "- [ ] task-a",
        "- [ ] task-b",
        "",
        "## In Progress",
        "- [~] task-c",
        "",
        "## Completed",
        "- [x] task-d",
      ].join("\n"),
      "utf8"
    )

    const manager = new RalphLoopManager()
    const queue = manager.loadQueue(taskFile)
    expect(queue.pending).toEqual(["task-a", "task-b"])
    expect(queue.inProgress).toEqual(["task-c"])
    expect(queue.completed).toEqual(["task-d"])

    const task = manager.dequeuePending(queue)
    expect(task).toBe("task-a")
    manager.markCompleted(queue, task!)
    manager.appendProgress(progressFile, "task-a completed")
    manager.saveQueue(taskFile, queue)

    const reloaded = manager.loadQueue(taskFile)
    expect(reloaded.pending).toEqual(["task-b"])
    expect(reloaded.completed.includes("task-a")).toBe(true)
    expect(readFileSync(progressFile, "utf8")).toContain("task-a completed")
  })

  it("returns empty queue when file cannot be parsed", () => {
    const manager = new RalphLoopManager()
    const queue = manager.loadQueue("/path/that/does/not/exist/TASKS.md")
    expect(queue).toEqual({ pending: [], inProgress: [], completed: [] })
  })
})
