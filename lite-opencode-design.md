# Lite OpenCode 设计文档

本文档描述如何实现一个轻量版的 OpenCode，保留核心功能的同时大幅简化架构。

## 设计目标

- **代码量**：~2000 行 TypeScript（超出原计划，但功能更丰富）
- **开发时间**：MVP 1-2 天，v1.1.0 增强功能 1-2 天
- **核心功能**：LLM + Tool 循环、消息持久化、基础工具集
- **v1.1.0 新增**：三层循环检测、Reasoning 支持、策略引擎

## 核心架构

```
┌─────────────────────────────────────────────────────────┐
│                      CLI Entry                          │
│                   (commander/yargs)                     │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    Agent Loop                           │
│  while (true) { llm.chat() → parse tools → execute }   │
└─────────────────────────┬───────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│  LLM Client   │ │ Tool Registry │ │ Message Store │
│  (AI SDK)     │ │ (Map<name>)   │ │ (SQLite)      │
└───────────────┘ └───────────────┘ └───────────────┘
```

## 项目结构

```
lite-opencode/
├── src/
│   ├── index.tsx          # CLI 入口 (Ink TUI)
│   ├── App.tsx            # TUI 组件
│   ├── agent.ts           # 核心 Agent 循环
│   ├── llm.ts             # LLM 客户端封装
│   ├── loopDetection.ts   # 三层循环检测服务 (v1.1.0)
│   ├── policy.ts          # 策略引擎 (v1.1.0)
│   ├── store.ts           # 消息持久化
│   ├── types.ts           # 类型定义
│   └── tools/
│       ├── index.ts       # Tool 注册中心
│       ├── bash.ts        # Shell 命令
│       ├── read.ts        # 读文件
│       ├── write.ts       # 写文件
│       ├── edit.ts        # 编辑文件
│       ├── grep.ts        # 搜索内容
│       └── glob.ts        # 搜索文件
├── docs/
│   ├── agent-loop-research.md  # Agent 循环调研
│   └── hook-system-design.md   # Hook 系统设计
├── package.json
├── tsconfig.json
└── CLAUDE.md              # Claude Code 指引
```

## 核心实现

### 1. 类型定义 (`src/types.ts`)

```typescript
import { z } from "zod"

// Tool 定义
export interface Tool<T extends z.ZodType = z.ZodType> {
  name: string
  description: string
  parameters: T
  execute: (params: z.infer<T>, ctx: Context) => Promise<string>
}

// 上下文
export interface Context {
  cwd: string
  messages: Message[]
}

// 消息
export interface Message {
  role: "user" | "assistant"
  content: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  toolCallId: string
  content: string
  isError?: boolean
}

// Agent 配置
export interface AgentConfig {
  provider: "openai" | "anthropic"
  model: string
  cwd: string
  dbPath: string
}
```

### 2. LLM 客户端 (`src/llm.ts`)

```typescript
import { generateText, CoreMessage, Tool } from "ai"
import { openai } from "@ai-sdk/openai"
import { anthropic } from "@ai-sdk/anthropic"
import type { Message, ToolCall } from "./types"

export class LLMClient {
  private model

  constructor(provider: "openai" | "anthropic", modelId: string) {
    if (provider === "openai") {
      this.model = openai(modelId)
    } else {
      this.model = anthropic(modelId)
    }
  }

  async chat(
    messages: Message[],
    tools: Array<{ name: string; description: string; parameters: any }>
  ) {
    // 转换消息格式
    const coreMessages: CoreMessage[] = messages.map((m) => {
      if (m.toolResults?.length) {
        return {
          role: "tool",
          content: m.toolResults.map((r) => ({
            type: "tool-result",
            toolCallId: r.toolCallId,
            toolName: "",
            result: r.content,
            isError: r.isError,
          })),
        }
      }
      return {
        role: m.role as "user" | "assistant",
        content: m.content || "",
      }
    })

    // 转换工具定义
    const toolDefs: Record<string, Tool> = {}
    for (const t of tools) {
      toolDefs[t.name] = {
        description: t.description,
        parameters: t.parameters,
      }
    }

    const result = await generateText({
      model: this.model,
      messages: coreMessages,
      tools: toolDefs,
      maxSteps: 10, // 允许多轮工具调用
    })

    return {
      content: result.text,
      toolCalls: result.toolCalls?.map((tc) => ({
        id: tc.toolCallId,
        name: tc.toolName,
        arguments: tc.args as Record<string, unknown>,
      })),
      finishReason: result.finishReason,
    }
  }
}
```

