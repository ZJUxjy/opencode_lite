# Lite-OpenCode Hook 系统设计

> 版本：1.0
> 日期：2025-02-27

---

## 1. 设计目标

### 1.1 核心需求

| 需求 | 说明 |
|------|------|
| **可扩展性** | 用户可以通过配置添加自定义行为 |
| **安全性** | Hook 可以拦截危险操作 |
| **可观测性** | 记录所有操作便于调试 |
| **简单性** | 配置简单，学习成本低 |

### 1.2 参考

- Claude Code Plugins: Hook JSON 配置 + 脚本执行
- Kilocode: 事件 Bus + 订阅模式
- Kimi-CLI: Wire Protocol + 实时注入

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Lite-OpenCode                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐         │
│   │   CLI   │────▶│  Agent  │────▶│   LLM   │────▶│  Tools  │         │
│   │  (Ink)  │     │  Loop   │     │ Stream  │     │Registry │         │
│   └─────────┘     └────┬────┘     └────┬────┘     └────┬────┘         │
│                        │               │               │               │
│                        └───────────────┼───────────────┘               │
│                                        │                                │
│                                  ┌─────▼─────┐                          │
│                                  │ HookManager│                          │
│                                  └─────┬─────┘                          │
│                                        │                                │
│                        ┌───────────────┼───────────────┐                │
│                        │               │               │                │
│                  ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐          │
│                  │  Built-in │   │  Config   │   │  Script   │          │
│                  │   Hooks   │   │  Hooks    │   │  Hooks    │          │
│                  └───────────┘   └───────────┘   └───────────┘          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Hook 类型

```typescript
enum HookType {
  // 会话生命周期
  SessionStart = "SessionStart",      // 会话开始
  SessionEnd = "SessionEnd",          // 会话结束

  // 工具执行
  PreToolUse = "PreToolUse",          // 工具执行前（可拦截）
  PostToolUse = "PostToolUse",        // 工具执行后

  // LLM 交互
  PreLLMCall = "PreLLMCall",          // LLM 调用前
  PostLLMCall = "PostLLMCall",        // LLM 调用后

  // 用户交互
  UserPromptSubmit = "UserPromptSubmit",  // 用户提交消息

  // 流式输出
  TextDelta = "TextDelta",            // 文本增量

  // 停止
  Stop = "Stop",                      // Agent 想要停止

  // 上下文
  PreCompact = "PreCompact",          // 上下文压缩前
  PostCompact = "PostCompact",        // 上下文压缩后
}
```

### 2.3 Hook 输入/输出

```typescript
// Hook 输入
interface HookInput {
  hookType: HookType
  sessionId: string
  timestamp: number

  // 根据不同 hookType 有不同字段
  toolName?: string
  toolArgs?: Record<string, unknown>
  toolResult?: string

  userPrompt?: string
  textDelta?: string

  llmModel?: string
  llmMessages?: Message[]

  compactBefore?: number
  compactAfter?: number
}

// Hook 输出
interface HookOutput {
  // 权限决策（仅 PreToolUse 有效）
  permissionDecision?: "allow" | "deny" | "ask"

  // 阻止 Agent 停止（仅 Stop 有效）
  blockStop?: boolean
  continuePrompt?: string  // 如果阻止，注入的 prompt

  // 系统消息（显示给用户）
  systemMessage?: string

  // 额外上下文（注入到 LLM）
  additionalContext?: string

  // 修改工具参数
  modifiedArgs?: Record<string, unknown>
}
```

---

## 3. 配置设计

