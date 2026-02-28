import type { ToolCall, Message } from "./types.js"

/**
 * 循环检测结果
 */
export interface LoopDetectionResult {
  detected: boolean
  type: "tool_call" | "content" | "llm_assisted" | null
  message: string
  confidence: number  // 0-1
  /** 是否需要 LLM 验证 */
  needsVerification?: boolean
  /** 用于验证的上下文 */
  verificationContext?: string
}

/**
 * 循环检测配置
 */
export interface LoopDetectionConfig {
  // 第一层：工具调用检测
  toolCallThreshold: number      // 连续相同调用次数阈值，默认 5
  // 第二层：内容重复检测
  contentWindowSize: number      // 滑动窗口大小，默认 50 字符
  contentRepeatThreshold: number // 重复次数阈值，默认 3
  // 第三层：LLM 辅助检测
  llmAssistedMinTurns: number    // 最少轮数后才触发，默认 30
  llmAssistedConfidence: number  // 置信度阈值，默认 0.9
  // Phase 4: 探测验证
  enableVerification: boolean    // 是否启用 LLM 验证
  verificationThreshold: number  // 触发验证的置信度阈值
}

const DEFAULT_CONFIG: LoopDetectionConfig = {
  toolCallThreshold: 5,
  contentWindowSize: 50,
  contentRepeatThreshold: 3,
  llmAssistedMinTurns: 30,
  llmAssistedConfidence: 0.9,
  enableVerification: true,
  verificationThreshold: 0.7,  // 置信度 >= 0.7 时需要验证
}

/**
 * 探测验证 Prompt 模板
 */
const VERIFICATION_PROMPT = `Analyze the following conversation patterns and determine if the agent is stuck in a loop.

A loop means the agent is:
1. Repeating the same action without making progress
2. Getting the same result repeatedly without adapting
3. Stuck in a cycle that won't lead to task completion

Recent actions:
{CONTEXT}

Respond with ONLY "LOOP" or "NO_LOOP" followed by a brief reason.
Example: "NO_LOOP - Agent is making incremental progress"
Example: "LOOP - Same action repeated 5 times with no change"`

/**
 * 三层循环检测服务
 *
 * 设计思路：
 * - 第一层：工具调用哈希检测（快速、确定性强）
 * - 第二层：内容滑动窗口检测（捕获重复文本输出）
 * - 第三层：LLM 辅助判断（高精度但成本高，延后触发）
 *
 * Phase 4 增强：
 * - 探测验证：检测结果需要 LLM 验证确认
 */
export class LoopDetectionService {
  private config: LoopDetectionConfig

  // 第一层状态
  private lastToolCallKey: string | null = null
  private toolCallRepetitionCount = 0

  // 第二层状态
  private contentWindow: string[] = []
  private recentContents: string[] = []  // 最近的完整内容，用于 LLM 分析
  private recentToolCalls: ToolCall[] = []  // 最近的工具调用

  // 轮数统计
  private turnCount = 0