### 3. Tool 注册中心 (`src/tools/index.ts`)

```typescript
import type { Tool } from "../types"
import { bashTool } from "./bash"
import { readTool } from "./read"
import { writeTool } from "./write"
import { editTool } from "./edit"
import { grepTool } from "./grep"
import { globTool } from "./glob"

export class ToolRegistry {
  private tools = new Map<string, Tool>()

  constructor() {
    // 注册内置工具
    ;[bashTool, readTool, writeTool, editTool, grepTool, globTool].forEach(
      (tool) => this.register(tool)
    )
  }

  register(tool: Tool) {
    this.tools.set(tool.name, tool)
  }

  get(name: string) {
    return this.tools.get(name)
  }

  getAll() {
    return Array.from(this.tools.values())
  }

  getDefinitions() {
    return this.getAll().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }))
  }
}

// 导出所有工具
export * from "./bash"
export * from "./read"
export * from "./write"
export * from "./edit"
export * from "./grep"
export * from "./glob"
```

### 4. Tool 实现

#### bash.ts

```typescript
import { z } from "zod"
import { exec } from "child_process"
import { promisify } from "util"
import type { Tool } from "../types"

const execAsync = promisify(exec)

export const bashTool: Tool = {
  name: "bash",
  description: `Execute a shell command.
- Use for system operations, running scripts, git commands, etc.
- Commands run in the project directory.
- Avoid interactive commands that require user input.`,

  parameters: z.object({
    command: z.string().describe("The shell command to execute"),
    timeout: z.number().optional().default(30000).describe("Timeout in ms"),
  }),

  async execute({ command, timeout }, ctx) {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: ctx.cwd,
        timeout,
        maxBuffer: 10 * 1024 * 1024,
      })

      let result = ""
      if (stdout) result += `STDOUT:\n${stdout}`
      if (stderr) result += `${result ? "\n" : ""}STDERR:\n${stderr}`

      return result || "Command completed with no output"
    } catch (error: any) {
      if (error.killed) {
        return `Error: Command timed out after ${timeout}ms`
      }
      return `Error: ${error.message}\n${error.stderr || ""}`
    }
  },
}
```

#### read.ts

```typescript
import { z } from "zod"
import { readFile } from "fs/promises"
import { existsSync } from "fs"
import type { Tool } from "../types"

export const readTool: Tool = {
  name: "read",
  description: `Read a file from the filesystem.
- Returns the file content with line numbers.
- Can read any text file including code, config, markdown.
- For large files, use offset and limit parameters.`,

  parameters: z.object({
    path: z.string().describe("Absolute path to the file"),
    offset: z.number().optional().describe("Starting line number (1-based)"),
    limit: z.number().optional().describe("Number of lines to read"),
  }),

  async execute({ path, offset = 1, limit }, ctx) {
    const fullPath = path.startsWith("/") ? path : `${ctx.cwd}/${path}`

    if (!existsSync(fullPath)) {
      return `Error: File not found: ${fullPath}`
    }

    try {
      const content = await readFile(fullPath, "utf-8")
      const lines = content.split("\n")

      const startLine = Math.max(1, offset) - 1
      const endLine = limit ? startLine + limit : lines.length
      const selectedLines = lines.slice(startLine, endLine)

      // 添加行号
      const numbered = selectedLines
        .map((line, i) => `${String(startLine + i + 1).padStart(6)}\t${line}`)
        .join("\n")

      return numbered
    } catch (error: any) {
      return `Error: ${error.message}`
    }
  },
}
```

#### write.ts

```typescript
import { z } from "zod"
import { writeFile, mkdir } from "fs/promises"
import { dirname } from "path"
import type { Tool } from "../types"

export const writeTool: Tool = {
  name: "write",
  description: `Write content to a file.
