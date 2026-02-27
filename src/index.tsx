#!/usr/bin/env node
import React from "react"
import { render } from "ink"
import { Command } from "commander"
import { Agent } from "./agent.js"
import { MessageStore } from "./store.js"
import { App } from "./App.js"
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

    const baseURL = options.baseUrl || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"
    const model = options.model || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514"

    // 渲染 Ink 应用
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
