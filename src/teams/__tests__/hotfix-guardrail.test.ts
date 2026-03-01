import { describe, expect, it } from "vitest"
import { HotfixGuardrailMode } from "../modes/hotfix-guardrail.js"
import { defaultTeamConfig } from "../manager.js"

describe("HotfixGuardrailMode", () => {
  it("returns success when safety reviewer approves", async () => {
    const mode = new HotfixGuardrailMode({
      ...defaultTeamConfig,
      mode: "hotfix-guardrail",
      maxIterations: 2,
    })

    const result = await mode.run("fix production outage", {
      askFixer: async () => ({ output: "patch + rollback", tokensUsed: 10 }),
      askSafetyReviewer: async () => ({
        output: '{"status":"approved","severity":"P3","mustFix":[],"suggestions":[]}',
        tokensUsed: 8,
      }),
    })

    expect(result.status).toBe("success")
    expect(result.reviewRounds).toBe(1)
  })

  it("fails after max iterations when safety review keeps rejecting", async () => {
    const mode = new HotfixGuardrailMode({
      ...defaultTeamConfig,
      mode: "hotfix-guardrail",
      maxIterations: 2,
    })

    const result = await mode.run("fix production outage", {
      askFixer: async () => ({ output: "patch", tokensUsed: 10 }),
      askSafetyReviewer: async () => ({
        output: '{"status":"changes_requested","severity":"P0","mustFix":["rollback missing"],"suggestions":[]}',
        tokensUsed: 8,
      }),
    })

    expect(result.status).toBe("failure")
    expect(result.p0Count).toBe(1)
    expect(result.reviewRounds).toBe(2)
  })
})
