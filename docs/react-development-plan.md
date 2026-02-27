# ReAct 系统开发计划

> 基于对 OpenManus、Roo-Code、dify、gemini-cli、goose、kilocode、opencode、pi-mono 八个项目的深度调研

---

## 目录

1. [设计目标](#1-设计目标)
2. [架构设计](#2-架构设计)
3. [开发阶段规划](#3-开发阶段规划)
4. [详细技术方案](#4-详细技术方案)
5. [文件结构规划](#5-文件结构规划)
6. [风险与缓解措施](#6-风险与缓解措施)

---

## 1. 设计目标

### 1.1 核心目标

| 目标 | 说明 | 参考项目 |
|------|------|----------|
| **双策略支持** | FC + CoT 两种模式，自动选择 | dify |
| **模型兼容性** | 支持所有 LLM，无论是否支持工具调用 | dify, gemini-cli |
| **流式输出** | 实时展示思考过程和工具执行 | dify, goose |
| **思考持久化** | 完整记录 Thought/Action/Observation 链 | dify, Roo-Code |
| **健壮性** | 多层循环检测、渐进式压缩恢复 | gemini-cli, goose |
| **可扩展性** | 模块化 Prompt、插件系统 | kilocode, goose |

### 1.2 与当前架构的兼容性

```
现有架构                          新增架构
┌─────────────────┐              ┌─────────────────┐
│     Agent       │──────────────│  ReActRunner    │
│   (agent.ts)    │              │  (策略选择)      │
└────────┬────────┘              └────────┬────────┘
         │                                │
         ▼                                ▼
┌─────────────────┐              ┌─────────────────┐
│    LLMClient    │──────────────│ FCRunner/CoTRunner│
│    (llm.ts)     │              │  (策略实现)       │
└─────────────────┘              └─────────────────┘
                                          │
                                          ▼
                                 ┌─────────────────┐
                                 │ ReActParser     │
                                 │ (输出解析器)     │
                                 └─────────────────┘
```

---

## 2. 架构设计

### 2.1 分层架构

```
┌─────────────────────────────────────────────────────────────┐
│                        Agent (入口)                          │
│  - 会话管理                                                  │
│  - 消息存储                                                  │
│  - 事件分发                                                  │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    ReActRunner (策略路由)                    │
│  - 模型能力检测                                              │
│  - 策略选择 (FC / CoT)                                       │
│  - 统一接口                                                  │
└─────────────────────────────┬───────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│     FCRunner            │     │     CoTRunner           │
│  (Function Calling)     │     │  (Chain-of-Thought)     │
│                         │     │                         │
│  - 原生工具调用          │     │  - ReAct Prompt 模板    │
│  - 结构化输出            │     │  - 流式输出解析         │
│  - maxSteps=1           │     │  - 停止词处理           │
└─────────────────────────┘     └───────────┬─────────────┘
                                            │
                                            ▼
                                ┌─────────────────────────┐
                                │    ReActParser          │
                                │  (流式 ReAct 解析器)    │
                                │                         │
                                │  - Thought/Action 解析  │
                                │  - JSON 提取            │
                                │  - 状态跟踪             │
                                └─────────────────────────┘
```

### 2.2 核心组件

| 组件 | 职责 | 参考实现 |
|------|------|----------|
| `ReActRunner` | 策略选择和路由 | dify app_runner.py |
| `FCRunner` | FC 模式实现 | 当前 agent.ts |
| `CoTRunner` | CoT 模式实现 | dify cot_agent_runner.py |
| `ReActParser` | 流式 ReAct 输出解析 | dify cot_output_parser.py |
| `ScratchpadManager` | 思考过程管理 | dify AgentScratchpadUnit |
| `ThoughtPersistence` | 思考过程持久化 | dify MessageAgentThought |

### 2.3 数据流

```
用户输入
    │
    ▼
┌─────────────────┐
│  Agent.run()    │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│                    ReActRunner                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 1. 检测模型能力                                   │   │
│  │    - tool-call / multi-tool-call → FC           │   │
│  │    - 否则 → CoT                                  │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 2. 选择 Runner                                   │   │
│  │    FCRunner / CoTRunner                         │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 3. 执行循环                                      │   │
│  │    while (not finished) {                       │   │
│  │      think() → act() → observe()                │   │
│  │    }                                            │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│   最终响应       │
└─────────────────┘
```

---

## 3. 开发阶段规划

### Phase 1: 基础架构 (3-5 天)

**目标**: 建立双策略框架

| 任务 | 说明 | 优先级 |
|------|------|--------|
| 1.1 ReActRunner | 策略路由器，模型能力检测 | P0 |
| 1.2 FCRunner | 迁移现有逻辑到独立类 | P0 |
| 1.3 CoTRunner 基础版 | 支持 ReAct Prompt 模板 | P0 |
| 1.4 ReActParser | 流式输出解析器 | P0 |
| 1.5 策略选择配置 | 支持手动覆盖策略 | P1 |

**交付物**:
- 可运行的 FC + CoT 双策略系统
- 基础的 ReAct 输出解析

### ✅ Phase 2: 流式解析增强 (已完成)

**目标**: 完善流式 ReAct 解析器

| 任务 | 说明 | 状态 |
|------|------|------|
| 2.1 状态跟踪 | 5 组状态变量完整实现 | ✅ |
| 2.2 JSON 提取 | 代码块 + 纯文本两种模式 | ✅ |
| 2.3 嵌套 JSON | 大括号计数器支持 | ✅ |
| 2.4 多模型兼容 | Cohere/Ollama/name-arguments 格式 | ✅ |
| 2.5 容错处理 | JSON 解析失败时自动修复 | ✅ |
| 2.6 测试用例 | 25 个测试用例全部通过 | ✅ |

**交付物**:
- ✅ 健壮的流式 ReAct 解析器 (`src/react/parser.ts`)
- ✅ 完整的测试用例 (`src/react/__tests__/parser.test.ts`)

### Phase 3: 思考过程持久化 (2-3 天)

**目标**: 完整记录和恢复思考链

| 任务 | 说明 | 优先级 |
|------|------|--------|
| 3.1 ScratchpadManager | 管理思考过程单元 | P0 |
| 3.2 ThoughtPersistence | 数据库存储 | P0 |
| 3.3 历史恢复 | 从数据库重建消息历史 | P0 |
| 3.4 前端展示 | UI 展示思考过程 | P2 |

**交付物**:
- 完整的思考过程存储
- 历史恢复机制

### Phase 4: 高级特性 (3-5 天)

**目标**: 增强健壮性和用户体验

| 任务 | 说明 | 优先级 |
|------|------|--------|
| 4.1 探测验证 | LLM 摘要后再验证 | P1 |
| 4.2 渐进式压缩恢复 | 压缩失败时逐步移除更多内容 | P1 |
| 4.3 非破坏性压缩 | 消息标记而非删除 | P2 |
| 4.4 Prompt 模块化增强 | 扩展到 8+ Section | P1 |
| 4.5 多停止词支持 | 不同阶段不同停止词 | P2 |

**交付物**:
- 企业级的 ReAct 系统

---

## 4. 详细技术方案

### 4.1 ReActRunner (策略路由器)

```typescript
// src/react/runner.ts

import type { Message, ToolCall, ToolDefinition } from "../types.js"
import { FCRunner } from "./fc-runner.js"
import { CoTRunner } from "./cot-runner.js"
import { ReActParser } from "./parser.js"

export type Strategy = "auto" | "fc" | "cot"

export interface ReActConfig {
  strategy?: Strategy
  maxIterations?: number
  enableStreaming?: boolean
}

export interface ReActEvents {
  onThinking?: () => void
  onThought?: (thought: string) => void
  onAction?: (action: Action) => void
  onObservation?: (observation: string) => void
  onToolCall?: (toolCall: ToolCall) => void
  onToolResult?: (toolCall: ToolCall, result: string) => void
  onResponse?: (content: string) => void
}

export interface Action {
  name: string
  input: Record<string, unknown>
}

/**
 * ReAct Runner - 策略路由器
 *
 * 参考: dify app_runner.py
 */
export class ReActRunner {
  private fcRunner: FCRunner
  private cotRunner: CoTRunner
  private parser: ReActParser
  private config: ReActConfig
  private events: ReActEvents = {}

  constructor(
    private llm: LLMClient,
    private tools: ToolRegistry,
    config: ReActConfig = {}
  ) {
    this.config = {
      strategy: "auto",
      maxIterations: 50,
      enableStreaming: true,
      ...config,
    }
    this.fcRunner = new FCRunner(llm, tools)
    this.cotRunner = new CoTRunner(llm, tools)
    this.parser = new ReActParser()
  }

  setEvents(events: ReActEvents) {
    this.events = events
    this.fcRunner.setEvents(events)
    this.cotRunner.setEvents(events)
  }

  /**
   * 检测模型能力
   * 参考: dify 策略选择机制
   */
  detectModelCapability(): "fc" | "cot" {
    const modelId = this.llm.getModelId().toLowerCase()

    // 支持原生工具调用的模型
    const fcCapableModels = [
      "claude", "gpt-4", "gpt-3.5", "gemini", "qwen",
      "deepseek", "glm-4", "minimax"
    ]

    for (const model of fcCapableModels) {
      if (modelId.includes(model)) {
        return "fc"
      }
    }

    return "cot"
  }

  /**
   * 选择策略
   */
  selectStrategy(): "fc" | "cot" {
    if (this.config.strategy === "fc") return "fc"
    if (this.config.strategy === "cot") return "cot"

    // auto 模式：基于模型能力自动选择
    return this.detectModelCapability()
  }

  /**
   * 执行 ReAct 循环
   */
  async run(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string
  ): Promise<string> {
    const strategy = this.selectStrategy()

    console.log(`🎯 Using strategy: ${strategy.toUpperCase()}`)

    if (strategy === "fc") {
      return this.fcRunner.run(messages, tools, systemPrompt)
    } else {
      return this.cotRunner.run(messages, tools, systemPrompt)
    }
  }
}
```

### 4.2 CoTRunner (Chain-of-Thought 实现)

```typescript
// src/react/cot-runner.ts

import type { Message, ToolCall, ToolDefinition } from "../types.js"
import { ReActParser, type Action } from "./parser.js"
import { ScratchpadManager, type ScratchpadUnit } from "./scratchpad.js"

/**
 * CoT Runner - Chain-of-Thought 策略实现
 *
 * 参考: dify cot_agent_runner.py
 */
export class CoTRunner {
  private parser: ReActParser
  private scratchpad: ScratchpadManager

  constructor(
    private llm: LLMClient,
    private tools: ToolRegistry
  ) {
    this.parser = new ReActParser()
    this.scratchpad = new ScratchpadManager()
  }

  /**
   * 生成 ReAct Prompt
   * 参考: dify prompt/template.py
   */
  private buildReActPrompt(
    tools: ToolDefinition[],
    systemPrompt: string
  ): string {
    const toolNames = tools.map(t => t.name).join(", ")
    const toolDescriptions = tools.map(t =>
      `- ${t.name}: ${t.description.split('\n')[0]}`
    ).join('\n')

    return `${systemPrompt}

## Available Tools

${toolDescriptions}

## Response Format

You must respond in the following format:

Thought: Think about what to do next
Action:
\`\`\`json
{
  "action": "tool_name",
  "action_input": { ... }
}
\`\`\`

Or if you have the final answer:

Thought: I now know the final answer
Action:
\`\`\`json
{
  "action": "Final Answer",
  "action_input": "Your final response to the user"
}
\`\`\`

Valid action values: "Final Answer" or ${toolNames}

IMPORTANT: Always use exactly ONE action per response.
`
  }

  /**
   * 执行 CoT 循环
   */
  async run(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string
  ): Promise<string> {
    const reactPrompt = this.buildReActPrompt(tools, systemPrompt)
    const maxIterations = 50
    let iteration = 0

    while (iteration < maxIterations) {
      iteration++

      // 1. 构建带 scratchpad 的消息
      const messagesWithScratchpad = this.addScratchpad(messages)

      // 2. 调用 LLM（使用停止词）
      const response = await this.llm.chatStream(
        messagesWithScratchpad,
        [], // CoT 模式不传递工具
        {
          onTextDelta: (text) => this.events.onThought?.(text),
        },
        reactPrompt
      )

      // 3. 解析 ReAct 输出
      const { thought, action, observation } = await this.parseResponse(response.content)

      // 4. 记录思考过程
      this.scratchpad.add({ thought, action, observation })

      // 5. 检查是否为最终答案
      if (!action || action.name.toLowerCase() === "final answer") {
        return action?.input as string || response.content
      }

      // 6. 执行工具
      this.events.onAction?.(action)
      const toolResult = await this.executeTool(action)
      this.events.onObservation?.(toolResult)

      // 7. 添加 Observation 到 scratchpad
      this.scratchpad.addObservation(toolResult)
    }

    return "Maximum iterations reached"
  }

  /**
   * 解析 ReAct 响应
   */
  private async parseResponse(content: string): Promise<{
    thought: string
    action: Action | null
    observation: string
  }> {
    return this.parser.parse(content)
  }

  /**
   * 添加 Scratchpad 到消息
   */
  private addScratchpad(messages: Message[]): Message[] {
    const scratchpadText = this.scratchpad.format()

    if (!scratchpadText) return messages

    // 在最后一条用户消息后添加 scratchpad
    return [
      ...messages,
      {
        role: "user",
        content: `\n${scratchpadText}\nThought:`,
      },
    ]
  }

  /**
   * 执行工具
   */
  private async executeTool(action: Action): Promise<string> {
    const tool = this.tools.get(action.name)

    if (!tool) {
      return `Error: Unknown tool '${action.name}'`
    }

    try {
      return await tool.execute(action.input, { cwd: this.cwd, messages: [] })
    } catch (error: any) {
      return `Error: ${error.message}`
    }
  }
}
```

### 4.3 ReActParser (流式输出解析器)

```typescript
// src/react/parser.ts

/**
 * ReAct 输出解析器
 *
 * 参考: dify cot_output_parser.py
 *
 * 状态跟踪机制:
 * 1. 代码块解析状态 (code_block_cache, in_code_block)
 * 2. JSON 解析状态 (json_cache, json_quote_count)
 * 3. Action 关键词匹配状态 (action_cache, action_idx)
 * 4. Thought 关键词匹配状态 (thought_cache, thought_idx)
 * 5. 边界检测 (last_character)
 */
export class ReActParser {
  // 代码块状态
  private codeBlockCache = ""
  private codeBlockDelimiterCount = 0
  private inCodeBlock = false

  // JSON 状态
  private jsonCache = ""
  private jsonQuoteCount = 0
  private inJson = false

  // 关键词状态
  private actionCache = ""
  private actionIdx = 0
  private actionStr = "action:"

  private thoughtCache = ""
  private thoughtIdx = 0
  private thoughtStr = "thought:"

  // 边界
  private lastCharacter = ""

  /**
   * 解析完整的 ReAct 响应
   */
  parse(content: string): {
    thought: string
    action: Action | null
    raw: string
  } {
    // 重置状态
    this.reset()

    let thought = ""
    let action: Action | null = null

    // 逐字符解析
    for (const char of content) {
      const result = this.processChar(char)

      if (result.type === "thought") {
        thought += result.value
      } else if (result.type === "action") {
        action = result.value
      }
    }

    return { thought, action, raw: content }
  }

  /**
   * 流式解析
   */
  *parseStream(
    chunks: Generator<string, void, unknown>
  ): Generator<{ type: "thought" | "action"; value: string | Action }, void, unknown> {
    this.reset()

    for (const chunk of chunks) {
      for (const char of chunk) {
        const result = this.processChar(char)
        if (result.type) {
          yield result as any
        }
      }
    }
  }

  /**
   * 处理单个字符
   */
  private processChar(char: string): { type: string | null; value: any } {
    let yieldChar = false
    let result: { type: string | null; value: any } = { type: null, value: null }

    // 1. 检测代码块边界
    if (char === "`") {
      this.codeBlockDelimiterCount++
      if (this.codeBlockDelimiterCount === 3) {
        this.inCodeBlock = !this.inCodeBlock
        this.codeBlockDelimiterCount = 0

        // 退出代码块时，尝试提取 JSON
        if (!this.inCodeBlock && this.codeBlockCache) {
          const jsonResults = this.extractJsonFromCodeBlock(this.codeBlockCache)
          for (const json of jsonResults) {
            const action = this.parseAction(json)
            if (action) {
              result = { type: "action", value: action }
            }
          }
          this.codeBlockCache = ""
        }
      }
    } else {
      this.codeBlockDelimiterCount = 0
    }

    // 2. 在代码块内
    if (this.inCodeBlock) {
      this.codeBlockCache += char
      this.lastCharacter = char
      return result
    }

    // 3. 检测 JSON 对象（代码块外）
    if (char === "{") {
      this.jsonQuoteCount++
      this.inJson = true
      this.jsonCache += char
    } else if (char === "}") {
      this.jsonCache += char
      if (this.jsonQuoteCount > 0) {
        this.jsonQuoteCount--
        if (this.jsonQuoteCount === 0) {
          this.inJson = false
          // 完整 JSON，尝试解析
          const action = this.parseAction(this.jsonCache)
          if (action) {
            result = { type: "action", value: action }
          }
          this.jsonCache = ""
        }
      }
    } else if (this.inJson) {
      this.jsonCache += char
    }

    // 4. 关键词匹配（不在 JSON 中时）
    if (!this.inJson) {
      // Action 关键词
      if (char.toLowerCase() === this.actionStr[this.actionIdx]) {
        if (this.actionIdx === 0) {
          // 检查边界
          if (this.lastCharacter !== "\n" && this.lastCharacter !== " " && this.lastCharacter !== "") {
            yieldChar = true
          } else {
            this.actionCache += char
            this.actionIdx++
          }
        } else {
          this.actionCache += char
          this.actionIdx++
          if (this.actionIdx === this.actionStr.length) {
            this.actionCache = ""
            this.actionIdx = 0
          }
        }
      } else {
        if (this.actionCache) {
          // 匹配失败，输出缓存
          result = { type: "thought", value: this.actionCache }
          this.actionCache = ""
          this.actionIdx = 0
        }
        yieldChar = true
      }
    }

    if (yieldChar) {
      result = { type: "thought", value: char }
    }

    this.lastCharacter = char
    return result
  }

  /**
   * 从代码块提取 JSON
   */
  private extractJsonFromCodeBlock(codeBlock: string): any[] {
    // 匹配 ```json...``` 或 ```...``` 中的 JSON
    const blocks = codeBlock.match(/```[json]*\s*([\[{].*?[}\]])\s*```/gis)
    if (!blocks) return []

    const results = []
    for (const block of blocks) {
      try {
        // 提取 JSON 部分
        const jsonMatch = block.match(/```[json]*\s*([\s\S]*?)\s*```/i)
        if (jsonMatch) {
          const jsonStr = jsonMatch[1].trim()
          results.push(JSON.parse(jsonStr))
        }
      } catch {
        // 忽略解析错误
      }
    }
    return results
  }

  /**
   * 解析 Action
   */
  private parseAction(json: any): Action | null {
    if (typeof json === "string") {
      try {
        json = JSON.parse(json)
      } catch {
        return null
      }
    }

    // Cohere 兼容：列表格式
    if (Array.isArray(json) && json.length === 1) {
      json = json[0]
    }

    let actionName = null
    let actionInput = null

    for (const [key, value] of Object.entries(json)) {
      if (key.toLowerCase().includes("action") && !key.toLowerCase().includes("input")) {
        actionName = value
      } else if (key.toLowerCase().includes("input")) {
        actionInput = value
      }
    }

    if (actionName && actionInput !== null) {
      return {
        name: String(actionName),
        input: typeof actionInput === "object" ? actionInput : { value: actionInput },
      }
    }

    return null
  }

  /**
   * 重置状态
   */
  reset() {
    this.codeBlockCache = ""
    this.codeBlockDelimiterCount = 0
    this.inCodeBlock = false
    this.jsonCache = ""
    this.jsonQuoteCount = 0
    this.inJson = false
    this.actionCache = ""
    this.actionIdx = 0
    this.thoughtCache = ""
    this.thoughtIdx = 0
    this.lastCharacter = ""
  }
}

export interface Action {
  name: string
  input: Record<string, unknown>
}
```

### 4.4 ScratchpadManager (思考过程管理)

```typescript
// src/react/scratchpad.ts

/**
 * 思考过程单元
 * 参考: dify AgentScratchpadUnit
 */
export interface ScratchpadUnit {
  thought: string
  action: Action | null
  actionStr: string
  observation: string | null
}

/**
 * Scratchpad 管理器
 *
 * 管理 ReAct 循环中的思考过程
 */
export class ScratchpadManager {
  private units: ScratchpadUnit[] = []
  private currentUnit: ScratchpadUnit | null = null

  /**
   * 添加新的思考单元
   */
  add(partial: Partial<ScratchpadUnit>) {
    if (!this.currentUnit) {
      this.currentUnit = {
        thought: "",
        action: null,
        actionStr: "",
        observation: null,
      }
    }

    Object.assign(this.currentUnit, partial)

    // 如果单元完成（有 observation 或是最终答案），保存它
    if (this.currentUnit.observation !== null ||
        this.currentUnit.action?.name.toLowerCase() === "final answer") {
      this.units.push(this.currentUnit)
      this.currentUnit = null
    }
  }

  /**
   * 添加 Observation
   */
  addObservation(observation: string) {
    if (this.currentUnit) {
      this.currentUnit.observation = observation
      this.units.push(this.currentUnit)
      this.currentUnit = null
    }
  }

  /**
   * 格式化为 Prompt 文本
   */
  format(): string {
    if (this.units.length === 0) return ""

    return this.units.map(unit => {
      let text = ""

      if (unit.thought) {
        text += `Thought: ${unit.thought}\n`
      }

      if (unit.action) {
        text += `Action:\n\`\`\`json\n${JSON.stringify(unit.action, null, 2)}\n\`\`\`\n`
      }

      if (unit.observation) {
        text += `Observation: ${unit.observation}\n`
      }

      return text
    }).join('\n')
  }

  /**
   * 获取所有单元
   */
  getUnits(): ScratchpadUnit[] {
    return [...this.units, this.currentUnit].filter(Boolean) as ScratchpadUnit[]
  }

  /**
   * 检查是否为最终答案
   */
  isFinal(): boolean {
    const lastUnit = this.units[this.units.length - 1]
    return lastUnit?.action?.name.toLowerCase() === "final answer"
  }

  /**
   * 获取最终答案
   */
  getFinalAnswer(): string | null {
    const lastUnit = this.units[this.units.length - 1]
    if (lastUnit?.action?.name.toLowerCase() === "final answer") {
      return lastUnit.action.input as string
    }
    return null
  }

  /**
   * 重置
   */
  reset() {
    this.units = []
    this.currentUnit = null
  }
}
```

### 4.5 ThoughtPersistence (思考过程持久化)

```typescript
// src/react/persistence.ts

import Database from "better-sqlite3"
import type { ScratchpadUnit, Action } from "./scratchpad.js"

/**
 * 持久化的思考记录
 */
export interface ThoughtRecord {
  id: string
  messageId: string
  position: number
  thought: string | null
  tool: string | null
  toolInput: string | null
  observation: string | null
  createdAt: number
}

/**
 * 思考过程持久化
 *
 * 参考: dify MessageAgentThought
 */
export class ThoughtPersistence {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.init()
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS thoughts (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        thought TEXT,
        tool TEXT,
        tool_input TEXT,
        observation TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_thoughts_message ON thoughts(message_id);
      CREATE INDEX IF NOT EXISTS idx_thoughts_position ON thoughts(message_id, position);
    `)
  }

  /**
   * 保存思考单元
   */
  save(messageId: string, unit: ScratchpadUnit, position: number): string {
    const id = crypto.randomUUID()

    const stmt = this.db.prepare(`
      INSERT INTO thoughts (id, message_id, position, thought, tool, tool_input, observation)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      id,
      messageId,
      position,
      unit.thought || null,
      unit.action?.name || null,
      unit.action ? JSON.stringify(unit.action.input) : null,
      unit.observation || null
    )

    return id
  }

  /**
   * 获取消息的所有思考记录
   */
  get(messageId: string): ThoughtRecord[] {
    const stmt = this.db.prepare<[], ThoughtRecord>(
      "SELECT * FROM thoughts WHERE message_id = ? ORDER BY position"
    )
    return stmt.all(messageId)
  }

  /**
   * 转换为 ScratchpadUnit 数组
   */
  toScratchpadUnits(records: ThoughtRecord[]): ScratchpadUnit[] {
    return records.map(record => ({
      thought: record.thought || "",
      action: record.tool ? {
        name: record.tool,
        input: record.toolInput ? JSON.parse(record.toolInput) : {},
      } as Action : null,
      actionStr: record.toolInput || "",
      observation: record.observation,
    }))
  }

  /**
   * 从历史重建消息
   * 参考: dify organize_agent_history
   */
  rebuildMessages(messageId: string): Message[] {
    const records = this.get(messageId)
    const messages: Message[] = []

    for (const record of records) {
      if (record.thought || record.tool) {
        // Assistant 消息（带工具调用）
        const toolCalls = record.tool ? [{
          id: crypto.randomUUID(),
          name: record.tool,
          arguments: record.toolInput ? JSON.parse(record.toolInput) : {},
        }] : undefined

        messages.push({
          role: "assistant",
          content: record.thought || "",
          toolCalls,
        })
      }

      if (record.observation) {
        // Tool 结果消息
        messages.push({
          role: "user",
          content: "",
          toolResults: [{
            toolCallId: crypto.randomUUID(),
            content: record.observation,
          }],
        })
      }
    }

    return messages
  }

  /**
   * 清除消息的思考记录
   */
  clear(messageId: string) {
    this.db.prepare("DELETE FROM thoughts WHERE message_id = ?").run(messageId)
  }
}
```

---

## 5. 文件结构规划

```
src/
├── react/
│   ├── index.ts              # 导出入口
│   ├── runner.ts             # ReActRunner (策略路由)
│   ├── fc-runner.ts          # FCRunner (Function Calling)
│   ├── cot-runner.ts         # CoTRunner (Chain-of-Thought)
│   ├── parser.ts             # ReActParser (流式解析器)
│   ├── scratchpad.ts         # ScratchpadManager (思考过程管理)
│   ├── persistence.ts        # ThoughtPersistence (持久化)
│   └── types.ts              # 类型定义
│
├── prompts/
│   ├── sections/
│   │   ├── react.ts          # ReAct 格式说明 Section
│   │   └── ...
│   └── ...
│
├── agent.ts                  # 修改: 使用 ReActRunner
├── llm.ts                    # 修改: 支持停止词
└── types.ts                  # 修改: 添加 Action 等类型
```

---

## 6. 风险与缓解措施

### 6.1 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| JSON 解析失败 | 工具调用失败 | 多层容错：代码块 → 纯文本 → 原始输出 |
| 模型输出格式不稳定 | 解析错误 | 健壮的解析器 + 重试机制 |
| 上下文过长 | Token 超限 | 渐进式压缩 + 非破坏性压缩 |
| 流式解析状态丢失 | 解析中断 | 状态快照 + 恢复机制 |

### 6.2 兼容性风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 不同模型输出格式差异 | 解析失败 | 多模型适配层 |
| 部分模型不支持停止词 | CoT 模式异常 | 检测模型能力 + 降级策略 |
| 嵌套 JSON 处理 | 解析错误 | 大括号计数器 + 深度限制 |

### 6.3 性能风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 流式解析性能 | 延迟增加 | 字符级解析优化 + 批量处理 |
| 思考过程存储 | 数据库膨胀 | 定期清理 + 压缩归档 |
| 多次 LLM 调用 | 成本增加 | 缓存机制 + 智能压缩 |

---

## 7. 里程碑

```
Week 1: Phase 1 - 基础架构
├── Day 1-2: ReActRunner + FCRunner
├── Day 3-4: CoTRunner + ReActParser
└── Day 5: 集成测试

Week 2: Phase 2 + Phase 3
├── Day 1-2: 流式解析增强
├── Day 3-4: 思考过程持久化
└── Day 5: 端到端测试

Week 3: Phase 4 - 高级特性
├── Day 1-2: 探测验证 + 渐进式压缩
├── Day 3-4: Prompt 模块化增强
└── Day 5: 文档 + 发布
```

---

## 8. 验收标准

### Phase 1 完成标准

- [ ] FC 模式正常工作（与现有行为一致）
- [ ] CoT 模式支持基本 ReAct 循环
- [ ] 策略自动选择基于模型能力
- [ ] 手动覆盖策略配置生效

### Phase 2 完成标准

- [ ] 流式输出正确解析 Thought/Action
- [ ] 代码块内 JSON 正确提取
- [ ] 纯文本 JSON 正确解析
- [ ] 嵌套 JSON 支持
- [ ] 至少 10 个测试用例通过

### Phase 3 完成标准

- [ ] 思考过程持久化到数据库
- [ ] 历史消息正确恢复
- [ ] 前端可展示思考过程

### Phase 4 完成标准

- [ ] 探测验证机制工作
- [ ] 渐进式压缩恢复工作
- [ ] 非破坏性压缩支持
- [ ] 性能无明显下降

---

*文档版本: 1.0*
*创建日期: 2026-02-28*
*参考项目: OpenManus, Roo-Code, dify, gemini-cli, goose, kilocode, opencode, pi-mono*
