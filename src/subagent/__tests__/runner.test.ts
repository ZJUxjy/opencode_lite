import { describe, it, expect, beforeEach } from "vitest"
import { SubagentRunner } from "../runner.js"

describe("SubagentRunner", () => {
  let runner: SubagentRunner

  beforeEach(() => {
    runner = new SubagentRunner({
      workingDir: "/tmp/test-subagent",
      parentSessionId: "test-parent",
    })
  })

  it("should create subagent with isolated session", async () => {
    const subagent = await runner.createSubagent("task-1", "Test task")
    expect(subagent.sessionId).toBeDefined()
    expect(subagent.sessionId).not.toBe("test-parent")
  })

  it("should execute task and return result", async () => {
    const result = await runner.execute("task-1", "List files in current directory")
    expect(result.success).toBe(true)
    expect(result.output).toBeDefined()
    expect(result.sessionId).toBeDefined()
  })
})
