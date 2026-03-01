import { describe, expect, it } from "vitest"
import { ContextContractSchema, TaskContractSchema, AgentMessageSchema } from "../contracts.js"

describe("contracts schemas", () => {
  it("validates task and context contracts", () => {
    const task = TaskContractSchema.parse({
      taskId: "t1",
      objective: "do x",
      fileScope: ["src/a.ts"],
      acceptanceChecks: ["npm test"],
    })
    expect(task.taskId).toBe("t1")

    const context = ContextContractSchema.parse({
      objective: "goal",
      context: {
        background: "bg",
        constraints: ["c1"],
        references: ["docs/x.md"],
      },
      boundaries: {
        mustNot: ["no db drop"],
        shouldConsider: ["perf"],
      },
      expectedOutcome: {
        intent: "ship",
        validationHint: "run tests",
      },
    })
    expect(context.objective).toBe("goal")
  })

  it("validates agent messages", () => {
    const message = AgentMessageSchema.parse({
      type: "conflict-detected",
      files: ["src/a.ts"],
    })
    expect(message.type).toBe("conflict-detected")
  })
})
