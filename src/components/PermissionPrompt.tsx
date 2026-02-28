import React, { useState, useEffect } from "react"
import { Box, Text, useInput } from "ink"
import type { PermissionPromptProps, PermissionDecision } from "../commands/types.js"

/** Permission options for selection */
const OPTIONS: { label: string; value: PermissionDecision; color: string; description: string }[] = [
  { label: "Allow Once", value: "allow", color: "cyan", description: "Allow this action once" },
  { label: "Always Allow", value: "always", color: "green", description: "Always allow this type of action" },
  { label: "Deny", value: "deny", color: "red", description: "Reject this action" },
]

/**
 * PermissionPrompt - UI component for permission requests
 *
 * Displays when the agent wants to perform a sensitive action
 * and needs user approval.
 *
 * Layout:
 * ┌─────────────────────────────────────────────┐
 * │ ⚠️  Permission Request                       │
 * │                                             │
 * │ Tool: write                                 │
 * │ File: /path/to/file.ts                      │
 * │                                             │
 * │ ❯ Allow Once                                │
 * │   Always Allow                              │
 * │   Deny                                      │
 * │                                             │
 * │ ↑↓ Navigate  Enter Confirm  Esc Deny       │
 * └─────────────────────────────────────────────┘
 */
export function PermissionPrompt({
  request,
  onDecision,
  visible,
}: PermissionPromptProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Reset selection when prompt becomes visible
  useEffect(() => {
    if (visible) {
      setSelectedIndex(0)
    }
  }, [visible])

  // Handle keyboard navigation
  useInput(
    (input, key) => {
      if (!visible) return

      // Arrow navigation
      if (key.upArrow) {
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : OPTIONS.length - 1))
        return
      }
      if (key.downArrow) {
        setSelectedIndex((prev) => (prev < OPTIONS.length - 1 ? prev + 1 : 0))
        return
      }

      // Enter confirms selection
      if (key.return) {
        onDecision(OPTIONS[selectedIndex].value)
        return
      }

      // Escape denies (quick reject)
      if (key.escape) {
        onDecision("deny")
        return
      }

      // Number keys as shortcuts
      if (input === "1") {
        onDecision("allow")
        return
      }
      if (input === "2") {
        onDecision("always")
        return
      }
      if (input === "3") {
        onDecision("deny")
        return
      }
    },
    { isActive: visible }
  )

  if (!visible) {
    return null
  }

  // Format args for display
  const formatArgs = (args: Record<string, unknown>): string => {
    const entries = Object.entries(args)
    if (entries.length === 0) return ""

    // Show file_path prominently if present
    if (args.file_path || args.path) {
      const path = args.file_path || args.path
      return `Path: ${path}`
    }

    // Show command prominently for bash
    if (args.command) {
      return `Command: ${args.command}`
    }

    // Default: show first arg
    const [key, value] = entries[0]
    const valueStr =
      typeof value === "string"
        ? value.length > 60
          ? value.slice(0, 60) + "..."
          : value
        : JSON.stringify(value).slice(0, 60)
    return `${key}: ${valueStr}`
  }

  // Get tool icon
  const getToolIcon = (toolName: string): string => {
    switch (toolName) {
      case "write":
        return "📝"
      case "edit":
        return "✏️"
      case "bash":
        return "⚡"
      default:
        return "🔧"
    }
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
      marginY={1}
    >
      {/* Header */}
      <Box>
        <Text bold color="yellow">
          ⚠️ Permission Request
        </Text>
      </Box>

      {/* Tool info */}
      <Box marginTop={1}>
        <Text>
          <Text dimColor>Tool: </Text>
          <Text bold>
            {getToolIcon(request.toolName)} {request.toolName}
          </Text>
        </Text>
      </Box>

      {/* Description or args */}
      <Box>
        <Text dimColor>
          {request.description || formatArgs(request.args)}
        </Text>
      </Box>

      {/* Options with highlight selection */}
      <Box flexDirection="column" marginTop={1}>
        {OPTIONS.map((option, index) => {
          const isSelected = index === selectedIndex
          return (
            <Box key={option.value}>
              <Text
                color={isSelected ? option.color : undefined}
                bold={isSelected}
                inverse={isSelected}
              >
                {isSelected ? " ❯ " : "   "}
                {option.label}
                {isSelected ? " " : ""}
              </Text>
            </Box>
          )
        })}
      </Box>

      {/* Hint */}
      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ Navigate  Enter Confirm  Esc Deny  (or press 1/2/3)
        </Text>
      </Box>
    </Box>
  )
}
