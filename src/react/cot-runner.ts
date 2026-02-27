/**
 * CoT Runner - Chain-of-Thought 策略实现
 *
 * 使用 ReAct (Reasoning + Acting) 模式
 *
 * 参考: dify cot_agent_runner.py
 */

import type { Message, ToolCall, ToolDefinition, Context } from "../types.js"
import type { Runner, ReActEvents, Action } from "./types.js"
import { LLMClient } from "../llm.js"
import { ToolRegistry } from "../tools/index.js"
import { ReActParser } from "./parser.js"
import { ScratchpadManager } from "./scratchpad.js"
import { LoopDetectionService } from "../loopDetection.js"
import { PolicyEngine } from "../policy.js"

/**
 * CoT Runner 配置
 */
export interface CoTRunnerConfig {
  /** 最大迭代次数 */
  maxIterations?: number
  /** 是否启用流式输出 */
  enableStreaming?: boolean
  /** 工作目录 */
  cwd?: string
  /** 停止词 */
  stopWords?: string[]
}

/**
 * 默认停止词
 */
const DEFAULT_STOP_WORDS = ["Observation:", "Observation ："]

/**
 * CoT Runner - Chain-of-Thought 策略
 *
 * 使用 ReAct 模式，通过 Prompt 模板指导模型输出 Thought/Action 格式
 */
export class CoTRunner implements Runner {
  private llm: LLMClient
  private tools: ToolRegistry
  private parser: ReActParser
  private scratchpad: ScratchpadManager
  private loopDetection: LoopDetectionService
  private policyEngine: PolicyEngine
  private config: CoTRunnerConfig
  private events: ReActEvents = {}
  private cwd: string

