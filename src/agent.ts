import type { Message, ToolCall, Context } from "./types.js"
import { LLMClient, type LLMConfig } from "./llm.js"
import { ToolRegistry } from "./tools/index.js"
import { MessageStore } from "./store.js"

export interface AgentConfig {
  cwd: string
  dbPath: string
  llm?: LLMConfig
  enableStream?: boolean
  compressionThreshold?: number
}

export interface AgentEvents {
  onThinking?: () => void
  onTextDelta?: (text: string) => void
  onToolCall?: (toolCall: ToolCall) => void
  onToolResult?: (toolCall: ToolCall, result: string) => void
  onResponse?: (content: string) => void
  onCompress?: (beforeTokens: number, afterTokens: number) => void
}

export class Agent {
  private llm: LLMClient
  private tools: ToolRegistry
  private store: MessageStore
  private sessionId: string
  private cwd: string
  private enableStream: boolean
  private compressionThreshold: number
  private events: AgentEvents = {}

  constructor(sessionId: string, config: AgentConfig) {
    this.llm = new LLMClient(config.llm)
    this.tools = new ToolRegistry()
    this.store = new MessageStore(config.dbPath)
    this.sessionId = sessionId
    this.cwd = config.cwd
    this.enableStream = config.enableStream ?? true
    this.compressionThreshold = config.compressionThreshold ?? 0.92
  }

  setEvents(events: AgentEvents) {
    this.events = events
  }

  async run(userInput: string): Promise<string> {
    // 1. 添加用户消息
    this.store.add(this.sessionId, {
      role: "user",
      content: userInput,
    })

    // 2. 加载历史消息
    let messages = this.store.get(this.sessionId)

    // 3. 上下文压缩
    const beforeTokens = this.llm.estimateTokens(messages)
    messages = await this.llm.compressContext(messages, this.compressionThreshold)
    const afterTokens = this.llm.estimateTokens(messages)
    if (beforeTokens !== afterTokens) {
      this.events.onCompress?.(beforeTokens, afterTokens)
    }

    // 4. 循环调用 LLM
    let iterations = 0
    const MAX_ITERATIONS = 50  // 防止无限循环

    while (iterations < MAX_ITERATIONS) {
      iterations++
      this.events.onThinking?.()

      let response
      try {
        if (this.enableStream) {
          response = await this.llm.chatStream(messages, this.tools.getDefinitions(), {
            onTextDelta: (text) => this.events.onTextDelta?.(text),
            onToolCall: (toolCall) => this.events.onToolCall?.(toolCall),
          })
        } else {
          response = await this.llm.chat(messages, this.tools.getDefinitions())
        }
      } catch (error: any) {
        // LLM 调用失败，返回错误
        this.events.onResponse?.(`Error: ${error.message}`)
        return `Error: ${error.message}`
      }

      // 5. 添加 assistant 消息
      const assistantMsg: Message = {
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
      }
      messages.push(assistantMsg)
      this.store.add(this.sessionId, assistantMsg)

      // 6. 通知响应完成
      if (response.content) {
        this.events.onResponse?.(response.content)
      }

      // 7. 没有工具调用，结束
      if (!response.toolCalls?.length) {
        return response.content
      }

      // 8. 执行工具并收集结果
      const toolResults = await this.executeTools(response.toolCalls)

      // 9. 添加工具结果消息
      const resultMsg: Message = {
        role: "user",
        content: "",
        toolResults,
      }
      messages.push(resultMsg)
      this.store.add(this.sessionId, resultMsg)

      // 10. 再次检查压缩
      const beforeTokens2 = this.llm.estimateTokens(messages)
      messages = await this.llm.compressContext(messages, this.compressionThreshold)
      const afterTokens2 = this.llm.estimateTokens(messages)
      if (beforeTokens2 !== afterTokens2) {
        this.events.onCompress?.(beforeTokens2, afterTokens2)
      }
    }

    // 达到最大迭代次数
    return "Reached maximum iteration limit. Please try a simpler request."
  }

  private async executeTool(call: ToolCall): Promise<string> {
    const tool = this.tools.get(call.name)
    if (!tool) {
      return `Error: Unknown tool '${call.name}'`
    }

    const ctx: Context = { cwd: this.cwd, messages: [] }
    try {
      return await tool.execute(call.arguments, ctx)
    } catch (error: any) {
      return `Error: ${error.message}`
    }
  }

  private async executeTools(toolCalls: ToolCall[]) {
    const results = []
    const ctx: Context = { cwd: this.cwd, messages: [] }

    for (const call of toolCalls) {
      // 触发工具调用事件
      this.events.onToolCall?.(call)

      const tool = this.tools.get(call.name)

      if (!tool) {
        const errorResult = {
          toolCallId: call.id,
          content: `Error: Unknown tool '${call.name}'`,
          isError: true,
        }
        results.push(errorResult)
        this.events.onToolResult?.(call, errorResult.content)
        continue
      }

      try {
        const content = await tool.execute(call.arguments, ctx)
        results.push({ toolCallId: call.id, content })
        this.events.onToolResult?.(call, content)
      } catch (error: any) {
        const errorResult = {
          toolCallId: call.id,
          content: `Error: ${error.message}`,
          isError: true,
        }
        results.push(errorResult)
        this.events.onToolResult?.(call, errorResult.content)
      }
    }

    return results
  }

  getHistory(): Message[] {
    return this.store.get(this.sessionId)
  }

  clearSession() {
    this.store.clear(this.sessionId)
  }

  getContextUsage() {
    const messages = this.store.get(this.sessionId)
    return this.llm.getContextUsage(messages)
  }
}
