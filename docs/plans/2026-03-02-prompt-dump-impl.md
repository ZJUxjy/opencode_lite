# Prompt Dump 功能实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 Prompt Dump 功能，将发送给 LLM 的完整 prompt 和响应保存到 Markdown 文件中，支持 CLI 参数和 TUI 命令两种触发方式。

**Architecture:** 创建 PromptDumper 工具类，在 LLMClient.chatStream() 中拦截并记录请求/响应。通过 Agent 传递 dump 配置，支持运行时开关。

**Tech Stack:** TypeScript, Node.js fs 模块, Markdown 格式化

---

### Task 1: 创建 PromptDumper 核心类

**Files:**
- Create: `src/utils/promptDumper.ts`
- Create: `src/utils/__tests__/promptDumper.test.ts`

**Step 1: 写失败的测试**

```typescript
// src/utils/__tests__/promptDumper.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { PromptDumper } from "../promptDumper.js"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

describe("PromptDumper", () => {
  let dumper: PromptDumper
  const testSessionId = "test-session-123"
  const dumpDir = path.join(os.homedir(), ".lite-opencode", "dumps")

  beforeEach(() => {
    dumper = new PromptDumper(testSessionId, true)
  })

  afterEach(() => {
    // 清理测试文件
    const dumpFile = path.join(dumpDir, `session-${testSessionId}.md`)
    if (fs.existsSync(dumpFile)) {
      fs.unlinkSync(dumpFile)
    }
  })

  it("should create dump file with correct header", () => {
    dumper = new PromptDumper(testSessionId, true)
    const dumpFile = path.join(dumpDir, `session-${testSessionId}.md`)
    expect(fs.existsSync(dumpFile)).toBe(true)

    const content = fs.readFileSync(dumpFile, "utf-8")
    expect(content).toContain(`# Session: ${testSessionId}`)
    expect(content).toContain("# Started:")
  })

  it("should dump request with system prompt", () => {
    const systemPrompt = "You are a helpful assistant."
    const messages = [{ role: "user" as const, content: "Hello" }]

    dumper.dumpRequest(systemPrompt, messages)

    const dumpFile = path.join(dumpDir, `session-${testSessionId}.md`)
    const content = fs.readFileSync(dumpFile, "utf-8")
    expect(content).toContain("## Request #1")
    expect(content).toContain("### System Prompt")
    expect(content).toContain("You are a helpful assistant.")
    expect(content).toContain("### Messages")
    expect(content).toContain("Hello")
  })

  it("should dump response", () => {
    const response = {
      content: "Hi there!",
      toolCalls: undefined,
    }

    dumper.dumpResponse(response)

    const dumpFile = path.join(dumpDir, `session-${testSessionId}.md`)
    const content = fs.readFileSync(dumpFile, "utf-8")
    expect(content).toContain("### LLM Response")
    expect(content).toContain("Hi there!")
  })

  it("should increment request number", () => {
    dumper.dumpRequest("system", [{ role: "user", content: "q1" }])
    dumper.dumpResponse({ content: "a1" })
    dumper.dumpRequest("system", [{ role: "user", content: "q2" }])
    dumper.dumpResponse({ content: "a2" })

    const dumpFile = path.join(dumpDir, `session-${testSessionId}.md`)
    const content = fs.readFileSync(dumpFile, "utf-8")
    expect(content).toContain("## Request #1")
    expect(content).toContain("## Request #2")
  })

  it("should not dump when disabled", () => {
    const disabledDumper = new PromptDumper("disabled-session", false)
    disabledDumper.dumpRequest("system", [{ role: "user", content: "test" }])

    const dumpFile = path.join(dumpDir, "session-disabled-session.md")
    expect(fs.existsSync(dumpFile)).toBe(false)
  })

  it("should toggle enabled state", () => {
    dumper.setEnabled(false)
    expect(dumper.isEnabled()).toBe(false)

    dumper.setEnabled(true)
    expect(dumper.isEnabled()).toBe(true)
  })

  it("should return dump file path", () => {
    const expectedPath = path.join(dumpDir, `session-${testSessionId}.md`)
    expect(dumper.getDumpPath()).toBe(expectedPath)
  })
})
```

**Step 2: 运行测试验证失败**

Run: `npm run test -- src/utils/__tests__/promptDumper.test.ts`
Expected: FAIL - Cannot find module '../promptDumper.js'

**Step 3: 实现 PromptDumper 类**

```typescript
// src/utils/promptDumper.ts
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import type { Message } from "../types.js"
import type { ChatResponse } from "../llm.js"

/**
 * PromptDumper - 将 LLM 请求和响应 dump 到文件
 *
 * 输出格式: Markdown
 * 位置: ~/.lite-opencode/dumps/session-{id}.md
 */
