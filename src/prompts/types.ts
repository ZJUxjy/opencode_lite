/**
 * Prompt 系统类型定义
 */

/**
 * 工具定义（简化版，用于 prompt 渲染）
 */
export interface ToolDefinition {
  name: string
  description: string
}

/**
 * Prompt 上下文，包含渲染所需的所有动态数据
 */
export interface PromptContext {
  model: string
  cwd: string
  platform: string
  tools: ToolDefinition[]
  date: Date
}

/**
 * Prompt Section 接口
 * 每个 section 是一个独立的模块，知道如何渲染自己
 */
export interface PromptSection {
  /** Section 名称，用于调试和日志 */
  name: string
  /** 渲染函数，返回该 section 的 prompt 文本 */
  render: (ctx: PromptContext) => string
  /** 可选：条件渲染，返回 false 时跳过该 section */
  enabled?: (ctx: PromptContext) => boolean
}