### 3.1 settings.json 扩展

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "...",
    "ANTHROPIC_MODEL": "..."
  },

  "hooks": {
    "enabled": true,

    "PreToolUse": [
      {
        "matcher": "bash|write|edit",
        "type": "permission",
        "rules": [
          {
            "pattern": "rm -rf /",
            "decision": "deny",
            "message": "禁止删除根目录"
          },
          {
            "pattern": "npm publish",
            "decision": "ask",
            "message": "发布到 npm 需要确认"
          }
        ]
      },
      {
        "matcher": "bash",
        "type": "script",
        "command": "python3 ~/.claude/hooks/security-check.py"
      }
    ],

    "PostToolUse": [
      {
        "matcher": "write|edit",
        "type": "script",
        "command": "bash ~/.claude/hooks/auto-format.sh"
      }
    ],

    "Stop": [
      {
        "type": "ralph-loop",
        "maxIterations": 10,
        "completionPattern": "<promise>.*?</promise>"
      }
    ],

    "SessionStart": [
      {
        "type": "context",
        "message": "当前工作目录: ${cwd}\n项目类型: ${projectType}"
      }
    ],

    "PreCompact": [
      {
        "type": "script",
        "command": "python3 ~/.claude/hooks/summarize.py"
      }
    ]
  }
}
```

### 3.2 Hook 类型定义

```typescript
// 内置 Hook 类型
type BuiltinHookType =
  | "permission"      // 权限检查
  | "ralph-loop"      // 自循环
  | "context"         // 上下文注入
  | "logging"         // 日志记录

// 通用 Hook 定义
interface HookDefinition {
  // 匹配器（正则表达式）
  matcher?: string

  // Hook 类型
  type: BuiltinHookType | "script"

  // 脚本路径（type=script 时）
  command?: string

  // 权限规则（type=permission 时）
  rules?: PermissionRule[]

  // Ralph Loop 配置（type=ralph-loop 时）
  maxIterations?: number
  completionPattern?: string

  // 上下文消息（type=context 时）
  message?: string
}

interface PermissionRule {
  pattern: string       // 正则表达式
  decision: "allow" | "deny" | "ask"
  message: string       // 提示消息
}
```

---

## 4. 核心实现

### 4.1 HookManager 类

```typescript
// src/hooks/manager.ts

import { HookType, type HookInput, type HookOutput, type HookDefinition } from "./types.js"
import { PermissionChecker } from "./permission.js"
import { RalphLoop } from "./ralph-loop.js"
import { ScriptExecutor } from "./script.js"

export class HookManager {
  private hooks: Map<HookType, HookDefinition[]> = new Map()
  private permissionChecker: PermissionChecker
  private ralphLoop: RalphLoop | null = null
  private scriptExecutor: ScriptExecutor

  constructor(config: Record<string, HookDefinition[]>) {
    // 解析配置
    for (const [type, definitions] of Object.entries(config)) {
      const hookType = HookType[type as keyof typeof HookType]
      if (hookType) {
        this.hooks.set(hookType, definitions)
      }
    }

    this.permissionChecker = new PermissionChecker()
    this.scriptExecutor = new ScriptExecutor()
  }

  /**
   * 执行指定类型的所有 Hook
   */
  async execute(hookType: HookType, input: HookInput): Promise<HookOutput> {
    const definitions = this.hooks.get(hookType) ?? []
    const output: HookOutput = {}

    for (const def of definitions) {
      // 检查 matcher
      if (def.matcher && input.toolName) {
        const regex = new RegExp(def.matcher, "i")
        if (!regex.test(input.toolName)) continue
      }

      // 根据类型执行
      switch (def.type) {
        case "permission":
          const permResult = await this.permissionChecker.check(
            input,
            def.rules ?? []
          )
          if (permResult.decision) {
            output.permissionDecision = permResult.decision
            output.systemMessage = permResult.message
          }
          break

        case "script":
          const scriptResult = await this.scriptExecutor.execute(
            def.command!,
            input
          )
          Object.assign(output, scriptResult)
          break

        case "ralph-loop":
          if (!this.ralphLoop) {
            this.ralphLoop = new RalphLoop(
              def.maxIterations ?? 10,
              def.completionPattern
            )
          }
          const ralphResult = await this.ralphLoop.check(input)
          if (ralphResult.blockStop) {
            output.blockStop = true
            output.continuePrompt = ralphResult.continuePrompt
          }
          break

        case "context":
          const message = this.interpolateMessage(def.message!, input)
          output.additionalContext = message
          break
      }

      // 如果已经有 deny 决策，提前返回
      if (output.permissionDecision === "deny") {
        return output
      }
    }

    return output
  }

