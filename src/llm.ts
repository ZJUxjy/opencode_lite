import { generateText, streamText, CoreMessage, Tool } from "ai"
import { createAnthropic } from "@ai-sdk/anthropic"
import type { Message, ToolCall } from "./types.js"

export interface LLMConfig {
  model?: string
  baseURL?: string
  apiKey?: string
  /** 请求超时时间（毫秒），默认 120000 (2分钟) */
  timeout?: number
}

export interface ChatResponse {
  content: string
  reasoning?: string  // 思考过程
  toolCalls?: ToolCall[]
  finishReason?: string
}

export interface StreamCallbacks {
  onTextDelta?: (text: string) => void
  onReasoningDelta?: (text: string) => void  // 思考过程增量
  onToolCall?: (toolCall: ToolCall) => void
}

// 模型上下文容量映射 (tokens)
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // Claude 4 系列
  "claude-4-opus": 200000,
  "claude-4-sonnet": 200000,
  "claude-opus-4": 200000,
  "claude-sonnet-4": 200000,

  // Claude 3.7 / 3.5 系列
  "claude-3-7-sonnet": 200000,
  "claude-3-5-sonnet": 200000,
  "claude-3-5-haiku": 200000,

  // Claude 3 系列
  "claude-3-opus": 200000,
  "claude-3-sonnet": 200000,
  "claude-3-haiku": 200000,

  // MiniMax
  "minimax-m2.5": 1000000,
  "minimax-m1": 1000000,

  // Qwen
  "qwen3-coder-plus": 128000,
  "qwen3-max": 128000,
  "qwen2.5": 128000,

  // DeepSeek
  "deepseek-chat": 64000,
  "deepseek-coder": 16000,

  // GLM
  "glm-4": 128000,
  "glm-4.7": 128000,

  // 默认值
  "default": 200000,
}

// 压缩阈值 (模型容量的百分比)
const COMPRESSION_THRESHOLD = 0.92  // 92%

export interface ModelRoutingConfig {
  /** Plan Mode 使用的模型 (强模型) */
  planModel?: string
  /** 执行模式使用的模型 (快模型) */
  buildModel?: string
  /** 是否启用模型路由 */
  enabled?: boolean
}

export class LLMClient {
  private model
  private provider
  private modelId: string
  private originalModelId: string  // 保存原始模型 ID
  private timeout: number
  private baseURL: string | undefined
  private apiKey: string | undefined
  private isMiniMax: boolean
  /** Current AbortController for canceling ongoing requests */
  private currentAbortController: AbortController | null = null
  /** Model routing configuration */
  private modelRouting: ModelRoutingConfig

  constructor(config: LLMConfig = {}) {
    // 优先级: 传入配置 > 环境变量 > 默认值
    this.baseURL = config.baseURL || process.env.ANTHROPIC_BASE_URL
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
    this.modelId = config.model || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514"
    this.originalModelId = this.modelId
    this.timeout = config.timeout || parseInt(process.env.API_TIMEOUT_MS || "120000", 10)

    // 模型路由配置
    this.modelRouting = {
      planModel: process.env.PLAN_MODE_MODEL || "claude-opus-4",
      buildModel: this.modelId,
      enabled: process.env.ENABLE_MODEL_ROUTING !== "false",  // 默认启用
    }

    // 创建 Anthropic 客户端，支持自定义 base URL
    // 注意: MiniMax 等 API 需要使用 Authorization: Bearer 格式
    this.isMiniMax = this.baseURL?.includes("minimax") || false
    const anthropicConfig: any = {
      ...(this.baseURL && { baseURL: this.baseURL }),
    }

    if (this.apiKey) {
      anthropicConfig.apiKey = this.apiKey
      // MiniMax 需要 Authorization: Bearer 格式
      if (this.isMiniMax) {
        anthropicConfig.headers = {
          Authorization: `Bearer ${this.apiKey}`,
        }
      }
    }

    this.provider = createAnthropic(anthropicConfig)

    this.model = this.provider(this.modelId)

    if (process.env.DEBUG_LLM === "1") {
      console.log(`[LLM] Initialized with model: ${this.modelId}, timeout: ${this.timeout}ms`)
      if (this.modelRouting.enabled) {
        console.log(`[LLM] Model routing enabled: Plan=${this.modelRouting.planModel}, Build=${this.modelRouting.buildModel}`)
      }
    }
  }

