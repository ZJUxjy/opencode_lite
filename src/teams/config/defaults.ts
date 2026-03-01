import type { TeamConfig } from "../core/types.js"

export const defaultTeamConfigs: Record<string, TeamConfig> = {
  default: {
    mode: "leader-workers",
    maxIterations: 10,
    timeoutMs: 300000,
    budget: { maxTokens: 100000 },
    qualityGate: { testsMustPass: true, noP0Issues: true, requiredChecks: [] },
    circuitBreaker: { maxConsecutiveFailures: 3, maxNoProgressRounds: 5, cooldownMs: 60000 },
    conflictResolution: "auto",
  },
  fast: {
    mode: "worker-reviewer",
    maxIterations: 3,
    timeoutMs: 60000,
    budget: { maxTokens: 50000 },
    qualityGate: { testsMustPass: false, noP0Issues: true, requiredChecks: [] },
    circuitBreaker: { maxConsecutiveFailures: 2, maxNoProgressRounds: 3, cooldownMs: 30000 },
    conflictResolution: "auto",
  },
  thorough: {
    mode: "planner-executor-reviewer",
    maxIterations: 20,
    timeoutMs: 600000,
    budget: { maxTokens: 200000 },
    qualityGate: { testsMustPass: true, noP0Issues: true, requiredChecks: ["npm test"] },
    circuitBreaker: { maxConsecutiveFailures: 5, maxNoProgressRounds: 10, cooldownMs: 120000 },
    conflictResolution: "auto",
  },
}
