import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { writeFileSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { loadTeamsConfig, resolveTeamConfig, mergeWithDefaults } from "../../config/loader.js"
import type { TeamConfig } from "../../core/types.js"

const tempDir = "/tmp/teams-config-test"

describe("ConfigLoader", () => {
  beforeEach(() => {
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("should load valid config file", () => {
    const configPath = join(tempDir, "teams.json")
    writeFileSync(configPath, JSON.stringify({
      teams: {
        default: { mode: "leader-workers", maxIterations: 5 },
      },
    }))

    const config = loadTeamsConfig(configPath)
    expect(config.teams.default.mode).toBe("leader-workers")
  })

  it("should return empty config for non-existent file", () => {
    const config = loadTeamsConfig("/nonexistent/path.json")
    expect(config.teams).toEqual({})
  })

  it("should resolve team config with defaults", () => {
    const overrides: Partial<TeamConfig> = {
      mode: "worker-reviewer",
      maxIterations: 20,
    }
    const config = resolveTeamConfig("default", overrides)
    expect(config.mode).toBe("worker-reviewer")
    expect(config.maxIterations).toBe(20)
    expect(config.timeoutMs).toBeDefined() // has default
  })

  it("should merge with defaults correctly", () => {
    const config = mergeWithDefaults({ mode: "council" })
    expect(config.mode).toBe("council")
    expect(config.maxIterations).toBe(10)
    expect(config.timeoutMs).toBe(300000)
    expect(config.budget?.maxTokens).toBe(100000)
  })
})
