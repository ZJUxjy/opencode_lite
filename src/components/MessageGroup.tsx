/**
 * MessageGroup Component
 *
 * Renders a collapsible group of related messages.
 * Keyboard handling is done in App.tsx, not here.
 */
import React from "react"
import { Box, Text } from "ink"
import type { MessageGroup as MessageGroupType } from "../messages/types.js"
import { MessageItem } from "./MessageItem.js"

interface MessageGroupProps {
  group: MessageGroupType
}

/**
 * Get icon for group type
 */
function getGroupIcon(type: MessageGroupType["type"]): string {
  switch (type) {
    case "thinking":
      return "💭"
    case "tool_execution":
      return "🔧"
    case "conversation":
      return "💬"
    default:
      return "📄"
  }
}

/**
 * Collapsible message group component
 *
 * Note: Collapse state is managed by the parent (App.tsx)
 * This component only renders the current state
 */
export function MessageGroup({ group }: MessageGroupProps) {
  const icon = getGroupIcon(group.type)
  const messageCount = group.messages.length

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Group header */}
      <Box>
        <Text bold>
          {icon} {group.title || "Message Group"}
          {group.collapsed && messageCount > 1 && (
            <Text dimColor> ({messageCount} messages)</Text>
          )}
        </Text>
      </Box>

      {/* Group content */}
      {!group.collapsed && (
        <Box flexDirection="column" paddingLeft={2}>
          {group.messages.map((message) => (
            <MessageItem key={message.id} message={message} />
          ))}
        </Box>
      )}
    </Box>
  )
}