  /**
   * 变量插值
   */
  private interpolateMessage(template: string, input: HookInput): string {
    return template
      .replace(/\$\{cwd\}/g, process.cwd())
      .replace(/\$\{sessionId\}/g, input.sessionId)
      .replace(/\$\{timestamp\}/g, String(input.timestamp))
  }
}
```

### 4.2 权限检查器

```typescript
// src/hooks/permission.ts

import type { HookInput, PermissionRule } from "./types.js"

export class PermissionChecker {
  private ruleCache = new Map<string, RegExp>()

  async check(input: HookInput, rules: PermissionRule[]): Promise<{
    decision?: "allow" | "deny" | "ask"
    message?: string
  }> {
    // 构建检查内容
    const contentToCheck = [
      input.toolName,
      JSON.stringify(input.toolArgs),
      input.toolResult,
    ].filter(Boolean).join(" ")

    for (const rule of rules) {
      // 获取或创建正则表达式
      let regex = this.ruleCache.get(rule.pattern)
      if (!regex) {
        regex = new RegExp(rule.pattern, "i")
        this.ruleCache.set(rule.pattern, regex)
      }

      if (regex.test(contentToCheck)) {
        return {
          decision: rule.decision,
          message: rule.message,
        }
      }
    }

    // 没有匹配的规则，默认允许
    return {}
  }
}
```

### 4.3 Ralph Loop 实现

```typescript
// src/hooks/ralph-loop.ts

import type { HookInput } from "./types.js"
import * as fs from "fs"
import * as path from "path"

export class RalphLoop {
  private iteration = 0
  private stateFile: string

  constructor(
    private maxIterations: number,
    private completionPattern?: string
  ) {
    this.stateFile = path.join(process.cwd(), ".claude", "ralph-loop.json")
    this.loadState()
  }

  async check(input: HookInput): Promise<{
    blockStop: boolean
    continuePrompt?: string
  }> {
    // 检查是否达到最大迭代次数
    if (this.iteration >= this.maxIterations) {
      return { blockStop: false }
    }

    // 检查完成承诺
    if (this.completionPattern) {
      const regex = new RegExp(this.completionPattern, "s")
      // 从最近的 assistant 消息中查找
      const recentContent = input.toolResult ?? ""
      if (regex.test(recentContent)) {
        return { blockStop: false }
      }
    }

    // 阻止停止，继续执行
    this.iteration++
    this.saveState()

    return {
      blockStop: true,
      continuePrompt: `继续执行任务。当前迭代: ${this.iteration}/${this.maxIterations}`,
    }
  }

  private loadState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const state = JSON.parse(fs.readFileSync(this.stateFile, "utf-8"))
        this.iteration = state.iteration ?? 0
      }
    } catch {
      // 忽略错误
    }
  }

  private saveState() {
    const dir = path.dirname(this.stateFile)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(this.stateFile, JSON.stringify({ iteration: this.iteration }))
  }

  reset() {
    this.iteration = 0
    try {
      fs.unlinkSync(this.stateFile)
    } catch {
      // 忽略错误
    }
  }
}
```

### 4.4 脚本执行器

```typescript
// src/hooks/script.ts

import { spawn } from "child_process"
import type { HookInput, HookOutput } from "./types.js"

export class ScriptExecutor {
  async execute(command: string, input: HookInput): Promise<HookOutput> {
    return new Promise((resolve, reject) => {
      const process = spawn(command, [], {
        shell: true,
        cwd: process.cwd(),
        env: {
          ...process.env,
          CLAUDE_SESSION_ID: input.sessionId,
          CLAUDE_HOOK_TYPE: input.hookType,
        },
      })

      // 发送输入
      process.stdin.write(JSON.stringify(input))
      process.stdin.end()

      // 收集输出
      let stdout = ""
      let stderr = ""

      process.stdout.on("data", (data) => {
        stdout += data.toString()
      })

      process.stderr.on("data", (data) => {
        stderr += data.toString()
      })

      process.on("close", (code) => {
        if (code === 0) {
          try {
            const output = JSON.parse(stdout) as HookOutput
            resolve(output)
          } catch {
            // 非JSON输出，作为系统消息
            resolve({ systemMessage: stdout.trim() || undefined })
          }
        } else if (code === 2) {
          // 退出码 2 表示阻止操作
          try {
            const output = JSON.parse(stdout) as HookOutput
            resolve({ ...output, permissionDecision: "deny" })
          } catch {
            resolve({
              permissionDecision: "deny",
              systemMessage: stderr || "Hook blocked the operation",
            })
          }
        } else {
          resolve({
            systemMessage: `Hook error: ${stderr || stdout}`,
          })
        }
      })

      process.on("error", (error) => {
        resolve({
          systemMessage: `Hook failed: ${error.message}`,
        })
      })
    })
  }
}
```

---

## 5. Agent 集成

### 5.1 修改 Agent 类

```typescript
// src/agent.ts

