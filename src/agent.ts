import type { Message, ToolCall, Context } from "./types.js"
import { LLMClient, type LLMConfig } from "./llm.js"
import { ToolRegistry } from "./tools/index.js"
import { MessageStore } from "./store.js"
import { LoopDetectionService, type LoopDetectionConfig } from "./loopDetection.js"
import { PolicyEngine, type PolicyConfig, type PolicyDecision, type PolicyResult } from "./policy.js"

export interface AgentConfig {
  cwd: string
  dbPath: string
  llm?: LLMConfig
  enableStream?: boolean
  compressionThreshold?: number
  loopDetection?: LoopDetectionConfig
  policy?: PolicyConfig
}

export interface AgentEvents {
  onThinking?: () => void
  onTextDelta?: (text: string) => void
  onReasoningDelta?: (text: string) => void  // 思考过程增量
  onToolCall?: (toolCall: ToolCall) => void
  onToolResult?: (toolCall: ToolCall, result: string) => void
  onResponse?: (content: string, reasoning?: string) => void  // 添加 reasoning 参数
  onCompress?: (beforeTokens: number, afterTokens: number) => void
  onLoopDetected?: (type: string, message: string) => void
  onPolicyCheck?: (toolCall: ToolCall, result: PolicyResult) => void  // 策略检查
  onPolicyAsk?: (toolCall: ToolCall) => Promise<PolicyDecision>  // 询问用户决策
}

export class Agent {
  private llm: LLMClient
  private tools: ToolRegistry
  private store: MessageStore
  private loopDetection: LoopDetectionService
  private policyEngine: PolicyEngine
  private sessionId: string
  private cwd: string
  private enableStream: boolean
  private compressionThreshold: number
  private events: AgentEvents = {}

  constructor(sessionId: string, config: AgentConfig) {
    this.llm = new LLMClient(config.llm)
    this.tools = new ToolRegistry()
    this.store = new MessageStore(config.dbPath)
    this.loopDetection = new LoopDetectionService(config.loopDetection)
    this.policyEngine = new PolicyEngine(config.policy)
    this.sessionId = sessionId
    this.cwd = config.cwd
    this.enableStream = config.enableStream ?? true
    this.compressionThreshold = config.compressionThreshold ?? 0.92
  }

  setEvents(events: AgentEvents) {
    this.events = events
  }

  async run(userInput: string): Promise<string> {
    // 1. 添加用户消息
    this.store.add(this.sessionId, {
      role: "user",
      content: userInput,
    })

    // 2. 加载历史消息
    let messages = this.store.get(this.sessionId)

    // 3. 上下文压缩
    const beforeTokens = this.llm.estimateTokens(messages)
    messages = await this.llm.compressContext(messages, this.compressionThreshold)
    const afterTokens = this.llm.estimateTokens(messages)
    if (beforeTokens !== afterTokens) {
      this.events.onCompress?.(beforeTokens, afterTokens)
    }

    // 4. 循环调用 LLM
    let iterations = 0
    const MAX_ITERATIONS = 50  // 防止无限循环

    while (iterations < MAX_ITERATIONS) {
      iterations++
      this.loopDetection.incrementTurn()
      this.events.onThinking?.()

      let response
      try {
        if (this.enableStream) {
          response = await this.llm.chatStream(messages, this.tools.getDefinitions(), {
            onTextDelta: (text) => this.events.onTextDelta?.(text),
            onReasoningDelta: (text) => this.events.onReasoningDelta?.(text),
            onToolCall: (toolCall) => this.events.onToolCall?.(toolCall),
          })
        } else {
          response = await this.llm.chat(messages, this.tools.getDefinitions())
        }
      } catch (error: any) {
        // LLM 调用失败，返回错误
        this.events.onResponse?.(`Error: ${error.message}`)
        return `Error: ${error.message}`
      }

      // 4.1 循环检测：检查内容重复
      if (response.content) {
        const contentLoopResult = this.loopDetection.checkContentLoop(response.content)
        if (contentLoopResult.detected) {
          this.events.onLoopDetected?.(contentLoopResult.type!, contentLoopResult.message)
          console.log(`\n⚠️ ${contentLoopResult.message}`)
          // 返回当前内容，但添加警告
          return `${response.content}\n\n[系统检测到可能的循环，已终止。请尝试简化您的请求。]`
        }
      }

      // 4.2 循环检测：检查工具调用
      if (response.toolCalls?.length) {
        for (const toolCall of response.toolCalls) {
          const toolLoopResult = this.loopDetection.checkToolCallLoop(toolCall)
          if (toolLoopResult.detected) {
            this.events.onLoopDetected?.(toolLoopResult.type!, toolLoopResult.message)
            console.log(`\n⚠️ ${toolLoopResult.message}`)
            // 返回错误信息
            return `[系统检测到工具调用循环：${toolCall.name} 连续调用了太多次。请尝试不同的方法。]`
          }
        }
      }

      // 5. 添加 assistant 消息
      const assistantMsg: Message = {
        role: "assistant",
        content: response.content,
        reasoning: response.reasoning,  // 保存思考过程
        toolCalls: response.toolCalls,
      }
      messages.push(assistantMsg)
      this.store.add(this.sessionId, assistantMsg)

      // 6. 通知响应完成
      if (response.content) {
        this.events.onResponse?.(response.content, response.reasoning)
      }

      // 7. 没有工具调用，结束
      if (!response.toolCalls?.length) {
        return response.content
      }

      // 8. 执行工具并收集结果
      const toolResults = await this.executeTools(response.toolCalls)

      // 9. 添加工具结果消息
      const resultMsg: Message = {
        role: "user",
        content: "",
        toolResults,
      }
      messages.push(resultMsg)
      this.store.add(this.sessionId, resultMsg)

      // 10. 再次检查压缩
      const beforeTokens2 = this.llm.estimateTokens(messages)
      messages = await this.llm.compressContext(messages, this.compressionThreshold)
      const afterTokens2 = this.llm.estimateTokens(messages)
      if (beforeTokens2 !== afterTokens2) {
        this.events.onCompress?.(beforeTokens2, afterTokens2)
      }
    }

    // 达到最大迭代次数
    return "Reached maximum iteration limit. Please try a simpler request."
  }