- Creates the file if it doesn't exist.
- Overwrites existing content.
- Creates parent directories if needed.`,

  parameters: z.object({
    path: z.string().describe("Path to the file"),
    content: z.string().describe("Content to write"),
  }),

  async execute({ path, content }, ctx) {
    const fullPath = path.startsWith("/") ? path : `${ctx.cwd}/${path}`

    try {
      // 确保目录存在
      await mkdir(dirname(fullPath), { recursive: true })
      await writeFile(fullPath, content, "utf-8")
      return `Successfully wrote ${content.length} characters to ${fullPath}`
    } catch (error: any) {
      return `Error: ${error.message}`
    }
  },
}
```

#### edit.ts

```typescript
import { z } from "zod"
import { readFile, writeFile } from "fs/promises"
import type { Tool } from "../types"

export const editTool: Tool = {
  name: "edit",
  description: `Edit a file by replacing specific text.
- Performs exact string replacement.
- The old_string must match exactly (including whitespace).
- Returns error if old_string is not found or appears multiple times.`,

  parameters: z.object({
    path: z.string().describe("Path to the file"),
    old_string: z.string().describe("Text to replace (must match exactly)"),
    new_string: z.string().describe("Replacement text"),
  }),

  async execute({ path, old_string, new_string }, ctx) {
    const fullPath = path.startsWith("/") ? path : `${ctx.cwd}/${path}`

    try {
      const content = await readFile(fullPath, "utf-8")

      // 检查唯一性
      const occurrences = content.split(old_string).length - 1
      if (occurrences === 0) {
        return `Error: old_string not found in file`
      }
      if (occurrences > 1) {
        return `Error: old_string appears ${occurrences} times, must be unique`
      }

      const newContent = content.replace(old_string, new_string)
      await writeFile(fullPath, newContent, "utf-8")

      return `Successfully edited ${fullPath}`
    } catch (error: any) {
      return `Error: ${error.message}`
    }
  },
}
```

#### grep.ts

```typescript
import { z } from "zod"
import { exec } from "child_process"
import { promisify } from "util"
import type { Tool } from "../types"

const execAsync = promisify(exec)

export const grepTool: Tool = {
  name: "grep",
  description: `Search for patterns in files using ripgrep.
- Supports regex patterns.
- Use glob to filter file types.
- Returns matching lines with file paths and line numbers.`,

  parameters: z.object({
    pattern: z.string().describe("Regex pattern to search for"),
    path: z.string().optional().describe("Directory or file to search"),
    glob: z.string().optional().describe("File pattern (e.g., *.ts, **/*.js)"),
    "ignore-case": z.boolean().optional().describe("Case insensitive search"),
  }),

  async execute({ pattern, path, glob, "ignore-case": ignoreCase }, ctx) {
    const searchPath = path || ctx.cwd
    const args = ["rg", "--line-number", "--with-filename"]

    if (ignoreCase) args.push("-i")
    if (glob) args.push("-g", glob)

    args.push(pattern, searchPath)

    try {
      const { stdout } = await execAsync(args.join(" "), {
        cwd: ctx.cwd,
        maxBuffer: 10 * 1024 * 1024,
      })
      return stdout || "No matches found"
    } catch (error: any) {
      // ripgrep returns exit code 1 when no matches
      if (error.code === 1) {
        return "No matches found"
      }
      return `Error: ${error.message}`
    }
  },
}
```

#### glob.ts

```typescript
import { z } from "zod"
import { glob as globSync } from "glob"
import type { Tool } from "../types"

export const globTool: Tool = {
  name: "glob",
  description: `Find files matching a pattern.
- Supports glob patterns like **/*.ts, src/**/*.js
- Returns file paths relative to the project directory.
- Useful for discovering files in the codebase.`,

  parameters: z.object({
    pattern: z.string().describe("Glob pattern (e.g., **/*.ts)"),
    path: z.string().optional().describe("Directory to search"),
  }),

  async execute({ pattern, path }, ctx) {
    const searchPath = path || ctx.cwd

    try {
      const files = await globSync(pattern, {
        cwd: searchPath,
        nodir: true,
        ignore: ["node_modules/**", ".git/**", "dist/**"],
      })

      if (files.length === 0) {
        return "No files found matching pattern"
      }

      return files.join("\n")
    } catch (error: any) {
      return `Error: ${error.message}`
    }
  },
}
```

