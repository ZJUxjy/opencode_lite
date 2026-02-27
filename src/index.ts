#!/usr/bin/env node
import { Command } from "commander"
import { Agent } from "./agent.js"
import { MessageStore } from "./store.js"
import * as readline from "readline"
import * as path from "path"
import * as os from "os"

// ANSI escape codes
const ANSI = {
  clearLine: "\x1b[2K",
  moveUp: (n: number) => `\x1b[${n}A`,
  moveToStart: "\x1b[0G",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
}

const program = new Command()

program
  .name("lite-opencode")
  .description("Lightweight AI coding agent")
  .version("1.0.0")
  .option("-m, --model <model>", "Model ID (overrides ANTHROPIC_MODEL)")
  .option("--base-url <url>", "API base URL (overrides ANTHROPIC_BASE_URL)")
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

    const agent = new Agent(options.session, {
      cwd: options.directory,
      dbPath,
      llm: {
        model: options.model,
        baseURL: options.baseUrl,
      },
      enableStream: options.stream !== false,
      compressionThreshold: parseFloat(options.compressionThreshold),
    })

    // 显示当前配置
    const baseURL = options.baseUrl || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"
    const model = options.model || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514"

    console.log("Lite OpenCode v1.0.0")
    console.log(`Base URL: ${baseURL}`)
    console.log(`Model: ${model}`)
    console.log(`Session: ${options.session}`)
    console.log(`Working directory: ${options.directory}`)
    console.log(`Streaming: ${options.stream !== false ? "enabled" : "disabled"}`)
    console.log(`Compression threshold: ${Math.round(parseFloat(options.compressionThreshold) * 100)}%`)
    console.log("\nType your message and press Enter. Type /exit to quit.\n")

    // 格式化上下文使用情况
    const formatContextUsage = (usage: { used: number; limit: number; percentage: number }): string => {
      const percent = Math.round(usage.percentage * 100)
      let color = ANSI.green
      if (percent >= 80) color = ANSI.yellow
      if (percent >= 92) color = ANSI.red

      const usedK = (usage.used / 1000).toFixed(1)
      const limitK = (usage.limit / 1000).toFixed(0)

      return `${color}[${percent}%]${ANSI.reset} ${ANSI.dim}${usedK}K/${limitK}K${ANSI.reset}`
    }

    // REPL 循环
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    // 自定义 prompt 函数，带状态栏
    const promptWithStatus = (callback: (input: string) => void) => {
      const usage = agent.getContextUsage()
      const statusText = formatContextUsage(usage)

      // 显示带状态栏的提示符
      rl.question(`[${statusText}] > `, callback)
    }

    const prompt = () => {
      promptWithStatus(async (input) => {
        const trimmed = input.trim()

        // 命令处理
        if (trimmed === "/exit" || trimmed === "/quit") {
          console.log("Goodbye!")
          rl.close()
          return
        }

        if (trimmed === "/clear") {
          agent.clearSession()
          console.log("Session cleared.")
          prompt()
          return
        }

        if (trimmed === "/context") {
          const usage = agent.getContextUsage()
          console.log(`Context Usage: ${usage.used}/${usage.limit} tokens (${Math.round(usage.percentage * 100)}%)`)
          prompt()
          return
        }

        if (trimmed === "/help") {
          console.log(`
Commands:
  /exit, /quit  - Exit the program
  /clear        - Clear current session
  /context      - Show detailed context usage
  /help         - Show this help
          `)
          prompt()
          return
        }

        if (!trimmed) {
          prompt()
          return
        }

        // 执行 Agent
        try {
          await agent.run(trimmed)
        } catch (error: any) {
          console.error(`Error: ${error.message}`)
        }

        prompt()
      })
    }

    prompt()
  })

program.parse()
