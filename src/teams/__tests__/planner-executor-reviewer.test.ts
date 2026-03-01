import { describe, it, expect } from "vitest"
import { PlannerExecutorReviewerMode } from "../modes/planner-executor-reviewer.js"
import { defaultTeamConfig } from "../manager.js"

describe("PlannerExecutorReviewerMode", () => {
  it("executes DAG subtasks and returns success when reviewer approves", async () => {
    const mode = new PlannerExecutorReviewerMode(defaultTeamConfig)
    const executorPrompts: string[] = []
    const reviewerPrompts: string[] = []

    const result = await mode.run("implement feature", {
      askPlanner: async () => ({
        output: '[{"id":"task-1","title":"Implement core","dependsOn":[]},{"id":"task-2","title":"Add tests","dependsOn":["task-1"]}]',
        tokensUsed: 10,
      }),
      askExecutor: async (prompt) => {
        executorPrompts.push(prompt)
        return { output: "execution\nFILE: src/a.ts", tokensUsed: 20 }
      },
      askReviewer: async (prompt) => {
        reviewerPrompts.push(prompt)
        return {
        output: '{"status":"approved","severity":"P3","mustFix":[],"suggestions":[]}',
        tokensUsed: 10,
        }
      },
    })

    expect(result.status).toBe("success")
    expect(result.reviewRounds).toBe(1)
    expect(result.output).toContain("[task-1]")
    expect(result.output).toContain("[task-2]")
    expect(executorPrompts).toHaveLength(2)
    expect(reviewerPrompts[0]).toContain("hasConflict=true")
  })

  it("returns failure after max iterations with reviewer must-fix and conflict count", async () => {
    const mode = new PlannerExecutorReviewerMode({ ...defaultTeamConfig, maxIterations: 2 })

    const result = await mode.run("implement feature", {
      askPlanner: async () => ({ output: '[{"id":"task-1","title":"Implement","dependsOn":[]}]', tokensUsed: 5 }),
      askExecutor: async () => ({ output: "attempt\nFILE: src/x.ts", tokensUsed: 10 }),
      askReviewer: async () => ({
        output: '{"status":"changes_requested","severity":"P0","mustFix":["fix logic"],"suggestions":[]}',
        tokensUsed: 5,
      }),
    })

    expect(result.status).toBe("failure")
    expect(result.reviewRounds).toBe(2)
    expect(result.p0Count).toBe(1)
    expect(result.mustFixCount).toBe(1)
  })
})
