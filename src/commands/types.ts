import type { Agent } from "../agent.js"
import type { RiskClassification } from "../policy/risk.js"
import type { UIMessage } from "../messages/types.js"

/**
 * Command execution context
 * Provides access to agent and UI state manipulation functions
 */
export interface CommandContext {
  agent: Agent
  setMessages: React.Dispatch<React.SetStateAction<UIMessage[]>>
  exit: () => void
  updateContextUsage: () => void
  showSessionList?: () => void
  toggleDumpPrompt?: () => void
  getDumpStatus?: () => { enabled: boolean; path: string }
}

/**
 * Re-export UIMessage for backward compatibility
 */
export type { UIMessage }

/**
 * Command definition
 */
export interface Command {
  /** Primary command name, e.g., "/exit" */
  name: string
  /** Optional aliases, e.g., ["/quit"] for "/exit" */
  aliases?: string[]
  /** Short description shown in autocomplete dropdown */
  description: string
  /** Command handler, receives args string and context */
  handler: (args: string, ctx: CommandContext) => void | Promise<void>
}

/**
 * Props for AutocompleteDropdown component
 */
export interface AutocompleteDropdownProps {
  suggestions: Command[]
  selectedIndex: number
  scrollOffset: number
  maxVisibleItems: number
  visible: boolean
  maxWidth: number
}

/**
 * Props for CommandInput component
 */
export interface CommandInputProps {
  isProcessing: boolean
  onSubmit: (value: string) => void | Promise<void>
  commandContext: CommandContext
  initialHistory?: string[]
  onHistoryChange?: (history: string[]) => void
}

/**
 * Props for useCommandInput hook
 */
export interface UseCommandInputProps {
  onSubmit: (value: string) => void | Promise<void>
  commandContext: CommandContext
  isProcessing: boolean
  initialHistory?: string[]
  onHistoryChange?: (history: string[]) => void
}

/**
 * Return type for useCommandInput hook
 */
export interface UseCommandInputReturn {
  input: string
  setInput: React.Dispatch<React.SetStateAction<string>>
  suggestions: Command[]
  selectedIndex: number
  scrollOffset: number
  maxVisibleItems: number
  showDropdown: boolean
  handleInputChange: (value: string) => void
  handleSubmit: (value: string) => void
  inputKey: number
}

/**
 * Permission decision types
 */
export type PermissionDecision = "allow" | "always" | "deny"

/**
 * Permission request info
 */
export interface PermissionRequest {
  id: string
  toolName: string
  description: string
  args: Record<string, unknown>
  risk?: RiskClassification
}

/**
 * Props for PermissionPrompt component
 */
export interface PermissionPromptProps {
  request: PermissionRequest
  onDecision: (decision: PermissionDecision) => void
  visible: boolean
}
