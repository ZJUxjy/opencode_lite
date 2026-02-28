/**
 * SessionList - 交互式会话选择器
 *
 * 遵循奥卡姆剃刀原则：简单、直接、无过度设计
 * 功能：列出会话 → 选择 → 确认
 */

import React, { useState, useMemo } from "react"
import { Box, Text, useInput } from "ink"
import type { Session } from "../session/index.js"

interface Props {
  sessions: Session[]
  currentCwd: string
  currentSessionId?: string
  onSelect: (sessionId: string) => void
  onCancel: () => void
}

/**
 * 格式化相对时间
 */
function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - timestamp

  if (diff < 60) return "刚刚"
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  if (diff < 172800) return "昨天"
  if (diff < 604800) return `${Math.floor(diff / 86400)}天前`

  const date = new Date(timestamp * 1000)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

/**
 * 截断文本
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 3) + "..."
}

export function SessionList({
  sessions,
  currentCwd,
  currentSessionId,
  onSelect,
  onCancel,
}: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  // 按更新时间排序
  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  }, [sessions])

  // 键盘导航
  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : sortedSessions.length - 1
      )
    } else if (key.downArrow) {
      setSelectedIndex((prev) =>
        prev < sortedSessions.length - 1 ? prev + 1 : 0
      )
    } else if (key.return) {
      const session = sortedSessions[selectedIndex]
      if (session) {
        onSelect(session.id)
      }
    } else if (key.escape || input === "q") {
      onCancel()
    }
  })

  if (sortedSessions.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text dimColor>没有可用的会话</Text>
        <Text dimColor>按 Esc 或 q 退出</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" padding={1}>
      {/* 标题 */}
      <Text bold underline>
        选择要恢复的会话
      </Text>
      <Text dimColor>
        ↑/↓ 导航, Enter 选择, Esc/q 取消
      </Text>
      <Box marginTop={1} />

      {/* 会话列表 */}
      {sortedSessions.map((session, index) => {
        const isSelected = index === selectedIndex
        const isCurrentSession = session.id === currentSessionId
        const isCurrentDir = session.cwd === currentCwd

        return (
          <Box key={session.id}>
            <Text
              bold={isSelected}
              color={isSelected ? "cyan" : undefined}
              dimColor={!isSelected}
            >
              {isSelected ? "▸ " : "  "}
              {truncate(session.title, 40)}
              <Text dimColor>
                {" "}
                ({session.messageCount}条消息, {formatRelativeTime(session.updatedAt)})
                {isCurrentSession && " [当前会话]"}
                {isCurrentDir && !isCurrentSession && " [当前目录]"}
              </Text>
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}
