#!/usr/bin/env node
import { Command } from "commander"
import { Agent } from "./agent.js"
import { MessageStore } from "./store.js"
import * as readline from "readline"
import * as path from "path"
import * as os from "os"

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
  .option("--max-tokens <number>", "Max context tokens before compression", "60000")
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
      maxContextTokens: parseInt(options.maxTokens, 10),
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
    console.log(`Max context tokens: ${options.maxTokens}`)
    console.log("\nType your message and press Enter. Type /exit to quit.\n")

    // REPL 循环
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    const prompt = () => {
      rl.question("\n> ", async (input) => {
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

        if (trimmed === "/help") {
          console.log(`
Commands:
  /exit, /quit  - Exit the program
  /clear        - Clear current session
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
