import type { Command, CommandContext } from "./types.js"
import { createSystemMessage } from "../messages/types.js"

// Re-export createSystemMessage for use in other command handlers if needed
export { createSystemMessage }

/**
 * Exit command - terminates the application
 */
const exitCommand: Command = {
  name: "/exit",
  aliases: ["/quit"],
  description: "Exit the program",
  handler: async (_args: string, ctx: CommandContext) => {
    // 显示恢复提示
    process.stdout.write('\n📋 To resume this session, run:\n')
    process.stdout.write(`   lite-opencode --resume ${ctx.agent.sessionId}\n\n`)

    // 先清理 MCP 连接
    const mcpManager = ctx.agent.getMCPManager()
    if (mcpManager) {
      try {
        await mcpManager.dispose()
      } catch {
        // 忽略清理错误
      }
    }

    // 强制退出进程
    process.exit(0)
  },
}

/**
 * Clear command - clears session history and resets agent state
 */
const clearCommand: Command = {
  name: "/clear",
  description: "Clear session history",
  handler: (_args: string, ctx: CommandContext) => {
    ctx.agent.clearSession()
    ctx.setMessages([])
    ctx.updateContextUsage()
  },
}

/**
 * Help command - displays available commands
 */
const helpCommand: Command = {
  name: "/help",
  description: "Show available commands",
  handler: (_args: string, ctx: CommandContext) => {
    const yoloStatus = ctx.agent.isYoloMode() ? "ON" : "OFF"
    const mcpStatus = ctx.agent.getMCPStatus()
    const mcpText = mcpStatus.length > 0
      ? `  /mcp          - Show MCP server status (${mcpStatus.filter(s => s.connected).length}/${mcpStatus.length} connected)\n`
      : ""
    const helpMessage = createSystemMessage(
      `Available commands:
  /exit, /quit  - Exit the program
  /clear        - Clear current session
  /help         - Show this help
  /tools        - List available tools
  /stats        - Show session statistics
  /compact      - Compress context (auto level)
  /compact preview - Show compression preview
  /yolo         - Toggle YOLO mode (auto-approve all)
  /sessions, /resume  - Show session list and switch sessions
  /skills       - List and manage skills
  /models       - Switch model
  /provider     - Switch provider
  /dump         - Toggle prompt dump for debugging
${mcpText}
Current status:
  YOLO Mode: ${yoloStatus}

Tip: Type / to see all commands, use Tab to autocomplete.`
    )
    ctx.setMessages((prev) => [...prev, helpMessage])
  },
}

/**
 * Tools command - lists all available tools and their descriptions
 */
const toolsCommand: Command = {
  name: "/tools",
  description: "List available tools",
  handler: (_args: string, ctx: CommandContext) => {
    const tools = ctx.agent.getTools()

    const toolList = tools
      .map((t) => {
        // 尝试从 Zod schema 中提取参数名
        let params = "    (no parameters)"
        if (t.parameters) {
          try {
            // 使用 any 类型来绕过 TypeScript 检查
            // ZodObject 的 shape 属性包含字段定义
            const schema = t.parameters as any
            const shape = schema._def?.shape || schema.shape
            if (shape && typeof shape === "object") {
              const keys = Object.keys(shape)
              if (keys.length > 0) {
                params = keys.map((p) => `    - ${p}`).join("\n")
              }
            }
          } catch {
            // 如果无法提取，忽略
          }
        }
        return `  📦 ${t.name}\n    ${t.description}\n${params}`
      })
      .join("\n\n")

    const message = createSystemMessage(`Available tools:\n\n${toolList}`)
    ctx.setMessages((prev) => [...prev, message])
  },
}

/**
 * Stats command - displays session statistics
 */
const statsCommand: Command = {
  name: "/stats",
  description: "Show session statistics",
  handler: (_args: string, ctx: CommandContext) => {
    const stats = ctx.agent.getSessionStats()
    const usagePercent = Math.round(stats.contextUsage.percentage * 100)
    const usedK = (stats.contextUsage.used / 1000).toFixed(1)
    const limitK = (stats.contextUsage.limit / 1000).toFixed(0)

    const message = createSystemMessage(
      `📊 Session Statistics

Messages:
  • Total: ${stats.messageCount}
  • User: ${stats.userMessages}
  • Assistant: ${stats.assistantMessages}
  • Tool calls: ${stats.toolCalls}

Context:
  • Usage: ${usagePercent}% (${usedK}K / ${limitK}K tokens)
  • Strategy: ${stats.strategy.toUpperCase()}
  • Model: ${stats.modelId}`
    )
    ctx.setMessages((prev) => [...prev, message])
  },
}

/**
 * Compact command - manually triggers context compression
 * Usage:
 *   /compact         - Execute compression immediately (auto level)
 *   /compact preview - Show compression preview
 *   /compact light   - Use light compression (keep more context)
 *   /compact moderate - Use moderate compression
 *   /compact aggressive - Use aggressive compression (keep minimal)
 */
