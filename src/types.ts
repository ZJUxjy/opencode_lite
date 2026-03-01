import { z } from "zod"

// Tool 定义
export interface Tool<T extends z.ZodType = z.ZodType> {
  name: string
  description: string
  parameters: T
  execute: (params: z.infer<T>, ctx: Context) => Promise<string>
  /** 标记该工具来自哪个 MCP 服务器（用于服务器断开时清理） */
  mcpServer?: string
}

// 上下文
export interface Context {
  cwd: string
  messages: Message[]
  setPlanMode?: (enabled: boolean) => void  // 用于同步 Plan Mode 状态到 PolicyEngine
}

// 消息
export interface Message {
  role: "user" | "assistant"
  content: string
  reasoning?: string  // 思考过程（MiniMax、DeepSeek 等模型支持）
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

// 工具定义（用于传递给 LLM）
export interface ToolDefinition {
  name: string
  description: string
  parameters: any
}
