/**
 * MCP Status and Diagnose Tools
 *
 * Provides tools for monitoring MCP server status and diagnosing issues.
 */

import { z } from "zod"
import type { Tool } from "../types.js"
import { getMCPManager } from "../mcp/index.js"

/**
 * Show MCP server status
 */
export const mcpStatusTool: Tool = {
  name: "mcp_status",
  description: `Show MCP (Model Context Protocol) server status and statistics.

Displays:
- Server connection status (connected/disconnected)
- Health status (healthy/degraded/unhealthy)
- Tool count per server
- Recent error counts
- Average response times

Use this to diagnose MCP connectivity issues.`,

  parameters: z.object({
    server: z.string().optional().describe("Filter to specific server name"),
  }),

  execute: async (params) => {
    const manager = getMCPManager()
    if (!manager) {
      return "MCP not initialized. No MCP servers are configured."
    }

    const states = manager.getAllServerStates()
    const lines: string[] = []

    lines.push("# MCP Server Status")
    lines.push("")

    let hasServers = false

    for (const state of states) {
      // Skip if filtering
      if (params.server && state.name !== params.server) {
        continue
      }

      hasServers = true
      const health = manager.getServerHealth(state.name)
      const statusIcon = health.connected ? "🟢" : "🔴"
      const healthIcon =
        health.status === "healthy" ? "✓" : health.status === "degraded" ? "⚠" : "✗"

      lines.push(`${statusIcon} **${state.name}**`)
      lines.push(`   Status: ${state.status.type}`)
      lines.push(`   Health: ${healthIcon} ${health.status}`)

      if (health.stats) {
        lines.push(
          `   Calls: ${health.stats.totalCalls} (${health.stats.successfulCalls} success, ${health.stats.failedCalls} failed)`
        )
        lines.push(`   Avg Duration: ${Math.round(health.stats.averageDuration)}ms`)
      }

      const tools = manager.getAllTools().filter((t) => t.server === state.name)
      lines.push(`   Tools: ${tools.length}`)

      if (health.stats?.lastError) {
        const errorPreview =
          health.stats.lastError.length > 100
            ? health.stats.lastError.slice(0, 100) + "..."
            : health.stats.lastError
        lines.push(`   Last Error: ${errorPreview}`)
      }

      lines.push("")
    }

    if (!hasServers) {
      lines.push("No MCP servers configured.")
      lines.push("")
      lines.push("Add servers to settings.json:")
      lines.push("```json")
      lines.push('"mcp": {')
      lines.push('  "servers": {')
      lines.push('    "my-server": {')
      lines.push('      "command": "node",')
      lines.push('      "args": ["server.js"]')
      lines.push("    }")
      lines.push("  }")
      lines.push("}")
      lines.push("```")
    }

    return lines.join("\n")
  },
}

/**
 * Diagnose MCP issues
 */
export const mcpDiagnoseTool: Tool = {
  name: "mcp_diagnose",
  description: `Diagnose MCP server configuration and connectivity issues.

Checks:
- Configuration validity
- Server process availability
- Tool registration status
- Recent errors

Example: mcp_diagnose server="my-server"`,

  parameters: z.object({
    server: z.string().optional().describe("Specific server to diagnose (default: all)"),
  }),

  execute: async (params) => {
    const manager = getMCPManager()
    if (!manager) {
      return "❌ MCP not initialized. No MCP servers are configured."
    }

    const lines: string[] = []
    lines.push("# MCP Diagnostics")
    lines.push("")

    const states = manager.getAllServerStates()

    if (states.length === 0) {
      lines.push("No MCP servers configured.")
      lines.push("")
      lines.push("To add an MCP server, edit your settings.json file:")
      lines.push("```json")
      lines.push('"mcp": {')
      lines.push('  "servers": {')
      lines.push('    "my-server": {')
      lines.push('      "command": "node",')
      lines.push('      "args": ["path/to/server.js"]')
      lines.push("    }")
      lines.push("  }")
      lines.push("}")
      lines.push("```")
      return lines.join("\n")
    }

    for (const state of states) {
      if (params.server && state.name !== params.server) {
        continue
      }

      lines.push(`## ${state.name}`)
      lines.push("")

      // Check connection
      if (state.status.type !== "connected") {
        lines.push("❌ Not connected")
        lines.push(`   Status: ${state.status.type}`)

        if (state.status.type === "error" && "error" in state.status && state.status.error) {
          lines.push(`   Error: ${state.status.error.message}`)
        }

        lines.push("")
        lines.push("**Possible causes:**")
        lines.push("- Server process not running")
        lines.push("- Incorrect command/path in settings.json")
        lines.push("- Missing dependencies")
        lines.push("- Server crashed during startup")
        lines.push("")
        continue
      }

      lines.push("✅ Connected")

      // Check tools
      const tools = manager.getAllTools().filter((t) => t.server === state.name)
      if (tools.length === 0) {
        lines.push("⚠️  No tools registered")
        lines.push("")
        lines.push("Server is connected but no tools are available.")
        lines.push("The server may not be implementing the tool protocol correctly.")
      } else {
        lines.push(`✅ ${tools.length} tools registered`)
        lines.push("")
        lines.push("Tools:")
        for (const tool of tools.slice(0, 5)) {
          lines.push(`  - ${tool.name}`)
        }
        if (tools.length > 5) {
          lines.push(`  ... and ${tools.length - 5} more`)
        }
      }

      lines.push("")
    }

    // Show recent errors
    const stats = manager.getStats()
    const recentErrors = stats.getRecentErrors(3)

    if (recentErrors.length > 0) {
      lines.push("## Recent Errors")
      lines.push("")

      for (const error of recentErrors) {
        const errorPreview =
          error.error && error.error.length > 80
            ? error.error.slice(0, 80) + "..."
            : error.error || "Unknown error"
        lines.push(`- ${error.serverName}.${error.toolName}: ${errorPreview}`)
      }

      lines.push("")
    }

    return lines.join("\n")
  },
}