const compactCommand: Command = {
  name: "/compact",
  description: "Compress context to save tokens",
  handler: async (args: string, ctx: CommandContext) => {
    const trimmedArgs = args.trim().toLowerCase()

    // 如果参数是 "preview"，显示预览
    if (trimmedArgs === "preview") {
      const preview = ctx.agent.getCompressionPreview()

      const previewLines = [
        `📦 Context Compression Preview`,
        ``,
        `Current state:`,
        `  • Tokens: ${preview.currentTokens} (${preview.currentPercentage}% of limit)`,
        `  • Messages: ${preview.messageCount}`,
        ``,
        `Compression options:`,
      ]

      for (const level of preview.levels) {
        const emoji = level.level === "light" ? "🟢" :
          level.level === "moderate" ? "🟡" : "🔴"
        previewLines.push(
          `  ${emoji} ${level.level.padEnd(10)} - Remove ${level.wouldRemove} messages, ~${level.estimatedTokens} tokens`
        )
      }

      previewLines.push(``,
        `Run '/compact' to compress with auto level selection`,
        `Or specify a level: /compact light|moderate|aggressive`)

      const message = createSystemMessage(previewLines.join('\n'))
      ctx.setMessages((prev) => [...prev, message])
      return
    }

    // 执行压缩
    const processingMsg = createSystemMessage("📦 Compressing context...")
    ctx.setMessages((prev) => [...prev, processingMsg])

    try {
      // 确定压缩级别
      const level = ["light", "moderate", "aggressive"].includes(trimmedArgs)
        ? trimmedArgs as "light" | "moderate" | "aggressive"
        : undefined

      const result = await ctx.agent.compactContext(level)
      ctx.updateContextUsage()

      const savedTokens = result.before - result.after
      const savedPercent = result.before > 0
        ? Math.round((savedTokens / result.before) * 100)
        : 0

      const emoji = result.level === "light" ? "🟢" :
        result.level === "moderate" ? "🟡" : "🔴"

      const message = createSystemMessage(
        `✅ Context compressed (${emoji} ${result.level})
  • Before: ${result.before} tokens
  • After: ${result.after} tokens
  • Saved: ${savedTokens} tokens (${savedPercent}%)
  • Messages removed: ${result.messagesRemoved}
  • Summary: ${result.summaryGenerated ? "Generated" : "N/A"}`
      )
      ctx.setMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== processingMsg.id)
        return [...filtered, message]
      })
    } catch (error: any) {
      const errorMessage = createSystemMessage(
        `❌ Compression failed: ${error.message}`
      )
      ctx.setMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== processingMsg.id)
        return [...filtered, errorMessage]
      })
    }
  },
}

/**
 * Yolo command - toggles YOLO mode (auto-approve all permissions)
 */
const yoloCommand: Command = {
  name: "/yolo",
  description: "Toggle YOLO mode (auto-approve all)",
  handler: (_args: string, ctx: CommandContext) => {
    const newState = ctx.agent.toggleYoloMode()
    const status = newState ? "ON" : "OFF"
    const emoji = newState ? "🚀" : "🔒"
    const warning = newState
      ? "\n\n⚠️ Warning: All operations will be auto-approved. Use with caution!"
      : ""

    const message = createSystemMessage(
      `${emoji} YOLO Mode: ${status}${warning}`
    )
    ctx.setMessages((prev) => [...prev, message])
  },
}

/**
 * Sessions command - shows interactive session selector
 */
const sessionsCommand: Command = {
  name: "/sessions",
  aliases: ["/resume"],
  description: "Show session list and switch sessions",
  handler: (_args: string, ctx: CommandContext) => {
    if (ctx.showSessionList) {
      ctx.showSessionList()
    } else {
      const message = createSystemMessage(
        "⚠️ Session list not available in this context"
      )
      ctx.setMessages((prev) => [...prev, message])
    }
  },
}

/**
 * Skills command - list and manage skills
 * Usage:
 *   /skills       - List all skills
 *   /skills watch - Toggle hot reload watching
 */
