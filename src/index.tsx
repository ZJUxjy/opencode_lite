#!/usr/bin/env node
import React from "react"
import { render } from "ink"
import { Command } from "commander"
import { Agent } from "./agent.js"
import { MessageStore } from "./store.js"
import { SessionStore, formatRelativeTime, type Session } from "./session/index.js"
import { App } from "./App.js"
import * as path from "path"
import * as os from "os"
import * as fs from "fs"

// 从 settings.json 加载配置
import type { MCPGlobalConfig } from "./mcp/config.js"
import type { TeamManagerOptions } from "./teams/team-manager.js"
import type { AgentRole, TeamMode, LeaderWorkersStrategy, TeamConfig } from "./teams/types.js"

/**
 * Settings.json 中的 Team 配置
 */
interface TeamSettingsConfig {
  /** 默认配置 */
  default?: Partial<TeamConfig>
  /** 具名配置 */
  [name: string]: Partial<TeamConfig> | undefined
}

interface SettingsConfig {
  env?: Record<string, string>
  timeout?: number
  mcp?: MCPGlobalConfig
  /** Team 配置 */
  teams?: TeamSettingsConfig
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
  .option("--list-sessions", "List all sessions with metadata")
  .option("--team <mode>", "Agent team mode (worker-reviewer, planner-executor-reviewer, leader-workers, hotfix-guardrail, council)")
  .option("--team-strategy <strategy>", "Leader-workers strategy (collaborative, competitive)", "collaborative")
  .option("--team-workers <n>", "Number of workers for leader-workers mode", "2")
  .option("--objective <text>", "Team objective/task description")
  .option("--scope <files>", "File scope for team (comma-separated patterns)")
  .option("--iterations <n>", "Max iterations for team mode", "3")
  .option("--team-timeout <ms>", "Timeout for team execution in ms", "300000")
  .option("--max-tokens <n>", "Max tokens budget for team", "200000")
  .option("--non-interactive", "Run in non-interactive mode (CI/CD)")
  .option("--output-format <format>", "Output format for non-interactive mode (text, json)", "text")
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

    // 获取配置（优先级：CLI > settings.json > 环境变量 > 默认值）
    const baseURL = getConfig(options.baseUrl, "ANTHROPIC_BASE_URL", settings, "https://api.anthropic.com")
    const model = getConfig(options.model, "ANTHROPIC_MODEL", settings, "claude-sonnet-4-20250514")
    const apiKey = getConfig(undefined, "ANTHROPIC_AUTH_TOKEN", settings, process.env.ANTHROPIC_API_KEY || "")
    const timeoutStr = getConfig(undefined, "API_TIMEOUT_MS", settings, "120000")
    const timeout = parseInt(timeoutStr, 10)

    // Parse team configuration if --team is specified
    const teamConfig = options.team
      ? buildTeamConfig(options, settings.teams, model)
      : undefined

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
      team: teamConfig,
    })

    // 初始化 MCP
    await agent.initializeMCP()

    // 非交互模式：直接运行并输出到 stdout
    if (options.nonInteractive) {
      await runNonInteractive(agent, options, teamConfig)
      return
    }

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
        teamConfig={teamConfig}
      />
    )
  })

/**
 * 构建 Team 配置
 * 优先级：CLI 参数 > settings.json 中的具名配置 > settings.json 中的 default 配置 > 内置默认值
 */
function buildTeamConfig(
  options: {
    team: string
    teamStrategy?: string
    teamWorkers?: string
    iterations?: string
    teamTimeout?: string
    maxTokens?: string
    objective?: string
    scope?: string
  },
  teamsConfig: TeamSettingsConfig | undefined,
  defaultModel: string
): TeamManagerOptions {
  const mode = options.team as TeamMode

  // 从 settings.json 获取配置
  const namedConfig = teamsConfig?.[mode] ?? {}
  const defaultTeamConfig = teamsConfig?.default ?? {}

  // 合并配置：具名配置覆盖默认配置
  const settingsTeamConfig = { ...defaultTeamConfig, ...namedConfig }

  // 构建 agents
  let agents: { role: AgentRole; model: string; skills?: string[]; systemPrompt?: string }[] =
    settingsTeamConfig.agents as any ?? []

  // 如果 settings.json 中没有定义 agents，使用默认值
  if (agents.length === 0) {
    switch (mode) {
      case "worker-reviewer":
        agents = [
          { role: "worker" as AgentRole, model: defaultModel },
          { role: "reviewer" as AgentRole, model: defaultModel },
        ]
        break
      case "planner-executor-reviewer":
        agents = [
          { role: "planner" as AgentRole, model: defaultModel },
          { role: "executor" as AgentRole, model: defaultModel },
          { role: "reviewer" as AgentRole, model: defaultModel },
        ]
        break
      case "leader-workers": {
        const workerCount = parseInt(options.teamWorkers ?? "2", 10)
        agents = [
          { role: "leader" as AgentRole, model: defaultModel },
          ...Array.from({ length: workerCount }, () => ({ role: "worker" as AgentRole, model: defaultModel })),
        ]
        break
      }
      case "hotfix-guardrail":
        agents = [
          { role: "fixer" as AgentRole, model: defaultModel },
          { role: "safety-reviewer" as AgentRole, model: defaultModel },
        ]
        break
      case "council":
        agents = [
          { role: "speaker" as AgentRole, model: defaultModel },
          { role: "member" as AgentRole, model: defaultModel },
          { role: "member" as AgentRole, model: defaultModel },
        ]
        break
    }
  }

  // 构建最终配置
  return {
    config: {
      mode,
      strategy: mode === "leader-workers"
        ? (options.teamStrategy as LeaderWorkersStrategy) ?? (settingsTeamConfig.strategy as LeaderWorkersStrategy) ?? "collaborative"
        : undefined,
      agents,
      maxIterations: parseInt(options.iterations ?? "3", 10) ?? (settingsTeamConfig.maxIterations as number) ?? 3,
      timeoutMs: parseInt(options.teamTimeout ?? "300000", 10) ?? (settingsTeamConfig.timeoutMs as number) ?? 300000,
      budget: {
        maxTokens: parseInt(options.maxTokens ?? "200000", 10) ?? (settingsTeamConfig.budget?.maxTokens as number) ?? 200000,
        maxCostUsd: settingsTeamConfig.budget?.maxCostUsd,
        maxParallelAgents: settingsTeamConfig.budget?.maxParallelAgents,
      },
      qualityGate: settingsTeamConfig.qualityGate ?? {
        testsMustPass: true,
        noP0Issues: true,
      },
      circuitBreaker: settingsTeamConfig.circuitBreaker ?? {
        maxConsecutiveFailures: 3,
        maxNoProgressRounds: 2,
        cooldownMs: 60000,
      },
      conflictResolution: (settingsTeamConfig.conflictResolution as "auto" | "manual") ?? "auto",
    },
    objective: options.objective,
    fileScope: options.scope?.split(",") ?? [],
  }
}

