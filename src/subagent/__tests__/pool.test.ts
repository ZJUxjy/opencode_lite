import { describe, it, expect } from "vitest"
import { SubagentPool } from "../pool.js"

describe("SubagentPool", () => {
  it("should execute multiple subagents in parallel", async () => {
    const pool = new SubagentPool({
      maxConcurrent: 3,
      workingDir: "/tmp/test-subagent",
      parentSessionId: "test-parent",
    })

    const tasks = [
      { id: "task-1", objective: "List files" },
      { id: "task-2", objective: "Show current directory" },
      { id: "task-3", objective: "Check git status" },
    ]

    const results = await pool.executeParallel(tasks)

    expect(results).toHaveLength(3)
    expect(results.every(r => r.sessionId)).toBe(true)
  })

  it("should respect maxConcurrent limit", async () => {
    const pool = new SubagentPool({
      maxConcurrent: 2,
      workingDir: "/tmp/test-subagent",
      parentSessionId: "test-parent",
    })
    expect(pool.getMaxConcurrent()).toBe(2)
  })
})
