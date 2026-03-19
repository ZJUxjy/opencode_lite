import React, { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { Box, Text, Static, useInput, useStdout } from "ink"
import Spinner from "ink-spinner"
import { Agent, type AgentEvents } from "./agent.js"
import { CommandInput } from "./components/CommandInput.js"
import { PermissionPrompt } from "./components/PermissionPrompt.js"
import { PlanFollowupPrompt, type PlanFollowupDecision } from "./components/PlanFollowupPrompt.js"
import { SessionList } from "./components/SessionList.js"
import { MessageItem } from "./components/MessageItem.js"
import { DialogModel, DialogProvider } from "./components/index.js"
import { parseSlashCommand, type SlashCommand } from "./input/slash-commands.js"
import { getStatePersistence } from "./state/index.js"
import { getErrorMessage } from "./utils/error.js"
import { getBuiltinProvider } from "./providers/registry.js"
import { ProviderConfigService } from "./providers/service.js"
import type { BuiltinProvider } from "./providers/types.js"
import { Session, SessionStore } from "./session/index.js"
import type { CommandContext, PermissionRequest, PermissionDecision } from "./commands/types.js"
import type { ToolCall } from "./types.js"
import type { PolicyDecision } from "./policy.js"
import { getPlanFilePathCurrent, readPlanFileCurrent, exitPlanModeCurrent, setPlanContext } from "./plan/index.js"
import { buildNewSessionPrompt, buildContinueSessionPrompt } from "./plan/handover.js"
import { formatToolArgs } from "./utils/formatToolArgs.js"
// New message system imports
import {
  type UIMessage,
  type MessageGroup,
  type MessageFilter,
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  createToolMessage,
} from "./messages/types.js"

/**
 * 方案 A 实现：最小改动修复滚动问题
 *
 * 核心改动：
 * 1. 为消息添加稳定 ID
 * 2. 正确分离 Static 和动态内容
 * 3. 移除脉冲动画（避免频繁重渲染）
 * 4. 优化消息更新策略
 */

// ============================================================================
// 类型定义
// ============================================================================

interface Props {
  agent: Agent
  model: string
  baseURL: string
  sessionId: string
  workingDir: string
  dbPath: string
  isResumed?: boolean
  resumedSessionTitle?: string
}

// ============================================================================
// 主组件
// ============================================================================

export function App({ agent, model, baseURL, sessionId, workingDir, dbPath, isResumed, resumedSessionTitle }: Props) {
  const { stdout } = useStdout()

  // 终端宽度
  const terminalWidth = stdout?.columns || 80

  // 注册进程退出钩子清理 MCP 并显示恢复命令
  useEffect(() => {
    // 同步显示恢复命令（必须在异步清理前执行）
    const showResumeHint = () => {
      // 使用 process.stdout.write 同步输出
      process.stdout.write('\n\n📋 To resume this session, run:\n')
      process.stdout.write(`   lite-opencode --resume ${sessionId}\n\n`)
    }

    // 异步清理 MCP
    const cleanupMCP = async () => {
      const mcpManager = agent.getMCPManager()
      if (mcpManager) {
        await mcpManager.dispose().catch(() => {})
      }
    }

    const handleExit = () => {
      showResumeHint()
      // 让进程自然退出
    }

    const handleSigint = () => {
      showResumeHint()
      // 同步清理后立即退出
      cleanupMCP().finally(() => {
        process.exit(0)
      })
    }

    process.on('beforeExit', handleExit)
    process.on('SIGINT', handleSigint)
    process.on('SIGTERM', handleExit)

    return () => {
      process.off('beforeExit', handleExit)
      process.off('SIGINT', handleSigint)
      process.off('SIGTERM', handleExit)
    }
  }, [agent, sessionId])

  // 初始化 Plan Mode 上下文
  useEffect(() => {
    setPlanContext({ sessionId, dbPath })
  }, [sessionId, dbPath])

  // =========================================================================
  // 状态管理
  // =========================================================================

  // 已完成的消息列表（会进入 Static 组件）
  const [messages, setMessages] = useState<UIMessage[]>([])

  // 消息过滤模式
  const [messageFilter, setMessageFilter] = useState<MessageFilter>("show_all")

  // 处理状态
  const [isProcessing, setIsProcessing] = useState(false)

  // 输入队列（当 LLM 思考时，用户输入会缓存到这里）
  const [inputQueue, setInputQueue] = useState<string[]>([])

  // 上下文使用情况 - 初始化时直接从 agent 获取，避免重复渲染
  const [contextUsage, setContextUsage] = useState(() => agent.getContextUsage())

  // 输入历史（从数据库加载）
  const [inputHistory, setInputHistory] = useState<string[]>([])

  // MCP 状态
  const [mcpStatus, setMcpStatus] = useState<{
    connected: number
    total: number
    healthy: number
    degraded: number
  }>(() => {
    const status = agent.getMCPStatus()
    const mcpManager = agent.getMCPManager()
    let healthy = 0
    let degraded = 0

    if (mcpManager) {
      for (const s of status) {
        const health = mcpManager.getServerHealth(s.name)
        if (health.status === "healthy") healthy++
        else if (health.status === "degraded") degraded++
      }
    }

    return {
      connected: status.filter((s) => s.connected).length,
      total: status.length,
      healthy,
      degraded,
    }
  })

  // =========================================================================
  // Session 恢复和历史消息加载
  // =========================================================================

  useEffect(() => {
    // 加载会话的输入历史
    const loadInputHistory = () => {
      const sessionStore = new SessionStore(dbPath)
      const session = sessionStore.get(sessionId)
      if (session && session.inputHistory) {
        setInputHistory(session.inputHistory)
      }
      sessionStore.close()
    }
    loadInputHistory()

    // 加载 skills
    const loadSkills = async () => {
      try {
        await agent.loadSkills()
        const skillCount = agent.getSkills().length
        if (skillCount > 0) {
          setMessages((prev) => [
            ...prev,
            createSystemMessage(`🎯 Loaded ${skillCount} skills. Use /skills to view and activate.`)
          ])
        }

        // Enable hot reload
        agent.enableSkillHotReload((skill, action) => {
          // Show notification when skill is reloaded
          if (action === "reloaded") {
            setMessages((prev) => [
              ...prev,
              createSystemMessage(`🔄 Skill reloaded: ${skill.metadata.name}`)
            ])
          } else if (action === "loaded") {
            setMessages((prev) => [
              ...prev,
              createSystemMessage(`✨ New skill detected: ${skill.metadata.name}`)
            ])
          }
        })
      } catch (error) {
        // Silent fail - skills are optional
      }
    }
    loadSkills()

    // 加载 MCP 状态
    const loadMCPStatus = () => {
      const status = agent.getMCPStatus()
      if (status.length > 0) {
        const mcpManager = agent.getMCPManager()
        let healthy = 0
        let degraded = 0

        if (mcpManager) {
          for (const s of status) {
            const health = mcpManager.getServerHealth(s.name)
            if (health.status === "healthy") healthy++
            else if (health.status === "degraded") degraded++
          }
        }

        setMcpStatus({
          connected: status.filter((s) => s.connected).length,
          total: status.length,
          healthy,
          degraded,
        })
        const toolCount = status.reduce((sum, s) => sum + s.tools, 0)
        setMessages((prev) => [
          ...prev,
          createSystemMessage(
            `🔌 MCP: ${status.length} servers, ${toolCount} tools. Use /mcp to view details.`
          ),
        ])
      }
    }
    loadMCPStatus()

    if (isResumed) {
      // 加载历史消息
      const historyMessages = agent.getHistory()

      if (historyMessages.length > 0) {
        // 转换历史消息为 UI Message 格式
        const uiMessages: UIMessage[] = historyMessages.map((msg, index) => ({
          id: `hist-${sessionId}-${index}-${Date.now()}`,
          role: msg.role,
          type: "text" as const,
          content: msg.content || "",
          metadata: {
            timestamp: Date.now() - (historyMessages.length - index) * 1000,
            priority: "normal" as const,
          },
        }))

        // 添加恢复提示作为第一条消息
        const resumeMessage = createSystemMessage(
          `📂 Resumed session: ${resumedSessionTitle || "Unknown"}\nSession ID: ${sessionId.slice(0, 20)}... (${uiMessages.length} messages)`
        )

        setMessages([resumeMessage, ...uiMessages])
      } else {
        // 没有历史消息，只显示恢复提示
        const resumeMessage = createSystemMessage(
          `📂 Resumed session: ${resumedSessionTitle || "Unknown"}\nSession ID: ${sessionId.slice(0, 20)}... (empty)`
        )
        setMessages([resumeMessage])
      }
    }
  }, []) // 只在组件挂载时执行

  // =========================================================================
  // 权限请求状态
  // =========================================================================

  // 当前待处理的权限请求
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null)
  // 用于 resolve 权限请求的 Promise
  const permissionResolveRef = useRef<((decision: PolicyDecision) => void) | null>(null)

  // =========================================================================
  // Plan Followup 状态
  // =========================================================================

  // 是否显示 Plan Followup 提示
  const [planFollowupVisible, setPlanFollowupVisible] = useState(false)
  // 当前计划文件路径
  const [planFilePath, setPlanFilePath] = useState<string>("")
  // 用于 resolve Plan Followup 的 Promise
  const planFollowupResolveRef = useRef<((decision: PlanFollowupDecision) => void) | null>(null)

  // =========================================================================
  // Session 选择器状态
  // =========================================================================

  const [showSessionList, setShowSessionList] = useState(false)
  const [availableSessions, setAvailableSessions] = useState<Session[]>([])

  // =========================================================================
  // Dialog 状态 (Model/Provider Selection)
  // =========================================================================

  const [activeDialog, setActiveDialog] = useState<SlashCommand | null>(null)

  // Initialize provider/model from saved config - fail explicitly if not configured
  const [configError, setConfigError] = useState<string | null>(null)

  const getInitialProviderAndModel = useCallback((): { provider: string; model: string } => {
    const providerService = new ProviderConfigService()
    const defaultProvider = providerService.getDefaultProvider()
    return {
      provider: defaultProvider.id,
      model: defaultProvider.defaultModel,
    }
  }, [])

  const [currentProvider, setCurrentProvider] = useState<string>(() => {
    try {
      return getInitialProviderAndModel().provider
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : String(e))
      return ""
    }
  })
  const [currentModel, setCurrentModel] = useState<string>(() => {
    try {
      return getInitialProviderAndModel().model
    } catch {
      // Error already set in provider initialization
      return ""
    }
  })

  // 加载可用会话
  const loadSessions = useCallback(() => {
    const sessionStore = new SessionStore(dbPath)
    const sessions = sessionStore.list({ includeArchived: false })
    setAvailableSessions(sessions)
    sessionStore.close()
  }, [dbPath])

  // =========================================================================
  // Dialog Handlers (Model/Provider Selection)
  // =========================================================================

  // Handle slash command detection
  const handleSlashCommand = useCallback((command: SlashCommand) => {
    setActiveDialog(command)
  }, [])

  // Handle model selection
  const handleModelSelect = useCallback(async (provider: string, model: string) => {
    setCurrentProvider(provider)
    setCurrentModel(model)
    setActiveDialog(null)

    // Update agent's LLM client
    try {
      await agent.switchProvider(provider)
      agent.switchModel(model)
    } catch (error) {
      console.error("Failed to switch model:", error)
    }

    // Add notification message
    const providerInfo = getBuiltinProvider(provider as BuiltinProvider)
    const message = createSystemMessage(`✓ Switched to ${providerInfo?.name ?? provider} / ${model}`)
    setMessages(prev => [...prev, message])
  }, [agent])

  // Handle provider selection
  const handleProviderSelect = useCallback(async (provider: string) => {
    // Get default model for this provider
    const providerInfo = getBuiltinProvider(provider as BuiltinProvider)
    const model = providerInfo?.defaultModel ?? "unknown"

    setCurrentProvider(provider)
    setCurrentModel(model)
    setActiveDialog(null)

    // Update agent's LLM client
    try {
      await agent.switchProvider(provider)
    } catch (error) {
      console.error("Failed to switch provider:", error)
    }

    // Add notification message
    const message = createSystemMessage(`✓ Switched to ${providerInfo?.name ?? provider} / ${model}`)
    setMessages(prev => [...prev, message])
  }, [agent])

  // Handle dialog cancel
  const handleDialogCancel = useCallback(() => {
    setActiveDialog(null)
  }, [])

  // Show model selection dialog
  const showModelDialog = useCallback(() => {
    setActiveDialog("models")
  }, [])

  // Show provider selection dialog
  const showProviderDialog = useCallback(() => {
    setActiveDialog("provider")
  }, [])

  // 显示会话列表
  const handleShowSessionList = useCallback(() => {
    loadSessions()
    setShowSessionList(true)
  }, [loadSessions])

  // 选择会话
  const handleSelectSession = useCallback((selectedSessionId: string) => {
    setShowSessionList(false)
    if (selectedSessionId !== sessionId) {
      // 由于 Agent 实例绑定特定 sessionId，需要提示用户重启
      const message = createSystemMessage(
        `💡 To switch to session ${selectedSessionId.slice(0, 20)}..., exit and run:\n` +
        `   lite-opencode -r ${selectedSessionId}`
      )
      setMessages((prev) => [...prev, message])
    }
  }, [sessionId])

  // 保存输入历史到数据库
  const handleSaveInputHistory = useCallback((newHistory: string[]) => {
    setInputHistory(newHistory)
    const sessionStore = new SessionStore(dbPath)
    sessionStore.updateInputHistory(sessionId, newHistory)
    sessionStore.close()
  }, [sessionId, dbPath])

  // 切换 Prompt Dump 功能
  const handleToggleDump = useCallback(() => {
    const dumper = agent.getPromptDumper()
    dumper.setEnabled(!dumper.isEnabled())
  }, [agent])

  // 获取 Prompt Dump 状态
  const handleGetDumpStatus = useCallback(() => {
    const dumper = agent.getPromptDumper()
    return {
      enabled: dumper.isEnabled(),
      path: dumper.getDumpPath(),
    }
  }, [agent])

  // 取消选择
  const handleCancelSessionList = useCallback(() => {
    setShowSessionList(false)
  }, [])

  /**
   * 处理权限请求
   * 当 Agent 需要用户授权时调用
   */
  const handlePolicyAsk = useCallback((toolCall: ToolCall): Promise<PolicyDecision> => {
    return new Promise((resolve) => {
      permissionResolveRef.current = resolve
      // Get risk classification for this tool call
      const risk = agent.getPolicyEngine().classifyRisk(toolCall.name, toolCall.arguments)
      setPermissionRequest({
        id: toolCall.id,
        toolName: toolCall.name,
        description: getToolDescription(toolCall),
        args: toolCall.arguments,
        risk,
      })
    })
  }, [agent])

  /**
   * 处理用户决策
   */
  const handlePermissionDecision = useCallback((decision: PermissionDecision) => {
    if (permissionResolveRef.current) {
      // 转换决策类型：PermissionDecision -> PolicyDecision
      const policyDecision: PolicyDecision = decision === "always" ? "allow" : decision
      permissionResolveRef.current(policyDecision)

      // 如果是 "always"，让 policy engine 学习（问题2修复：传入 cwd）
      if (decision === "always" && permissionRequest) {
        agent.getPolicyEngine().learn(
          permissionRequest.toolName,
          permissionRequest.args,
          "allow",
          true,
          agent.getCwd()  // 传入工作目录
        )
      }

      permissionResolveRef.current = null
      setPermissionRequest(null)
    }
  }, [agent, permissionRequest])

  /**
   * 处理 Plan Followup 决策
   */
  const handlePlanFollowupDecision = useCallback(async (decision: PlanFollowupDecision) => {
    setPlanFollowupVisible(false)

    if (!decision) {
      return
    }

    const { content: planContent } = readPlanFileCurrent()

    if (decision === "new_session") {
      // 在新会话中实现（简化版：清空当前消息并添加计划作为初始提示）
      const newSessionPrompt = buildNewSessionPrompt({
        planContent,
      })

      // 清空消息历史
      setMessages([])

      // 添加系统消息
      const systemMessage = createSystemMessage("🆕 Starting new session with plan...")
      setMessages([systemMessage])

      // 添加计划作为用户消息，让 Agent 执行
      setTimeout(() => {
        handleSubmit(newSessionPrompt)
      }, 100)
    } else if (decision === "continue") {
      // 在当前会话中继续
      const continuePrompt = buildContinueSessionPrompt(planContent)

      const systemMessage = createSystemMessage("🔄 Continuing with plan implementation...")
      setMessages(prev => [...prev, systemMessage])

      setTimeout(() => {
        handleSubmit(continuePrompt)
      }, 100)
    }
  }, [])

  /**
   * 获取工具的友好描述
   */
  const getToolDescription = (toolCall: ToolCall): string => {
    const { name, arguments: args } = toolCall
    const argStr = typeof args === "object" ? args : {}

    switch (name) {
      case "write":
        return `Write to file: ${argStr.file_path || argStr.path || "unknown"}`
      case "edit":
        return `Edit file: ${argStr.file_path || argStr.path || "unknown"}`
      case "bash":
        const cmd = String(argStr.command || "")
        return cmd.length > 80 ? cmd.slice(0, 80) + "..." : cmd
      default:
        return `${name}: ${JSON.stringify(argStr).slice(0, 60)}`
    }
  }

  // =========================================================================
  // 流式输出 - 使用 ref 累加，避免频繁 setState
  // =========================================================================

  const streamingTextRef = useRef("")
  const streamingReasoningRef = useRef("")

  // 用于显示的文本（节流更新，减少重渲染频率）
  const [displayText, setDisplayText] = useState("")
  const [displayReasoning, setDisplayReasoning] = useState("")

  // 当前工具调用
  const [currentTool, setCurrentTool] = useState<{
    name: string
    args: string
  } | null>(null)

  // 节流定时器
  const throttleTimerRef = useRef<NodeJS.Timeout | null>(null)
  const THROTTLE_MS = 150  // 节流间隔，平衡流畅性和性能

  // =========================================================================
  // 节流更新显示文本
  // =========================================================================

  const flushDisplay = useCallback(() => {
    const newText = streamingTextRef.current
    const newReasoning = streamingReasoningRef.current

    // 只在内容变化时才更新
    setDisplayText(prev => prev !== newText ? newText : prev)
    setDisplayReasoning(prev => prev !== newReasoning ? newReasoning : prev)
  }, [])

  useEffect(() => {
    if (isProcessing) {
      // 启动节流定时器
      throttleTimerRef.current = setInterval(flushDisplay, THROTTLE_MS)
    } else {
      // 停止时立即刷新最后一次内容
      if (throttleTimerRef.current) {
        clearInterval(throttleTimerRef.current)
        throttleTimerRef.current = null
      }
    }

    return () => {
      if (throttleTimerRef.current) {
        clearInterval(throttleTimerRef.current)
      }
    }
  }, [isProcessing, flushDisplay])

  // =========================================================================
  // 上下文使用情况
  // =========================================================================

  const updateContextUsage = useCallback(() => {
    const usage = agent.getContextUsage()
    setContextUsage(usage)
  }, [agent])

  // =========================================================================
  // Command context for command handlers
  // =========================================================================

  // 自定义退出函数：清理 MCP 并强制退出
  const handleExit = useCallback(async () => {
    const mcpManager = agent.getMCPManager()
    if (mcpManager) {
      try {
        await mcpManager.dispose()
      } catch {
        // 忽略清理错误
      }
    }
    process.exit(0)
  }, [agent])

  const commandContext: CommandContext = useMemo(
    () => ({
      agent,
      setMessages,
      exit: handleExit,
      updateContextUsage,
      showSessionList: handleShowSessionList,
      toggleDumpPrompt: handleToggleDump,
      getDumpStatus: handleGetDumpStatus,
      showModelDialog,
      showProviderDialog,
    }),
    [agent, setMessages, handleExit, updateContextUsage, handleShowSessionList, handleToggleDump, handleGetDumpStatus, showModelDialog, showProviderDialog]
  )

  // =========================================================================
  // 处理用户输入
  // =========================================================================

  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return

    // Check for slash commands first
    const command = parseSlashCommand(trimmed)
    if (command) {
      handleSlashCommand(command)
      return
    }

    // 如果正在处理，将输入加入队列
    if (isProcessing) {
      setInputQueue(prev => [...prev, trimmed])
      return
    }

    // Note: Command handling is now done by CommandInput component
    // This callback only handles regular messages

    // -----------------------------------------------------------------------
    // 添加用户消息
    // -----------------------------------------------------------------------

    const userMessage = createUserMessage(trimmed)
    setMessages(prev => [...prev, userMessage])

    // 重置流式状态
    setIsProcessing(true)
    streamingTextRef.current = ""
    streamingReasoningRef.current = ""
    setDisplayText("")
    setDisplayReasoning("")
    setCurrentTool(null)

    // -----------------------------------------------------------------------
    // 设置事件回调
    // -----------------------------------------------------------------------

    const events: AgentEvents = {
      onThinking: () => {
        // 保持空实现，让 "Thinking..." 动画显示
      },

      onReasoningDelta: (text: string) => {
        // 累加到 ref，不触发重渲染
        streamingReasoningRef.current += text
      },

      onTextDelta: (text: string) => {
        // 累加到 ref，不触发重渲染
        streamingTextRef.current += text
      },

      onToolCall: (toolCall) => {
        setCurrentTool({
          name: toolCall.name,
          args: formatToolArgs(toolCall.arguments)  // 问题3+4修复：格式化显示
        })
      },

      onToolResult: (toolCall, result) => {
        // 工具调用完成后，添加到消息历史
        const toolMessage = createAssistantMessage(
          `🔧 ${toolCall.name}\n✅ ${result.slice(0, 200)}${result.length > 200 ? "..." : ""}`
        )
        setMessages(prev => [...prev, toolMessage])
        setCurrentTool(null)

        // 检测 exit_plan_mode 工具执行，显示 PlanFollowup
        if (toolCall.name === "exit_plan_mode" && result.includes("Successfully exited")) {
          const planPath = getPlanFilePathCurrent()
          setPlanFilePath(planPath)
          setPlanFollowupVisible(true)
        }
      },

      onResponse: (content: string, reasoning?: string) => {
        // 响应完成后，添加到消息历史
        if (content) {
          const assistantMessage = createAssistantMessage(
            content,
            reasoning || streamingReasoningRef.current || undefined
          )
          setMessages(prev => [...prev, assistantMessage])
        }

        // 重置流式状态
        streamingTextRef.current = ""
        streamingReasoningRef.current = ""
        setDisplayText("")
        setDisplayReasoning("")
      },

      onCompress: (before: number, after: number) => {
        const compressMessage = createSystemMessage(
          `📦 Compressed: ${before} → ${after} tokens`
        )
        setMessages(prev => [...prev, compressMessage])
      },

      onPolicyAsk: handlePolicyAsk,
    }

    agent.setEvents(events)

    // -----------------------------------------------------------------------
    // 执行 Agent
    // -----------------------------------------------------------------------

    try {
      await agent.run(trimmed)
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : ""
      // 如果是用户取消，不显示错误（已经在上面的 useInput 中处理了）
      if (errMsg.includes("cancelled by user")) {
        // 用户取消，静默处理
        setIsProcessing(false)
        updateContextUsage()
        return
      }

      let errorMessage = getErrorMessage(error)

      if (errMsg.includes("timed out")) {
        errorMessage = `Request timed out. Please check your network connection or try again.`
      } else if (errMsg.includes("ECONNREFUSED") || errMsg.includes("ENOTFOUND")) {
        errorMessage = `Network error: Unable to connect to the API. Please check your base URL.`
      } else if (errMsg.includes("401") || errMsg.includes("Unauthorized")) {
        errorMessage = `Authentication error: Please check your API key.`
      } else if (errMsg.includes("429")) {
        errorMessage = `Rate limited: Too many requests. Please wait a moment and try again.`
      }

      const errorMessageObj = createSystemMessage(`❌ Error: ${errorMessage}`)
      setMessages(prev => [...prev, errorMessageObj])
    }

    setIsProcessing(false)
    updateContextUsage()
  }, [agent, isProcessing])

  // =========================================================================
  // 处理输入队列
  // =========================================================================

  useEffect(() => {
    // 当处理完成且队列中有输入时，自动处理下一个
    if (!isProcessing && inputQueue.length > 0) {
      const nextInput = inputQueue[0]
      setInputQueue(prev => prev.slice(1))
      handleSubmit(nextInput)
    }
  }, [isProcessing, inputQueue, handleSubmit])

  // =========================================================================
  // 键盘快捷键
  // =========================================================================

  useInput((input, key) => {
    // Ctrl+C: Exit (always active)
    if (key.ctrl && input === "c") {
      // 显示恢复提示
      process.stdout.write('\n\n📋 To resume this session, run:\n')
      process.stdout.write(`   lite-opencode --resume ${sessionId}\n\n`)
      // 先清理 MCP 连接
      const mcpManager = agent.getMCPManager()
      if (mcpManager) {
        mcpManager.dispose().catch(() => {})
      }
      // 强制退出进程
      process.exit(0)
    }

    // Ctrl+E: Expand all message groups
    if (key.ctrl && input === "e" && !isProcessing) {
      setMessages(prev =>
        prev.map(msg => ({
          ...msg,
          metadata: { ...msg.metadata, collapsed: false }
        }))
      )
    }

    // Ctrl+O: Collapse all message groups
    if (key.ctrl && input === "o" && !isProcessing) {
      setMessages(prev =>
        prev.map(msg => ({
          ...msg,
          metadata: { ...msg.metadata, collapsed: true }
        }))
      )
    }

    // Ctrl+H: Toggle system message visibility
    if (key.ctrl && input === "h" && !isProcessing) {
      setMessageFilter(prev =>
        prev === "hide_system" ? "show_all" : "hide_system"
      )
    }

    // Escape: Cancel ongoing request
    if (key.escape && isProcessing) {
      agent.abort()
      const cancelMessage = createSystemMessage("⚠️ Request cancelled by user")
      setMessages(prev => [...prev, cancelMessage])
      setIsProcessing(false)
      updateContextUsage()
    }
  }, { isActive: !activeDialog })  // Disable when dialog is open

  // =========================================================================
  // 初始化
  // =========================================================================

  useEffect(() => {
    updateContextUsage()
  }, [updateContextUsage])

  // =========================================================================
  // =========================================================================
  // 格式化上下文状态
  // =========================================================================

  const contextStatus = useMemo(() => {
    const percent = Math.round(contextUsage.percentage * 100)
    const color = percent >= 92 ? "red" : percent >= 80 ? "yellow" : "green"
    const usedK = (contextUsage.used / 1000).toFixed(1)
    const limitK = (contextUsage.limit / 1000).toFixed(0)
    return { percent, color, usedK, limitK }
  }, [contextUsage])

  // 获取当前模型显示名称
  const modelDisplayName = useMemo(() => {
    const providerInfo = getBuiltinProvider(currentProvider as BuiltinProvider)
    return `${providerInfo?.name ?? currentProvider}/${currentModel}`
  }, [currentProvider, currentModel])

  // =========================================================================
  // 渲染
  // =========================================================================
  // 消息过滤
  // =========================================================================

  const filteredMessages = useMemo(() => {
    switch (messageFilter) {
      case "hide_system":
        return messages.filter(msg =>
          msg.role !== "system" && msg.role !== "tool"
        )
      case "show_errors_only":
        return messages.filter(msg =>
          msg.type === "error"
        )
      case "compact":
        return messages.map(msg => ({
          ...msg,
          metadata: { ...msg.metadata, collapsed: true }
        }))
      default:
        return messages
    }
  }, [messages, messageFilter])

  // =========================================================================

  // Show configuration error if provider setup is missing
  if (configError) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red" bold>⚠ Configuration Error</Text>
        <Text> </Text>
        <Text>{configError}</Text>
        <Text> </Text>
        <Text dimColor>Please configure a provider first:</Text>
        <Text color="cyan">  lite-opencode config</Text>
        <Text dimColor>Or use the /provider command to set up a provider.</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {/* =====================================================================
          Static 区域：已完成的消息

          关键点：
          1. 使用 message.id 作为 key，而不是索引
          2. 只包含已完成的消息，不包含流式内容
          3. Static 组件会将内容输出到主缓冲区，支持滚动
          4. 消息根据 messageFilter 进行过滤
          ===================================================================== */}
      <Static items={filteredMessages}>
        {(message) => (
          <MessageItem key={message.id} message={message} />
        )}
      </Static>

      {/* =====================================================================
          动态区域：流式输出和工具调用

          这部分内容会频繁更新，不会进入 Static
          ===================================================================== */}
      <Box flexDirection="column" width={terminalWidth}>
        {/* 思考过程流式输出 */}
        {displayReasoning && (
          <Box flexDirection="column">
            <Text dimColor italic wrap="wrap">
              💭 {displayReasoning}
              {isProcessing && <Text dimColor>▌</Text>}
            </Text>
          </Box>
        )}

        {/* 流式文本输出 */}
        {(displayText || isProcessing) && (
          <Box>
            {displayText ? (
              <Text wrap="wrap">
                {displayText}
                {isProcessing && <Text dimColor>▌</Text>}
              </Text>
            ) : (
              /* Thinking 动画 - 使用静态文本，避免脉冲动画触发重渲染 */
              <Box>
                <Text>
                  <Text color="cyan">
                    <Spinner type="dots" />
                  </Text>
                  <Text> </Text>
                  <Text color="cyan">Thinking...</Text>
                </Text>
              </Box>
            )}
          </Box>
        )}

        {/* 当前工具调用 */}
        {currentTool && (
          <Box marginBottom={1}>
            <Text color="yellow" wrap="wrap">
              🔧 {currentTool.name}({currentTool.args})
            </Text>
          </Box>
        )}
      </Box>

      {/* =====================================================================
          权限提示
          ===================================================================== */}
      <PermissionPrompt
        request={permissionRequest!}
        onDecision={handlePermissionDecision}
        visible={permissionRequest !== null}
      />

      {/* =====================================================================
          Plan Followup 提示
          ===================================================================== */}
      <PlanFollowupPrompt
        planFilePath={planFilePath}
        onDecision={handlePlanFollowupDecision}
        visible={planFollowupVisible}
      />

      {/* =====================================================================
          分隔线：明确划分输出区域和输入区域（自适应终端宽度）
          ===================================================================== */}
      <Box>
        <Text dimColor>{'─'.repeat(terminalWidth)}</Text>
      </Box>

      {/* =====================================================================
          Session 选择器
          ===================================================================== */}
      {showSessionList && (
        <Box flexDirection="column" marginTop={1}>
          <SessionList
            sessions={availableSessions}
            currentCwd={workingDir}
            currentSessionId={sessionId}
            onSelect={handleSelectSession}
            onCancel={handleCancelSessionList}
          />
        </Box>
      )}

      {/* =====================================================================
          Model Selection Dialog
          ===================================================================== */}
      {activeDialog === "models" && (
        <DialogModel
          currentProvider={currentProvider}
          currentModel={currentModel}
          onSelect={handleModelSelect}
          onCancel={handleDialogCancel}
        />
      )}

      {/* =====================================================================
          Provider Selection Dialog
          ===================================================================== */}
      {activeDialog === "provider" && (
        <DialogProvider
          onSelect={handleProviderSelect}
          onCancel={handleDialogCancel}
        />
      )}

      {/* =====================================================================
          底部输入框 + 横线 + 状态栏
          ===================================================================== */}
      <Box flexDirection="column">
        {/* 输入框 */}
        <CommandInput
          isProcessing={isProcessing}
          onSubmit={handleSubmit}
          commandContext={commandContext}
          initialHistory={inputHistory}
          onHistoryChange={handleSaveInputHistory}
          isActive={!activeDialog}
        />

        {/* 底部横线 */}
        <Box>
          <Text dimColor>{'─'.repeat(terminalWidth)}</Text>
        </Box>

        {/* 状态栏 + 快捷提示 合并在一行 */}
        <Box>
          <Text>
            <Text color={contextStatus.color}>
              ▌Context: {contextStatus.percent}%
            </Text>
            <Text dimColor> ({contextStatus.usedK}K / {contextStatus.limitK}K)</Text>
            <Text dimColor> | {modelDisplayName}</Text>
            {agent.isYoloMode() && <Text color="yellow" bold> 🚀 YOLO</Text>}
            {agent.isPlanMode() && <Text color="magenta" bold> 📋 PLAN</Text>}
            {mcpStatus.total > 0 && (
              <Text
                color={
                  mcpStatus.degraded > 0
                    ? "yellow"
                    : mcpStatus.connected === mcpStatus.total
                      ? "green"
                      : "red"
                }
              >
                {" "}
                {mcpStatus.degraded > 0 ? "⚠" : mcpStatus.connected === mcpStatus.total ? "🔌" : "🔴"}
                {" "}MCP {mcpStatus.connected}/{mcpStatus.total}
                {mcpStatus.degraded > 0 && <Text dimColor> ({mcpStatus.degraded} degraded)</Text>}
              </Text>
            )}
            {isProcessing && <Text color="cyan"> ● Processing...</Text>}
            {inputQueue.length > 0 && (
              <Text color="yellow"> ⏳ Queue: {inputQueue.length}</Text>
            )}
            <Text dimColor> | </Text>
            <Text dimColor>
              {isProcessing
                ? "Type to queue • Ctrl+C cancel"
                : "↑↓ History • / Commands • Ctrl+E Expand • Ctrl+O Collapse • Ctrl+H Hide System"
              }
            </Text>
          </Text>
        </Box>
      </Box>
    </Box>
  )
}
