/**
 * MessageItem Component
 *
 * Renders a single message with appropriate styling based on type and role.
 */
import React from "react"
import { Box, Text } from "ink"
import type { UIMessage } from "../messages/types.js"
import { MESSAGE_COLORS } from "../messages/types.js"

interface MessageItemProps {
  message: UIMessage
  compact?: boolean
}

/**
 * Single message rendering component
 * - User messages: blue ">" prefix
 * - Assistant messages: with optional reasoning
 * - Tool messages: colored border with tool name
 * - System messages: dimmed
 */
export function MessageItem({ message, compact = false }: MessageItemProps) {
  const colors = MESSAGE_COLORS[message.type]

  const renderContent = () => {
    switch (message.role) {
      case "user":
        return (
          <Box flexDirection="column">
            <Text wrap="wrap">
              <Text bold color="blue">{"> "}</Text>
              <Text>{message.content}</Text>
            </Text>
          </Box>
        )

      case "assistant":
        return (
          <Box flexDirection="column">
            {message.reasoning && (
              <Text dimColor color="gray" wrap="wrap">
                💭 {compact
                  ? message.reasoning.slice(0, 100) + "..."
                  : message.reasoning}
              </Text>
            )}
            <Text wrap="wrap">{message.content}</Text>
          </Box>
        )

      case "system":
        return (
          <Box flexDirection="column">
            <Text dimColor wrap="wrap">{message.content}</Text>
          </Box>
        )

      case "tool":
        return (
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={colors.border}
            paddingX={1}
          >
            {message.metadata.toolName && (
              <Text bold color={colors.border}>
                {message.metadata.toolName}
              </Text>
            )}
            <Text dimColor wrap="wrap">{message.content}</Text>
          </Box>
        )

      default:
        return <Text wrap="wrap">{message.content}</Text>
    }
  }

  return (
    <Box flexDirection="column" marginBottom={compact ? 0 : 1}>
      {renderContent()}
    </Box>
  )
}
