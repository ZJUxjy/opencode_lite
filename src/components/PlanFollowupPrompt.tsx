import React, { useState, useEffect } from "react"
import { Box, Text, useInput } from "ink"

/**
 * PlanFollowup 决策类型
 */
export type PlanFollowupDecision = "new_session" | "continue" | null

/**
 * PlanFollowupPrompt Props
 */
interface PlanFollowupPromptProps {
  planFilePath: string
  onDecision: (decision: PlanFollowupDecision) => void
  visible: boolean
}

/**
 * PlanFollowupPrompt - 计划退出后的跟进提示
 *
 * 在 exit_plan_mode 后显示，询问用户：
 * - Start new session: 在新会话中实现计划
 * - Continue here: 在当前会话中继续
 *
 * Layout:
 * ┌─────────────────────────────────────────────┐
 * │ ✅ Planning Complete                         │
 * │                                             │
 * │ Plan saved to: ./plans/bright-shining-moon  │
 * │                                             │
 * │ ❯ Start new session                         │
 * │   Continue here                             │
 * │                                             │
 * │ ↑↓ Navigate  Enter Confirm                 │
 * └─────────────────────────────────────────────┘
 */
export function PlanFollowupPrompt({
  planFilePath,
  onDecision,
  visible,
}: PlanFollowupPromptProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  const options = [
    {
      label: "Start new session",
      description: "Implement in a fresh session with clean context",
      value: "new_session" as const,
    },
    {
      label: "Continue here",
      description: "Implement the plan in this session",
      value: "continue" as const,
    },
  ]

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
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : options.length - 1))
        return
      }
      if (key.downArrow) {
        setSelectedIndex((prev) => (prev < options.length - 1 ? prev + 1 : 0))
        return
      }

      // Enter confirms selection
      if (key.return) {
        onDecision(options[selectedIndex].value)
        return
      }

      // Number keys as shortcuts
      if (input === "1") {
        onDecision("new_session")
        return
      }
      if (input === "2") {
        onDecision("continue")
        return
      }

      // Escape cancels (continue in current session)
      if (key.escape) {
        onDecision("continue")
        return
      }
    },
    { isActive: visible }
  )

  if (!visible) {
    return null
  }

  // 简化路径显示
  const displayPath = planFilePath.replace(/^.*[\\/]/, "")

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="green"
      paddingX={1}
      marginY={1}
    >
      {/* Header */}
      <Box>
        <Text bold color="green">
          ✅ Planning Complete
        </Text>
      </Box>

      {/* Plan info */}
      <Box marginTop={1}>
        <Text dimColor>Plan saved to: </Text>
        <Text>{displayPath}</Text>
      </Box>

      {/* Options with highlight selection */}
      <Box flexDirection="column" marginTop={1}>
        {options.map((option, index) => {
          const isSelected = index === selectedIndex
          return (
            <Box key={option.value} flexDirection="column">
              <Box>
                <Text
                  color={isSelected ? "cyan" : undefined}
                  bold={isSelected}
                  inverse={isSelected}
                >
                  {isSelected ? " ❯ " : "   "}
                  {option.label}
                  {isSelected ? " " : ""}
                </Text>
              </Box>
              {isSelected && (
                <Box paddingLeft={3}>
                  <Text dimColor>{option.description}</Text>
                </Box>
              )}
            </Box>
          )
        })}
      </Box>

      {/* Hint */}
      <Box marginTop={1}>
        <Text dimColor>
          ↑↓ Navigate  Enter Confirm  (or press 1/2)
        </Text>
      </Box>
    </Box>
  )
}
