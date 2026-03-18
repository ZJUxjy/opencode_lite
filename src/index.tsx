#!/usr/bin/env node
import React from "react"
import { render } from "ink"
import { Command } from "commander"
import { Agent } from "./agent.js"
import { MessageStore } from "./store.js"
import { SessionStore, formatRelativeTime, type Session } from "./session/index.js"
import { App } from "./App.js"
import { TeamManager } from "./teams/manager.js"
import type { TeamMode } from "./teams/core/types.js"
import { TEAM_MODES } from "./teams/core/types.js"
import * as path from "path"
import * as os from "os"
import * as fs from "fs"
import { parseDumpOption } from "./cli/dump-option.js"

// 从 settings.json 加载配置
import type { MCPGlobalConfig } from "./mcp/config.js"
import type { RiskConfig } from "./policy/risk.js"

interface SettingsConfig {
  env?: Record<string, string>
  timeout?: number
  mcp?: MCPGlobalConfig
  policy?: {
    risk?: RiskConfig
    yoloMode?: boolean
  }
}

function loadSettings(): SettingsConfig {
  // 按优先级查找 settings.json:
  // 1. 当前工作目录
  // 2. 项目根目录（相对于可执行文件）
  // 3. 用户主目录
  const searchPaths = [
    path.join(process.cwd(), "settings.json"),
    path.join(path.dirname(process.argv[1] || ""), "..", "settings.json"),
    path.join(os.homedir(), ".lite-opencode", "settings.json"),
  ]

  for (const settingsPath of searchPaths) {
    try {
      if (fs.existsSync(settingsPath)) {
        const content = fs.readFileSync(settingsPath, "utf-8")
        return JSON.parse(content)
      }
    } catch (error) {
      // 忽略解析错误，继续查找下一个路径
    }
  }
  return {}
}

// 获取配置值：CLI 参数 > settings.json > 环境变量 > 默认值
function getConfig(
  cliValue: string | undefined,
  envKey: string,
  settings: SettingsConfig,
  defaultValue: string
): string {
  if (cliValue) return cliValue
  if (settings.env?.[envKey]) return settings.env[envKey]
  if (process.env[envKey]) return process.env[envKey]
  return defaultValue
}

/**
 * 将 settings.env 中的环境变量应用到 process.env
 * 这样 MCP 配置中的 ${VAR} 占位符才能正确解析
 */
function applySettingsEnvToProcess(settings: SettingsConfig): void {
  if (settings.env) {
    for (const [key, value] of Object.entries(settings.env)) {
      // 不覆盖已存在的环境变量（优先级：shell env > settings.env）
      if (process.env[key] === undefined) {
        process.env[key] = value
      }
    }
  }
}

/**
 * 解析会话参数，确定要使用的会话ID和是否为新会话
 */
function resolveSession(
  options: {
    resume?: boolean | string
    continue?: boolean
    session?: string
  },
  sessionStore: SessionStore,
  cwd: string
): { sessionId: string; isNewSession: boolean; resumedSession?: Session } {
  // 优先级: --resume <id> > --resume (latest) > --continue > --session > new session

  // Case 1: --resume [session-id]
  if (options.resume !== undefined) {
    if (typeof options.resume === "string") {
      // --resume <session-id>: 恢复指定会话
      const session = sessionStore.get(options.resume)
      if (!session) {
        console.error(`Error: Session "${options.resume}" not found`)
        process.exit(1)
      }
      return { sessionId: options.resume, isNewSession: false, resumedSession: session }
    } else {
      // --resume: 恢复最新会话
      const latestSession = sessionStore.getLatestSession()
      if (!latestSession) {
        console.error("Error: No sessions found. Create a new session instead.")
        process.exit(1)
      }
      return {
        sessionId: latestSession.id,
        isNewSession: false,
        resumedSession: latestSession,
      }
    }
  }

  // Case 2: --continue: 继续当前目录的最后会话
  if (options.continue) {
    const lastSession = sessionStore.getLastSession(cwd)
    if (!lastSession) {
      console.error(`Error: No previous session found for directory: ${cwd}`)
      process.exit(1)
    }
    return { sessionId: lastSession.id, isNewSession: false, resumedSession: lastSession }
  }

  // Case 3: --session <id>: 使用指定的会话ID（兼容现有行为）
  if (options.session && options.session !== Date.now().toString()) {
    // 检查会话是否存在
    const existingSession = sessionStore.get(options.session)
    if (existingSession) {
      return { sessionId: options.session, isNewSession: false, resumedSession: existingSession }
    }
    // 会话不存在，创建新会话（用户显式指定了ID）
    console.log(`That session is not found, Creating new session: ${options.session}`)
    return { sessionId: options.session, isNewSession: true }
  }

  // Case 4: 创建新会话
  const newSessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  return { sessionId: newSessionId, isNewSession: true }
}

