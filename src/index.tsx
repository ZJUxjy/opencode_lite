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
import type { TeamConfig, TeamMode, LeaderWorkersStrategy } from "./teams/index.js"

interface SettingsConfig {
  env?: Record<string, string>
  timeout?: number
  mcp?: MCPGlobalConfig
  teams?: Partial<TeamConfig>
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
  .option("--team <mode>", "Team mode (worker-reviewer|planner-executor-reviewer|leader-workers|hotfix-guardrail|council)")
  .option("--team-strategy <strategy>", "Team strategy (collaborative|competitive)")
  .option("--non-interactive", "Run once and exit (no TUI)")
  .option("--output-format <format>", "Output format for non-interactive mode (text|json)", "text")
  .option("--prompt <text>", "Input prompt for non-interactive mode")
  .option("--team-ralph", "Run Ralph loop task queue in non-interactive mode")
  .option("--task-file <path>", "Task queue file path for Ralph loop", "TASKS.md")
  .option("--progress-file <path>", "Progress log file for Ralph loop", "PROGRESS.md")
  .option("--max-iterations <number>", "Max iterations for Ralph loop", "50")
  .option("--cooldown-ms <number>", "Cooldown between Ralph tasks (ms)", "0")
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
      teams: settings.teams,
      mcp: settings.mcp,
    })

    const teamMode = options.team as TeamMode | undefined
    if (teamMode) {
      const strategy = (options.teamStrategy === "competitive" ? "competitive" : "collaborative") as LeaderWorkersStrategy
      agent.setTeamMode(teamMode, strategy)
      agent.setTeamEnabled(true)
    }

    // 初始化 MCP
    await agent.initializeMCP()

    if (options.nonInteractive) {
      const asJson = options.outputFormat === "json"

      if (options.teamRalph) {
        const summary = await agent.runTeamRalphLoop({
          taskFilePath: path.resolve(options.directory, options.taskFile),
          progressFilePath: path.resolve(options.directory, options.progressFile),
          maxIterations: Math.max(1, parseInt(options.maxIterations, 10) || 50),
          cooldownMs: Math.max(0, parseInt(options.cooldownMs, 10) || 0),
        })

        if (asJson) {
          console.log(JSON.stringify({ mode: teamMode || "worker-reviewer", type: "ralph-loop", summary }, null, 2))
        } else {
          console.log(`Ralph loop finished: processed=${summary.processed}, completed=${summary.completed.length}, failed=${summary.failed.length}`)
        }
        process.exit(0)
      }

      const prompt = String(options.prompt || "").trim()
      if (!prompt) {
        console.error("Error: --prompt is required in --non-interactive mode")
        process.exit(1)
      }

      if (teamMode) {
        const result = await agent.runTeamTask(prompt)
        if (asJson) {
          console.log(JSON.stringify({ type: "team", mode: teamMode, result }, null, 2))
        } else {
          console.log(result.output)
        }
      } else {
        const output = await agent.run(prompt)
        if (asJson) {
          console.log(JSON.stringify({ type: "single-agent", output }, null, 2))
        } else {
          console.log(output)
        }
      }

      process.exit(0)
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
      />
    )
  })

program.parse()
