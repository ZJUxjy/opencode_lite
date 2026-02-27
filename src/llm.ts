import { generateText, CoreMessage, Tool } from "ai"
import { createAnthropic } from "@ai-sdk/anthropic"
import type { Message } from "./types.js"

export interface LLMConfig {
  model?: string
  baseURL?: string
  apiKey?: string
}

export class LLMClient {
  private model

  constructor(config: LLMConfig = {}) {
    // 优先级: 传入配置 > 环境变量 > 默认值
    const baseURL = config.baseURL || process.env.ANTHROPIC_BASE_URL
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
    const modelId = config.model || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514"

    // 创建 Anthropic 客户端，支持自定义 base URL
    const provider = createAnthropic({
      ...(baseURL && { baseURL }),
      ...(apiKey && { apiKey }),
    })

    this.model = provider(modelId)
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
