import type { Message, ToolCall, Context, ToolDefinition } from "./types.js"
import { LLMClient, type LLMConfig } from "./llm.js"
import { ToolRegistry } from "./tools/index.js"
import { MessageStore } from "./store.js"
import { LoopDetectionService, type LoopDetectionConfig } from "./loopDetection.js"
import { PolicyEngine, type PolicyConfig, type PolicyDecision, type PolicyResult } from "./policy.js"
import { PromptProvider } from "./prompts/index.js"
import { ReActRunner, type Strategy, type ReActEvents } from "./react/index.js"
import { CompressionService, type CompressionLevel, type CompressionPreview, type CompressionResult } from "./compression.js"
import { SkillRegistry, getSkillRegistry } from "./skills/index.js"
import { MCPManager, type MCPManagerOptions } from "./mcp/manager.js"

export interface AgentConfig {
  cwd: string
  dbPath: string
  llm?: LLMConfig
  enableStream?: boolean
  compressionThreshold?: number
  loopDetection?: LoopDetectionConfig
  policy?: PolicyConfig
  /** ReAct 策略: auto | fc | cot */
  strategy?: Strategy
  /** MCP 配置 */
  mcp?: MCPManagerOptions
  /** Dump prompts and responses to file for debugging */
  dumpPrompt?: boolean
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
  /** CoT 模式：思考内容增量 */
  onThought?: (thought: string) => void
  /** CoT 模式：执行动作 */
  onAction?: (action: { name: string; input: Record<string, unknown> | string }) => void
  /** CoT 模式：观察结果 */
  onObservation?: (observation: string) => void
}

/**
 * Agent - AI 编程助手核心类
 *
 * 支持双策略 (FC + CoT) 的 ReAct 实现：
 * - FC (Function Calling): 使用模型原生工具调用能力
 * - CoT (Chain-of-Thought): 使用 ReAct Prompt 模板
 */
export class Agent {
  private llm: LLMClient
  private tools: ToolRegistry
  private store: MessageStore
  private loopDetection: LoopDetectionService
  private policyEngine: PolicyEngine
  private promptProvider: PromptProvider
  private reactRunner: ReActRunner
  private compressionService: CompressionService
  private skillRegistry: SkillRegistry
  private mcpManager?: MCPManager
  private _sessionId: string
  private cwd: string
  private enableStream: boolean
  private compressionThreshold: number
  private strategy: Strategy
  private events: AgentEvents = {}

  constructor(sessionId: string, config: AgentConfig) {
    this.llm = new LLMClient(config.llm)
    this.tools = new ToolRegistry()
    this.store = new MessageStore(config.dbPath)
    this.loopDetection = new LoopDetectionService(config.loopDetection)
    this.policyEngine = new PolicyEngine(config.policy)
    this.promptProvider = new PromptProvider()
    this.compressionService = new CompressionService(this.llm, {
      threshold: config.compressionThreshold ?? 0.92,
    })
    this.skillRegistry = getSkillRegistry({
      searchPaths: ["./skills", "~/.lite-opencode/skills"],
      includeBuiltins: true,
      recursive: false,
    })
    this._sessionId = sessionId
    this.cwd = config.cwd
    this.enableStream = config.enableStream ?? true
    this.compressionThreshold = config.compressionThreshold ?? 0.92
    this.strategy = config.strategy || "auto"

    // 初始化 MCP Manager
    if (config.mcp?.servers && config.mcp.servers.length > 0) {
      this.mcpManager = new MCPManager({
        servers: config.mcp.servers,
        enabled: config.mcp.enabled ?? true,
      })
      this.tools.setMCPManager(this.mcpManager)
    }

    // 初始化 ReAct Runner
    this.reactRunner = new ReActRunner(this.llm, this.tools, {
      strategy: this.strategy,
      maxIterations: 50,
      enableStreaming: this.enableStream,
    })
  }