import { HookManager, HookType } from "./hooks/index.js"

export class Agent {
  private hooks: HookManager

  constructor(sessionId: string, config: AgentConfig) {
    // ... 现有代码 ...

    // 初始化 Hook 管理器
    this.hooks = new HookManager(config.hooks ?? {})
  }

  async run(userInput: string): Promise<string> {
    // 1. SessionStart Hook
    await this.hooks.execute(HookType.SessionStart, {
      hookType: HookType.SessionStart,
      sessionId: this.sessionId,
      timestamp: Date.now(),
    })

    // ... 添加用户消息 ...

    while (iterations < MAX_ITERATIONS) {
      // 2. PreLLMCall Hook
      const preLLMResult = await this.hooks.execute(HookType.PreLLMCall, {
        hookType: HookType.PreLLMCall,
        sessionId: this.sessionId,
        timestamp: Date.now(),
        llmModel: this.llm.getModelId(),
        llmMessages: messages,
      })

      if (preLLMResult.additionalContext) {
        messages.push({
          role: "system",
          content: preLLMResult.additionalContext,
        })
      }

      // ... 调用 LLM ...

      // 3. PostLLMCall Hook
      await this.hooks.execute(HookType.PostLLMCall, {
        hookType: HookType.PostLLMCall,
        sessionId: this.sessionId,
        timestamp: Date.now(),
      })

      // 4. 检查是否应该停止
      if (!response.toolCalls?.length) {
        // Stop Hook
        const stopResult = await this.hooks.execute(HookType.Stop, {
          hookType: HookType.Stop,
          sessionId: this.sessionId,
          timestamp: Date.now(),
        })

        if (stopResult.blockStop && stopResult.continuePrompt) {
          // 注入继续 prompt
          messages.push({
            role: "user",
            content: stopResult.continuePrompt,
          })
          continue
        }

        return response.content
      }

      // 5. 执行工具
      for (const call of response.toolCalls) {
        // PreToolUse Hook
        const preToolResult = await this.hooks.execute(HookType.PreToolUse, {
          hookType: HookType.PreToolUse,
          sessionId: this.sessionId,
          timestamp: Date.now(),
          toolName: call.name,
          toolArgs: call.arguments,
        })

        // 检查权限
        if (preToolResult.permissionDecision === "deny") {
          // 添加拒绝结果
          toolResults.push({
            toolCallId: call.id,
            content: `Permission denied: ${preToolResult.systemMessage}`,
            isError: true,
          })
          continue
        }

        if (preToolResult.permissionDecision === "ask") {
          // 需要用户确认
          const confirmed = await this.askUserPermission(call, preToolResult.systemMessage)
          if (!confirmed) {
            toolResults.push({
              toolCallId: call.id,
              content: "Permission denied by user",
              isError: true,
            })
            continue
          }
        }

        // 执行工具
        const result = await this.executeTool(call)

        // PostToolUse Hook
        await this.hooks.execute(HookType.PostToolUse, {
          hookType: HookType.PostToolUse,
          sessionId: this.sessionId,
          timestamp: Date.now(),
          toolName: call.name,
          toolArgs: call.arguments,
          toolResult: result,
        })

        toolResults.push({ toolCallId: call.id, content: result })
      }
    }

    // 6. SessionEnd Hook
    await this.hooks.execute(HookType.SessionEnd, {
      hookType: HookType.SessionEnd,
      sessionId: this.sessionId,
      timestamp: Date.now(),
    })

    return result
  }
}
```

---

## 6. 使用示例

### 6.1 安全检查 Hook

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "bash",
        "type": "permission",
        "rules": [
          {
            "pattern": "rm\\s+-rf\\s+/",
            "decision": "deny",
            "message": "禁止删除根目录"
          },
          {
            "pattern": "sudo",
            "decision": "ask",
            "message": "sudo 命令需要确认"
          },
          {
            "pattern": "curl.*\\|.*sh",
            "decision": "ask",
            "message": "从网络执行脚本需要确认"
          }
        ]
      }
    ]
  }
}
```