export class PromptDumper {
  private sessionId: string
  private enabled: boolean
  private dumpPath: string
  private requestNumber: number = 0
  private initialized: boolean = false

  constructor(sessionId: string, enabled: boolean = false) {
    this.sessionId = sessionId
    this.enabled = enabled
    this.dumpPath = this.getDumpPath()

    if (this.enabled) {
      this.initialize()
    }
  }

  private initialize(): void {
    if (this.initialized) return

    const dumpDir = path.dirname(this.dumpPath)
    if (!fs.existsSync(dumpDir)) {
      fs.mkdirSync(dumpDir, { recursive: true })
    }

    // 写入文件头
    const header = this.generateHeader()
    fs.writeFileSync(this.dumpPath, header, "utf-8")
    this.initialized = true
  }

  private generateHeader(): string {
    const now = new Date()
    const timestamp = now.toISOString().replace("T", " ").slice(0, 19)

    return `# Session: ${this.sessionId}
# Started: ${timestamp}
# Dump file: ${this.dumpPath}

`
  }

  /**
   * Dump 请求信息
   */
  dumpRequest(systemPrompt: string, messages: Message[]): void {
    if (!this.enabled) return

    if (!this.initialized) {
      this.initialize()
    }

    this.requestNumber++
    const now = new Date()
    const timestamp = now.toTimeString().slice(0, 8)

    const systemPromptTokens = Math.round(systemPrompt.length / 4)
    const messageCount = messages.length

    let content = `---

## Request #${this.requestNumber} @ ${timestamp}

### System Prompt (${systemPromptTokens} tokens)
\`\`\`
${systemPrompt}
\`\`\`

### Messages (${messageCount} messages)
\`\`\`
`

    messages.forEach((msg, i) => {
      content += `[${i}] ${msg.role.toUpperCase()}:\n`

      if (msg.content) {
        content += `${msg.content}\n`
      }

      if (msg.toolCalls?.length) {
        msg.toolCalls.forEach(tc => {
          content += `[tool: ${tc.name}(${JSON.stringify(tc.arguments)})]\n`
        })
      }

      if (msg.toolResults?.length) {
        msg.toolResults.forEach(tr => {
          const truncated = tr.content.length > 200
            ? tr.content.slice(0, 200) + "..."
            : tr.content
          content += `[tool result: ${truncated}]\n`
        })
      }

      content += "\n"
    })

    content += "```\n\n"

    fs.appendFileSync(this.dumpPath, content, "utf-8")
  }

  /**
   * Dump 响应信息
   */
  dumpResponse(response: ChatResponse): void {
    if (!this.enabled) return

    let content = "### LLM Response\n```\n"

    if (response.content) {
      content += `${response.content}\n`
    }

    if (response.toolCalls?.length) {
      content += "\n[Tool Calls]\n"
      response.toolCalls.forEach(tc => {
        content += `- ${tc.name}: ${JSON.stringify(tc.arguments).slice(0, 100)}\n`
      })
    }

    if (response.reasoning) {
      content += `\n[Reasoning]\n${response.reasoning}\n`
    }

    content += "```\n\n"

    fs.appendFileSync(this.dumpPath, content, "utf-8")
  }

  /**
   * 设置是否启用
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (enabled && !this.initialized) {
      this.initialize()
    }
  }

  /**
   * 获取是否启用
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * 获取 dump 文件路径
   */
  getDumpPath(): string {
    const dumpDir = path.join(os.homedir(), ".lite-opencode", "dumps")
    return path.join(dumpDir, `session-${this.sessionId}.md`)
  }
}
```

**Step 4: 运行测试验证通过**

Run: `npm run test -- src/utils/__tests__/promptDumper.test.ts`
Expected: PASS - All tests pass

**Step 5: 提交**

```bash
git add src/utils/promptDumper.ts src/utils/__tests__/promptDumper.test.ts
git commit -m "feat(utils): add PromptDumper for logging LLM requests

- Add PromptDumper class to dump system prompt, messages, and responses
- Support enable/disable toggle
- Output to ~/.lite-opencode/dumps/session-{id}.md"
```

---

### Task 2: 添加 CLI 参数 --dump-prompt

**Files:**
- Modify: `src/index.tsx:178-185`
- Modify: `src/types.ts` (add DumpConfig interface)

**Step 1: 写失败的测试**

```typescript
// src/cli/__tests__/dump-option.test.ts
import { describe, it, expect } from "vitest"
import { parseDumpOption } from "../dump-option.js"

