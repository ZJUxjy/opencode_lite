/**
 * FC Runner - Function Calling 策略实现
 *
 * 使用模型原生的工具调用能力
 *
 * 参考: dify fc_agent_runner.py
 */

import type { Message, ToolCall, ToolDefinition, Context } from "../types.js"
import type { Runner, ReActEvents } from "./types.js"
import { LLMClient } from "../llm.js"
import { ToolRegistry } from "../tools/index.js"
import { LoopDetectionService } from "../loopDetection.js"
import { PolicyEngine, type PolicyDecision, type PolicyResult } from "../policy.js"
import { getErrorMessage } from "../utils/error.js"

/**
 * FC Runner 配置
 */
export interface FCRunnerConfig {
  /** 最大迭代次数 */
  maxIterations?: number
  /** 是否启用流式输出 */
  enableStreaming?: boolean
  /** 工作目录 */
  cwd?: string
  /** 外部循环检测服务（用于状态共享） */
  loopDetection?: LoopDetectionService
  /** 外部策略引擎（用于状态共享） */
  policyEngine?: PolicyEngine
  /** Plan Mode 状态同步回调 */
  setPlanMode?: (enabled: boolean) => void
  /** 计划文件路径同步回调 */
  setPlanFilePath?: (path: string | null) => void
}

/**
 * FC Runner - Function Calling 策略
 *
 * 使用模型原生的函数调用能力，通过 tools 参数传递工具定义
 */
export class FCRunner implements Runner {
  private llm: LLMClient
  private tools: ToolRegistry
  private loopDetection: LoopDetectionService
  private policyEngine: PolicyEngine
  private config: FCRunnerConfig
  private events: ReActEvents = {}
  private cwd: string

  constructor(
    llm: LLMClient,
    tools: ToolRegistry,
    config: FCRunnerConfig = {}
  ) {
    this.llm = llm
    this.tools = tools
    // 使用外部注入的实例（保持状态一致性），否则创建新实例
    this.loopDetection = config.loopDetection ?? new LoopDetectionService()
    this.policyEngine = config.policyEngine ?? new PolicyEngine()
    this.config = {
      maxIterations: 50,
      enableStreaming: true,
      cwd: process.cwd(),
      ...config,
    }
    this.cwd = this.config.cwd || process.cwd()
  }

  /**
   * 设置事件回调
   */
  setEvents(events: ReActEvents): void {
    this.events = events
  }

  /**
   * 设置策略引擎
   */
  setPolicyEngine(engine: PolicyEngine): void {
    this.policyEngine = engine
  }

  /**
   * 执行 FC 循环
   */
  async run(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string
  ): Promise<string> {
    // 创建副本以避免修改调用方的数组（避免副作用）
    let workingMessages = [...messages]
    let iterations = 0
    const maxIterations = this.config.maxIterations || 50

    while (iterations < maxIterations) {
      iterations++
      this.loopDetection.incrementTurn()
      this.events.onThinking?.()

      // 1. 调用 LLM（FC 模式）
      let response
      try {
        if (this.config.enableStreaming) {
          response = await this.llm.chatStream(
            workingMessages,
            tools,
            {
              onTextDelta: (text) => this.events.onThought?.(text),
              onToolCall: (toolCall) => this.events.onToolCall?.(toolCall),
            },
            systemPrompt
          )
        } else {
          response = await this.llm.chat(workingMessages, tools, systemPrompt)
        }
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error)
        this.events.onResponse?.(`Error: ${errorMessage}`)
        return `Error: ${errorMessage}`
      }

      // 2. 循环检测：检查内容重复
      if (response.content) {
        const contentLoopResult = this.loopDetection.checkContentLoop(response.content)
        if (contentLoopResult.detected) {
          this.events.onLoopDetected?.(contentLoopResult.type!, contentLoopResult.message)
          return `${response.content}\n\n[系统检测到可能的循环，已终止。]`
        }
      }

      // 3. 循环检测：检查工具调用
      if (response.toolCalls?.length) {
        for (const toolCall of response.toolCalls) {
          const toolLoopResult = this.loopDetection.checkToolCallLoop(toolCall)
          if (toolLoopResult.detected) {
            this.events.onLoopDetected?.(toolLoopResult.type!, toolLoopResult.message)
            return `[系统检测到工具调用循环：${toolCall.name} 连续调用了太多次。]`
          }
        }
      }

      // 4. 添加 assistant 消息（修改副本而非原始数组）
      workingMessages.push({
        role: "assistant",
        content: response.content,
        reasoning: response.reasoning,
        toolCalls: response.toolCalls,
      })

      // 5. 没有工具调用，结束
      if (!response.toolCalls?.length) {
        this.events.onResponse?.(response.content)
        return response.content
      }

      // 6. 执行工具
      const toolResults = await this.executeTools(response.toolCalls)

      // 7. 添加工具结果消息（修改副本而非原始数组）
      workingMessages.push({
        role: "user",
        content: "",
        toolResults,
      })
    }

    return "Maximum iterations reached"
  }

  /**
   * 执行工具调用
   */
  private async executeTools(toolCalls: ToolCall[]): Promise<Array<{
    toolCallId: string
    content: string
    isError?: boolean
  }>> {
    const results: Array<{
      toolCallId: string
      content: string
      isError?: boolean
    }> = []

    const ctx: Context = {
      cwd: this.cwd,
      messages: [],
      setPlanMode: this.config.setPlanMode,
      setPlanFilePath: this.config.setPlanFilePath,
    }

    for (const call of toolCalls) {
      // 触发工具调用事件
      this.events.onToolCall?.(call)

      // 策略检查
      const policyResult = this.policyEngine.check(call.name, call.arguments)

      if (policyResult.decision === "deny") {
        // 直接拒绝
        results.push({
          toolCallId: call.id,
          content: `Permission denied: ${policyResult.reason}`,
          isError: true,
        })
        continue
      }

      // 获取工具
      const tool = this.tools.get(call.name)

      if (!tool) {
        results.push({
          toolCallId: call.id,
          content: `Error: Unknown tool '${call.name}'`,
          isError: true,
        })
        continue
      }

      // 执行工具
      try {
        const content = await tool.execute(call.arguments, ctx)
        results.push({ toolCallId: call.id, content })
        this.events.onToolResult?.(call, content)
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error)
        results.push({
          toolCallId: call.id,
          content: `Error: ${errorMessage}`,
          isError: true,
        })
        this.events.onToolResult?.(call, `Error: ${errorMessage}`)
      }
    }

    return results
  }

  /**
   * 重置循环检测状态
   */
  reset(): void {
    this.loopDetection.reset()
  }
}