### 5. 消息存储 (`src/store.ts`)

```typescript
import Database from "better-sqlite3"
import type { Message, ToolCall, ToolResult } from "./types"

interface DBMessage {
  id: number
  session_id: string
  role: string
  content: string | null
  tool_calls: string | null
  tool_results: string | null
  created_at: number
}

export class MessageStore {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.init()
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT,
        tool_calls TEXT,
        tool_results TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_session ON messages(session_id);
    `)
  }

  add(sessionId: string, message: Message) {
    const stmt = this.db.prepare(`
      INSERT INTO messages (session_id, role, content, tool_calls, tool_results)
      VALUES (?, ?, ?, ?, ?)
    `)

    stmt.run(
      sessionId,
      message.role,
      message.content || null,
      message.toolCalls ? JSON.stringify(message.toolCalls) : null,
      message.toolResults ? JSON.stringify(message.toolResults) : null
    )
  }

  get(sessionId: string): Message[] {
    const rows = this.db
      .prepare<[], DBMessage>(
        "SELECT * FROM messages WHERE session_id = ? ORDER BY id"
      )
      .all(sessionId)

    return rows.map((row) => ({
      role: row.role as "user" | "assistant",
      content: row.content || "",
      toolCalls: row.tool_calls ? (JSON.parse(row.tool_calls) as ToolCall[]) : undefined,
      toolResults: row.tool_results
        ? (JSON.parse(row.tool_results) as ToolResult[])
        : undefined,
    }))
  }

  clear(sessionId: string) {
    this.db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId)
  }

  listSessions(): string[] {
    const rows = this.db
      .prepare<[], { session_id: string }>(
        "SELECT DISTINCT session_id FROM messages ORDER BY session_id DESC"
      )
      .all()
    return rows.map((r) => r.session_id)
  }

  close() {
    this.db.close()
  }
}
```

### 6. Agent 核心 (`src/agent.ts`)

```typescript
import type { Message, ToolCall, Context } from "./types"
import { LLMClient } from "./llm"
import { ToolRegistry } from "./tools"
import { MessageStore } from "./store"

export class Agent {
  private llm: LLMClient
  private tools: ToolRegistry
  private store: MessageStore
  private sessionId: string
  private cwd: string

  constructor(sessionId: string, config: { provider: "openai" | "anthropic"; model: string; cwd: string; dbPath: string }) {
    this.llm = new LLMClient(config.provider, config.model)
    this.tools = new ToolRegistry()
    this.store = new MessageStore(config.dbPath)
    this.sessionId = sessionId
    this.cwd = config.cwd
  }

  async run(userInput: string): Promise<string> {
    // 1. 添加用户消息
    this.store.add(this.sessionId, {
      role: "user",
      content: userInput,
    })

    // 2. 加载历史消息
    let messages = this.store.get(this.sessionId)

    // 3. 循环调用 LLM
    while (true) {
      console.log("\n🤖 Thinking...")

      const response = await this.llm.chat(messages, this.tools.getDefinitions())

      // 4. 添加 assistant 消息
      const assistantMsg: Message = {
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
      }
      messages.push(assistantMsg)
      this.store.add(this.sessionId, assistantMsg)

      // 5. 输出内容
      if (response.content) {
        console.log(`\n${response.content}`)
      }

      // 6. 没有工具调用，结束
      if (!response.toolCalls?.length) {
        return response.content
      }

      // 7. 执行工具
      const toolResults = await this.executeTools(response.toolCalls)

      // 8. 添加工具结果
      const resultMsg: Message = {
        role: "user",
        content: "",
        toolResults,
      }
      messages.push(resultMsg)
      this.store.add(this.sessionId, resultMsg)
    }
  }

