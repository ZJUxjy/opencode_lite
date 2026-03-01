import { describe, expect, it } from "vitest"
import { CouncilMode } from "../modes/council.js"
import { defaultTeamConfig } from "../manager.js"

describe("CouncilMode", () => {
  it("collects member perspectives and synthesizes final decision", async () => {
    const mode = new CouncilMode({
      ...defaultTeamConfig,
      mode: "council",
      budget: { ...(defaultTeamConfig.budget || { maxTokens: 1000 }), maxParallelAgents: 3 },
    })

    let memberCalls = 0
    const result = await mode.run("decide architecture", {
      askMember: async (_prompt, idx) => {
        memberCalls += 1
        return { output: `perspective-${idx}`, tokensUsed: 5 }
      },
      askSpeaker: async (prompt) => ({ output: `decision\n${prompt.slice(0, 20)}`, tokensUsed: 8 }),
    })

    expect(result.status).toBe("success")
    expect(memberCalls).toBe(3)
    expect(result.output).toContain("decision")
  })

  it("runs council members in parallel", async () => {
    const mode = new CouncilMode({
      ...defaultTeamConfig,
      mode: "council",
      budget: { ...(defaultTeamConfig.budget || { maxTokens: 1000 }), maxParallelAgents: 3 },
    })

    let active = 0
    let maxActive = 0
    const result = await mode.run("parallel decision", {
      askMember: async (_prompt, idx) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 10 + idx))
        active -= 1
        return { output: `member-${idx}`, tokensUsed: 3 }
      },
      askSpeaker: async () => ({ output: "final decision", tokensUsed: 4 }),
    })

    expect(result.status).toBe("success")
    expect(maxActive).toBeGreaterThan(1)
  })

  it("respects sequential parallelStrategy mode", async () => {
    const mode = new CouncilMode({
      ...defaultTeamConfig,
      mode: "council",
      parallelStrategy: { mode: "sequential" },
      budget: { ...(defaultTeamConfig.budget || { maxTokens: 1000 }), maxParallelAgents: 3 },
    })

    let active = 0
    let maxActive = 0
    await mode.run("sequential decision", {
      askMember: async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return { output: "member", tokensUsed: 1 }
      },
      askSpeaker: async () => ({ output: "done", tokensUsed: 1 }),
    })

    expect(maxActive).toBe(1)
  })
})