  setEvents(events: AgentEvents) {
    this.events = events

    // 转换事件到 ReAct 事件格式
    const reactEvents: ReActEvents = {
      onThinking: events.onThinking,
      onThought: events.onThought || events.onTextDelta,
      onAction: events.onAction,
      onObservation: events.onObservation,
      onToolCall: events.onToolCall,
      onToolResult: events.onToolResult,
      onResponse: (content) => events.onResponse?.(content),
      onLoopDetected: events.onLoopDetected,
    }

    this.reactRunner.setEvents(reactEvents)
  }

  /**
   * 执行 Agent 循环
   */
  async run(userInput: string): Promise<string> {
    // 1. 添加用户消息
    this.store.add(this._sessionId, {
      role: "user",
      content: userInput,
    })

    // 2. 加载历史消息
    let messages = this.store.get(this._sessionId)

    // 3. 上下文压缩
    const beforeTokens = this.llm.estimateTokens(messages)
    messages = await this.llm.compressContext(
      messages,
      this.compressionThreshold,
      this.promptProvider.getCompactionPrompt()
    )
    const afterTokens = this.llm.estimateTokens(messages)
    if (beforeTokens !== afterTokens) {
      this.events.onCompress?.(beforeTokens, afterTokens)
    }

    // 4. 生成 system prompt
    const skillPrompt = this.skillRegistry.getActivePromptInjection()
    const systemPrompt = this.promptProvider.getSystemPrompt({
      model: this.llm.getModelId(),
      cwd: this.cwd,
      platform: process.platform,
      tools: this.tools.getDefinitions(),
      date: new Date(),
      skills: skillPrompt,
    })

    // 5. 使用 ReActRunner 执行
    const result = await this.runWithReAct(messages, this.tools.getDefinitions(), systemPrompt)

    return result
  }

  /**
   * 使用 ReActRunner 执行循环
   */
  private async runWithReAct(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string
  ): Promise<string> {
    // 复制消息以避免修改原始数组
    let workingMessages = [...messages]
    let iterations = 0
    const MAX_ITERATIONS = 50

    while (iterations < MAX_ITERATIONS) {
      iterations++
      this.loopDetection.incrementTurn()

      // 调用 LLM
      let response
      try {
        if (this.enableStream) {
          response = await this.llm.chatStream(
            workingMessages,
            tools,
            {
              onTextDelta: (text) => this.events.onTextDelta?.(text),
              onReasoningDelta: (text) => this.events.onReasoningDelta?.(text),
              onToolCall: (toolCall) => this.events.onToolCall?.(toolCall),
            },
            systemPrompt
          )
        } else {
          response = await this.llm.chat(workingMessages, tools, systemPrompt)
        }
      } catch (error: any) {
        this.events.onResponse?.(`Error: ${error.message}`)
        return `Error: ${error.message}`
      }

      // 循环检测：内容重复
      if (response.content) {
        const contentLoopResult = this.loopDetection.checkContentLoop(response.content)
        if (contentLoopResult.detected) {
          this.events.onLoopDetected?.(contentLoopResult.type!, contentLoopResult.message)
          return `${response.content}\n\n[系统检测到可能的循环，已终止。]`
        }
      }

      // 循环检测：工具调用
      if (response.toolCalls?.length) {
        for (const toolCall of response.toolCalls) {
          const toolLoopResult = this.loopDetection.checkToolCallLoop(toolCall)
          if (toolLoopResult.detected) {
            this.events.onLoopDetected?.(toolLoopResult.type!, toolLoopResult.message)
            return `[系统检测到工具调用循环：${toolCall.name} 连续调用了太多次。]`
          }
        }
      }

      // 添加 assistant 消息
      const assistantMsg: Message = {
        role: "assistant",
        content: response.content,
        reasoning: response.reasoning,
        toolCalls: response.toolCalls,
      }
      workingMessages.push(assistantMsg)
      this.store.add(this._sessionId, assistantMsg)

      // 通知响应
      if (response.content) {
        this.events.onResponse?.(response.content, response.reasoning)
      }

      // 没有工具调用，结束
      if (!response.toolCalls?.length) {
        return response.content
      }

      // 执行工具
      const toolResults = await this.executeTools(response.toolCalls)

      // 添加工具结果
      const resultMsg: Message = {
        role: "user",
        content: "",
        toolResults,
      }
      workingMessages.push(resultMsg)
      this.store.add(this._sessionId, resultMsg)

      // 检查压缩
      const beforeTokens2 = this.llm.estimateTokens(workingMessages)
      workingMessages = await this.llm.compressContext(
        workingMessages,
        this.compressionThreshold,
        this.promptProvider.getCompactionPrompt()
      )
      const afterTokens2 = this.llm.estimateTokens(workingMessages)
      if (beforeTokens2 !== afterTokens2) {
        this.events.onCompress?.(beforeTokens2, afterTokens2)
      }
    }

    return "Maximum iterations reached"
  }