const skillsCommand: Command = {
  name: "/skills",
  aliases: ["/skill"],
  description: "List and manage skills",
  handler: (args: string, ctx: CommandContext) => {
    const trimmedArgs = args.trim().toLowerCase()

    // Handle watch subcommand
    if (trimmedArgs === "watch") {
      const registry = ctx.agent.getSkillRegistry()

      const isWatching = registry.isHotReloadEnabled()

      if (isWatching) {
        registry.disableHotReload()
        const message = createSystemMessage("⏸️  Skill hot reload disabled")
        ctx.setMessages((prev) => [...prev, message])
      } else {
        registry.enableHotReload()
        const message = createSystemMessage("▶️  Skill hot reload enabled - changes to SKILL.md files will auto-reload")
        ctx.setMessages((prev) => [...prev, message])
      }
      return
    }

    const skills = ctx.agent.getSkills()

    if (skills.length === 0) {
      const message = createSystemMessage(
        `No skills found.

Skills can be placed in:
  • ./skills/ (project-specific)
  • ~/.lite-opencode/skills/ (global)

Each skill is a directory containing a SKILL.md file with YAML frontmatter.`
      )
      ctx.setMessages((prev) => [...prev, message])
      return
    }

    const lines: string[] = []
    lines.push(`# Available Skills (${skills.length})`)
    lines.push(``)

    // Active skills first
    const activeSkills = skills.filter((s) => s.isActive)
    const inactiveSkills = skills.filter((s) => !s.isActive)

    if (activeSkills.length > 0) {
      lines.push(`## Active 🟢`)
      lines.push(``)
      for (const skill of activeSkills) {
        lines.push(`**${skill.name}** (${skill.id})`)
        lines.push(`  ${skill.description}`)
        lines.push(``)
      }
    }

    if (inactiveSkills.length > 0) {
      lines.push(`## Inactive ⚪`)
      lines.push(``)
      for (const skill of inactiveSkills) {
        const activation = skill.activation === "auto" ? "[auto]" :
                          skill.activation === "always" ? "[always]" : "[manual]"
        lines.push(`**${skill.name}** ${activation}`)
        lines.push(`  ${skill.description}`)
        lines.push(``)
      }
    }

    lines.push(`---`)
    lines.push(`To activate a skill, use: activate_skill tool with id="skill-id"`)
    lines.push(`To toggle hot reload, use: /skills watch`)

    const message = createSystemMessage(lines.join("\n"))
    ctx.setMessages((prev) => [...prev, message])
  },
}

/**
 * MCP command - shows MCP server status and available tools
 */
const mcpCommand: Command = {
  name: "/mcp",
  description: "Show MCP server status",
  handler: (_args: string, ctx: CommandContext) => {
    const status = ctx.agent.getMCPStatus()

    if (status.length === 0) {
      const message = createSystemMessage(
        `No MCP servers configured.

To configure MCP servers, add to your settings.json:
{
  "mcp": {
    "enabled": true,
    "servers": [
      {
        "name": "filesystem",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
      }
    ]
  }
}`
      )
      ctx.setMessages((prev) => [...prev, message])
      return
    }

    const lines: string[] = []
    const connectedCount = status.filter((s) => s.connected).length
    const totalTools = status.reduce((sum, s) => sum + s.tools, 0)

    lines.push(`# MCP Servers (${connectedCount}/${status.length} connected)`)
    lines.push(``)

    for (const server of status) {
      const emoji = server.connected ? "🟢" : "🔴"
      lines.push(`${emoji} **${server.name}**`)
      lines.push(`  Status: ${server.connected ? "Connected" : "Disconnected"}`)
      lines.push(`  Tools: ${server.tools}`)
      lines.push(``)
    }

    lines.push(`---`)
    lines.push(`Total MCP tools available: ${totalTools}`)

    const message = createSystemMessage(lines.join("\n"))
    ctx.setMessages((prev) => [...prev, message])
  },
}

/**
 * Models command - opens model selection dialog
 */
const modelsCommand: Command = {
  name: "/models",
  description: "Open model selection dialog",
  handler: (_args: string, ctx: CommandContext) => {
    if (ctx.showModelDialog) {
      ctx.showModelDialog()
    } else {
      const message = createSystemMessage("Model selection not available in this context")
      ctx.setMessages((prev) => [...prev, message])
    }
  },
}

/**
 * Provider command - opens provider selection dialog
 */
const providerCommand: Command = {
  name: "/provider",
  aliases: ["/providers"],
  description: "Open provider selection dialog",
  handler: (_args: string, ctx: CommandContext) => {
    if (ctx.showProviderDialog) {
      ctx.showProviderDialog()
    } else {
      const message = createSystemMessage("Provider selection not available in this context")
      ctx.setMessages((prev) => [...prev, message])
    }
  },
}

/**
 * Dump command - toggles prompt dump for debugging
 */
const dumpCommand: Command = {
  name: "/dump",
  description: "Toggle prompt dump for debugging",
  handler: (_args: string, ctx: CommandContext) => {
    if (!ctx.toggleDumpPrompt || !ctx.getDumpStatus) {
      const message = createSystemMessage("Dump functionality not available")
      ctx.setMessages((prev) => [...prev, message])
      return
    }

    const status = ctx.getDumpStatus()
    ctx.toggleDumpPrompt()
    const newStatus = ctx.getDumpStatus()

    const lines: string[] = []
    lines.push(`${newStatus.enabled ? "Prompt dump enabled" : "Prompt dump disabled"}`)
    if (newStatus.enabled) {
      lines.push(`Dump file: ${newStatus.path}`)
    }

    const message = createSystemMessage(lines.join("\n"))
    ctx.setMessages((prev) => [...prev, message])
  },
}

/**
 * All builtin commands
 * Exported as array for easy registration in CommandRegistry
 */
export const builtinCommands: Command[] = [
  exitCommand,
  clearCommand,
  helpCommand,
  toolsCommand,
  statsCommand,
  compactCommand,
  yoloCommand,
  sessionsCommand,
  skillsCommand,
  mcpCommand,
  dumpCommand,
  modelsCommand,
  providerCommand,
]