  private async executeTools(toolCalls: ToolCall[]) {
    const results = []
    const ctx: Context = { cwd: this.cwd, messages: [] }

    for (const call of toolCalls) {
      const tool = this.tools.get(call.name)

      if (!tool) {
        console.log(`  ❌ Unknown tool: ${call.name}`)
        results.push({
          toolCallId: call.id,
          content: `Error: Unknown tool '${call.name}'`,
          isError: true,
        })
        continue
      }

      console.log(`  🔧 ${call.name}(${JSON.stringify(call.arguments)})`)

      try {
        const content = await tool.execute(call.arguments, ctx)
        console.log(`  ✅ Done`)
        results.push({ toolCallId: call.id, content })
      } catch (error: any) {
        console.log(`  ❌ Error: ${error.message}`)
        results.push({
          toolCallId: call.id,
          content: `Error: ${error.message}`,
          isError: true,
        })
      }
    }

    return results
  }

  // 获取历史会话
  getHistory(): Message[] {
    return this.store.get(this.sessionId)
  }

  // 清除当前会话
  clearSession() {
    this.store.clear(this.sessionId)
  }
}
```

### 7. CLI 入口 (`src/index.ts`)

```typescript
#!/usr/bin/env node
import { Command } from "commander"
import { Agent } from "./agent"
import { MessageStore } from "./store"
import * as readline from "readline"
import * as path from "path"
import * as os from "os"

const program = new Command()

