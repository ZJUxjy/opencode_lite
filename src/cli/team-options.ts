/**
 * Team CLI Options Parser
 *
 * Parses and validates command-line options for agent teams
 */

import { TEAM_MODES, type TeamMode } from "../teams/modes/index.js"

export interface TeamCLIOptions {
  team?: TeamMode
  teamConfig?: string
  teamObjective?: string
  teamBudget?: number
  teamTimeout?: number
  teamProfile?: string
}

export function parseTeamOptions(argv: string[]): TeamCLIOptions {
  const options: TeamCLIOptions = {}

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case "--team":
        options.team = argv[++i] as TeamMode
        break
      case "--team-config":
        options.teamConfig = argv[++i]
        break
      case "--team-objective":
        options.teamObjective = argv[++i]
        break
      case "--team-budget":
        options.teamBudget = parseInt(argv[++i], 10)
        break
      case "--team-timeout":
        options.teamTimeout = parseInt(argv[++i], 10)
        break
      case "--team-profile":
        options.teamProfile = argv[++i]
        break
    }
  }

  return options
}

export function validateTeamOptions(
  options: TeamCLIOptions
): { valid: true } | { valid: false; error: string } {
  if (options.team && !TEAM_MODES.includes(options.team)) {
    return {
      valid: false,
      error: `Invalid team mode: ${options.team}. Valid modes: ${TEAM_MODES.join(", ")}`,
    }
  }

  if (options.teamBudget !== undefined && options.teamBudget <= 0) {
    return { valid: false, error: "Team budget must be positive" }
  }

  if (options.teamTimeout !== undefined && options.teamTimeout <= 0) {
    return { valid: false, error: "Team timeout must be positive" }
  }

  return { valid: true }
}
