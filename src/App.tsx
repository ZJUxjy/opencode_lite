import React, { useState, useEffect, useCallback, useRef } from "react"
import { Box, Text, useInput, useApp } from "ink"
import TextInput from "ink-text-input"
import Spinner from "ink-spinner"
import { Agent, type AgentEvents } from "./agent.js"

interface Props {
  agent: Agent
  model: string
  baseURL: string
  sessionId: string
  workingDir: string
}

interface Message {
  role: "user" | "assistant" | "system"
  content: string
  isStreaming?: boolean
  toolCall?: { name: string; args: string }
}

export function App({ agent, model, baseURL, sessionId, workingDir }: Props) {
  const { exit } = useApp()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)
  const [streamingText, setStreamingText] = useState("")
  const [currentTool, setCurrentTool] = useState<{ name: string; args: string } | null>(null)
  const [contextUsage, setContextUsage] = useState({ used: 0, limit: 0, percentage: 0 })
  const messagesEndRef = useRef<number>(0)
  const [pulseIndex, setPulseIndex] = useState(0)

  // 颜色脉冲动画
  useEffect(() => {
    const timer = setInterval(() => {
      setPulseIndex(prev => (prev + 1) % 3)
    }, 300)
    return () => clearInterval(timer)
  }, [])

  // 更新上下文使用情况
  const updateContextUsage = useCallback(() => {
    const usage = agent.getContextUsage()
    setContextUsage(usage)
  }, [agent])

  // 处理用户输入
  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim()
    if (!trimmed || isProcessing) return

    setInput("")

    // 处理命令
    if (trimmed === "/exit" || trimmed === "/quit") {
      exit()
      return
    }

    if (trimmed === "/clear") {
      agent.clearSession()
      setMessages([])
      updateContextUsage()
      return
    }

    if (trimmed === "/help") {
      setMessages(prev => [...prev, {
        role: "system",
        content: `Commands:
  /exit, /quit  - Exit the program
  /clear        - Clear current session
  /help         - Show this help`
      }])
      return
    }

    // 添加用户消息
    setMessages(prev => [...prev, { role: "user", content: trimmed }])
    setIsProcessing(true)
    setStreamingText("")
    setCurrentTool(null)

    // 设置事件回调
    const events: AgentEvents = {
      onThinking: () => {
        // Don't set streaming text - let the animated "Thinking..." show
      },
      onTextDelta: (text) => {
        setStreamingText(prev => prev === "🤖 Thinking..." ? text : prev + text)
      },
      onToolCall: (toolCall) => {
        setCurrentTool({ name: toolCall.name, args: JSON.stringify(toolCall.arguments) })
      },
      onToolResult: (toolCall, result) => {
        setMessages(prev => [...prev, {
          role: "assistant",
          content: `🔧 ${toolCall.name}\n✅ ${result.slice(0, 200)}${result.length > 200 ? "..." : ""}`
        }])
        setCurrentTool(null)
      },
      onResponse: (content) => {
        if (content && streamingText !== "🤖 Thinking...") {
          setMessages(prev => [...prev, { role: "assistant", content }])
        }
        setStreamingText("")
      },
      onCompress: (before, after) => {
        setMessages(prev => [...prev, {
          role: "system",
          content: `📦 Compressed: ${before} → ${after} tokens`
        }])
      }
    }

    agent.setEvents(events)

    try {
      await agent.run(trimmed)
    } catch (error: any) {
      setMessages(prev => [...prev, {
        role: "system",
        content: `❌ Error: ${error.message}`
      }])
    }

    setIsProcessing(false)
    updateContextUsage()
  }, [agent, isProcessing, exit, updateContextUsage])

  // 键盘快捷键
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit()
    }
  })

  // 初始化
  useEffect(() => {
    updateContextUsage()
  }, [updateContextUsage])

  // 格式化上下文状态
  const formatContextStatus = () => {
    const percent = Math.round(contextUsage.percentage * 100)
    const color = percent >= 92 ? "red" : percent >= 80 ? "yellow" : "green"
    const usedK = (contextUsage.used / 1000).toFixed(1)
    const limitK = (contextUsage.limit / 1000).toFixed(0)
    return (
      <Text>
        <Text color={color}>▌ Context: {percent}%</Text>
        <Text dimColor> ({usedK}K / {limitK}K)</Text>
      </Text>
    )
  }

  return (
    <Box flexDirection="column" height="100%">
      {/* 标题栏 */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">Lite OpenCode v1.0.0</Text>
        <Text dimColor>Model: {model} | Session: {sessionId}</Text>
      </Box>

      {/* 消息区域 */}
      <Box flexDirection="column" flexGrow={1} marginBottom={1}>
        {messages.map((msg, i) => (
          <Box key={i} flexDirection="column" marginBottom={1}>
            {msg.role === "user" && (
              <Text>
                <Text bold color="blue">&gt; </Text>
                <Text>{msg.content}</Text>
              </Text>
            )}
            {msg.role === "assistant" && (
              <Text>{msg.content}</Text>
            )}
            {msg.role === "system" && (
              <Text dimColor>{msg.content}</Text>
            )}
          </Box>
        ))}

        {/* 流式输出 */}
        {(streamingText || isProcessing) && (
          <Box marginBottom={1}>
            {streamingText ? (
              <Text>
                {streamingText}
                {isProcessing && <Text dimColor>▌</Text>}
              </Text>
            ) : (
              <Box>
                <Text>
                  <Text color="cyan">
                    <Spinner type="dots" />
                  </Text>
                  <Text> </Text>
                  <Text color="cyan">Thinking</Text>
                  {/* Pulsing dots: 浅色=亮 深色=暗 */}
                  {/* State 0: 亮暗暗, State 1: 亮亮暗, State 2: 亮亮亮 */}
                  <Text dimColor={false}>.</Text>
                  <Text dimColor={pulseIndex === 0}>.</Text>
                  <Text dimColor={pulseIndex < 2}>.</Text>
                </Text>
              </Box>
            )}
          </Box>
        )}

        {/* 当前工具调用 */}
        {currentTool && (
          <Box marginBottom={1}>
            <Text color="yellow">
              🔧 {currentTool.name}({currentTool.args})
            </Text>
          </Box>
        )}
      </Box>

      {/* 底部状态栏 + 输入框 */}
      <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
        {/* 状态栏 */}
        <Box>
          {formatContextStatus()}
          {isProcessing && <Text dimColor> | Processing...</Text>}
        </Box>

        {/* 输入框 */}
        <Box>
          <Text bold color="cyan">&gt; </Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            placeholder={isProcessing ? "Waiting for response..." : "Type a message... (/help for commands)"}
            showCursor={!isProcessing}
          />
        </Box>
      </Box>
    </Box>
  )
}
