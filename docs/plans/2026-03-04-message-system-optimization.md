# Message System Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 优化消息系统 UI，添加系统消息折叠、Agent 消息分组、颜色编码等改进。

**Architecture:** 扩展 Message 类型，添加消息分组和折叠状态管理，使用 Ink 组件实现可折叠消息。

**Tech Stack:** TypeScript, Ink, React hooks

---

## Overview

当前消息系统改进需求：
1. **系统消息折叠**: 工具调用结果默认折叠，可展开查看
2. **Agent 消息分组**: 同一次思考过程的消息聚合
3. **颜色编码**: 不同类型消息不同颜色边框
4. **消息过滤**: 按类型筛选显示

---

## Task 1: Extend Message Types

**Files:**
- Create: `src/messages/types.ts`
- Modify: `src/App.tsx:42-50` (Message interface)

**Step 1: Create enhanced message types**

```typescript
// src/messages/types.ts

export type MessageRole = "user" | "assistant" | "system" | "tool"

export type MessageType =
  | "text"           // Regular text message
  | "tool_call"      // Tool invocation
  | "tool_result"    // Tool execution result
  | "reasoning"      // Chain of thought
  | "error"          // Error message
  | "notification"   // System notification

export interface MessageMetadata {
  // Grouping
  groupId?: string           // Groups related messages
  groupIndex?: number        // Position within group
  groupSize?: number         // Total messages in group

  // Tool execution
  toolCallId?: string
  toolName?: string
  toolArgs?: Record<string, unknown>

  // Display
  collapsible?: boolean
  collapsed?: boolean
  priority?: "low" | "normal" | "high"

  // Timing
  duration?: number          // Execution time in ms
  timestamp: number
}

export interface Message {
  id: string
  role: MessageRole
  type: MessageType
  content: string
  reasoning?: string
  metadata: MessageMetadata
}

// Group of related messages
export interface MessageGroup {
  id: string
  type: "thinking" | "tool_execution" | "conversation"
  messages: Message[]
  title?: string
  collapsed: boolean
}

// Color scheme for message types
export const MESSAGE_COLORS: Record<MessageType, { border: string; bg: string }> = {
  text: { border: "gray", bg: "transparent" },
  tool_call: { border: "blue", bg: "#1a1a2e" },
  tool_result: { border: "green", bg: "#0a1a0a" },
  reasoning: { border: "yellow", bg: "#1a1a0a" },
  error: { border: "red", bg: "#1a0a0a" },
  notification: { border: "cyan", bg: "#0a1a1a" },
}
```

**Step 2: Run TypeScript check**

Run: `npx tsc --noEmit src/messages/types.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add src/messages/types.ts
git commit -m "feat(messages): add enhanced message types with grouping"
```

---

## Task 2: Create MessageGroup Component

**Files:**
- Create: `src/components/MessageGroup.tsx`

**Step 1: Implement collapsible message group**

```typescript
// src/components/MessageGroup.tsx
import React, { useState } from "react"
import { Box, Text, useInput } from "ink"
import type { MessageGroup as MessageGroupType, Message } from "../messages/types.js"
import { MessageItem } from "./MessageItem.js"

interface MessageGroupProps {
  group: MessageGroupType
  onToggleCollapse?: (groupId: string) => void
}

export function MessageGroup({ group, onToggleCollapse }: MessageGroupProps) {
  const [isCollapsed, setIsCollapsed] = useState(group.collapsed)

  useInput((input, key) => {
    if (key.return) {
      setIsCollapsed(!isCollapsed)
      onToggleCollapse?.(group.id)
    }
  })

  const getGroupIcon = () => {
    switch (group.type) {
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

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Group header */}
      <Box>
        <Text bold>
          {getGroupIcon()} {group.title || "Message Group"}
          {isCollapsed ? ` (${group.messages.length} messages)` : ""}
          {" "}
          <Text dimColor>[Enter to {isCollapsed ? "expand" : "collapse"}]</Text>
        </Text>
      </Box>

      {/* Group content */}
      {!isCollapsed && (
        <Box flexDirection="column" paddingLeft={2}>
          {group.messages.map((message) => (
            <MessageItem key={message.id} message={message} />
          ))}
        </Box>
      )}
    </Box>
  )
}
```

**Step 2: Create MessageItem component**

```typescript
// src/components/MessageItem.tsx
import React from "react"
import { Box, Text } from "ink"
import type { Message } from "../messages/types.js"
import { MESSAGE_COLORS } from "../messages/types.js"

interface MessageItemProps {
  message: Message
  compact?: boolean
}

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
      case "tool":
        return (
          <Box flexDirection="column" borderStyle="round" borderColor={colors.border} paddingX={1}>
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
```

**Step 3: Commit**

```bash
git add src/components/MessageGroup.tsx src/components/MessageItem.tsx
git commit -m "feat(ui): add MessageGroup and MessageItem components"
```

