import type { Message, ToolCall, Context } from "./types.js"
import { LLMClient } from "./llm.js"
import { ToolRegistry } from "./tools/index.js"
import { MessageStore } from "./store.js"

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
