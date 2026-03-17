// src/input/slash-commands.ts

/**
 * Available slash commands
 */
export const SLASH_COMMANDS = {
  models: {
    description: "Open model selection dialog",
    usage: "/models",
  },
  provider: {
    description: "Open provider selection dialog",
    usage: "/provider",
  },
} as const

export type SlashCommand = keyof typeof SLASH_COMMANDS

/**
 * Parse input for slash commands
 * @returns Command name if input is a slash command, null otherwise
 */
export function parseSlashCommand(input: string): SlashCommand | null {
  const trimmed = input.trim()

  if (trimmed === "/models") {
    return "models"
  }
  if (trimmed === "/provider") {
    return "provider"
  }

  return null
}

/**
 * Check if input looks like a slash command (for autocomplete hints)
 */
export function isPartialSlashCommand(input: string): boolean {
  const trimmed = input.trim()
  return trimmed.startsWith("/") && !trimmed.includes(" ")
}

/**
 * Get matching commands for autocomplete
 */
export function getMatchingCommands(partial: string): SlashCommand[] {
  const trimmed = partial.trim().toLowerCase()

  if (!trimmed.startsWith("/")) {
    return []
  }

  const commands = Object.keys(SLASH_COMMANDS) as SlashCommand[]
  return commands.filter((cmd) => `/${cmd}`.startsWith(trimmed))
}
