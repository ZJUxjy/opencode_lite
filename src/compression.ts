/**
 * 上下文压缩服务
 *
 * Phase 4 增强：
 * - 渐进式压缩恢复：压缩失败时逐步移除更多内容
 * - 非破坏性压缩：消息标记而非删除
 * - 多级压缩策略
 * - LLM 生成高质量摘要
 * - 压缩预览功能
 *
 * 参考: gemini-cli ChatCompressionService, goose context_mgmt
 */

import type { Message } from "./types.js"
import { LLMClient } from "./llm.js"

/**
 * 压缩级别
 */
export type CompressionLevel = "light" | "moderate" | "aggressive"

/**
 * 压缩结果
 */
export interface CompressionResult {
  messages: Message[]
  level: CompressionLevel
  originalCount: number
  compressedCount: number
  removedIndices: number[]
  summaryGenerated: boolean
  /** 压缩前的 token 数 */
  originalTokens: number
  /** 压缩后的 token 数 */
  compressedTokens: number
}

/**
 * 压缩预览信息
 */
export interface CompressionPreview {
  currentTokens: number
  currentPercentage: number
  messageCount: number
  wouldCompress: boolean
  levels: {
    level: CompressionLevel
    keepFirst: number
    keepLast: number
    wouldRemove: number
    estimatedTokens: number
  }[]
}

/**
 * 压缩配置
 */
export interface CompressionConfig {
  /** 压缩阈值 (0-1) */
  threshold: number
  /** 轻度压缩保留的消息数 */
  lightKeepFirst: number
  lightKeepLast: number
  /** 中度压缩保留的消息数 */
  moderateKeepFirst: number
  moderateKeepLast: number
  /** 激进压缩保留的消息数 */
  aggressiveKeepFirst: number
  aggressiveKeepLast: number
  /** 是否使用 LLM 生成摘要 */
  useLlmSummary: boolean
  /** 最大压缩尝试次数 */
  maxAttempts: number
}

const DEFAULT_CONFIG: CompressionConfig = {
  threshold: 0.92,
  lightKeepFirst: 2,
  lightKeepLast: 6,
  moderateKeepFirst: 1,
  moderateKeepLast: 4,
  aggressiveKeepFirst: 1,
  aggressiveKeepLast: 2,
  useLlmSummary: true,
  maxAttempts: 3,
}

/**
 * 上下文压缩服务
 */
export class CompressionService {
  private config: CompressionConfig
  private llm: LLMClient
  private compactionPrompt: string

  constructor(llm: LLMClient, config: Partial<CompressionConfig> = {}) {
    this.llm = llm
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.compactionPrompt = `Please summarize the following conversation history concisely.
Keep key information, decisions, file changes, and context needed for continuing the conversation.
Focus on:
- User's original request and goals
- Key decisions made
- Files that were read, modified, or created
- Any errors encountered and how they were resolved
- Current state of the task

Format the summary as bullet points. Be concise but comprehensive.`
  }

  /**
   * 设置压缩提示
   */
  setCompactionPrompt(prompt: string): void {
    this.compactionPrompt = prompt
  }

  /**
   * 获取压缩预览（不执行压缩）
   */
  getPreview(messages: Message[]): CompressionPreview {
    const usage = this.llm.getContextUsage(messages)
    const levels: CompressionPreview["levels"] = []

    const levelConfigs: { level: CompressionLevel; keepFirst: number; keepLast: number }[] = [
      { level: "light", keepFirst: this.config.lightKeepFirst, keepLast: this.config.lightKeepLast },
      { level: "moderate", keepFirst: this.config.moderateKeepFirst, keepLast: this.config.moderateKeepLast },
      { level: "aggressive", keepFirst: this.config.aggressiveKeepFirst, keepLast: this.config.aggressiveKeepLast },
    ]

    for (const { level, keepFirst, keepLast } of levelConfigs) {
      const wouldRemove = Math.max(0, messages.length - keepFirst - keepLast)
      const keptMessages = messages.length <= keepFirst + keepLast
        ? messages
        : [...messages.slice(0, keepFirst), ...messages.slice(-keepLast)]

      // 估算摘要大小（约 500 tokens）
      const summaryTokens = 500
      const estimatedTokens = this.llm.estimateTokens(keptMessages) + summaryTokens

      levels.push({
        level,
        keepFirst,
        keepLast,
        wouldRemove,
        estimatedTokens,
      })
    }

    return {
      currentTokens: usage.used,
      currentPercentage: Math.round(usage.percentage * 100),
      messageCount: messages.length,
      wouldCompress: usage.percentage >= this.config.threshold,
      levels,
    }
  }

