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
/** Maximum input history to keep */
const MAX_INPUT_HISTORY = 50

export function useCommandInput({
  onSubmit,
  commandContext,
  isProcessing,
  initialHistory = [],
  onHistoryChange,
  isActive = true,
}: UseCommandInputProps & { isActive?: boolean }): UseCommandInputReturn {
  const [input, setInput] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [dropdownClosed, setDropdownClosed] = useState(false)
  // Key to force TextInput remount when accepting suggestion (fixes cursor position)
  const [inputKey, setInputKey] = useState(0)

  // Track if we just accepted a suggestion (to prevent double-submit)
  const justAcceptedRef = useRef(false)

  // Input history for up/down navigation
  const [inputHistory, setInputHistory] = useState<string[]>(initialHistory)
  const [historyIndex, setHistoryIndex] = useState(-1)
  const tempInputRef = useRef("")

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

  // Keyboard navigation for autocomplete dropdown and input history
  // Note: This runs in parallel with TextInput's internal useInput
  useInput(
    (_char, key) => {
      if (isProcessing) return

      // Tab: Accept selected suggestion
      if (key.tab && showDropdown && suggestions.length > 0) {
        const selectedCmd = suggestions[selectedIndex]
        if (selectedCmd) {
          setInput(selectedCmd.name + " ")
          setInputKey((prev) => prev + 1)
          setDropdownClosed(true)
        }
        return
      }

      // Up arrow: History navigation or dropdown navigation
      if (key.upArrow) {
        if (showDropdown && suggestions.length > 0) {
          // Dropdown navigation
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : suggestions.length - 1
          )
        } else {
          // Input history navigation
          navigateHistory("up")
        }
        return
      }

      // Down arrow: History navigation or dropdown navigation
      if (key.downArrow) {
        if (showDropdown && suggestions.length > 0) {
          // Dropdown navigation
          setSelectedIndex((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : 0
          )
        } else {
          // Input history navigation
          navigateHistory("down")
        }
        return
      }

      // Escape: Close dropdown
      if (key.escape && showDropdown) {
        setDropdownClosed(true)
        return
      }

      // Enter: If dropdown is shown and we have suggestions, accept the selected one
      if (key.return && showDropdown && suggestions.length > 0) {
        const selectedCmd = suggestions[selectedIndex]
        if (selectedCmd) {
          setInput(selectedCmd.name + " ")
          setInputKey((prev) => prev + 1)
          justAcceptedRef.current = true
          setDropdownClosed(true)
        }
        return
      }
    },
    { isActive: isActive && !isProcessing }
  )

  /**
   * Navigate through input history
   */
  const navigateHistory = useCallback((direction: "up" | "down") => {
    if (inputHistory.length === 0) return

    if (direction === "up") {
      // First time pressing up: save current input
      if (historyIndex === -1) {
        tempInputRef.current = input
      }

      // Move up in history (towards more recent = higher index)
      const newIndex = historyIndex + 1
      if (newIndex < inputHistory.length) {
        setHistoryIndex(newIndex)
        setInput(inputHistory[inputHistory.length - 1 - newIndex])
      }
    } else {
      // Move down in history
      const newIndex = historyIndex - 1
      if (newIndex >= 0) {
        setHistoryIndex(newIndex)
        setInput(inputHistory[inputHistory.length - 1 - newIndex])
      } else if (newIndex === -1) {
        // Back to current editing
        setHistoryIndex(-1)
        setInput(tempInputRef.current)
      }
    }
  }, [inputHistory, historyIndex, input])

  // Handle input change
  const handleInputChange = useCallback((value: string) => {
    setInput(value)
    // Reset the "just accepted" flag when user types
    justAcceptedRef.current = false
    // Reset history index when user manually types
    if (historyIndex !== -1) {
      setHistoryIndex(-1)
    }
  }, [historyIndex])

  // Handle form submission
  const handleSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim()

      // If we just accepted a suggestion, don't submit yet
      if (justAcceptedRef.current) {
        justAcceptedRef.current = false
        return
      }

      // Save to history if not empty and different from last entry
      if (trimmed) {
        setInputHistory((prev) => {
          // Don't save if same as last entry
          if (prev.length > 0 && prev[prev.length - 1] === trimmed) {
            return prev
          }
          // Add new entry, keeping max size
          const newHistory = [...prev, trimmed]
          if (newHistory.length > MAX_INPUT_HISTORY) {
            const trimmedHistory = newHistory.slice(-MAX_INPUT_HISTORY)
            // 使用 setTimeout 避免在渲染期间更新父组件状态
            setTimeout(() => onHistoryChange?.(trimmedHistory), 0)
            return trimmedHistory
          }
          // 使用 setTimeout 避免在渲染期间更新父组件状态
          setTimeout(() => onHistoryChange?.(newHistory), 0)
          return newHistory
        })
      }

      // Reset history navigation
      setHistoryIndex(-1)
      tempInputRef.current = ""

      // Clear input
      setInput("")

      // Check if it's a command
      if (trimmed.startsWith("/")) {
        const [cmdName, ...args] = trimmed.split(" ")
        const cmd = registry.get(cmdName)

        if (cmd) {
          // 使用 setTimeout 避免在渲染期间更新父组件状态
          // 修复 "Cannot update a component while rendering a different component" 错误
          setTimeout(() => {
            cmd.handler(args.join(" "), commandContext)
          }, 0)
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
    [commandContext, onSubmit, onHistoryChange]
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
