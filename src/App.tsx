import React, { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { Box, Text, Static, useInput, useApp, useStdout } from "ink"
import Spinner from "ink-spinner"
import { Agent, type AgentEvents } from "./agent.js"
import { CommandInput } from "./components/CommandInput.js"
import { PermissionPrompt } from "./components/PermissionPrompt.js"
import type { CommandContext, PermissionRequest, PermissionDecision } from "./commands/types.js"
import type { ToolCall } from "./types.js"
import type { PolicyDecision } from "./policy.js"

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
}

interface Message {
  id: string  // 稳定的唯一 ID，避免使用索引作为 key
  role: "user" | "assistant" | "system"
  content: string
  reasoning?: string
  timestamp: number
}

// ============================================================================
// 工具函数
// ============================================================================

// 全局计数器，确保同一毫秒内的 ID 唯一
let messageCounter = 0

/**
 * 生成唯一的消息 ID
 */
function generateMessageId(): string {
  const timestamp = Date.now()
  const counter = messageCounter++
  const random = Math.random().toString(36).slice(2, 6)
  return `msg-${timestamp}-${counter}-${random}`
}

/**
 * 创建用户消息
 */
function createUserMessage(content: string): Message {
  return {
    id: generateMessageId(),
    role: "user",
    content,
    timestamp: Date.now(),
  }
}

/**
 * 创建助手消息
 */
function createAssistantMessage(content: string, reasoning?: string): Message {
  return {
    id: generateMessageId(),
    role: "assistant",
    content,
    reasoning,
    timestamp: Date.now(),
  }
}

/**
 * 创建系统消息
 */
function createSystemMessage(content: string): Message {
  return {
    id: generateMessageId(),
    role: "system",
    content,
    timestamp: Date.now(),
  }
}

// ============================================================================
// 消息渲染组件
// ============================================================================

interface MessageItemProps {
  message: Message
}

/**
 * 单条消息渲染组件
 * 注意：必须使用 message.id 作为 key，不能使用索引
 * 长文本会自动换行
 */
function MessageItem({ message }: MessageItemProps) {
  if (message.role === "user") {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text wrap="wrap">
          <Text bold color="blue">&gt; </Text>
          <Text>{message.content}</Text>
        </Text>
      </Box>
    )
  }

  if (message.role === "assistant") {
    return (
      <Box flexDirection="column" marginBottom={1}>
        {message.reasoning && (
          <Text dimColor color="gray" wrap="wrap">
            💭 {message.reasoning.length > 200
              ? message.reasoning.slice(0, 200) + "..."
              : message.reasoning}
          </Text>
        )}
        <Text wrap="wrap">{message.content}</Text>
      </Box>
    )
  }

  // system
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor wrap="wrap">{message.content}</Text>
    </Box>
  )
}

// ============================================================================
// 主组件
// ============================================================================