/**
 * 格式化会话列表输出
 */
function formatSessionList(
  sessions: Session[],
  currentCwd: string,
  currentSessionId?: string
): string {
  if (sessions.length === 0) {
    return "No sessions found."
  }

  const lines: string[] = ["Sessions:", ""]

  // 按目录分组
  const grouped = sessions.reduce((acc, session) => {
    const dir = session.cwd
    if (!acc[dir]) acc[dir] = []
    acc[dir].push(session)
    return acc
  }, {} as Record<string, Session[]>)

  Object.entries(grouped).forEach(([dir, dirSessions]) => {
    const isCurrentDir = dir === currentCwd
    lines.push(`${isCurrentDir ? "📁" : "  "} ${dir}${isCurrentDir ? " (current)" : ""}`)

    dirSessions.forEach((session) => {
      const isCurrentSession = session.id === currentSessionId
      const marker = isCurrentSession ? "▸" : " "
      const timeStr = formatRelativeTime(session.updatedAt)
      const msgCount = session.messageCount > 0 ? `${session.messageCount} msgs` : "empty"
      const archived = session.isArchived ? " [archived]" : ""

      lines.push(
        `  ${marker} ${session.id.slice(0, 20)}...  ${session.title.slice(0, 40)}  (${msgCount}, ${timeStr})${archived}`
      )
    })
    lines.push("")
  })

  return lines.join("\n")
}

const program = new Command()