---

## Task 3: Update App.tsx to Use New Components

**Files:**
- Modify: `src/App.tsx:117-150` (replace MessageItem)
- Modify: `src/App.tsx:186-200` (messages state management)

**Step 1: Update message creation helpers**

```typescript
// src/App.tsx
import type { Message, MessageGroup } from "./messages/types.js"
import { MessageGroup as MessageGroupComponent } from "./components/MessageGroup.js"
import { MessageItem } from "./components/MessageItem.js"

// Update create message helpers
function createUserMessage(content: string): Message {
  return {
    id: generateMessageId(),
    role: "user",
    type: "text",
    content,
    metadata: {
      timestamp: Date.now(),
      priority: "normal",
    },
  }
}

function createAssistantMessage(content: string, reasoning?: string): Message {
  return {
    id: generateMessageId(),
    role: "assistant",
    type: "text",
    content,
    reasoning,
    metadata: {
      timestamp: Date.now(),
      priority: "normal",
    },
  }
}

function createSystemMessage(content: string, type: Message["type"] = "notification"): Message {
  return {
    id: generateMessageId(),
    role: "system",
    type,
    content,
    metadata: {
      timestamp: Date.now(),
      priority: "low",
      collapsible: true,
      collapsed: true,  // System messages collapsed by default
    },
  }
}

function createToolMessage(toolName: string, args: Record<string, unknown>, result: string): Message {
  return {
    id: generateMessageId(),
    role: "tool",
    type: "tool_result",
    content: result,
    metadata: {
      timestamp: Date.now(),
      toolName,
      toolArgs: args,
      collapsible: true,
      collapsed: true,  // Tool results collapsed by default
      priority: "low",
    },
  }
}
```

**Step 2: Add message grouping logic**

```typescript
// Add to App component
const [messageGroups, setMessageGroups] = useState<MessageGroup[]>([])

// Group messages by tool execution or thinking session
const groupMessages = (msgs: Message[]): MessageGroup[] => {
  const groups: MessageGroup[] = []
  let currentGroup: Message[] = []
  let currentGroupType: MessageGroup["type"] = "conversation"

  for (const msg of msgs) {
    // Start new group on tool execution
    if (msg.type === "tool_call" || msg.type === "tool_result") {
      if (currentGroup.length > 0) {
        groups.push({
          id: `group-${groups.length}`,
          type: currentGroupType,
          messages: currentGroup,
          collapsed: currentGroupType !== "conversation",
        })
      }
      currentGroup = [msg]
      currentGroupType = "tool_execution"
    } else if (msg.reasoning) {
      // Group reasoning messages
      if (currentGroupType !== "thinking") {
        if (currentGroup.length > 0) {
          groups.push({
            id: `group-${groups.length}`,
            type: currentGroupType,
            messages: currentGroup,
            collapsed: currentGroupType !== "conversation",
          })
        }
        currentGroup = [msg]
        currentGroupType = "thinking"
      } else {
        currentGroup.push(msg)
      }
    } else {
      // Regular conversation
      if (currentGroupType !== "conversation") {
        if (currentGroup.length > 0) {
          groups.push({
            id: `group-${groups.length}`,
            type: currentGroupType,
            messages: currentGroup,
            collapsed: true,
          })
        }
        currentGroup = [msg]
        currentGroupType = "conversation"
      } else {
        currentGroup.push(msg)
      }
    }
  }

  // Add final group
  if (currentGroup.length > 0) {
    groups.push({
      id: `group-${groups.length}`,
      type: currentGroupType,
      messages: currentGroup,
      collapsed: currentGroupType !== "conversation",
    })
  }

  return groups
}
```

**Step 3: Update message rendering**

```typescript
// Replace the Static component content
<Static items={messageGroups}>
  {(group) => (
    <MessageGroupComponent
      key={group.id}
      group={group}
      onToggleCollapse={(groupId) => {
        setMessageGroups(prev =>
          prev.map(g =>
            g.id === groupId ? { ...g, collapsed: !g.collapsed } : g
          )
        )
      }}
    />
  )}
</Static>
```

**Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): integrate message grouping and new components"
```

---

## Task 4: Add Message Filter Tool

**Files:**
- Create: `src/tools/message-filter.ts`

**Step 1: Create message filter tool**

```typescript
// src/tools/message-filter.ts
import { z } from "zod"
import type { Tool } from "../types.js"

/**
 * Filter visible messages
 */