describe("parseDumpOption", () => {
  it("should return false when option not provided", () => {
    const result = parseDumpOption(undefined)
    expect(result).toBe(false)
  })

  it("should return true when option is provided without value", () => {
    const result = parseDumpOption(true)
    expect(result).toBe(true)
  })

  it("should return true when option is 'true'", () => {
    const result = parseDumpOption("true")
    expect(result).toBe(true)
  })

  it("should return false when option is 'false'", () => {
    const result = parseDumpOption("false")
    expect(result).toBe(false)
  })
})
```

**Step 2: 运行测试验证失败**

Run: `npm run test -- src/cli/__tests__/dump-option.test.ts`
Expected: FAIL - Cannot find module

**Step 3: 实现 CLI 参数解析**

```typescript
// src/cli/dump-option.ts
/**
 * 解析 --dump-prompt 参数
 */
export function parseDumpOption(value: string | boolean | undefined): boolean {
  if (value === undefined) return false
  if (typeof value === "boolean") return value
  return value.toLowerCase() === "true"
}
```

**Step 4: 修改 index.tsx 添加 CLI 参数**

在 `src/index.tsx` 中添加参数定义（约 line 183）：

```typescript
// 在 .option("--compression-threshold ...") 之后添加:
.option("--dump-prompt [enabled]", "Dump prompts and responses to file for debugging")
```

然后在 Agent 配置中传递 dump 选项（约 line 284）：

```typescript
// 在 Agent 构造函数参数中添加:
const dumpPrompt = parseDumpOption(options.dumpPrompt)

const agent = new Agent(sessionId, {
  cwd: options.directory,
  dbPath,
  llm: { ... },
  enableStream: options.stream !== false,
  compressionThreshold: parseFloat(options.compressionThreshold),
  mcp: settings.mcp,
  dumpPrompt,  // 添加这一行
})
```

**Step 5: 更新 AgentConfig 接口**

在 `src/agent.ts` 中更新 `AgentConfig` 接口：

```typescript
export interface AgentConfig {
  cwd: string
  dbPath: string
  llm?: LLMConfig
  enableStream?: boolean
  compressionThreshold?: number
  loopDetection?: LoopDetectionConfig
  policy?: PolicyConfig
  strategy?: Strategy
  mcp?: MCPManagerOptions
  dumpPrompt?: boolean  // 添加这一行
}
```

**Step 6: 运行测试验证通过**

Run: `npm run test -- src/cli/__tests__/dump-option.test.ts`
Expected: PASS

**Step 7: 提交**

```bash
git add src/cli/dump-option.ts src/cli/__tests__/dump-option.test.ts src/index.tsx src/agent.ts
git commit -m "feat(cli): add --dump-prompt option

- Add parseDumpOption function for CLI parsing
- Add dumpPrompt to AgentConfig interface
- Pass dumpPrompt to Agent constructor"
```

---

### Task 3: 集成 PromptDumper 到 Agent

**Files:**
- Modify: `src/agent.ts`

**Step 1: 在 Agent 中初始化 PromptDumper**

在 `src/agent.ts` 中添加：

```typescript
// 在文件顶部添加 import
import { PromptDumper } from "./utils/promptDumper.js"

// 在 Agent 类中添加私有属性
export class Agent {
  // ... 现有属性
  private promptDumper: PromptDumper

  // 在 constructor 中初始化
  constructor(sessionId: string, config: AgentConfig) {
    // ... 现有代码

    // 初始化 PromptDumper
    this.promptDumper = new PromptDumper(sessionId, config.dumpPrompt ?? false)
  }

  // 添加公共方法供外部访问
  getPromptDumper(): PromptDumper {
    return this.promptDumper
  }

  // 添加切换 dump 的方法
  setDumpPrompt(enabled: boolean): void {
    this.promptDumper.setEnabled(enabled)
  }
}
```

**Step 2: 在 LLMClient 调用前 dump 请求**

在 `runWithReAct` 方法中，调用 LLM 之前添加 dump：

```typescript
// 在调用 this.llm.chatStream 或 this.llm.chat 之前添加:

// Dump request if enabled
if (this.promptDumper.isEnabled()) {
  this.promptDumper.dumpRequest(systemPrompt, workingMessages)
}
```

**Step 3: 在收到响应后 dump 响应**

在 `runWithReAct` 方法中，收到响应后添加 dump：

```typescript
// 在 response 赋值后，循环检测之前添加:

// Dump response if enabled
if (this.promptDumper.isEnabled()) {
  this.promptDumper.dumpResponse(response)
}
```

**Step 4: 编译验证**

Run: `npm run build`
Expected: No errors

**Step 5: 提交**

```bash
git add src/agent.ts
git commit -m "feat(agent): integrate PromptDumper into Agent