  /**
   * 获取当前模型的上下文容量
   */
  getContextLimit(): number {
    // 尝试精确匹配
    const normalizedId = this.modelId.toLowerCase()

    for (const [key, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
      if (normalizedId.includes(key.toLowerCase())) {
        return limit
      }
    }

    // 返回默认值
    return MODEL_CONTEXT_LIMITS.default
  }

  /**
   * 获取当前上下文使用情况
   */
  getContextUsage(messages: Message[]): { used: number; limit: number; percentage: number } {
    const used = this.estimateTokens(messages)
    const limit = this.getContextLimit()
    const percentage = used / limit

    return { used, limit, percentage }
  }

  /**
   * 获取当前模型 ID
   */
  getModelId(): string {
    return this.modelId
  }

  /**
   * 切换到 Plan Mode 模型（强模型）
   */
  switchToPlanModel(): void {
    if (!this.modelRouting.enabled) return

    const planModel = this.modelRouting.planModel
    if (planModel && planModel !== this.modelId) {
      this.modelId = planModel
      this.model = this.provider(this.modelId)

      if (process.env.DEBUG_LLM === "1") {
        console.log(`[LLM] Switched to Plan Mode model: ${this.modelId}`)
      }
    }
  }

  /**
   * 切换到 Build 模型（快模型）
   */
  switchToBuildModel(): void {
    if (!this.modelRouting.enabled) return

    const buildModel = this.modelRouting.buildModel
    if (buildModel && buildModel !== this.modelId) {
      this.modelId = buildModel
      this.model = this.provider(this.modelId)

      if (process.env.DEBUG_LLM === "1") {
        console.log(`[LLM] Switched to Build model: ${this.modelId}`)
      }
    }
  }

  /**
   * 获取模型路由配置
   */
  getModelRoutingConfig(): ModelRoutingConfig {
    return { ...this.modelRouting }
  }

  /**
   * 设置模型路由配置
   */
  setModelRoutingConfig(config: Partial<ModelRoutingConfig>): void {
    this.modelRouting = { ...this.modelRouting, ...config }
  }

  /**
   * 获取当前模型显示名称
   */
  getModelDisplayName(): string {
    const id = this.modelId.toLowerCase()
    if (id.includes("opus")) return "Opus"
    if (id.includes("sonnet")) return "Sonnet"
    if (id.includes("haiku")) return "Haiku"
    if (id.includes("minimax")) return "MiniMax"
    if (id.includes("glm")) return "GLM"
    if (id.includes("qwen")) return "Qwen"
    if (id.includes("deepseek")) return "DeepSeek"
    return this.modelId
  }

  /**
   * Abort any ongoing request
   */
  abort(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
      if (process.env.DEBUG_LLM === "1") {
        console.log(`[LLM] Request aborted by user`)
      }
    }
  }

  /**
   * Check if there's an ongoing request
   */
  isProcessing(): boolean {
    return this.currentAbortController !== null
  }

  /**
   * 非流式调用（保留兼容性）
   */
  async chat(
    messages: Message[],
    tools: Array<{ name: string; description: string; parameters: any }>,
    systemPrompt?: string
  ): Promise<ChatResponse> {
    const coreMessages = this.convertMessages(messages)
    const toolDefs = this.convertTools(tools)

    // 创建 AbortController 用于超时控制和用户取消
    this.currentAbortController = new AbortController()
    const controller = this.currentAbortController
    const timeoutId = setTimeout(() => {
      controller.abort()
    }, this.timeout)

    try {
      const result = await generateText({
        model: this.model,
        system: systemPrompt,
        messages: coreMessages,
        tools: toolDefs,
        maxSteps: 1,  // 单步执行，工具调用由 agent 循环处理
        maxTokens: 32000,  // 足够大的 token 限制
        abortSignal: controller.signal,
      })

      clearTimeout(timeoutId)
      this.currentAbortController = null

      return {
        content: result.text,
        toolCalls: result.toolCalls?.map((tc) => ({
          id: tc.toolCallId,
          name: tc.toolName,
          arguments: tc.args as Record<string, unknown>,
        })),
        finishReason: result.finishReason,
      }
    } catch (error: any) {
      clearTimeout(timeoutId)
      this.currentAbortController = null

      // 处理超时错误
      if (error.name === "AbortError" || controller.signal.aborted) {
        throw new Error(`Request timed out after ${this.timeout / 1000} seconds. The API may be slow or unresponsive.`)
      }

      throw error
    }
  }