/**
 * Run agent in non-interactive mode for CI/CD
 */
async function runNonInteractive(
  agent: Agent,
  options: {
    objective?: string
    outputFormat: string
    directory: string
    team?: string
  },
  teamConfig?: TeamManagerOptions
): Promise<void> {
  const outputFormat = options.outputFormat || "text"

  // Get user input from objective or stdin
  let userInput = options.objective || ""

  if (!userInput && !options.team) {
    // Read from stdin if no objective provided and not in team mode
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) {
      chunks.push(chunk)
    }
    userInput = Buffer.concat(chunks).toString("utf-8").trim()
  }

  if (!userInput && !options.team) {
    console.error("Error: No input provided. Use --objective or pipe input via stdin.")
    process.exit(1)
  }

  const startTime = Date.now()
  const results: {
    success: boolean
    output: string
    duration: number
    toolCalls?: number
    tokensUsed?: { input: number; output: number }
    teamResult?: unknown
  } = {
    success: false,
    output: "",
    duration: 0,
  }

  try {
    if (outputFormat === "text") {
      console.log(`🔧 Working directory: ${options.directory}`)
      if (userInput) {
        console.log(`📝 Task: ${userInput.slice(0, 100)}${userInput.length > 100 ? "..." : ""}`)
      }
      if (options.team) {
        console.log(`👥 Team mode: ${options.team}`)
      }
      console.log("⏳ Processing...\n")
    }

    // Set up event handlers for progress tracking
    let toolCallCount = 0
    agent.setEvents({
      onToolCall: () => {
        toolCallCount++
      },
      onTextDelta: outputFormat === "text" ? (text) => process.stdout.write(text) : undefined,
    })

    // Run agent or team
    if (teamConfig && options.team) {
      // Team mode
      const teamManager = agent.getTeamManager()
      if (teamManager) {
        results.teamResult = await teamManager.run()
        results.success = true
      }
    } else if (userInput) {
      // Single agent mode
      results.output = await agent.run(userInput)
      results.success = true
    }

    const stats = agent.getSessionStats()
    results.duration = Date.now() - startTime
    results.toolCalls = toolCallCount
    results.tokensUsed = {
      input: stats.contextUsage.used,
      output: stats.contextUsage.used,
    }

    if (outputFormat === "text") {
      console.log("\n\n✅ Completed successfully")
      console.log(`⏱️  Duration: ${(results.duration / 1000).toFixed(2)}s`)
      console.log(`🔧 Tool calls: ${results.toolCalls}`)
      console.log(`📊 Tokens: ${results.tokensUsed?.input || 0} in / ${results.tokensUsed?.output || 0} out`)
    } else if (outputFormat === "json") {
      console.log(JSON.stringify({
        success: results.success,
        output: results.output,
        teamResult: results.teamResult,
        duration: results.duration,
        toolCalls: results.toolCalls,
        tokensUsed: results.tokensUsed,
      }, null, 2))
    }

    process.exit(0)
  } catch (error) {
    results.duration = Date.now() - startTime
    results.success = false
    results.output = error instanceof Error ? error.message : String(error)

    if (outputFormat === "text") {
      console.error("\n\n❌ Failed:", results.output)
    } else if (outputFormat === "json") {
      console.log(JSON.stringify({
        success: false,
        error: results.output,
        duration: results.duration,
      }, null, 2))
    }

    process.exit(1)
  }
}

program.parse()
