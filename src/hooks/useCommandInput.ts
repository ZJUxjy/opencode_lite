import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { useInput } from "ink"
import type { UseCommandInputProps, UseCommandInputReturn, Command } from "../commands/types.js"
import { registry } from "../commands/index.js"

/** Maximum number of suggestions to display at once */
const MAX_VISIBLE_ITEMS = 5

/**
 * useCommandInput - Custom hook for command input with autocomplete
 *
 * Features:
 * - Autocomplete suggestions when input starts with /
 * - Keyboard navigation (Up/Down arrows, Tab, Enter, Escape)
 * - Scrolling support for long command lists
 * - Command execution via registry
 * - Fallback to regular message submission for non-commands
 *
 * Keyboard bindings:
 * - Tab: Accept selected suggestion
 * - Up/Down: Navigate suggestions (with scrolling)
 * - Enter: Execute command or accept suggestion
 * - Escape: Close dropdown
 */
export function useCommandInput({
  onSubmit,
  commandContext,
  isProcessing,
}: UseCommandInputProps): UseCommandInputReturn {
  const [input, setInput] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [dropdownClosed, setDropdownClosed] = useState(false)
  // Key to force TextInput remount when accepting suggestion (fixes cursor position)
  const [inputKey, setInputKey] = useState(0)

  // Track if we just accepted a suggestion (to prevent double-submit)
  const justAcceptedRef = useRef(false)

  // Get autocomplete suggestions based on input
  const suggestions = useMemo<Command[]>(() => {
    if (!input.startsWith("/")) return []
    return registry.findMatches(input)
  }, [input])

  // Show dropdown when typing a command and have suggestions
  const showDropdown = useMemo(() => {
    return input.startsWith("/") && suggestions.length > 0 && !dropdownClosed
  }, [input, suggestions.length, dropdownClosed])

  // Reset selected index and scroll when suggestions change
  useEffect(() => {
    setSelectedIndex(0)
    setScrollOffset(0)
    setDropdownClosed(false)
  }, [suggestions.length])

  // Reset dropdown closed state when input changes
  useEffect(() => {
    setDropdownClosed(false)
  }, [input])

  // Ensure selected item is visible (auto-scroll)
  useEffect(() => {
    if (selectedIndex < scrollOffset) {
      setScrollOffset(selectedIndex)
    } else if (selectedIndex >= scrollOffset + MAX_VISIBLE_ITEMS) {
      setScrollOffset(selectedIndex - MAX_VISIBLE_ITEMS + 1)
    }
  }, [selectedIndex, scrollOffset])

  // Keyboard navigation for autocomplete dropdown
  // Note: This runs in parallel with TextInput's internal useInput
  // We use the isActive pattern to only capture navigation keys when dropdown is shown
  useInput(
    (_char, key) => {
      if (isProcessing) return

      // Tab: Accept selected suggestion
      // Note: Tab doesn't trigger TextInput's onSubmit, so no need for justAcceptedRef
      if (key.tab && showDropdown && suggestions.length > 0) {
        const selectedCmd = suggestions[selectedIndex]
        if (selectedCmd) {
          setInput(selectedCmd.name + " ")
          setInputKey((prev) => prev + 1) // Force remount to fix cursor position
          setDropdownClosed(true)
        }
        return
      }

      // Up arrow: Move selection up (wrap around)
      if (key.upArrow && showDropdown && suggestions.length > 0) {
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : suggestions.length - 1
        )
        return
      }

      // Down arrow: Move selection down (wrap around)
      if (key.downArrow && showDropdown && suggestions.length > 0) {
        setSelectedIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : 0
        )
        return
      }

      // Escape: Close dropdown
      if (key.escape && showDropdown) {
        setDropdownClosed(true)
        return
      }

      // Enter: If dropdown is shown and we have suggestions, accept the selected one
      // This prevents the form from submitting immediately when navigating
      if (key.return && showDropdown && suggestions.length > 0) {
        const selectedCmd = suggestions[selectedIndex]
        if (selectedCmd) {
          setInput(selectedCmd.name + " ")
          setInputKey((prev) => prev + 1) // Force remount to fix cursor position
          justAcceptedRef.current = true
          setDropdownClosed(true)
        }
        return
      }
    },
    { isActive: showDropdown && !isProcessing }
  )

  // Handle input change
  const handleInputChange = useCallback((value: string) => {
    setInput(value)
    // Reset the "just accepted" flag when user types
    justAcceptedRef.current = false
  }, [])

  // Handle form submission
  const handleSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim()

      // If we just accepted a suggestion, don't submit yet
      if (justAcceptedRef.current) {
        justAcceptedRef.current = false
        return
      }

      // Clear input
      setInput("")

      // Check if it's a command
      if (trimmed.startsWith("/")) {
        const [cmdName, ...args] = trimmed.split(" ")
        const cmd = registry.get(cmdName)

        if (cmd) {
          // Execute command
          cmd.handler(args.join(" "), commandContext)
          return
        }

        // Unknown command - still submit as regular message
        // (let agent handle it or show error)
      }

      // Submit as regular message
      if (trimmed) {
        onSubmit(trimmed)
      }
    },
    [commandContext, onSubmit]
  )

  return {
    input,
    setInput,
    suggestions,
    selectedIndex,
    scrollOffset,
    maxVisibleItems: MAX_VISIBLE_ITEMS,
    showDropdown,
    handleInputChange,
    handleSubmit,
    inputKey,
  }
}
