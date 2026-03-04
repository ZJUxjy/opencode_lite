/**
 * Enhanced Message Types for UI
 *
 * This module defines the message types used by the TUI layer.
 * It extends the core Message type with grouping, metadata, and display properties.
 */

// ============================================================================
// Type Definitions
// ============================================================================

export type MessageRole = "user" | "assistant" | "system" | "tool"

export type MessageType =
  | "text"           // Regular text message
  | "tool_call"      // Tool invocation
  | "tool_result"    // Tool execution result
  | "reasoning"      // Chain of thought
  | "error"          // Error message
  | "notification"   // System notification

/**
 * Message filter modes
 */
export type MessageFilter =
  | "show_all"       // Show all messages
  | "hide_system"    // Hide system/tool messages
  | "show_errors_only" // Only show error messages
  | "compact"        // Collapse all groups

/**
 * Metadata for message display and grouping
 */
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

/**
 * UI Message type with full metadata
 */
export interface UIMessage {
  id: string
  role: MessageRole
  type: MessageType
  content: string
  reasoning?: string
  metadata: MessageMetadata
}

/**
 * Group of related messages
 */
export interface MessageGroup {
  id: string
  type: "thinking" | "tool_execution" | "conversation"
  messages: UIMessage[]
  title?: string
  collapsed: boolean
}

// ============================================================================
// Color Scheme
// ============================================================================

/**
 * Color scheme for message types
 * - border: Border color for the message box
 * - bg: Background color (hex string)
 */
export const MESSAGE_COLORS: Record<MessageType, { border: string; bg: string }> = {
  text: { border: "gray", bg: "transparent" },
  tool_call: { border: "blue", bg: "#1a1a2e" },
  tool_result: { border: "green", bg: "#0a1a0a" },
  reasoning: { border: "yellow", bg: "#1a1a0a" },
  error: { border: "red", bg: "#1a0a0a" },
  notification: { border: "cyan", bg: "#0a1a1a" },
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique message ID
 */
let messageCounter = 0

export function generateMessageId(): string {
  const timestamp = Date.now()
  const counter = messageCounter++
  const random = Math.random().toString(36).slice(2, 6)
  return `msg-${timestamp}-${counter}-${random}`
}

/**
 * Create a user message
 */
export function createUserMessage(content: string): UIMessage {
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

/**
 * Create an assistant message
 */
export function createAssistantMessage(content: string, reasoning?: string): UIMessage {
  return {
    id: generateMessageId(),
    role: "assistant",
    type: reasoning ? "reasoning" : "text",
    content,
    reasoning,
    metadata: {
      timestamp: Date.now(),
      priority: "normal",
    },
  }
}

/**
 * Create a system message
 */
export function createSystemMessage(content: string, type: MessageType = "notification"): UIMessage {
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

/**
 * Create a tool result message
 */
export function createToolMessage(
  toolName: string,
  args: Record<string, unknown>,
  result: string,
  isError?: boolean
): UIMessage {
  return {
    id: generateMessageId(),
    role: "tool",
    type: isError ? "error" : "tool_result",
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

/**
 * Create a tool call message
 */
export function createToolCallMessage(
  toolName: string,
  args: Record<string, unknown>
): UIMessage {
  return {
    id: generateMessageId(),
    role: "tool",
    type: "tool_call",
    content: `${toolName}(${JSON.stringify(args)})`,
    metadata: {
      timestamp: Date.now(),
      toolName,
      toolArgs: args,
      priority: "normal",
    },
  }
}