  constructor(
    llm: LLMClient,
    tools: ToolRegistry,
    config: CoTRunnerConfig = {}
  ) {
    this.llm = llm
    this.tools = tools
    this.parser = new ReActParser()
    this.scratchpad = new ScratchpadManager()
    this.loopDetection = new LoopDetectionService()
    this.policyEngine = new PolicyEngine()
    this.config = {
      maxIterations: 50,
      enableStreaming: true,
      cwd: process.cwd(),
      stopWords: DEFAULT_STOP_WORDS,
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
   * 执行 CoT 循环
   */
  async run(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string
  ): Promise<string> {
    // 重置状态
    this.scratchpad.reset()
    this.loopDetection.reset()

    // 构建 ReAct Prompt
    const reactPrompt = this.buildReActPrompt(tools, systemPrompt)

    let iterations = 0
    const maxIterations = this.config.maxIterations || 50

    while (iterations < maxIterations) {
      iterations++
      this.loopDetection.incrementTurn()
      this.events.onThinking?.()

      // 1. 构建带 scratchpad 的消息
      const messagesWithScratchpad = this.addScratchpad(messages)

      // 2. 调用 LLM（CoT 模式，不传递工具）
      let response
      try {
        response = await this.llm.chatStream(
          messagesWithScratchpad,
          [], // CoT 模式不传递工具定义
          {
            onTextDelta: (text) => this.events.onThought?.(text),
          },
          reactPrompt
        )
      } catch (error: any) {
        this.events.onResponse?.(`Error: ${error.message}`)
        return `Error: ${error.message}`
      }

      // 3. 解析 ReAct 输出
      const { thought, action } = this.parser.parse(response.content)

      // 4. 记录思考过程
      if (thought) {
        this.scratchpad.add({ thought })
      }

      // 5. 循环检测
      if (response.content) {
        const contentLoopResult = this.loopDetection.checkContentLoop(response.content)
        if (contentLoopResult.detected) {
          this.events.onLoopDetected?.(contentLoopResult.type!, contentLoopResult.message)
          return `${response.content}\n\n[系统检测到可能的循环，已终止。]`
        }
      }

      // 6. 检查是否为最终答案或无 Action
      if (!action) {
        // 没有解析出 Action，直接返回内容
        this.events.onResponse?.(response.content)
        return response.content
      }

      if (this.isFinalAnswer(action)) {
        // 是最终答案
        this.scratchpad.setAction(action)
        this.scratchpad.completeCurrentUnit()

        const finalAnswer = typeof action.input === "string"
          ? action.input
          : JSON.stringify(action.input)

        this.events.onResponse?.(finalAnswer)
        return finalAnswer
      }

      // 7. 记录 Action
      this.scratchpad.setAction(action)
      this.events.onAction?.(action)

      // 8. 策略检查
      const policyResult = this.policyEngine.check(action.name, action.input as Record<string, unknown>)
      if (policyResult.decision === "deny") {
        const observation = `Permission denied: ${policyResult.reason}`
        this.scratchpad.addObservation(observation)
        this.events.onObservation?.(observation)
        continue
      }

      // 9. 执行工具
      const observation = await this.executeTool(action)
      this.scratchpad.addObservation(observation)
      this.events.onObservation?.(observation)

      // 10. 循环检测
      const toolLoopResult = this.loopDetection.checkToolCallLoop({
        id: `cot-${iterations}`,
        name: action.name,
        arguments: typeof action.input === "object" ? action.input : { input: action.input },
      })
      if (toolLoopResult.detected) {
        this.events.onLoopDetected?.(toolLoopResult.type!, toolLoopResult.message)
        return `[系统检测到工具调用循环：${action.name} 连续调用了太多次。]`
      }
    }

    return "Maximum iterations reached"
  }

  /**
   * 构建 ReAct Prompt
   */
  private buildReActPrompt(
    tools: ToolDefinition[],
    systemPrompt: string
  ): string {
    const toolNames = tools.map(t => t.name).join(", ")
    const toolDescriptions = tools
      .map((t) => `- ${t.name}: ${t.description.split("\n")[0]}`)
      .join("\n")

    return `${systemPrompt}

## Available Tools

${toolDescriptions}

## Response Format

You must respond in the following ReAct format:

Thought: Think about what to do next, consider previous steps and current state
Action:
\`\`\`json
{
  "action": "tool_name",
  "action_input": { "param": "value" }
}
\`\`\`

When you have the final answer for the user, use:

Thought: I now know the final answer
Action:
\`\`\`json
{
  "action": "Final Answer",
  "action_input": "Your final response to the user"
}
\`\`\`

Valid action values: "Final Answer" or ${toolNames}

IMPORTANT:
- Always use exactly ONE action per response
- Always use valid JSON format for the action
- Think step by step before each action
`
  }

  /**
   * 添加 Scratchpad 到消息
   */
  private addScratchpad(messages: Message[]): Message[] {
    const scratchpadText = this.scratchpad.format()

    if (!scratchpadText) {
      return messages
    }

    // 在最后添加 scratchpad 作为上下文
    return [
      ...messages,
      {
        role: "user" as const,
        content: `\nPrevious steps:\n${scratchpadText}\nContinue with the next step. Thought:`,
      },
    ]
  }

  /**
   * 执行工具
   */
  private async executeTool(action: Action): Promise<string> {
    const tool = this.tools.get(action.name)

    if (!tool) {
      return `Error: Unknown tool '${action.name}'`
    }

    const ctx: Context = { cwd: this.cwd, messages: [] }
    const args = typeof action.input === "object" ? action.input : { input: action.input }

    // 触发工具调用事件
    this.events.onToolCall?.({
      id: `cot-${Date.now()}`,
      name: action.name,
      arguments: args,
    })

    try {
      const result = await tool.execute(args, ctx)
      this.events.onToolResult?.(
        { id: `cot-${Date.now()}`, name: action.name, arguments: args },
        result
      )
      return result
    } catch (error: any) {
      const errorMsg = `Error: ${error.message}`
      this.events.onToolResult?.(
        { id: `cot-${Date.now()}`, name: action.name, arguments: args },
        errorMsg
      )
      return errorMsg
    }
  }

  /**
   * 检查是否为最终答案
   */
  private isFinalAnswer(action: Action): boolean {
    const name = action.name.toLowerCase()
    return name.includes("final") && name.includes("answer")
  }

  /**
   * 获取 Scratchpad（用于调试）
   */
  getScratchpad(): ScratchpadManager {
    return this.scratchpad
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.scratchpad.reset()
    this.loopDetection.reset()
    this.parser.reset()
  }
}
