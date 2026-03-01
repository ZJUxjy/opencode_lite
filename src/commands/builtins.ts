import type { Command, CommandContext, Message } from "./types.js"

/**
 * Generate a unique message ID
 * (Mirrors the implementation in App.tsx for consistency)
 */
function generateMessageId(): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).slice(2, 6)
  return `msg-${timestamp}-${random}`
}

/**
 * Create a system message for display in the UI
 */
function createSystemMessage(content: string): Message {
  return {
    id: generateMessageId(),
    role: "system",
    content,
    timestamp: Date.now(),
  }
}

/**
 * Exit command - terminates the application
 */
const exitCommand: Command = {
  name: "/exit",
  aliases: ["/quit"],
  description: "Exit the program",
  handler: (_args: string, ctx: CommandContext) => {
    ctx.exit()
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
    const yoloStatus = ctx.agent.isYoloMode() ? "ON 🚀" : "OFF"
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
  /team         - Team mode control and baseline
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
 */
const skillsCommand: Command = {
  name: "/skills",
  aliases: ["/skill"],
  description: "List and manage skills",
  handler: (_args: string, ctx: CommandContext) => {
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
 * Team command - manage team execution modes and baselines
 */
const teamCommand: Command = {
  name: "/team",
  description: "Manage Team mode (status/mode/on/off/run/baseline/batch/checkpoints/resume)",
  handler: async (args: string, ctx: CommandContext) => {
    const [subcommand, ...rest] = args.trim().split(/\s+/).filter(Boolean)
    const payload = rest.join(" ").trim()

    if (!subcommand || subcommand === "status") {
      const status = ctx.agent.getTeamStatus()
      const mode = ctx.agent.getTeamMode()
      const message = createSystemMessage(
        `Team status:\n  Enabled: ${status.enabled ? "yes" : "no"}\n  Mode: ${mode.mode}${mode.strategy ? ` (${mode.strategy})` : ""}\n  Runtime: ${status.status}`
      )
      ctx.setMessages((prev) => [...prev, message])
      return
    }

    if (subcommand === "mode") {
      const [modeArg, strategyArg] = rest
      if (!modeArg) {
        const current = ctx.agent.getTeamMode()
        const message = createSystemMessage(
          `Current team mode: ${current.mode}${current.strategy ? ` (${current.strategy})` : ""}\n` +
          "Usage: /team mode worker-reviewer|planner-executor-reviewer|leader-workers|hotfix-guardrail|council [collaborative|competitive]"
        )
        ctx.setMessages((prev) => [...prev, message])
        return
      }

      if (!["worker-reviewer", "planner-executor-reviewer", "leader-workers", "hotfix-guardrail", "council"].includes(modeArg)) {
        const message = createSystemMessage(
          "Unsupported mode. Allowed: worker-reviewer, planner-executor-reviewer, leader-workers, hotfix-guardrail, council"
        )
        ctx.setMessages((prev) => [...prev, message])
        return
      }

      const strategy = strategyArg === "competitive" ? "competitive" : "collaborative"
      ctx.agent.setTeamMode(
        modeArg as "worker-reviewer" | "planner-executor-reviewer" | "leader-workers" | "hotfix-guardrail" | "council",
        strategy
      )
      const message = createSystemMessage(
        `✅ Team mode switched to ${modeArg}${modeArg === "leader-workers" ? ` (${strategy})` : ""}`
      )
      ctx.setMessages((prev) => [...prev, message])
      return
    }

    if (subcommand === "on") {
      ctx.agent.setTeamEnabled(true)
      const message = createSystemMessage("✅ Team mode enabled (worker-reviewer)")
      ctx.setMessages((prev) => [...prev, message])
      return
    }

    if (subcommand === "off") {
      ctx.agent.setTeamEnabled(false)
      const message = createSystemMessage("✅ Team mode disabled")
      ctx.setMessages((prev) => [...prev, message])
      return
    }

    if (subcommand === "run") {
      if (!payload) {
        const message = createSystemMessage("Usage: /team run <task>")
        ctx.setMessages((prev) => [...prev, message])
        return
      }

      const teamMode = ctx.agent.getTeamMode()
      const running = createSystemMessage(
        `👥 Team running in ${teamMode.mode}${teamMode.strategy ? ` (${teamMode.strategy})` : ""}...`
      )
      ctx.setMessages((prev) => [...prev, running])
      const result = await ctx.agent.runTeamTask(payload)
      const summary = createSystemMessage(
        `Team result: ${result.status}\n  Rounds: ${result.reviewRounds}\n  MustFix: ${result.mustFixCount}\n  P0: ${result.p0Count}\n  Tokens: ${result.stats.tokensUsed}\n  Fallback: ${result.fallbackUsed ? "yes" : "no"}\n\nOutput:\n${result.output}`
      )
      ctx.setMessages((prev) => [...prev.filter((m) => m.id !== running.id), summary])
      ctx.updateContextUsage()
      return
    }

    if (subcommand === "baseline") {
      if (!payload) {
        const message = createSystemMessage("Usage: /team baseline <task>")
        ctx.setMessages((prev) => [...prev, message])
        return
      }

      const running = createSystemMessage("📊 Running baseline comparison (single-agent vs team)...")
      ctx.setMessages((prev) => [...prev, running])
      const baseline = await ctx.agent.runTeamBaseline(payload)
      const summary = createSystemMessage(
        `Baseline comparison:\nSingle: tokens=${baseline.single.tokensUsed}, duration=${baseline.single.durationMs}ms\nTeam: tokens=${baseline.team.tokensUsed}, duration=${baseline.team.durationMs}ms, rounds=${baseline.team.reviewRounds}, mustFix=${baseline.team.mustFixCount}, p0=${baseline.team.p0Count}, fallback=${baseline.team.fallbackUsed ? "yes" : "no"}`
      )
      ctx.setMessages((prev) => [...prev.filter((m) => m.id !== running.id), summary])
      ctx.updateContextUsage()
      return
    }

    if (subcommand === "baseline-batch") {
      if (!payload) {
        const message = createSystemMessage(
          "Usage: /team baseline-batch <task1 || task2 || ...> (recommend >= 10 tasks)"
        )
        ctx.setMessages((prev) => [...prev, message])
        return
      }

      const tasks = payload.split("||").map((t) => t.trim()).filter(Boolean)
      const running = createSystemMessage(
        `📊 Running batch baseline for ${tasks.length} task(s)...`
      )
      ctx.setMessages((prev) => [...prev, running])

      const { summary } = await ctx.agent.runTeamBaselineBatch(tasks)
      const warning = summary.sampleSize < 10
        ? `\n⚠️ Sample size ${summary.sampleSize} < 10 (recommended minimum for rollout gate).`
        : ""

      const report = createSystemMessage(
        `Batch baseline summary (n=${summary.sampleSize})${warning}\n\n` +
        `Single-agent:\n` +
        `  avg tokens=${summary.single.avgTokens}, p50=${summary.single.p50Tokens}, p90=${summary.single.p90Tokens}\n` +
        `  avg duration=${summary.single.avgDurationMs}ms, p50=${summary.single.p50DurationMs}ms, p90=${summary.single.p90DurationMs}ms\n\n` +
        `Team(current mode):\n` +
        `  avg tokens=${summary.team.avgTokens}, p50=${summary.team.p50Tokens}, p90=${summary.team.p90Tokens}\n` +
        `  avg duration=${summary.team.avgDurationMs}ms, p50=${summary.team.p50DurationMs}ms, p90=${summary.team.p90DurationMs}ms\n` +
        `  avg rounds=${summary.team.avgReviewRounds}, avg mustFix=${summary.team.avgMustFixCount}, avg P0=${summary.team.avgP0Count}, fallback rate=${summary.team.fallbackRate}`
      )

      ctx.setMessages((prev) => [...prev.filter((m) => m.id !== running.id), report])
      ctx.updateContextUsage()
      return
    }

    if (subcommand === "checkpoints") {
      const checkpoints = ctx.agent.getTeamCheckpoints(20)
      if (checkpoints.length === 0) {
        const message = createSystemMessage("No checkpoints found.")
        ctx.setMessages((prev) => [...prev, message])
        return
      }

      const lines = checkpoints.map((cp) => {
        const mode = cp.context?.mode || "unknown"
        const task = (cp.context?.task || cp.description).slice(0, 80)
        return `- ${cp.id} | mode=${mode} | ${new Date(cp.timestamp).toISOString()} | ${task}`
      })
      const message = createSystemMessage(`Checkpoints (${checkpoints.length}):\n${lines.join("\n")}`)
      ctx.setMessages((prev) => [...prev, message])
      return
    }

    if (subcommand === "resume") {
      const [checkpointId, strategyArg] = rest
      if (!checkpointId) {
        const message = createSystemMessage(
          "Usage: /team resume <checkpoint-id> [continue-iteration|restart-task|skip-completed]"
        )
        ctx.setMessages((prev) => [...prev, message])
        return
      }
      const strategy =
        strategyArg === "restart-task" || strategyArg === "skip-completed"
          ? strategyArg
          : "continue-iteration"
      const running = createSystemMessage(`♻️ Resuming from checkpoint ${checkpointId} (${strategy})...`)
      ctx.setMessages((prev) => [...prev, running])
      try {
        const result = await ctx.agent.resumeTeamFromCheckpoint(checkpointId, strategy)
        const summary = createSystemMessage(
          `Resume result: ${result.status}\n  Rounds: ${result.reviewRounds}\n  MustFix: ${result.mustFixCount}\n  P0: ${result.p0Count}\n  Tokens: ${result.stats.tokensUsed}\n  Fallback: ${result.fallbackUsed ? "yes" : "no"}\n\nOutput:\n${result.output}`
        )
        ctx.setMessages((prev) => [...prev.filter((m) => m.id !== running.id), summary])
      } catch (error: any) {
        const message = createSystemMessage(`❌ Resume failed: ${error.message}`)
        ctx.setMessages((prev) => [...prev.filter((m) => m.id !== running.id), message])
      }
      ctx.updateContextUsage()
      return
    }

    const message = createSystemMessage(
      "Unknown /team subcommand. Use: /team status|mode <mode> [strategy]|on|off|run <task>|baseline <task>|baseline-batch <task1 || task2 ...>|checkpoints|resume <checkpoint-id> [strategy]"
    )
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
  teamCommand,
  mcpCommand,
]