export const filterMessagesTool: Tool = {
  name: "filter_messages",
  description: `Filter which types of messages are displayed.

Options:
- show_all: Show all messages (default)
- hide_system: Hide system/tool messages
- show_errors_only: Only show error messages
- compact: Collapse all groups

Example: filter_messages mode="hide_system"`,

  parameters: z.object({
    mode: z.enum(["show_all", "hide_system", "show_errors_only", "compact"])
      .describe("Filter mode"),
  }),

  execute: async (params, ctx) => {
    // Store filter preference in context or app state
    ctx.messageFilter = params.mode

    const descriptions: Record<string, string> = {
      show_all: "Showing all messages",
      hide_system: "Hiding system and tool messages",
      show_errors_only: "Showing only error messages",
      compact: "All message groups collapsed",
    }

    return descriptions[params.mode]
  },
}
```

**Step 2: Register tool**

```typescript
// src/tools/index.ts
import { filterMessagesTool } from "./message-filter.js"

const allTools = [
  // ... existing tools ...
  filterMessagesTool,
]
```

**Step 3: Commit**

```bash
git add src/tools/message-filter.ts src/tools/index.ts
git commit -m "feat(tools): add message filter tool"
```

---

## Task 5: Add Keyboard Shortcuts for Message Navigation

**Files:**
- Modify: `src/App.tsx` (add keyboard handlers)

**Step 1: Add message navigation shortcuts**

```typescript
// In App component, add keyboard handling
useInput((input, key) => {
  // Ctrl+E: Expand all
  if (key.ctrl && input === "e") {
    setMessageGroups(prev =>
      prev.map(g => ({ ...g, collapsed: false }))
    )
  }

  // Ctrl+C: Collapse all
  if (key.ctrl && input === "c") {
    setMessageGroups(prev =>
      prev.map(g => ({ ...g, collapsed: true }))
    )
  }

  // Ctrl+H: Hide system messages
  if (key.ctrl && input === "h") {
    setMessageGroups(prev =>
      prev.map(g =>
        g.type === "tool_execution" ? { ...g, collapsed: true } : g
      )
    )
  }
})
```

**Step 2: Update help/status bar**

```typescript
// In status bar
<Text dimColor>
  Ctrl+E Expand • Ctrl+C Collapse • Ctrl+H Hide System
</Text>
```

**Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(ui): add message navigation keyboard shortcuts"
```

---

## Task 6: Add Tests

**Files:**
- Create: `src/messages/__tests__/grouping.test.ts`

**Step 1: Write grouping tests**

```typescript
import { describe, it, expect } from "vitest"
import type { Message, MessageGroup } from "../types.js"

describe("Message Grouping", () => {
  const createMessage = (overrides: Partial<Message> = {}): Message => ({
    id: "test",
    role: "assistant",
    type: "text",
    content: "test",
    metadata: { timestamp: Date.now() },
    ...overrides,
  })

  it("should group consecutive reasoning messages", () => {
    const messages: Message[] = [
      createMessage({ reasoning: "Thinking...", type: "reasoning" }),
      createMessage({ content: "Result", type: "text" }),
    ]

    // Grouping logic test
    expect(messages[0].type).toBe("reasoning")
  })

  it("should collapse tool execution groups by default", () => {
    const group: MessageGroup = {
      id: "test-group",
      type: "tool_execution",
      messages: [],
      collapsed: true,
    }

    expect(group.collapsed).toBe(true)
  })
})
```

**Step 2: Run tests**

Run: `npm test -- --run src/messages/__tests__/grouping.test.ts`
Expected: All tests pass

**Step 3: Commit**

```bash
git add src/messages/__tests__/grouping.test.ts
git commit -m "test(messages): add message grouping tests"
```

---

## Task 7: Update Documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add message system documentation**

```markdown
### Message System

Messages are organized into collapsible groups:

**Group Types:**
- 💬 **Conversation**: Regular user/assistant messages (expanded by default)
- 💭 **Thinking**: Reasoning chains (collapsed by default)
- 🔧 **Tool Execution**: Tool calls and results (collapsed by default)

**Keyboard Shortcuts:**
- `Ctrl+E`: Expand all groups
- `Ctrl+C`: Collapse all groups
- `Ctrl+H`: Hide system messages
- `Enter`: Toggle individual group

**Message Filters:**
```
/filter_messages mode=hide_system    # Hide system/tool messages
/filter_messages mode=compact        # Collapse all groups
```

**Color Coding:**
- Blue: Tool calls
- Green: Tool results
- Yellow: Reasoning
- Red: Errors
- Cyan: Notifications
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add message system documentation"
```

---

## Summary

This implementation adds:

1. **Enhanced Message Types**: Type metadata, grouping info, collapsible state
2. **MessageGroup Component**: Collapsible message groups with icons
3. **Color Coding**: Different colors for different message types
4. **MessageItem Component**: Enhanced individual message rendering
5. **Keyboard Shortcuts**: Ctrl+E/C/H for navigation
6. **Filter Tool**: /filter_messages command
7. **Test Coverage**: Grouping logic tests

**Total estimated time**: 1-2 days
**Breaking changes**: Message interface extended (backward compatible)
**UI impact**: Significant improvement in readability
