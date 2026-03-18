/**
 * ReAct Runner - 策略路由器
 *
 * 根据模型能力和配置选择 FC 或 CoT 策略
 *
 * 参考: dify app_runner.py
 */

import type { Message, ToolDefinition } from "../types.js"
import type {
  Strategy,
  ReActConfig,
  ReActEvents,
  Runner,
  ModelCapabilities,
} from "./types.js"
import { LLMClient } from "../llm.js"
import { ToolRegistry } from "../tools/index.js"
import { LoopDetectionService } from "../loopDetection.js"
import { PolicyEngine } from "../policy.js"
import { FCRunner } from "./fc-runner.js"
import { CoTRunner } from "./cot-runner.js"

/**
 * 支持 FC 的模型关键词
 */
const FC_CAPABLE_MODELS = [
  "claude",
  "gpt-4",
  "gpt-3.5",
  "gemini",
  "qwen",
  "deepseek",
  "glm-4",
  "minimax",
  "doubao",
  "yi",
  "moonshot",
  "kimi",
  "glm-5",
  "nova"
]

/**
 * ReAct Runner - 策略路由器
 *
 * 根据模型能力自动选择最优策略：
 * - FC (Function Calling): 使用模型原生工具调用能力
 * - CoT (Chain-of-Thought): 使用 ReAct Prompt 模板
 */
export class ReActRunner implements Runner {
  private llm: LLMClient
  private tools: ToolRegistry
  private config: ReActConfig
  private events: ReActEvents = {}
  private loopDetection?: LoopDetectionService
  private policyEngine?: PolicyEngine

  // Runner 实例（懒加载）
  private fcRunner: FCRunner | null = null
  private cotRunner: CoTRunner | null = null

  constructor(
    llm: LLMClient,
    tools: ToolRegistry,
    config: ReActConfig = {},
    dependencies?: {
      loopDetection?: LoopDetectionService
      policyEngine?: PolicyEngine
    }
  ) {
    this.llm = llm
    this.tools = tools
    this.config = {
      strategy: "auto",
      maxIterations: 50,
      enableStreaming: true,
      ...config,
    }
    this.loopDetection = dependencies?.loopDetection
    this.policyEngine = dependencies?.policyEngine
  }

  /**
   * 设置事件回调
   */
  setEvents(events: ReActEvents): void {
    this.events = events
    // 同步到子 Runner
    if (this.fcRunner) {
      this.fcRunner.setEvents(events)
    }
    if (this.cotRunner) {
      this.cotRunner.setEvents(events)
    }
  }

  /**
   * 执行 ReAct 循环
   */
  async run(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string
  ): Promise<string> {
    const strategy = this.selectStrategy()

    console.log(`🎯 ReAct strategy: ${strategy.toUpperCase()}`)

    if (strategy === "fc") {
      return this.getFCRunner().run(messages, tools, systemPrompt)
    } else {
      return this.getCoTRunner().run(messages, tools, systemPrompt)
    }
  }

  /**
   * 选择策略
   */
  selectStrategy(): "fc" | "cot" {
    // 手动指定策略
    if (this.config.strategy === "fc") return "fc"
    if (this.config.strategy === "cot") return "cot"

    // auto 模式：基于模型能力自动选择
    return this.detectModelCapability() ? "fc" : "cot"
  }

  /**
   * 检测模型能力
   *
   * @returns 是否支持 FC
   */
  detectModelCapability(): boolean {
    const capabilities = this.getModelCapabilities()
    return capabilities.toolCall
  }

  /**
   * 获取模型能力详情
   */
  getModelCapabilities(): ModelCapabilities {
    const modelId = this.llm.getModelId().toLowerCase()

    // 检查是否支持 FC
    const toolCall = FC_CAPABLE_MODELS.some((model) => modelId.includes(model))

    // 特殊处理：某些模型名称可能误导
    const excludePatterns = ["legacy", "old", "v1", "base"]
    const isExcluded = excludePatterns.some((p) => modelId.includes(p))

    return {
      toolCall: toolCall && !isExcluded,
      multiToolCall: toolCall && !isExcluded,
      streamToolCall: toolCall && !isExcluded,
      stopWords: true, // 大多数模型都支持停止词
    }
  }

  /**
   * 获取当前策略
   */
  getCurrentStrategy(): "fc" | "cot" {
    return this.selectStrategy()
  }

  /**
   * 获取 FC Runner（懒加载）
   */
  getFCRunner(): FCRunner {
    if (!this.fcRunner) {
      this.fcRunner = new FCRunner(this.llm, this.tools, {
        maxIterations: this.config.maxIterations,
        enableStreaming: this.config.enableStreaming,
        loopDetection: this.loopDetection,
        policyEngine: this.policyEngine,
      })
      this.fcRunner.setEvents(this.events)
    }
    return this.fcRunner
  }

  /**
   * 获取 CoT Runner（懒加载）
   */
  getCoTRunner(): CoTRunner {
    if (!this.cotRunner) {
      this.cotRunner = new CoTRunner(this.llm, this.tools, {
        maxIterations: this.config.maxIterations,
        enableStreaming: this.config.enableStreaming,
        stopWords: this.config.stopWords,
        loopDetection: this.loopDetection,
        policyEngine: this.policyEngine,
      })
      this.cotRunner.setEvents(this.events)
    }
    return this.cotRunner
  }

  /**
   * 重置状态
   */
  reset(): void {
    if (this.fcRunner) {
      this.fcRunner.reset()
    }
    if (this.cotRunner) {
      this.cotRunner.reset()
    }
  }

  /**
   * 获取配置
   */
  getConfig(): ReActConfig {
    return { ...this.config }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ReActConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    }

    // 更新子 Runner 配置
    if (this.fcRunner && config.maxIterations !== undefined) {
      // FCRunner 需要重新创建来更新配置
      this.fcRunner = null
    }
    if (this.cotRunner && (config.maxIterations !== undefined || config.stopWords !== undefined)) {
      // CoTRunner 需要重新创建来更新配置
      this.cotRunner = null
    }
  }
}