### 6.2 自动格式化 Hook

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "write|edit",
        "type": "script",
        "command": "bash ~/.claude/hooks/auto-format.sh"
      }
    ]
  }
}
```

```bash
#!/bin/bash
# ~/.claude/hooks/auto-format.sh

read -r input
file_path=$(echo "$input" | jq -r '.toolArgs.path')

# 根据文件类型格式化
case "$file_path" in
  *.ts|*.tsx) npx prettier --write "$file_path" 2>/dev/null ;;
  *.py) black "$file_path" 2>/dev/null ;;
  *.go) gofmt -w "$file_path" 2>/dev/null ;;
esac

# 返回空 JSON 表示成功
echo "{}"
```

### 6.3 Ralph Loop（自循环）

```json
{
  "hooks": {
    "Stop": [
      {
        "type": "ralph-loop",
        "maxIterations": 5,
        "completionPattern": "<promise>.*?</promise>"
      }
    ]
  }
}
```

### 6.4 自定义安全脚本

```python
#!/usr/bin/env python3
# ~/.claude/hooks/security-check.py

import json
import sys

def main():
    input_data = json.load(sys.stdin)
    tool_name = input_data.get("toolName", "")
    tool_args = input_data.get("toolArgs", {})

    # 检查敏感文件
    sensitive_patterns = [".env", "credentials", "secrets", "private_key"]

    if tool_name in ["read", "write", "edit"]:
        file_path = tool_args.get("path", "")
        for pattern in sensitive_patterns:
            if pattern in file_path.lower():
                output = {
                    "permissionDecision": "ask",
                    "systemMessage": f"访问敏感文件需要确认: {file_path}"
                }
                print(json.dumps(output))
                sys.exit(0)

    # 默认允许
    print("{}")

if __name__ == "__main__":
    main()
```

---

## 7. 实现优先级

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P0 | HookManager 基础框架 | 核心调度 |
| P0 | PreToolUse + 权限系统 | 安全基础 |
| P1 | PostToolUse | 后置处理 |
| P1 | 脚本执行器 | 扩展能力 |
| P2 | Ralph Loop | 自循环模式 |
| P2 | Session 生命周期 | 会话管理 |
| P3 | PreCompact / PostCompact | 压缩通知 |

---

## 8. 文件结构

```
src/
├── hooks/
│   ├── index.ts          # 导出
│   ├── types.ts          # 类型定义
│   ├── manager.ts        # Hook 管理器
│   ├── permission.ts     # 权限检查器
│   ├── ralph-loop.ts     # Ralph Loop
│   └── script.ts         # 脚本执行器
├── agent.ts              # 集成 Hook
└── index.tsx             # 加载 Hook 配置
```

---

## 9. 测试计划

### 9.1 单元测试

```typescript
describe("HookManager", () => {
  it("should execute PreToolUse hooks", async () => {
    const manager = new HookManager({
      PreToolUse: [{
        matcher: "bash",
        type: "permission",
        rules: [{
          pattern: "rm",
          decision: "deny",
          message: "No rm"
        }]
      }]
    })

    const result = await manager.execute(HookType.PreToolUse, {
      hookType: HookType.PreToolUse,
      sessionId: "test",
      timestamp: Date.now(),
      toolName: "bash",
      toolArgs: { command: "rm -rf /" },
    })

    expect(result.permissionDecision).toBe("deny")
  })
})
```

### 9.2 集成测试

```bash
# 测试权限拦截
node dist/index.js
> run rm -rf /
# 应该显示 "Permission denied"

# 测试 Ralph Loop
node dist/index.js
# 配置 ralph-loop 后，Agent 应该持续执行直到输出 <promise>
```