  /**
   * 执行工具调用
   */
  private async executeTools(toolCalls: ToolCall[]) {
    const results = []
    const ctx: Context = {
      cwd: this.cwd,
      messages: [],
      setPlanMode: (enabled) => this.setPlanMode(enabled)  // 调用 Agent 方法以触发模型切换
    }

    for (const call of toolCalls) {
      this.events.onToolCall?.(call)

      // 策略检查
      const policyResult = this.policyEngine.check(call.name, call.arguments)
      this.events.onPolicyCheck?.(call, policyResult)

      if (policyResult.decision === "deny") {
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
        let userDecision: PolicyDecision
        if (this.events.onPolicyAsk) {
          userDecision = await this.events.onPolicyAsk(call)
        } else {
          userDecision = "deny"
        }

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

  /**
   * 获取当前策略
   */
  getStrategy(): "fc" | "cot" {
    return this.reactRunner.getCurrentStrategy()
  }

  /**
   * 获取模型能力
   */
  getModelCapabilities() {
    return this.reactRunner.getModelCapabilities()
  }

  /**
   * 获取当前会话 ID
   */
  get sessionId(): string {
    return this._sessionId
  }

  getHistory(): Message[] {
    return this.store.get(this._sessionId)
  }

  clearSession() {
    this.store.clear(this._sessionId)
    this.loopDetection.reset()
    this.policyEngine.clearLearnedRules()
    this.reactRunner.reset()
  }

  getContextUsage() {
    const messages = this.store.get(this._sessionId)
    return this.llm.getContextUsage(messages)
  }

  /**
   * 获取工具列表
   */
  getTools() {
    return this.tools.getDefinitions()
  }

  /**
   * 获取当前策略
   */
  getStrategyInfo(): { strategy: Strategy; actual: "fc" | "cot" } {
    return {
      strategy: this.strategy,
      actual: this.reactRunner.getCurrentStrategy(),
    }
  }

  /**
   * 获取压缩预览（不执行压缩）
   */
  getCompressionPreview(): CompressionPreview {
    const messages = this.store.get(this._sessionId)
    return this.compressionService.getPreview(messages)
  }

  /**
   * 手动压缩上下文（使用渐进式压缩）
   * @param level 可选的压缩级别，不指定则自动选择
   * @returns 压缩结果
   */
  async compactContext(level?: CompressionLevel): Promise<{
    before: number
    after: number
    level: CompressionLevel
    messagesRemoved: number
    summaryGenerated: boolean
  }> {
    const messages = this.store.get(this._sessionId)

    // 设置压缩提示
    this.compressionService.setCompactionPrompt(this.promptProvider.getCompactionPrompt())

    let result: CompressionResult

    if (level) {
      // 使用指定级别
      result = await this.compressionService.compressWithLevel(messages, level)
    } else {
      // 自动选择级别（渐进式压缩）
      result = await this.compressionService.compress(messages)
    }

    // 如果压缩有效，更新存储
    if (result.messages.length < messages.length) {
      this.store.clear(this._sessionId)
      result.messages.forEach((msg) => this.store.add(this._sessionId, msg))
    }

    return {
      before: result.originalTokens,
      after: result.compressedTokens,
      level: result.level,
      messagesRemoved: result.originalCount - result.compressedCount,
      summaryGenerated: result.summaryGenerated,
    }
  }

  /**
   * 获取会话统计信息
   */
  getSessionStats() {
    const messages = this.store.get(this._sessionId)
    const contextUsage = this.llm.getContextUsage(messages)
    const strategy = this.reactRunner.getCurrentStrategy()

    // 统计消息数量
    let userMessages = 0
    let assistantMessages = 0
    let toolCalls = 0

    for (const msg of messages) {
      if (msg.role === "user") userMessages++
      if (msg.role === "assistant") {
        assistantMessages++
        if (msg.toolCalls) toolCalls += msg.toolCalls.length
      }
    }

    return {
      messageCount: messages.length,
      userMessages,
      assistantMessages,
      toolCalls,
      contextUsage,
      strategy,
      modelId: this.llm.getModelId(),
    }
  }

  /**
   * 取消当前正在进行的 LLM 请求
   */
  abort(): void {
    this.llm.abort()
  }

  /**
   * 切换 YOLO 模式
   */
  toggleYoloMode(): boolean {
    return this.policyEngine.toggleYoloMode()
  }

  /**
   * 获取 YOLO 模式状态
   */
  isYoloMode(): boolean {
    return this.policyEngine.isYoloMode()
  }

  /**
   * 切换 Plan Mode
   */
  togglePlanMode(): boolean {
    return this.policyEngine.togglePlanMode()
  }

  /**
   * 设置 Plan Mode
   */
  setPlanMode(enabled: boolean): void {
    this.policyEngine.setPlanMode(enabled)

    // 自动切换模型
    if (enabled) {
      this.llm.switchToPlanModel()
    } else {
      this.llm.switchToBuildModel()
    }
  }

  /**
   * 获取 Plan Mode 状态
   */
  isPlanMode(): boolean {
    return this.policyEngine.isPlanMode()
  }

  /**
   * 获取策略引擎（用于直接访问）
   */
  getPolicyEngine(): PolicyEngine {
    return this.policyEngine
  }

  /**
   * 获取当前模型显示名称
   */
  getModelDisplayName(): string {
    return this.llm.getModelDisplayName()
  }

  /**
   * 切换到 Plan Mode 模型
   */
  switchToPlanModel(): void {
    this.llm.switchToPlanModel()
  }

  /**
   * 切换到 Build 模型
   */
  switchToBuildModel(): void {
    this.llm.switchToBuildModel()
  }

  /**
   * 获取 Skill Registry
   */
  getSkillRegistry(): SkillRegistry {
    return this.skillRegistry
  }

  /**
   * 加载所有 Skills
   */
  async loadSkills(): Promise<void> {
    await this.skillRegistry.discoverAndLoad()
  }

  /**
   * 激活 Skill
   */
  activateSkill(id: string): ReturnType<SkillRegistry["activate"]> {
    return this.skillRegistry.activate(id)
  }

  /**
   * 停用 Skill
   */
  deactivateSkill(id: string): boolean {
    return this.skillRegistry.deactivate(id)
  }

  /**
   * 获取 Skill 列表
   */
  getSkills(): ReturnType<SkillRegistry["getSummaries"]> {
    return this.skillRegistry.getSummaries()
  }

  /**
   * 获取激活的 Skills
   */
  getActiveSkills(): ReturnType<SkillRegistry["getActive"]> {
    return this.skillRegistry.getActive()
  }

  // ==========================================================================
  // MCP 方法
  // ==========================================================================

  /**
   * 初始化 MCP（在应用启动时调用）
   */
  async initializeMCP(): Promise<void> {
    if (this.mcpManager) {
      await this.mcpManager.initialize()
    }
  }

  /**
   * 获取 MCP Manager
   */
  getMCPManager(): MCPManager | undefined {
    return this.mcpManager
  }

  /**
   * 获取 MCP 服务器状态
   */
  getMCPStatus(): Array<{ name: string; connected: boolean; tools: number }> {
    if (!this.mcpManager) {
      return []
    }

    return this.mcpManager.getAllServerStates().map((state) => ({
      name: state.name,
      connected: state.status.type === "connected",
      tools:
        state.status.type === "connected" ? state.status.tools?.length || 0 : 0,
    }))
  }
}
