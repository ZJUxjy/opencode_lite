import React from "react"
import { Box, Text, useStdout } from "ink"
import TextInput from "ink-text-input"
import { useCommandInput } from "../hooks/useCommandInput.js"
import { AutocompleteDropdown } from "./AutocompleteDropdown.js"
import type { CommandInputProps } from "../commands/types.js"

/**
 * CommandInput - Combined input component with autocomplete
 *
 * Combines:
 * - TextInput for text entry
 * - AutocompleteDropdown for command suggestions
 *
 * Layout:
 * ┌─────────────────────────────────────┐
 * │ ❯ <input text>                      │
 * │   /exit - Exit the program          │  ← Dropdown (when typing /)
 * │   /clear - Clear session history    │
 * └─────────────────────────────────────┘
 */
export function CommandInput({
  isProcessing,
  onSubmit,
  commandContext,
  initialHistory,
  onHistoryChange,
}: CommandInputProps) {
  const { stdout } = useStdout()
  const terminalWidth = stdout?.columns || 80

  const {
    input,
    suggestions,
    selectedIndex,
    scrollOffset,
    maxVisibleItems,
    showDropdown,
    handleInputChange,
    handleSubmit,
    inputKey,
  } = useCommandInput({
    onSubmit,
    commandContext,
    isProcessing,
    initialHistory,
    onHistoryChange,
  })

  return (
    <Box flexDirection="column">
      {/* Main input row */}
      <Box width={terminalWidth - 3}>
        <Box width={2}>
          <Text bold color="green">
            ❯{" "}
          </Text>
        </Box>
        <Box flexGrow={1}>
          <TextInput
            key={inputKey}
            value={input}
            onChange={handleInputChange}
            onSubmit={handleSubmit}
            placeholder={
              isProcessing
                ? "[LLM is thinking... Type to queue next message]"
                : "Type a message... (/ for commands, ↑↓ for history)"
            }
            showCursor={true}
          />
        </Box>
      </Box>

      {/* Autocomplete dropdown */}
      <AutocompleteDropdown
        suggestions={suggestions}
        selectedIndex={selectedIndex}
        scrollOffset={scrollOffset}
        maxVisibleItems={maxVisibleItems}
        visible={showDropdown}
        maxWidth={terminalWidth - 4}
      />
    </Box>
  )
}