  /**
   * 执行压缩（带渐进式恢复）
   */
  async compress(messages: Message[]): Promise<CompressionResult> {
    const usage = this.llm.getContextUsage(messages)
    const originalTokens = usage.used

    // 未达到阈值，无需压缩
    if (usage.percentage < this.config.threshold) {
      return {
        messages,
        level: "light",
        originalCount: messages.length,
        compressedCount: messages.length,
        removedIndices: [],
        summaryGenerated: false,
        originalTokens,
        compressedTokens: originalTokens,
      }
    }

    console.log(`\n📦 Compressing context (${Math.round(usage.percentage * 100)}% used)...`)

    // 尝试不同级别的压缩
    const levels: CompressionLevel[] = ["light", "moderate", "aggressive"]

    for (const level of levels) {
      const result = await this.tryCompress(messages, level)

      // 检查压缩后的使用率是否低于阈值
      const newUsage = this.llm.getContextUsage(result.messages)

      if (newUsage.percentage < this.config.threshold) {
        console.log(`  ✅ Compressed with ${level} level to ${Math.round(newUsage.percentage * 100)}%`)
        return {
          ...result,
          compressedTokens: newUsage.used,
        }
      }

      console.log(`  ⚠️ ${level} compression insufficient (${Math.round(newUsage.percentage * 100)}%), trying next level...`)
    }

    // 所有级别都尝试过，返回激进压缩结果
    const finalResult = await this.tryCompress(messages, "aggressive")
    const finalUsage = this.llm.getContextUsage(finalResult.messages)
    console.log(`  ⚠️ Max compression reached`)
    return {
      ...finalResult,
      compressedTokens: finalUsage.used,
    }
  }

  /**
   * 手动压缩（使用指定级别）
   */
  async compressWithLevel(
    messages: Message[],
    level: CompressionLevel
  ): Promise<CompressionResult> {
    const usage = this.llm.getContextUsage(messages)
    const result = await this.tryCompress(messages, level)
    const newUsage = this.llm.getContextUsage(result.messages)

    return {
      ...result,
      originalTokens: usage.used,
      compressedTokens: newUsage.used,
    }
  }

  /**
   * 尝试指定级别的压缩
   */
  private async tryCompress(
    messages: Message[],
    level: CompressionLevel
  ): Promise<CompressionResult> {
    const { keepFirst, keepLast } = this.getKeepCounts(level)

    // 消息太少，无法压缩
    if (messages.length <= keepFirst + keepLast) {
      return {
        messages,
        level,
        originalCount: messages.length,
        compressedCount: messages.length,
        removedIndices: [],
        summaryGenerated: false,
        originalTokens: 0,
        compressedTokens: 0,
      }
    }

    // 需要压缩的中间部分
    const toCompress = messages.slice(keepFirst, -keepLast)
    const removedIndices = Array.from(
      { length: toCompress.length },
      (_, i) => keepFirst + i
    )

    // 生成摘要并替换（返回新数组，不修改原始 messages）
    return this.buildCompressedMessages(messages, toCompress, keepFirst, keepLast, level, removedIndices)
  }

  /**
   * 构建压缩后的消息数组：生成摘要消息并替换中间部分（返回新数组，非破坏性）
   */
  private async buildCompressedMessages(
    messages: Message[],
    toCompress: Message[],
    keepFirst: number,
    keepLast: number,
    level: CompressionLevel,
    removedIndices: number[]
  ): Promise<CompressionResult> {
    // 生成摘要
    const summary = await this.generateSummary(toCompress, level)

    // 创建摘要消息
    const summaryMessage: Message = {
      role: "assistant",
      content: `[Context Summary - ${level}]\n${summary}`,
    }

    // 组合：前几条 + 摘要 + 后几条
    const compressed = [
      ...messages.slice(0, keepFirst),
      summaryMessage,
      ...messages.slice(-keepLast),
    ]

    return {
      messages: compressed,
      level,
      originalCount: messages.length,
      compressedCount: compressed.length,
      removedIndices,
      summaryGenerated: true,
      originalTokens: 0,
      compressedTokens: 0,
    }
  }

  /**
   * 生成摘要（使用 LLM 或简单格式化）
   */
  private async generateSummary(messages: Message[], level: CompressionLevel): Promise<string> {
    // 准备消息内容
    const summaryContent = messages
      .map(m => {
        const content = (m.content || "").slice(0, 500)
        const toolCalls = m.toolCalls?.map(tc => `[${tc.name}]`).join(" ") || ""
        return `[${m.role}]: ${content}${toolCalls ? ` ${toolCalls}` : ""}`
      })
      .join('\n\n')

    if (this.config.useLlmSummary) {
      try {
        // 使用 LLM 生成高质量摘要
        const summary = await this.generateLlmSummary(summaryContent, level)
        return summary
      } catch (error) {
        console.log(`  ⚠️ LLM summary failed, using simple summary`)
        return this.formatSimpleSummary(messages)
      }
    }

    return this.formatSimpleSummary(messages)
  }

