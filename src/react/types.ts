/**
 * ReAct 模块类型定义
 *
 * 参考: dify AgentScratchpadUnit, AgentEntity
 */

import type { ToolCall } from "../types.js"

/**
 * 策略类型
 */
export type Strategy = "auto" | "fc" | "cot"

/**
 * ReAct Action
 *
 * 代表一个工具调用动作
 */
export interface Action {
  /** 工具名称或 "Final Answer" */
  name: string
  /** 工具输入参数 */
  input: Record<string, unknown> | string
}

/**
 * 思考过程单元
 *
 * 记录一次完整的 Thought → Action → Observation 循环
 */
export interface ScratchpadUnit {
  /** LLM 的思考内容 */
  thought: string
  /** 执行的动作 */
  action: Action | null
  /** 动作的字符串表示（用于显示） */
  actionStr: string
  /** 工具执行结果 */
  observation: string | null
}

/**
 * ReAct Runner 配置
 */
export interface ReActConfig {
  /** 策略选择: auto | fc | cot */
  strategy?: Strategy
  /** 最大迭代次数 */
  maxIterations?: number
  /** 是否启用流式输出 */
  enableStreaming?: boolean
  /** 停止词（CoT 模式） */
  stopWords?: string[]
}

/**
 * 多停止词配置
 *
 * 不同阶段使用不同的停止词
 */
export interface StopWordsConfig {
  /** 思考阶段停止词 */
  thought?: string[]
  /** Action 阶段停止词 */
  action?: string[]
  /** 观察阶段停止词 */
  observation?: string[]
}

/**
 * 默认停止词配置
 */
export const DEFAULT_STOP_WORDS: StopWordsConfig = {
  thought: ["Action:", "Action ："],
  action: ["Observation:", "Observation ："],
  observation: ["Thought:", "Thought ："],
}

/**
 * ReAct 事件回调
 */
export interface ReActEvents {
  /** 开始思考 */
  onThinking?: () => void
  /** 思考内容增量 */
  onThought?: (thought: string) => void
  /** 执行动作 */
  onAction?: (action: Action) => void
  /** 观察结果 */
  onObservation?: (observation: string) => void
  /** 工具调用 */
  onToolCall?: (toolCall: ToolCall) => void
  /** 工具结果 */
  onToolResult?: (toolCall: ToolCall, result: string) => void
  /** 最终响应 */
  onResponse?: (content: string) => void
  /** 循环检测 */
  onLoopDetected?: (type: string, message: string) => void
}

/**
 * 解析结果
 */
export interface ParseResult {
  /** 解析类型 */
  type: "thought" | "action" | "text" | null
  /** 解析值 */
  value: string | Action | null
}

/**
 * Runner 接口
 *
 * FCRunner 和 CoTRunner 都需要实现此接口
 */
export interface Runner {
  /** 设置事件回调 */
  setEvents(events: ReActEvents): void
  /** 执行 ReAct 循环 */
  run(
    messages: import("../types.js").Message[],
    tools: import("../types.js").ToolDefinition[],
    systemPrompt: string
  ): Promise<string>
}

/**
 * 模型能力
 */
export interface ModelCapabilities {
  /** 是否支持工具调用 */
  toolCall: boolean
  /** 是否支持多工具调用 */
  multiToolCall: boolean
  /** 是否支持流式工具调用 */
  streamToolCall: boolean
  /** 是否支持停止词 */
  stopWords: boolean
}