export function App({ agent, model, baseURL, sessionId, workingDir }: Props) {
  const { exit } = useApp()
  const { stdout } = useStdout()

  // 终端宽度
  const terminalWidth = stdout?.columns || 80

  // =========================================================================
  // 状态管理
  // =========================================================================

  // 已完成的消息列表（会进入 Static 组件）
  const [messages, setMessages] = useState<Message[]>([])

  // 处理状态
  const [isProcessing, setIsProcessing] = useState(false)

  // 上下文使用情况 - 初始化时直接从 agent 获取，避免重复渲染
  const [contextUsage, setContextUsage] = useState(() => agent.getContextUsage())

  // =========================================================================
  // 权限请求状态
  // =========================================================================

  // 当前待处理的权限请求
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null)
  // 用于 resolve 权限请求的 Promise
  const permissionResolveRef = useRef<((decision: PolicyDecision) => void) | null>(null)

  /**
   * 处理权限请求
   * 当 Agent 需要用户授权时调用
   */
  const handlePolicyAsk = useCallback((toolCall: ToolCall): Promise<PolicyDecision> => {
    return new Promise((resolve) => {
      permissionResolveRef.current = resolve
      setPermissionRequest({
        id: toolCall.id,
        toolName: toolCall.name,
        description: getToolDescription(toolCall),
        args: toolCall.arguments,
      })
    })
  }, [])

  /**
   * 处理用户决策
   */
  const handlePermissionDecision = useCallback((decision: PermissionDecision) => {
    if (permissionResolveRef.current) {
      // 转换决策类型：PermissionDecision -> PolicyDecision
      const policyDecision: PolicyDecision = decision === "always" ? "allow" : decision
      permissionResolveRef.current(policyDecision)

      // 如果是 "always"，让 policy engine 学习
      if (decision === "always" && permissionRequest) {
        agent.getPolicyEngine().learn(
          permissionRequest.toolName,
          permissionRequest.args,
          "allow",
          true
        )
      }

      permissionResolveRef.current = null
      setPermissionRequest(null)
    }
  }, [agent, permissionRequest])

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

  const commandContext: CommandContext = useMemo(
    () => ({
      agent,
      setMessages,
      exit,
      updateContextUsage,
    }),
    [agent, setMessages, exit, updateContextUsage]
  )

  // =========================================================================
  // 处理用户输入
  // =========================================================================

  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim()
    if (!trimmed || isProcessing) return

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
          args: JSON.stringify(toolCall.arguments)
        })
      },

      onToolResult: (toolCall, result) => {
        // 工具调用完成后，添加到消息历史
        const toolMessage = createAssistantMessage(
          `🔧 ${toolCall.name}\n✅ ${result.slice(0, 200)}${result.length > 200 ? "..." : ""}`
        )
        setMessages(prev => [...prev, toolMessage])
        setCurrentTool(null)
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
    } catch (error: any) {
      // 如果是用户取消，不显示错误（已经在上面的 useInput 中处理了）
      if (error.message?.includes("cancelled by user")) {
        // 用户取消，静默处理
        setIsProcessing(false)
        updateContextUsage()
        return
      }

      let errorMessage = error.message || "Unknown error"

      if (error.message?.includes("timed out")) {
        errorMessage = `Request timed out. Please check your network connection or try again.`
      } else if (error.message?.includes("ECONNREFUSED") || error.message?.includes("ENOTFOUND")) {
        errorMessage = `Network error: Unable to connect to the API. Please check your base URL.`
      } else if (error.message?.includes("401") || error.message?.includes("Unauthorized")) {
        errorMessage = `Authentication error: Please check your API key.`
      } else if (error.message?.includes("429")) {
        errorMessage = `Rate limited: Too many requests. Please wait a moment and try again.`
      }

      const errorMessageObj = createSystemMessage(`❌ Error: ${errorMessage}`)
      setMessages(prev => [...prev, errorMessageObj])
    }

    setIsProcessing(false)
    updateContextUsage()
  }, [agent, isProcessing])

  // =========================================================================
  // 键盘快捷键
  // =========================================================================

  useInput((input, key) => {
    // Ctrl+C: Exit
    if (key.ctrl && input === "c") {
      exit()
    }

    // Escape: Cancel ongoing request
    if (key.escape && isProcessing) {
      agent.abort()
      const cancelMessage = createSystemMessage("⚠️ Request cancelled by user")
      setMessages(prev => [...prev, cancelMessage])
      setIsProcessing(false)
      updateContextUsage()
    }
  })

  // =========================================================================
  // 初始化
  // =========================================================================

  useEffect(() => {
    updateContextUsage()
  }, [updateContextUsage])

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

  // =========================================================================
  // 渲染
  // =========================================================================

  return (
    <Box flexDirection="column">
      {/* =====================================================================
          Static 区域：已完成的消息

          关键点：
          1. 使用 message.id 作为 key，而不是索引
          2. 只包含已完成的消息，不包含流式内容
          3. Static 组件会将内容输出到主缓冲区，支持滚动
          ===================================================================== */}
      <Static items={messages}>
        {(message) => (
          <MessageItem key={message.id} message={message} />
        )}
      </Static>

      {/* =====================================================================
          动态区域：流式输出和工具调用

          这部分内容会频繁更新，不会进入 Static
          ===================================================================== */}
      <Box flexDirection="column" marginBottom={1} width={terminalWidth}>
        {/* 思考过程流式输出 */}
        {displayReasoning && (
          <Box marginBottom={1} flexDirection="column">
            <Text dimColor italic wrap="wrap">
              💭 {displayReasoning}
              {isProcessing && <Text dimColor>▌</Text>}
            </Text>
          </Box>
        )}

        {/* 流式文本输出 */}
        {(displayText || isProcessing) && (
          <Box marginBottom={1}>
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
          分隔线：明确划分输出区域和输入区域（自适应终端宽度）
          ===================================================================== */}
      <Box marginBottom={1}>
        <Text dimColor>{'─'.repeat(terminalWidth)}</Text>
      </Box>

      {/* =====================================================================
          底部状态栏 + 输入框
          ===================================================================== */}
      <Box flexDirection="column">
        {/* 状态栏 */}
        <Box marginBottom={1}>
          <Text>
            <Text color={contextStatus.color}>
              ▌Context: {contextStatus.percent}%
            </Text>
            <Text dimColor> ({contextStatus.usedK}K / {contextStatus.limitK}K)</Text>
            {agent.isYoloMode() && <Text color="yellow" bold> 🚀 YOLO</Text>}
            {agent.isPlanMode() && <Text color="magenta" bold> 📋 PLAN</Text>}
            {isProcessing && <Text color="cyan"> ● Processing...</Text>}
          </Text>
        </Box>

        {/* 输入框 - 限制宽度防止溢出 */}
        <CommandInput
          isProcessing={isProcessing}
          onSubmit={handleSubmit}
          commandContext={commandContext}
        />
      </Box>
    </Box>
  )
}
