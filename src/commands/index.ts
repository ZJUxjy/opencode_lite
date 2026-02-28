import { Fzf, type FzfResultItem } from "fzf"
import type { Command } from "./types.js"
import { builtinCommands } from "./builtins.js"

/**
 * CommandRegistry - Central command management system
 *
 * Features:
 * - Command registration with alias support
 * - Prefix matching (exact startswith) - highest priority
 * - Fuzzy matching via fzf - fallback for partial matches
 * - Deduplication of commands with multiple aliases
 */
class CommandRegistry {
  private commands = new Map<string, Command>()
  private fzfInstance: Fzf<Command[]> | null = null

  constructor() {
    // Register all builtin commands
    builtinCommands.forEach((cmd) => this.register(cmd))
  }

  /**
   * Register a command and its aliases
   */
  register(cmd: Command): void {
    // Register primary name
    this.commands.set(cmd.name, cmd)

    // Register aliases (they point to the same command object)
    if (cmd.aliases) {
      cmd.aliases.forEach((alias) => {
        this.commands.set(alias, cmd)
      })
    }

    // Invalidate fzf instance to force rebuild on next search
    this.fzfInstance = null
  }

  /**
   * Get a command by exact name or alias
   */
  get(name: string): Command | undefined {
    return this.commands.get(name)
  }

  /**
   * Get all unique commands (deduplicated)
   * Returns only primary names, not aliases
   */
  getAll(): Command[] {
    const seen = new Set<string>()
    const result: Command[] = []

    for (const cmd of this.commands.values()) {
      if (!seen.has(cmd.name)) {
        seen.add(cmd.name)
        result.push(cmd)
      }
    }

    return result
  }

  /**
   * Find matching commands for autocomplete
   *
   * Strategy:
   * 1. If input doesn't start with '/', return empty (not a command)
   * 2. Prefix matching first (commands starting with input)
   * 3. Fuzzy matching as fallback (commands containing input chars in order)
   *
   * @param input - User input string
   * @returns Array of matching commands (deduplicated)
   */
  findMatches(input: string): Command[] {
    // Only match commands (must start with /)
    if (!input.startsWith("/")) {
      return []
    }

    const query = input.slice(1).toLowerCase() // Remove leading /

    // Get unique commands for matching
    const allCommands = this.getAll()

    // Step 1: Prefix matching (exact startswith) - highest priority
    const prefixMatches = allCommands.filter((cmd) => {
      const cmdName = cmd.name.slice(1).toLowerCase() // Remove leading /
      return cmdName.startsWith(query)
    })

    if (prefixMatches.length > 0) {
      return prefixMatches
    }

    // Step 2: Fuzzy matching as fallback
    // Rebuild fzf instance if needed
    if (!this.fzfInstance) {
      this.fzfInstance = new Fzf(allCommands, {
        selector: (cmd: Command) => cmd.name.slice(1), // Search without leading /
        casing: "case-insensitive",
      })
    }

    const fuzzyResults: FzfResultItem<Command>[] = this.fzfInstance.find(query)

    // Extract commands from fuzzy results
    return fuzzyResults.map((result) => result.item)
  }

  /**
   * Check if a string is a valid command
   */
  isCommand(input: string): boolean {
    return input.startsWith("/") && this.commands.has(input.split(" ")[0])
  }

  /**
   * Get command names for display
   */
  getCommandNames(): string[] {
    const names = new Set<string>()
    for (const cmd of this.commands.keys()) {
      names.add(cmd)
    }
    return Array.from(names).sort()
  }
}

// Singleton instance
export const registry = new CommandRegistry()
