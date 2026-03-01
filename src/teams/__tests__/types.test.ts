import { describe, it, expect } from "vitest"
import {
  TeamMode,
  AgentRole,
  TeamConfig,
  ThinkingBudget,
  ContextContract,
  TeamConfigSchema,
  defaultTeamConfig,
  TEAM_MODES,
  AGENT_ROLES,
} from "../core/types.js"

describe("Types", () => {
  it("should define all team modes", () => {
    const modes: TeamMode[] = ["council", "leader-workers", "worker-reviewer", "planner-executor-reviewer", "hotfix-guardrail"]
    expect(modes).toHaveLength(5)
  })

  it("should define agent roles", () => {
    const roles: AgentRole[] = ["leader", "worker", "reviewer", "planner", "executor"]
    expect(roles).toHaveLength(5)
  })

  it("should have valid default team config", () => {
    const config: TeamConfig = {
      mode: "leader-workers",
      maxIterations: 10,
      timeoutMs: 300000,
      budget: { maxTokens: 100000 },
      qualityGate: { testsMustPass: true, noP0Issues: true, requiredChecks: [] },
      circuitBreaker: { maxConsecutiveFailures: 3, maxNoProgressRounds: 5, cooldownMs: 60000 },
      conflictResolution: "auto",
    }
    expect(config.mode).toBe("leader-workers")
  })

  it("should support thinking budget", () => {
    const budget: ThinkingBudget = {
      enabled: true,
      maxThinkingTokens: 10000,
      outputThinkingProcess: true,
    }
    expect(budget.enabled).toBe(true)
  })

  it("should support context contract", () => {
    const contract: ContextContract = {
      taskId: "test-task",
      objective: "Add feature",
      context: { background: "...", constraints: [], references: [] },
      boundaries: { mustNot: [], shouldConsider: [] },
      expectedOutcome: { intent: "...", validationHint: "..." },
    }
    expect(contract.objective).toBe("Add feature")
  })

  // Runtime tests - these require actual implementation
  describe("Runtime values", () => {
    it("should export TEAM_MODES array", () => {
      expect(TEAM_MODES).toBeDefined()
      expect(TEAM_MODES).toContain("leader-workers")
      expect(TEAM_MODES).toContain("council")
      expect(TEAM_MODES).toHaveLength(5)
    })

    it("should export AGENT_ROLES array", () => {
      expect(AGENT_ROLES).toBeDefined()
      expect(AGENT_ROLES).toContain("leader")
      expect(AGENT_ROLES).toContain("worker")
    })

    it("should export defaultTeamConfig", () => {
      expect(defaultTeamConfig).toBeDefined()
      expect(defaultTeamConfig.mode).toBe("worker-reviewer")
      expect(defaultTeamConfig.maxIterations).toBeGreaterThan(0)
      expect(defaultTeamConfig.timeoutMs).toBeGreaterThan(0)
    })

    it("should export TeamConfigSchema for validation", () => {
      expect(TeamConfigSchema).toBeDefined()

      const validConfig = {
        mode: "leader-workers",
        agents: [{ role: "leader" as const, model: "gpt-4" }],
        maxIterations: 10,
        timeoutMs: 300000,
        qualityGate: { testsMustPass: true, noP0Issues: true },
        circuitBreaker: { maxConsecutiveFailures: 3, maxNoProgressRounds: 5, cooldownMs: 60000 },
        conflictResolution: "auto" as const,
      }

      const result = TeamConfigSchema.safeParse(validConfig)
      expect(result.success).toBe(true)
    })
  })
})