  /**
   * 流式调用
   */
  async chatStream(
    messages: Message[],
    tools: Array<{ name: string; description: string; parameters: any }>,
    callbacks: StreamCallbacks = {},
    systemPrompt?: string
  ): Promise<ChatResponse> {
    const coreMessages = this.convertMessages(messages)
    const toolDefs = this.convertTools(tools)

    // 创建 AbortController 用于超时控制和用户取消
    this.currentAbortController = new AbortController()
    const controller = this.currentAbortController
    const timeoutId = setTimeout(() => {
      controller.abort()
      if (process.env.DEBUG_LLM === "1") {
        console.log(`[LLM] Request timed out after ${this.timeout}ms`)
      }
    }, this.timeout)

    if (process.env.DEBUG_LLM === "1") {
      console.log(`[LLM] Starting stream request with ${messages.length} messages, timeout: ${this.timeout}ms`)
    }

    try {
      const result = streamText({
        model: this.model,
        system: systemPrompt,
        messages: coreMessages,
        tools: toolDefs,
        maxSteps: 1,  // 单步执行，工具调用由 agent 循环处理
        maxTokens: 32000,  // 与 OpenCode 保持一致
        temperature: 0.2,
        abortSignal: controller.signal,
      })

      let fullContent = ""
      let fullReasoning = ""
      const toolCalls: ToolCall[] = []

      const streamResult = await result

      // 处理流式响应
      for await (const delta of streamResult.fullStream) {
        // 收到数据，重置超时
        clearTimeout(timeoutId)
        timeoutId.refresh()

        switch (delta.type) {
          case "text-delta":
            fullContent += delta.textDelta
            callbacks.onTextDelta?.(delta.textDelta)
            break

          case "reasoning":
            // 处理思考过程增量（MiniMax、DeepSeek 等模型支持）
            // AI SDK 使用 type: 'reasoning' + textDelta 属性
            fullReasoning += delta.textDelta
            callbacks.onReasoningDelta?.(delta.textDelta)
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

          case "error":
            throw new Error(`LLM Stream Error: ${JSON.stringify(delta.error || delta)}`)
        }
      }

      clearTimeout(timeoutId)
      this.currentAbortController = null

      return {
        content: fullContent || (await streamResult.text),
        reasoning: fullReasoning || undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        finishReason: await streamResult.finishReason,
      }
    } catch (error: any) {
      clearTimeout(timeoutId)
      this.currentAbortController = null

      // 处理用户取消
      if (error.name === "AbortError" && controller.signal.aborted) {
        throw new Error(`Request cancelled by user`)
      }

      // 处理其他错误
      if (process.env.DEBUG_LLM === "1") {
        console.error(`[LLM] Stream error:`, error)
      }
      throw error
    }
  }

  /**
   * 估算消息的 token 数量（简单估算：1 token ≈ 4 字符）
   */
  estimateTokens(messages: Message[]): number {
    let total = 0
    for (const msg of messages) {
      total += Math.ceil((msg.content?.length || 0) / 4)
      total += Math.ceil((msg.reasoning?.length || 0) / 4)  // 包含思考过程
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
   * 检查是否需要压缩上下文
   */
  needsCompression(messages: Message[]): boolean {
    const { percentage } = this.getContextUsage(messages)
    return percentage >= COMPRESSION_THRESHOLD
  }

  /**
   * 压缩上下文：基于模型容量百分比触发
   * @param messages - 要压缩的消息列表
   * @param threshold - 压缩阈值（0-1）
   * @param compactionPrompt - 可选的自定义压缩提示
   */
  async compressContext(
    messages: Message[],
    threshold: number = COMPRESSION_THRESHOLD,
    compactionPrompt?: string
  ): Promise<Message[]> {
    const { used, limit, percentage } = this.getContextUsage(messages)

    // 未达到阈值，无需压缩
    if (percentage < threshold) {
      return messages
    }

    console.log(`\n📦 Compressing context (${Math.round(percentage * 100)}% used: ${used}/${limit} tokens)...`)

    // 消息太少，无法压缩
    if (messages.length <= 4) {
      console.log(`  ⚠️ Too few messages to compress`)
      return messages
    }

    // 策略：保留第一条用户消息 + 最近的消息
    // 中间部分让 LLM 生成摘要
    const keepFirst = 2  // 保留前 2 条
    const keepLast = 6   // 保留后 6 条

    if (messages.length <= keepFirst + keepLast) {
      console.log(`  ⚠️ Not enough messages to compress`)
      return messages
    }

    // 需要压缩的中间部分
    const toCompress = messages.slice(keepFirst, -keepLast)

    // 生成摘要
    const summaryContent = toCompress
      .map(m => `[${m.role}]: ${m.content?.slice(0, 500)}...`)
      .join('\n\n')

    try {
      // 使用快速模型生成摘要
      const fastModel = this.provider(
        process.env.ANTHROPIC_SMALL_FAST_MODEL ||
        process.env.ANTHROPIC_MODEL ||
        this.modelId
      )

      const summaryResult = await generateText({
        model: fastModel,
        messages: [{
          role: "user",
          content: `${compactionPrompt || `Please summarize the following conversation history concisely.
Keep key information, decisions, file changes, and context needed for continuing the conversation.`}

${summaryContent}

Provide a brief summary:`
        }],
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

      const newUsage = this.getContextUsage(compressed)
      console.log(`  ✅ Compressed to ${Math.round(newUsage.percentage * 100)}% (${newUsage.used}/${limit} tokens, ${compressed.length} messages)`)

      return compressed
    } catch (error) {
      console.log(`  ⚠️ Compression failed, keeping original messages`)
      return messages
    }
  }

  private convertMessages(messages: Message[]): CoreMessage[] {
    return messages.map((m) => {
      // 处理工具结果消息
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

      // 处理 assistant 消息（可能包含 toolCalls）
      if (m.role === "assistant" && m.toolCalls?.length) {
        // 构建包含文本和工具调用的 content 数组
        const content: Array<any> = []

        // 添加文本内容
        if (m.content) {
          content.push({ type: "text", text: m.content })
        }

        // 添加工具调用
        for (const tc of m.toolCalls) {
          content.push({
            type: "tool-call",
            toolCallId: tc.id,
            toolName: tc.name,
            args: tc.arguments,
          })
        }

        return {
          role: "assistant",
          content,
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