- Initialize PromptDumper in Agent constructor
- Dump requests before LLM call
- Dump responses after LLM response
- Add getPromptDumper and setDumpPrompt methods"
```

---

### Task 4: 添加 /dump TUI 命令

**Files:**
- Modify: `src/commands/builtins.ts`
- Modify: `src/commands/types.ts`
- Modify: `src/App.tsx`

**Step 1: 更新 CommandContext 接口**

在 `src/commands/types.ts` 中更新 `CommandContext`：

```typescript
export interface CommandContext {
  agent: Agent
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  exit: () => void
  updateContextUsage: () => void
  showSessionList?: () => void
  toggleDumpPrompt?: () => void  // 添加这一行
  getDumpStatus?: () => { enabled: boolean; path: string }  // 添加这一行
}
```

**Step 2: 添加 /dump 命令**

在 `src/commands/builtins.ts` 中添加命令：

```typescript
// 在 mcpCommand 之后添加:

/**
 * Dump command - toggle prompt dumping
 */
const dumpCommand: Command = {
  name: "/dump",
  description: "Toggle prompt dump for debugging",
  handler: (_args: string, ctx: CommandContext) => {
    if (!ctx.toggleDumpPrompt || !ctx.getDumpStatus) {
      const message = createSystemMessage(
        "⚠️ Dump functionality not available"
      )
      ctx.setMessages((prev) => [...prev, message])
      return
    }

    const status = ctx.getDumpStatus()
    ctx.toggleDumpPrompt()
    const newStatus = ctx.getDumpStatus()

    const message = createSystemMessage(
      `${newStatus.enabled ? "✅" : "❌"} Prompt dump ${newStatus.enabled ? "enabled" : "disabled"}
${newStatus.enabled ? `📁 Dump file: ${newStatus.path}` : ""}`
    )
    ctx.setMessages((prev) => [...prev, message])
  },
}

// 在 builtinCommands 数组中添加:
export const builtinCommands: Command[] = [
  // ... 现有命令
  dumpCommand,
]
```

**Step 3: 在 App.tsx 中实现 toggle 函数**

在 `src/App.tsx` 中添加：

```typescript
// 在 commandContext 的 useMemo 中添加:
const handleToggleDump = useCallback(() => {
  const dumper = agent.getPromptDumper()
  dumper.setEnabled(!dumper.isEnabled())
}, [agent])

const handleGetDumpStatus = useCallback(() => {
  const dumper = agent.getPromptDumper()
  return {
    enabled: dumper.isEnabled(),
    path: dumper.getDumpPath(),
  }
}, [agent])

// 更新 commandContext useMemo:
const commandContext: CommandContext = useMemo(
  () => ({
    agent,
    setMessages,
    exit,
    updateContextUsage,
    showSessionList: handleShowSessionList,
    toggleDumpPrompt: handleToggleDump,
    getDumpStatus: handleGetDumpStatus,
  }),
  [agent, setMessages, exit, updateContextUsage, handleShowSessionList, handleToggleDump, handleGetDumpStatus]
)
```

**Step 4: 更新 /help 命令**

在 `src/commands/builtins.ts` 的 helpCommand 中添加：

```typescript
// 在 helpMessage 的命令列表中添加:
`  /dump         - Toggle prompt dump for debugging
`
```

**Step 5: 编译验证**

Run: `npm run build`
Expected: No errors

**Step 6: 提交**

```bash
git add src/commands/builtins.ts src/commands/types.ts src/App.tsx
git commit -m "feat(commands): add /dump command for TUI

- Add /dump command to toggle prompt dumping
- Show dump file path when enabled
- Add toggleDumpPrompt and getDumpStatus to CommandContext"
```

---

### Task 5: 端到端测试

**Files:**
- Manual testing

**Step 1: 编译项目**

Run: `npm run build`
Expected: Build successful

**Step 2: 测试 CLI 参数**

Run: `npm run dev -- --dump-prompt`
然后输入问题，检查 `~/.lite-opencode/dumps/` 目录下是否生成了 dump 文件。

**Step 3: 测试 TUI 命令**

1. 运行 `npm run dev`
2. 输入 `/dump` 启用 dump
3. 输入问题
4. 检查 dump 文件内容

**Step 4: 验证 dump 文件格式**

检查生成的 Markdown 文件是否包含：
- Session 头信息
- System Prompt
- Messages
- LLM Response

**Step 5: 最终提交**

```bash
git add -A
git commit -m "feat: complete prompt dump feature

- Add PromptDumper utility class
- Add --dump-prompt CLI option
- Add /dump TUI command
- Output to ~/.lite-opencode/dumps/session-{id}.md"
```

---

## 文件变更总结

| 文件 | 操作 |
|------|------|
| `src/utils/promptDumper.ts` | 创建 |
| `src/utils/__tests__/promptDumper.test.ts` | 创建 |
| `src/cli/dump-option.ts` | 创建 |
| `src/cli/__tests__/dump-option.test.ts` | 创建 |
| `src/index.tsx` | 修改 |
| `src/agent.ts` | 修改 |
| `src/commands/types.ts` | 修改 |
| `src/commands/builtins.ts` | 修改 |
| `src/App.tsx` | 修改 |