  private async executeTool(call: ToolCall): Promise<string> {
    const tool = this.tools.get(call.name)
    if (!tool) {
      return `Error: Unknown tool '${call.name}'`
    }

    const ctx: Context = { cwd: this.cwd, messages: [] }
    try {
      return await tool.execute(call.arguments, ctx)
    } catch (error: any) {
      return `Error: ${error.message}`
    }
  }

  private async executeTools(toolCalls: ToolCall[]) {
    const results = []
    const ctx: Context = { cwd: this.cwd, messages: [] }

    for (const call of toolCalls) {
      // 触发工具调用事件
      this.events.onToolCall?.(call)

      // 策略检查
      const policyResult = this.policyEngine.check(call.name, call.arguments)
      this.events.onPolicyCheck?.(call, policyResult)

      if (policyResult.decision === "deny") {
        // 直接拒绝
        const denyResult = {
          toolCallId: call.id,
          content: `Permission denied: ${policyResult.reason}`,
          isError: true,
        }
        results.push(denyResult)
        this.events.onToolResult?.(call, denyResult.content)
        continue
      }

      if (policyResult.decision === "ask") {
        // 需要询问用户
        let userDecision: PolicyDecision
        if (this.events.onPolicyAsk) {
          userDecision = await this.events.onPolicyAsk(call)
        } else {
          // 没有询问回调，默认拒绝
          userDecision = "deny"
        }

        // 从用户决策中学习
        if (userDecision !== "ask") {
          this.policyEngine.learn(call.name, call.arguments, userDecision)
        }

        if (userDecision === "deny") {
          const denyResult = {
            toolCallId: call.id,
            content: `Permission denied by user`,
            isError: true,
          }
          results.push(denyResult)
          this.events.onToolResult?.(call, denyResult.content)
          continue
        }
      }

      const tool = this.tools.get(call.name)

      if (!tool) {
        const errorResult = {
          toolCallId: call.id,
          content: `Error: Unknown tool '${call.name}'`,
          isError: true,
        }
        results.push(errorResult)
        this.events.onToolResult?.(call, errorResult.content)
        continue
      }

      try {
        const content = await tool.execute(call.arguments, ctx)
        results.push({ toolCallId: call.id, content })
        this.events.onToolResult?.(call, content)
      } catch (error: any) {
        const errorResult = {
          toolCallId: call.id,
          content: `Error: ${error.message}`,
          isError: true,
        }
        results.push(errorResult)
        this.events.onToolResult?.(call, errorResult.content)
      }
    }

    return results
  }

  getHistory(): Message[] {
    return this.store.get(this.sessionId)
  }

  clearSession() {
    this.store.clear(this.sessionId)
    this.loopDetection.reset()
    this.policyEngine.clearLearnedRules()
  }

  getContextUsage() {
    const messages = this.store.get(this.sessionId)
    return this.llm.getContextUsage(messages)
  }
}
