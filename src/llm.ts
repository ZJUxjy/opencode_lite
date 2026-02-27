import { generateText, streamText, CoreMessage, Tool } from "ai"
import { createAnthropic } from "@ai-sdk/anthropic"
import type { Message, ToolCall, ToolResult } from "./types.js"

export interface LLMConfig {
  model?: string
  baseURL?: string
  apiKey?: string
}

export interface ChatResponse {
  content: string
  toolCalls?: ToolCall[]
  finishReason?: string
}

export interface StreamCallbacks {
  onTextDelta?: (text: string) => void
  onToolCall?: (toolCall: ToolCall) => void
}

export class LLMClient {
  private model
  private provider

  constructor(config: LLMConfig = {}) {
    // 优先级: 传入配置 > 环境变量 > 默认值
    const baseURL = config.baseURL || process.env.ANTHROPIC_BASE_URL
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
    const modelId = config.model || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514"

    // 创建 Anthropic 客户端，支持自定义 base URL
    this.provider = createAnthropic({
      ...(baseURL && { baseURL }),
      ...(apiKey && { apiKey }),
    })

    this.model = this.provider(modelId)
  }

  /**
   * 非流式调用（保留兼容性）
   */
  async chat(
    messages: Message[],
    tools: Array<{ name: string; description: string; parameters: any }>
  ): Promise<ChatResponse> {
    const coreMessages = this.convertMessages(messages)
    const toolDefs = this.convertTools(tools)

    const result = await generateText({
      model: this.model,
      messages: coreMessages,
      tools: toolDefs,
      maxSteps: 10,
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

  /**
   * 流式调用
   */
  async chatStream(
    messages: Message[],
    tools: Array<{ name: string; description: string; parameters: any }>,
    callbacks: StreamCallbacks = {}
  ): Promise<ChatResponse> {
    const coreMessages = this.convertMessages(messages)
    const toolDefs = this.convertTools(tools)

    const result = streamText({
      model: this.model,
      messages: coreMessages,
      tools: toolDefs,
      maxSteps: 10,
    })

    let fullContent = ""
    const toolCalls: ToolCall[] = []

    // 处理流式响应
    for await (const delta of (await result).fullStream) {
      switch (delta.type) {
        case "text-delta":
          fullContent += delta.textDelta
          callbacks.onTextDelta?.(delta.textDelta)
          break

        case "tool-call":
          const tc: ToolCall = {
            id: delta.toolCallId,
            name: delta.toolName,
            arguments: delta.args as Record<string, unknown>,
          }
          toolCalls.push(tc)
          callbacks.onToolCall?.(tc)
          break
      }
    }

    const finalResult = await (await result)
    return {
      content: fullContent || (await finalResult.text),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: await finalResult.finishReason,
    }
  }

  /**
   * 估算消息的 token 数量（简单估算：1 token ≈ 4 字符）
   */
  estimateTokens(messages: Message[]): number {
    let total = 0
    for (const msg of messages) {
      total += Math.ceil((msg.content?.length || 0) / 4)
      if (msg.toolCalls) {
        total += Math.ceil(JSON.stringify(msg.toolCalls).length / 4)
      }
      if (msg.toolResults) {
        total += Math.ceil(JSON.stringify(msg.toolResults).length / 4)
      }
    }
    return total
  }

  /**
   * 压缩上下文：保留系统信息和最近的消息，中间部分用摘要替代
   */
  async compressContext(
    messages: Message[],
    maxTokens: number = 60000
  ): Promise<Message[]> {
    const currentTokens = this.estimateTokens(messages)

    if (currentTokens <= maxTokens) {
      return messages
    }

    console.log(`\n📦 Compressing context (${currentTokens} tokens → ${maxTokens} limit)...`)

    // 策略：保留第一条用户消息 + 最近的消息
    // 中间部分让 LLM 生成摘要
    if (messages.length <= 4) {
      return messages
    }

    // 保留第一条和最后几条
    const keepFirst = 2  // 保留前 2 条
    const keepLast = 6   // 保留后 6 条

    if (messages.length <= keepFirst + keepLast) {
      return messages
    }

    // 需要压缩的中间部分
    const toCompress = messages.slice(keepFirst, -keepLast)

    // 生成摘要
    const summaryPrompt: Message = {
      role: "user",
      content: `Please summarize the following conversation history concisely (keep key information, decisions, and context needed for continuing the conversation):

${toCompress.map(m => `[${m.role}]: ${m.content?.slice(0, 500)}...`).join('\n\n')}

Provide a brief summary:`,
    }

    try {
      // 使用快速模型生成摘要
      const fastModel = this.provider(process.env.ANTHROPIC_SMALL_FAST_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514")

      const summaryResult = await generateText({
        model: fastModel,
        messages: [{ role: "user", content: summaryPrompt.content }],
        maxTokens: 1000,
      })

      const summaryMessage: Message = {
        role: "assistant",
        content: `[Context Summary]\n${summaryResult.text}`,
      }

      // 组合：前几条 + 摘要 + 后几条
      const compressed = [
        ...messages.slice(0, keepFirst),
        summaryMessage,
        ...messages.slice(-keepLast),
      ]

      console.log(`  ✅ Compressed to ${this.estimateTokens(compressed)} tokens (${compressed.length} messages)`)

      return compressed
    } catch (error) {
      console.log(`  ⚠️ Compression failed, keeping original messages`)
      return messages
    }
  }

  private convertMessages(messages: Message[]): CoreMessage[] {
    return messages.map((m) => {
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
  }

  private convertTools(tools: Array<{ name: string; description: string; parameters: any }>): Record<string, Tool> {
    const toolDefs: Record<string, Tool> = {}
    for (const t of tools) {
      toolDefs[t.name] = {
        description: t.description,
        parameters: t.parameters,
      }
    }
    return toolDefs
  }
}