  constructor(config: Partial<LoopDetectionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 增加轮数计数
   */
  incrementTurn(): void {
    this.turnCount++
  }

  /**
   * 获取当前轮数
   */
  getTurnCount(): number {
    return this.turnCount
  }

  /**
   * 重置状态（新会话时调用）
   */
  reset(): void {
    this.lastToolCallKey = null
    this.toolCallRepetitionCount = 0
    this.contentWindow = []
    this.recentContents = []
    this.recentToolCalls = []
    this.turnCount = 0
  }

  /**
   * 第一层：检测工具调用循环
   * 相同工具 + 相同参数 连续调用超过阈值
   */
  checkToolCallLoop(toolCall: ToolCall): LoopDetectionResult {
    // 保存工具调用记录
    this.recentToolCalls.push(toolCall)
    if (this.recentToolCalls.length > 20) {
      this.recentToolCalls.shift()
    }

    const key = this.hashToolCall(toolCall)

    if (this.lastToolCallKey === key) {
      this.toolCallRepetitionCount++

      if (this.toolCallRepetitionCount >= this.config.toolCallThreshold) {
        const result: LoopDetectionResult = {
          detected: true,
          type: "tool_call",
          message: `检测到工具调用循环：${toolCall.name} 连续调用了 ${this.toolCallRepetitionCount} 次`,
          confidence: 0.9,
        }

        // 如果启用验证且置信度在阈值范围内，需要验证
        if (this.config.enableVerification && result.confidence < 1.0) {
          result.needsVerification = true
          result.verificationContext = this.buildToolCallVerificationContext()
        }

        return result
      }
    } else {
      this.lastToolCallKey = key
      this.toolCallRepetitionCount = 1
    }

    return {
      detected: false,
      type: null,
      message: "",
      confidence: 0,
    }
  }

  /**
   * 第二层：检测内容重复循环
   * 使用滑动窗口检测重复的文本输出
   */
  checkContentLoop(content: string): LoopDetectionResult {
    if (!content || content.length < this.config.contentWindowSize) {
      return { detected: false, type: null, message: "", confidence: 0 }
    }

    // 跳过代码块（避免代码重复的误报）
    const cleanContent = this.stripCodeBlocks(content)

    // 分割成固定大小的块
    const chunks = this.splitIntoChunks(cleanContent, this.config.contentWindowSize)

    // 更新滑动窗口（保留最近 20 个块）
    this.contentWindow = [...this.contentWindow.slice(-20 + chunks.length), ...chunks]

    // 保存完整内容用于 LLM 分析
    this.recentContents.push(content)
    if (this.recentContents.length > 10) {
      this.recentContents.shift()
    }

    // 检测连续重复的块
    let repeatCount = 1
    let maxRepeatCount = 1
    let repeatedChunk = ""

    for (let i = 1; i < this.contentWindow.length; i++) {
      if (this.contentWindow[i] === this.contentWindow[i - 1]) {
        repeatCount++
        if (repeatCount > maxRepeatCount) {
          maxRepeatCount = repeatCount
          repeatedChunk = this.contentWindow[i]
        }
      } else {
        repeatCount = 1
      }
    }

    if (maxRepeatCount >= this.config.contentRepeatThreshold) {
      const result: LoopDetectionResult = {
        detected: true,
        type: "content",
        message: `检测到内容重复：相同内容重复了 ${maxRepeatCount} 次`,
        confidence: 0.8,
      }

      // 内容循环置信度较低，建议验证
      if (this.config.enableVerification) {
        result.needsVerification = true
        result.verificationContext = this.buildContentVerificationContext()
      }

      return result
    }

    return { detected: false, type: null, message: "", confidence: 0 }
  }

  /**
   * 第三层：LLM 辅助判断（需要外部调用 LLM）
   * 返回是否应该进行 LLM 检测，以及相关上下文
   */
  shouldCheckWithLLM(): boolean {
    // 只在达到最少轮数后才触发
    return this.turnCount >= this.config.llmAssistedMinTurns
  }

  /**
   * 获取用于 LLM 分析的最近内容
   */
  getRecentContentForAnalysis(): string {
    return this.recentContents.join("\n\n---\n\n")
  }

  /**
   * 获取验证 Prompt
   */
  getVerificationPrompt(context: string): string {
    return VERIFICATION_PROMPT.replace("{CONTEXT}", context)
  }

  /**
   * 解析 LLM 验证响应
   */
  parseVerificationResponse(response: string): { isLoop: boolean; reason: string } {
    const trimmed = response.trim().toUpperCase()

    if (trimmed.startsWith("LOOP")) {
      const reason = response.trim().substring(4).trim() || "Detected loop pattern"
      return { isLoop: true, reason }
    }

    return { isLoop: false, reason: response.trim() }
  }

  /**
   * 构建工具调用验证上下文
   */
  private buildToolCallVerificationContext(): string {
    const recentCalls = this.recentToolCalls.slice(-10)
    return recentCalls.map((call, i) =>
      `${i + 1}. Tool: ${call.name}, Args: ${JSON.stringify(call.arguments).slice(0, 100)}`
    ).join("\n")
  }

  /**
   * 构建内容验证上下文
   */
  private buildContentVerificationContext(): string {
    return this.recentContents.slice(-5).map((content, i) =>
      `Turn ${i + 1}: ${content.slice(0, 200)}...`
    ).join("\n\n")
  }

  /**
   * 生成工具调用的哈希键
   * 使用工具名 + 参数 JSON 字符串
   */
  private hashToolCall(toolCall: ToolCall): string {
    // 简化参数：只比较键名和值的类型，忽略具体值的细微差异
    const simplifiedArgs = this.simplifyArgs(toolCall.arguments)
    return `${toolCall.name}:${JSON.stringify(simplifiedArgs)}`
  }

  /**
   * 简化参数对象，用于比较
   * 忽略数值的微小差异和字符串的细微变化
   */
  private simplifyArgs(args: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(args)) {
      if (typeof value === "string") {
        // 字符串：只比较长度范围
        result[key] = `string(${value.length})`
      } else if (typeof value === "number") {
        // 数字：保留原值
        result[key] = value
      } else if (typeof value === "boolean") {
        result[key] = value
      } else if (Array.isArray(value)) {
        result[key] = `array(${value.length})`
      } else if (typeof value === "object" && value !== null) {
        result[key] = this.simplifyArgs(value as Record<string, unknown>)
      } else {
        result[key] = value
      }
    }

    return result
  }

  /**
   * 移除代码块（避免代码重复的误报）
   */
  private stripCodeBlocks(text: string): string {
    // 移除 ``` 包裹的代码块
    return text.replace(/```[\s\S]*?```/g, "[CODE_BLOCK]")
  }

  /**
   * 将文本分割成固定大小的块
   */
  private splitIntoChunks(text: string, size: number): string[] {
    const chunks: string[] = []
    for (let i = 0; i < text.length; i += size) {
      chunks.push(text.slice(i, i + size))
    }
    return chunks
  }

  /**
   * 综合检测：检查工具调用和内容循环
   */
  detect(toolCall: ToolCall | null, content: string): LoopDetectionResult {
    // 先检查工具调用循环
    if (toolCall) {
      const toolResult = this.checkToolCallLoop(toolCall)
      if (toolResult.detected) {
        return toolResult
      }
    }

    // 再检查内容循环
    if (content) {
      const contentResult = this.checkContentLoop(content)
      if (contentResult.detected) {
        return contentResult
      }
    }

    return { detected: false, type: null, message: "", confidence: 0 }
  }
}
