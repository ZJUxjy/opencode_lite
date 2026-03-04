/**
 * Message Filter Tool
 *
 * Allows filtering which types of messages are displayed in the UI.
 */
import { z } from "zod"
import type { Tool } from "../types.js"

/**
 * Filter visible messages
 */
export const filterMessagesTool: Tool = {
  name: "filter_messages",
  description: `Filter which types of messages are displayed.

Options:
- show_all: Show all messages (default)
- hide_system: Hide system/tool messages
- show_errors_only: Only show error messages
- compact: Collapse all groups

Example: filter_messages mode="hide_system"`,

  parameters: z.object({
    mode: z.enum(["show_all", "hide_system", "show_errors_only", "compact"])
      .describe("Filter mode"),
  }),

  execute: async (params) => {
    const descriptions: Record<string, string> = {
      show_all: "Showing all messages",
      hide_system: "Hiding system and tool messages",
      show_errors_only: "Showing only error messages",
      compact: "All message groups collapsed",
    }

    return `✅ ${descriptions[params.mode]}

Note: This tool sets the filter preference. Use keyboard shortcuts for quick access:
- Ctrl+E: Expand all
- Ctrl+O: Collapse all
- Ctrl+H: Toggle system messages`
  },
}
