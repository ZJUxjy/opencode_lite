import { generateText, CoreMessage, Tool } from "ai"
import { openai } from "@ai-sdk/openai"
import { anthropic } from "@ai-sdk/anthropic"
import type { Message, ToolCall } from "./types.js"

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