program
  .name("lite-opencode")
  .description("Lightweight AI coding agent")
  .version("1.0.0")
  .option("-p, --provider <provider>", "LLM provider (openai/anthropic)", "openai")
  .option("-m, --model <model>", "Model ID", "gpt-4o")
  .option("-d, --directory <dir>", "Working directory", process.cwd())
  .option("-s, --session <id>", "Session ID", Date.now().toString())
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
      provider: options.provider,
      model: options.model,
      cwd: options.directory,
      dbPath,
    })

    console.log("Lite OpenCode v1.0.0")
    console.log(`Provider: ${options.provider}`)
    console.log(`Model: ${options.model}`)
    console.log(`Session: ${options.session}`)
    console.log(`Working directory: ${options.directory}`)
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
```

## 配置文件

### package.json

```json
{
  "name": "lite-opencode",
  "version": "1.0.0",
  "type": "module",
  "description": "Lightweight AI coding agent",
  "bin": {
    "lite-opencode": "./dist/index.js"
  },
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "ai": "^4.0.0",
    "@ai-sdk/openai": "^1.0.0",
    "@ai-sdk/anthropic": "^1.0.0",
    "better-sqlite3": "^11.0.0",
    "commander": "^13.0.0",
    "glob": "^11.0.0",
    "zod": "^3.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

## 功能对比

| 功能 | OpenCode | Lite 版 |
|------|----------|---------|
| LLM Provider | 20+ | ✅ 多 Provider (Anthropic/MiniMax/DeepSeek/...) |
| 内置 Tools | 20+ | ✅ 6 个核心工具 |
| UI | TUI + Web + Desktop | ✅ Ink TUI (终端界面) |
| 状态管理 | 复杂 Part 系统 | 简单 Message |
| 权限系统 | 完整规则引擎 | ✅ 策略引擎 (allow/deny/ask) |
| 上下文压缩 | 有 | ✅ 基于模型容量的百分比压缩 |
| Session 分叉 | 有 | 无 |
| LSP 集成 | 有 | 无 |
| MCP 集成 | 有 | 无 |
| Skill 系统 | 有 | 无 |
| 流式输出 | 有 | ✅ 支持 |
| 循环检测 | 有 | ✅ 三层检测 (工具/内容/LLM) |
| Reasoning | 有 | ✅ 支持思考过程显示 |

## 使用方式

```bash
# 安装
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 运行
./dist/index.js

# 指定 provider 和 model
./dist/index.js -p anthropic -m claude-sonnet-4-20250514

# 指定工作目录
./dist/index.js -d /path/to/project

# 继续之前的会话
./dist/index.js -s 1234567890

# 列出所有会话
./dist/index.js --list-sessions
```

## 环境变量

```bash
# OpenAI
export OPENAI_API_KEY="sk-..."

# Anthropic
export ANTHROPIC_API_KEY="sk-ant-..."
```

## 扩展路线图

### Phase 1: MVP ✅ 已完成

- ✅ 核心 Agent 循环
- ✅ 6 个基础工具
- ✅ SQLite 持久化
- ✅ 简单 REPL → 升级为 Ink TUI

### Phase 2: 增强 ✅ 大部分完成

- ✅ 多 Provider 支持 (Anthropic/MiniMax/DeepSeek/OpenAI...)
- ✅ 流式输出
- ✅ 上下文压缩 (基于模型容量百分比)
- ⏳ Session 管理 (列表已完成，删除/重命名待做)

### Phase 3: 高级功能 ⏳ 部分完成

- ✅ 权限系统 → 策略引擎 (allow/deny/ask)
- ❌ LSP 集成 (代码补全、跳转)
- ❌ MCP 集成
- ✅ TUI 界面 → 使用 Ink 实现

### Phase 4: 企业级 ❌ 未开始

- ❌ Skill 系统
- ❌ 多 Agent 模式 (build/plan)
- ❌ 远程 Server 模式
- ❌ Web UI

### v1.1.0 新增功能 (Phase 1 ReAct 增强)

- ✅ 三层循环检测服务
  - 第一层：工具调用哈希检测 (相同工具+参数连续5次)
  - 第二层：内容滑动窗口检测 (50字符窗口，3次重复)
  - 第三层：LLM 辅助判断 (30轮后触发，可选)
- ✅ Reasoning 支持
  - 支持 MiniMax/DeepSeek 等模型的思考过程
  - 流式输出思考内容
  - 持久化到消息历史
- ✅ 策略引擎
  - 三级决策：allow/deny/ask
  - 预定义规则 + 学习规则
  - 从用户决策中学习

## 关键设计决策

### 1. 为什么用 Vercel AI SDK？

- 自动处理 tool calling 的复杂细节
- 内置多轮工具调用 (maxSteps)
- 统一的 API 适配多个 provider
- 活跃的社区和文档

### 2. 为什么用 better-sqlite3？

- 同步 API，代码更简洁
- 比 Drizzle 更轻量
- 足够处理简单的消息存储需求
- 无需 migrations

### 3. 为什么移除权限系统？

- MVP 阶段简化复杂度
- 用户在受信任环境中运行
- 可以在 Phase 3 添加

### 4. 为什么不用图状态管理 (如 LangGraph)？

- OpenCode 的 while 循环模式已经足够
- 图结构增加了学习成本
- 对于简单 Agent，循环更直观

## 总结

Lite OpenCode 是 OpenCode 的精简实现，保留了核心的 "LLM + Tool 循环" 模式。相比原设计：

### 实际完成度

| 阶段 | 原计划 | 实际完成 | 说明 |
|------|--------|----------|------|
| Phase 1 | 4 项 | ✅ 4/4 + 升级 | REPL 升级为 Ink TUI |
| Phase 2 | 4 项 | ✅ 3/4 | Session 管理部分完成 |
| Phase 3 | 4 项 | ✅ 2/4 | 权限系统 + TUI 已实现 |
| 额外功能 | - | ✅ 2 项 | 循环检测 + Reasoning |

### 代码统计

```
src/               ~1200 行
├── index.tsx      ~100 行 (CLI 入口 + Ink TUI)
├── App.tsx        ~250 行 (TUI 组件)
├── agent.ts       ~280 行 (Agent 循环 + 事件系统)
├── llm.ts         ~370 行 (LLM 客户端 + 上下文管理)
├── store.ts       ~70 行 (消息持久化)
├── types.ts       ~50 行 (类型定义)
├── loopDetection.ts ~270 行 (三层循环检测)
├── policy.ts      ~290 行 (策略引擎)
└── tools/         ~250 行 (6 个工具)
```

**总计：约 1900 行**（原设计 600-800 行）

### 适合场景

- 学习 AI Agent 架构
- 快速原型开发
- 定制化修改
- 理解 OpenCode 核心原理
- 需要轻量级编码助手的场景

### 版本历史

- **v1.0.0** - MVP：核心 Agent 循环 + 6 工具 + 上下文压缩 + Ink TUI
- **v1.1.0** - ReAct 增强：三层循环检测 + Reasoning 支持 + 策略引擎
