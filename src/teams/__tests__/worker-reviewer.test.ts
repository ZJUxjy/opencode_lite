import { describe, it, expect } from "vitest"
import { WorkerReviewerMode } from "../modes/worker-reviewer.js"
import { defaultTeamConfig } from "../manager.js"

describe("WorkerReviewerMode", () => {
  it("approves when reviewer returns approved json", async () => {
    const mode = new WorkerReviewerMode(defaultTeamConfig)

    const result = await mode.run("implement feature", {
      askWorker: async () => ({ output: "worker-output", tokensUsed: 30 }),
      askReviewer: async () => ({
        output: '{"status":"approved","severity":"P3","mustFix":[],"suggestions":[]}',
        tokensUsed: 20,
      }),
    })

    expect(result.status).toBe("success")
    expect(result.reviewRounds).toBe(1)
  })

  it("fails after max iterations on repeated change requests", async () => {
    const mode = new WorkerReviewerMode({ ...defaultTeamConfig, maxIterations: 2 })

    const result = await mode.run("implement feature", {
      askWorker: async () => ({ output: "worker-output", tokensUsed: 30 }),
      askReviewer: async () => ({
        output: '{"status":"changes_requested","severity":"P1","mustFix":["x"],"suggestions":[]}',
        tokensUsed: 20,
      }),
    })

    expect(result.status).toBe("failure")
    expect(result.reviewRounds).toBe(2)
  })
})