  /**
   * 使用 LLM 生成摘要
   *
   * 使用 LLMClient 的当前 provider，而不是硬编码 Anthropic
   */
  private async generateLlmSummary(content: string, level: CompressionLevel): Promise<string> {
    const levelInstruction = level === "aggressive"
      ? "Be extremely concise - use only 2-3 bullet points."
      : level === "moderate"
        ? "Be concise - use 3-5 bullet points."
        : "Use 5-8 bullet points to capture important details."

    const prompt = `${this.compactionPrompt}

${levelInstruction}

Conversation to summarize:
${content}

Summary:`

    const maxTokens = level === "aggressive" ? 300 : level === "moderate" ? 500 : 800

    // 使用 LLMClient 的当前 provider，而不是硬编码 Anthropic
    return this.llm.generateTextForCompression(prompt, maxTokens)
  }

  /**
   * 格式化简单摘要（不调用 LLM）
   */
  private formatSimpleSummary(messages: Message[]): string {
    const userMessages = messages.filter(m => m.role === "user")
    const assistantMessages = messages.filter(m => m.role === "assistant")

    const toolCalls = assistantMessages
      .filter(m => m.toolCalls?.length)
      .flatMap(m => m.toolCalls || [])
      .map(tc => tc.name)

    const uniqueTools = [...new Set(toolCalls)]
    const keywords = this.extractKeywords(messages)

    const lines = [
      `• ${messages.length} messages (${userMessages.length} user, ${assistantMessages.length} assistant)`,
    ]

    if (uniqueTools.length > 0) {
      lines.push(`• Tools used: ${uniqueTools.slice(0, 5).join(", ")}${uniqueTools.length > 5 ? "..." : ""}`)
    }

    if (keywords) {
      lines.push(`• Key topics: ${keywords}`)
    }

    return lines.join('\n')
  }

  /**
   * 提取关键词
   */
  private extractKeywords(messages: Message[]): string {
    const allContent = messages.map(m => m.content || "").join(" ")
    const words = allContent.toLowerCase().split(/\W+/)
    const stopWords = new Set([
      "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
      "have", "has", "had", "do", "does", "did", "will", "would", "could",
      "should", "may", "might", "must", "shall", "can", "need", "dare",
      "ought", "used", "to", "of", "in", "for", "on", "with", "at", "by",
      "from", "as", "into", "through", "during", "before", "after", "above",
      "below", "between", "under", "again", "further", "then", "once",
      "here", "there", "when", "where", "why", "how", "all", "each", "few",
      "more", "most", "other", "some", "such", "no", "nor", "not", "only",
      "own", "same", "so", "than", "too", "very", "just", "and", "but",
      "if", "or", "because", "until", "while", "this", "that", "these",
      "those", "i", "you", "he", "she", "it", "we", "they", "what", "which",
      "who", "whom", "file", "code", "function", "let", "const", "return",
    ])

    const freq: Record<string, number> = {}
    for (const word of words) {
      if (word.length > 3 && !stopWords.has(word)) {
        freq[word] = (freq[word] || 0) + 1
      }
    }

    const sorted = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word)

    return sorted.join(", ") || ""
  }

  /**
   * 获取指定级别的保留消息数
   */
  private getKeepCounts(level: CompressionLevel): { keepFirst: number; keepLast: number } {
    switch (level) {
      case "light":
        return {
          keepFirst: this.config.lightKeepFirst,
          keepLast: this.config.lightKeepLast,
        }
      case "moderate":
        return {
          keepFirst: this.config.moderateKeepFirst,
          keepLast: this.config.moderateKeepLast,
        }
      case "aggressive":
        return {
          keepFirst: this.config.aggressiveKeepFirst,
          keepLast: this.config.aggressiveKeepLast,
        }
    }
  }

  /**
   * 检查是否需要压缩
   */
  needsCompression(messages: Message[]): boolean {
    const { percentage } = this.llm.getContextUsage(messages)
    return percentage >= this.config.threshold
  }

  /**
   * 获取压缩配置
   */
  getConfig(): CompressionConfig {
    return { ...this.config }
  }

  /**
   * 更新压缩配置
   */
  updateConfig(config: Partial<CompressionConfig>): void {
    this.config = { ...this.config, ...config }
  }
}
