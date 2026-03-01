import { existsSync, readFileSync } from "node:fs"
import type { TeamConfig, BudgetConfig, QualityGateConfig, CircuitBreakerConfig } from "../core/types.js"
import { defaultTeamConfigs } from "./defaults.js"

export interface TeamsConfigFile {
  teams: {
    [profile: string]: Partial<TeamConfig>
  }
}

export function loadTeamsConfig(path: string): TeamsConfigFile {
  if (!existsSync(path)) {
    return { teams: {} }
  }
  try {
    const content = readFileSync(path, "utf-8")
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed.teams === "object") {
      return parsed as TeamsConfigFile
    }
    return { teams: {} }
  } catch {
    return { teams: {} }
  }
}

function mergeBudget(
  base: BudgetConfig | undefined,
  overrides: BudgetConfig | undefined
): BudgetConfig | undefined {
  if (!base && !overrides) return undefined
  return { ...(base || {}), ...(overrides || {}) } as BudgetConfig
}

function mergeQualityGate(
  base: QualityGateConfig,
  overrides: QualityGateConfig | undefined
): QualityGateConfig {
  return { ...base, ...(overrides || {}) }
}

function mergeCircuitBreaker(
  base: CircuitBreakerConfig,
  overrides: CircuitBreakerConfig | undefined
): CircuitBreakerConfig {
  return { ...base, ...(overrides || {}) }
}

export function mergeWithDefaults(overrides: Partial<TeamConfig>): TeamConfig {
  const base = defaultTeamConfigs.default
  return {
    ...base,
    ...overrides,
    budget: mergeBudget(base.budget, overrides.budget),
    qualityGate: mergeQualityGate(base.qualityGate, overrides.qualityGate),
    circuitBreaker: mergeCircuitBreaker(base.circuitBreaker, overrides.circuitBreaker),
  }
}

export function resolveTeamConfig(
  profile: string,
  overrides: Partial<TeamConfig> = {}
): TeamConfig {
  const baseConfig = defaultTeamConfigs[profile] || defaultTeamConfigs.default
  return {
    ...baseConfig,
    ...overrides,
    budget: mergeBudget(baseConfig.budget, overrides.budget),
    qualityGate: mergeQualityGate(baseConfig.qualityGate, overrides.qualityGate),
    circuitBreaker: mergeCircuitBreaker(baseConfig.circuitBreaker, overrides.circuitBreaker),
  }
}