program
  .name("lite-opencode")
  .description("Lightweight AI coding agent")
  .version("1.0.0")
  .option("-m, --model <model>", "Model ID")
  .option("--base-url <url>", "API base URL")
  .option("-d, --directory <dir>", "Working directory", process.cwd())
  .option("-s, --session <id>", "Session ID (creates new if not exists)")
  .option("-r, --resume [session-id]", "Resume session (latest or specific ID)")
  .option("-c, --continue", "Continue the last session for current directory")
  .option("--no-stream", "Disable streaming output")
  .option("--compression-threshold <number>", "Context compression threshold (0-1)", "0.92")
  .option("--dump-prompt [enabled]", "Dump prompts and responses to file for debugging")
  .option("--list-sessions", "List all sessions with metadata")
  // Team mode options
  .option("--team <mode>", `Team collaboration mode (${TEAM_MODES.join(", ")})`)
  .option("--team-objective <objective>", "Objective for team mode")
  .option("--team-config <path>", "Path to teams configuration file")
  .option("--team-profile <profile>", "Team configuration profile (default: 'default')")
  .option("--team-budget <tokens>", "Maximum token budget for team execution")
  .option("--team-timeout <ms>", "Timeout in milliseconds for team execution")
  .action(async (options) => {
    const dbPath = path.join(os.homedir(), ".lite-opencode", "history.db")

    // 初始化 SessionStore
    const sessionStore = new SessionStore(dbPath)

    // 列出会话
    if (options.listSessions) {
      const sessions = sessionStore.list({ includeArchived: true })
      console.log(formatSessionList(sessions, options.directory))
      process.exit(0)
    }

    // Handle team mode
    if (options.team) {
      // Validate team mode
      if (!TEAM_MODES.includes(options.team as TeamMode)) {
        console.error(`Error: Invalid team mode "${options.team}". Valid modes: ${TEAM_MODES.join(", ")}`)
        process.exit(1)
      }

      // Get objective from option or stdin
      let objective = options.teamObjective
      if (!objective) {
        // Try to read from stdin
        if (!process.stdin.isTTY) {
          const chunks: Buffer[] = []
          for await (const chunk of process.stdin) {
            chunks.push(chunk)
          }
          objective = Buffer.concat(chunks).toString("utf-8").trim()
        }
        if (!objective) {
          console.error("Error: No objective provided. Use --team-objective or pipe input via stdin.")
          process.exit(1)
        }
      }

      // Load settings for team mode
      const settings = loadSettings()
      applySettingsEnvToProcess(settings)

      const teamModel = getConfig(options.model, "ANTHROPIC_MODEL", settings, "claude-sonnet-4-20250514")
      const teamBaseURL = getConfig(options.baseUrl, "ANTHROPIC_BASE_URL", settings, "https://api.anthropic.com")
      const teamApiKey = getConfig(undefined, "ANTHROPIC_AUTH_TOKEN", settings, process.env.ANTHROPIC_API_KEY || "")

      const manager = new TeamManager({
        mode: options.team as TeamMode,
        objective,
        configPath: options.teamConfig,
        profile: options.teamProfile,
        budget: options.teamBudget ? parseInt(options.teamBudget, 10) : undefined,
        timeout: options.teamTimeout ? parseInt(options.teamTimeout, 10) : undefined,
        model: teamModel,
        baseURL: teamBaseURL,
        apiKey: teamApiKey,
      })

      try {
        const result = await manager.run()
        console.log(JSON.stringify(result, null, 2))
        process.exit(result.status === "completed" ? 0 : 1)
      } catch (error) {
        console.error("Team execution failed:", error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
    }

    // 解析会话参数
    const { sessionId, isNewSession, resumedSession } = resolveSession(
      options,
      sessionStore,
      options.directory
    )

    // 如果是新会话，创建会话记录
    if (isNewSession) {
      sessionStore.create({
        id: sessionId,
        cwd: options.directory,
        title: "New Session",
      })
    }

    // 加载 settings.json
    const settings = loadSettings()
    applySettingsEnvToProcess(settings)

    // Load provider configuration
    const { ProviderConfigService } = await import("./providers/service.js")
    const providerService = new ProviderConfigService()

    // Get LLM config from provider service (if configured)
    let llmConfigFromProvider: { model: string; baseURL: string; apiKey: string } | null = null
    try {
      if (providerService.hasProviders()) {
        llmConfigFromProvider = providerService.getLLMConfig()
      }
    } catch (error) {
      // Provider service not configured, fall back to settings
    }

    // 获取配置（优先级：CLI > ProviderService > settings > env > defaults）
    const baseURL =
      options.baseUrl ??
      llmConfigFromProvider?.baseURL ??
      getConfig(undefined, "ANTHROPIC_BASE_URL", settings, "https://api.anthropic.com")

    const model =
      options.model ??
      llmConfigFromProvider?.model ??
      getConfig(undefined, "ANTHROPIC_MODEL", settings, "claude-sonnet-4-20250514")

    const apiKey =
      llmConfigFromProvider?.apiKey ??
      getConfig(undefined, "ANTHROPIC_AUTH_TOKEN", settings, process.env.ANTHROPIC_API_KEY || "")

    const timeoutStr = getConfig(undefined, "API_TIMEOUT_MS", settings, "120000")
    const timeout = parseInt(timeoutStr, 10)

    const dumpPrompt = parseDumpOption(options.dumpPrompt)

    const agent = new Agent(sessionId, {
      cwd: options.directory,
      dbPath,
      llm: {
        model,
        baseURL,
        apiKey,
        timeout,
      },
      enableStream: options.stream !== false,
      compressionThreshold: parseFloat(options.compressionThreshold),
      mcp: settings.mcp,
      dumpPrompt,
      policy: settings.policy?.risk ? {
        riskConfig: settings.policy.risk,
      } : undefined,
    })

    // MCP 改为懒加载，不在启动时初始化
    // await agent.initializeMCP()

    // 加载 Skills
    await agent.loadSkills()

    // 渲染 Ink 应用
    // 注意: 不使用 incrementalRendering，因为与 Spinner 动画不兼容
    // Static 组件已经处理历史消息的滚动
    render(
      <App
        agent={agent}
        model={model}
        baseURL={baseURL}
        sessionId={sessionId}
        workingDir={options.directory}
        dbPath={dbPath}
        isResumed={!isNewSession}
        resumedSessionTitle={resumedSession?.title}
      />
    )
  })

// Provider configuration commands
const configCommand = program
  .command("config")
  .description("Configure LLM providers")

// Default action: run wizard
configCommand
  .action(async () => {
    const { runConfigWizard } = await import("./cli/config-wizard.js")
    await runConfigWizard()
  })

configCommand
  .command("list")
  .description("List all configured providers")
  .action(async () => {
    const { ProviderConfigService } = await import("./providers/service.js")
    const service = new ProviderConfigService()
    const providers = service.listProviders()
    const builtinProviders = service.getBuiltinProviders()

    if (providers.length === 0 && builtinProviders.every(p => !p.configured)) {
      console.log("No providers configured. Run 'lite-opencode config' to set up.")
      return
    }

    console.log("\n# Configured Providers\n")

    for (const p of builtinProviders) {
      const marker = p.configured ? "✓" : "○"
      const defaultMarker = p.config?.isDefault ? " (default)" : ""
      console.log(`  ${marker} ${p.info.name}${defaultMarker}`)
      if (p.configured && p.config) {
        console.log(`      Model: ${p.config.defaultModel}`)
        console.log(`      Base URL: ${p.config.baseUrl}`)
      }
    }

    console.log("\nRun 'lite-opencode config' to add or modify providers.")
  })

configCommand
  .command("switch <provider>")
  .description("Switch default provider")
  .action(async (providerId: string) => {
    const { ProviderConfigService } = await import("./providers/service.js")
    const service = new ProviderConfigService()

    try {
      service.setDefault(providerId)
      service.save()
      console.log(`✓ Switched default provider to '${providerId}'`)
    } catch (error) {
      console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  })

configCommand
  .command("show [provider]")
  .description("Show provider configuration details")
  .action(async (providerId?: string) => {
    const { ProviderConfigService } = await import("./providers/service.js")
    const service = new ProviderConfigService()

    try {
      const provider = providerId
        ? service.getProvider(providerId)
        : service.getDefaultProvider()

      if (!provider) {
        console.log(`Provider '${providerId}' not found.`)
        return
      }

      console.log(`\n# ${provider.name}\n`)
      console.log(`  ID: ${provider.id}`)
      console.log(`  Model: ${provider.defaultModel}`)
      console.log(`  Base URL: ${provider.baseUrl}`)
      console.log(`  Default: ${provider.isDefault ? "Yes" : "No"}`)
      console.log()
    } catch (error) {
      console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  })

// MCP management commands
const mcpCommand = program
  .command("mcp")
  .description("MCP server management")

mcpCommand
  .command("status [server]")
  .description("Show MCP server status and statistics")
  .action(async (server?: string) => {
    const { mcpStatusTool } = await import("./tools/mcp-status.js")
    const result = await mcpStatusTool.execute({ server }, { cwd: process.cwd(), messages: [] })
    console.log(result)
  })

mcpCommand
  .command("diagnose [server]")
  .description("Diagnose MCP configuration and connectivity issues")
  .action(async (server?: string) => {
    const { mcpDiagnoseTool } = await import("./tools/mcp-status.js")
    const result = await mcpDiagnoseTool.execute({ server }, { cwd: process.cwd(), messages: [] })
    console.log(result)
  })

program.parse()
