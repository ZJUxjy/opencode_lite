import type { Message, ToolCall, Context } from "./types.js"
import { LLMClient, type LLMConfig } from "./llm.js"
import { ToolRegistry } from "./tools/index.js"
import { MessageStore } from "./store.js"

export interface AgentConfig {
  cwd: string
  dbPath: string
  llm?: LLMConfig
  enableStream?: boolean
  maxContextTokens?: number
}

export class Agent {
  private llm: LLMClient
  private tools: ToolRegistry
  private store: MessageStore
  private sessionId: string
  private cwd: string
  private enableStream: boolean
  private maxContextTokens: number

  constructor(sessionId: string, config: AgentConfig) {
    this.llm = new LLMClient(config.llm)
    this.tools = new ToolRegistry()
    this.store = new MessageStore(config.dbPath)
    this.sessionId = sessionId
    this.cwd = config.cwd
    this.enableStream = config.enableStream ?? true
    this.maxContextTokens = config.maxContextTokens ?? 60000
  }

  async run(userInput: string): Promise<string> {
    // 1. 添加用户消息
    this.store.add(this.sessionId, {
      role: "user",
      content: userInput,
    })

    // 2. 加载历史消息
    let messages = this.store.get(this.sessionId)

    // 3. 上下文压缩（如果超过限制）
    messages = await this.llm.compressContext(messages, this.maxContextTokens)

    // 4. 循环调用 LLM
    while (true) {
      console.log("\n🤖 Thinking...")

      let response
      if (this.enableStream) {
        // 流式输出
        process.stdout.write("\n")
        response = await this.llm.chatStream(messages, this.tools.getDefinitions(), {
          onTextDelta: (text) => {
            process.stdout.write(text)
          },
          onToolCall: (toolCall) => {
            console.log(`\n  🔧 ${toolCall.name}(${JSON.stringify(toolCall.arguments)})`)
          },
        })
        console.log() // 换行
      } else {
        // 非流式输出
        response = await this.llm.chat(messages, this.tools.getDefinitions())
        if (response.content) {
          console.log(`\n${response.content}`)
        }
      }

      // 5. 添加 assistant 消息
      const assistantMsg: Message = {
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
      }
      messages.push(assistantMsg)
      this.store.add(this.sessionId, assistantMsg)

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

      // 9. 再次检查上下文是否需要压缩
      messages = await this.llm.compressContext(messages, this.maxContextTokens)
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

      // 流式模式下工具调用已在回调中打印
      if (!this.enableStream) {
        console.log(`  🔧 ${call.name}(${JSON.stringify(call.arguments)})`)
      }

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
