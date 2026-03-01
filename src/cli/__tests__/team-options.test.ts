import { describe, it, expect } from "vitest"
import { parseTeamOptions, validateTeamOptions } from "../team-options.js"

import type { TeamMode } from "../../teams/modes/index.js"

describe("TeamCLIOptions", () => {
  it("should parse team mode", () => {
    const options = parseTeamOptions(["--team", "leader-workers"])
    expect(options.team).toBe("leader-workers")
  })

  it("should parse team config path", () => {
    const options = parseTeamOptions(["--team-config", "./teams.json"])
    expect(options.teamConfig).toBe("./teams.json")
  })

  it("should parse team objective", () => {
    const options = parseTeamOptions(["--team-objective", "Add auth"])
    expect(options.teamObjective).toBe("Add auth")
  })

  it("should parse team budget", () => {
    const options = parseTeamOptions(["--team-budget", "50000"])
    expect(options.teamBudget).toBe(50000)
  })

  it("should parse all options together", () => {
    const options = parseTeamOptions([
      "--team", "council",
      "--team-config", "./teams.json",
      "--team-objective", "Test",
      "--team-budget", "100000",
      "--team-timeout", "60000",
    ])
    expect(options.team).toBe("council")
    expect(options.teamConfig).toBe("./teams.json")
    expect(options.teamObjective).toBe("Test")
    expect(options.teamBudget).toBe(100000)
    expect(options.teamTimeout).toBe(60000)
  })

  it("should validate required options", () => {
    const result = validateTeamOptions({ team: "leader-workers" })
    expect(result.valid).toBe(true)
  })

  it("should reject invalid mode", () => {
    const result = validateTeamOptions({ team: "invalid-mode" as TeamMode })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error).toContain("Invalid team mode")
    }
  })
})
