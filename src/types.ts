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
