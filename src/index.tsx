#!/usr/bin/env node
import React from "react"
import { render } from "ink"
import { Command } from "commander"
import { Agent } from "./agent.js"
import { MessageStore } from "./store.js"
import { App } from "./App.js"
import * as path from "path"
import * as os from "os"
import * as fs from "fs"

// 从 settings.json 加载配置
interface SettingsConfig {
  env?: Record<string, string>
  timeout?: number
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

const program = new Command()

program
  .name("lite-opencode")
  .description("Lightweight AI coding agent")
  .version("1.0.0")
  .option("-m, --model <model>", "Model ID")
  .option("--base-url <url>", "API base URL")
  .option("-d, --directory <dir>", "Working directory", process.cwd())
  .option("-s, --session <id>", "Session ID", Date.now().toString())
  .option("--no-stream", "Disable streaming output")
  .option("--compression-threshold <number>", "Context compression threshold (0-1)", "0.92")
  .option("--list-sessions", "List all sessions")
  .action(async (options) => {
    const dbPath = path.join(os.homedir(), ".lite-opencode", "history.db")

    // 列出会话
    if (options.listSessions) {
      const store = new MessageStore(dbPath)
      const sessions = store.listSessions()
      console.log("Sessions:")
      sessions.forEach((s) => console.log(`  - ${s}`))
      process.exit(0)
    }

    // 加载 settings.json
    const settings = loadSettings()

    // 获取配置（优先级：CLI > settings.json > 环境变量 > 默认值）
    const baseURL = getConfig(options.baseUrl, "ANTHROPIC_BASE_URL", settings, "https://api.anthropic.com")
    const model = getConfig(options.model, "ANTHROPIC_MODEL", settings, "claude-sonnet-4-20250514")
    const apiKey = getConfig(undefined, "ANTHROPIC_AUTH_TOKEN", settings, process.env.ANTHROPIC_API_KEY || "")
    const timeoutStr = getConfig(undefined, "API_TIMEOUT_MS", settings, "120000")
    const timeout = parseInt(timeoutStr, 10)

    const agent = new Agent(options.session, {
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
    })

    // 渲染 Ink 应用
    // 注意: 不使用 incrementalRendering，因为与 Spinner 动画不兼容
    // Static 组件已经处理历史消息的滚动
    render(
      <App
        agent={agent}
        model={model}
        baseURL={baseURL}
        sessionId={options.session}
        workingDir={options.directory}
      />
    )
  })

program.parse()
