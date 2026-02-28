import React from "react"
import { Box, Text } from "ink"
import type { AutocompleteDropdownProps } from "../commands/types.js"

/**
 * AutocompleteDropdown - Displays command suggestions below input
 *
 * Features:
 * - Shows a scrollable window of suggestions
 * - Highlights selected item with inverse colors
 * - Shows scroll indicators (↑/↓) when there are hidden items
 * - Adapts to terminal width
 */
export function AutocompleteDropdown({
  suggestions,
  selectedIndex,
  scrollOffset,
  maxVisibleItems,
  visible,
  maxWidth,
}: AutocompleteDropdownProps) {
  // Don't render if not visible or no suggestions
  if (!visible || suggestions.length === 0) {
    return null
  }

  // Calculate visible window
  const displayItems = suggestions.slice(
    scrollOffset,
    scrollOffset + maxVisibleItems
  )
  const hasItemsAbove = scrollOffset > 0
  const hasItemsBelow = scrollOffset + maxVisibleItems < suggestions.length
  const itemsAbove = scrollOffset
  const itemsBelow = suggestions.length - scrollOffset - maxVisibleItems

  return (
    <Box flexDirection="column" paddingLeft={2} marginTop={0}>
      {/* Scroll up indicator */}
      {hasItemsAbove && (
        <Text dimColor>
          {"  "}
          ↑ {itemsAbove} more above
        </Text>
      )}

      {displayItems.map((cmd, index) => {
        // Calculate the actual index in the full suggestions list
        const actualIndex = scrollOffset + index
        const isSelected = actualIndex === selectedIndex

        // Truncate description if needed
        const maxDescLen = maxWidth - cmd.name.length - 5
        const description =
          maxDescLen > 0 && cmd.description.length > maxDescLen
            ? cmd.description.slice(0, maxDescLen - 3) + "..."
            : cmd.description

        return (
          <Box key={cmd.name}>
            <Text
              color={isSelected ? "cyan" : undefined}
              inverse={isSelected}
              bold={isSelected}
            >
              {isSelected ? "❯ " : "  "}
              {cmd.name}
            </Text>
            {!isSelected && (
              <Text dimColor>
                {" "}
                - {description}
              </Text>
            )}
            {isSelected && (
              <Text color="cyan" bold>
                {" "}
                - {description}
              </Text>
            )}
          </Box>
        )
      })}

      {/* Scroll down indicator */}
      {hasItemsBelow && (
        <Text dimColor>
          {"  "}
          ↓ {itemsBelow} more below
        </Text>
      )}
    </Box>
  )
}
