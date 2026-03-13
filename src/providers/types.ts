// src/providers/types.ts

/**
 * Built-in supported LLM providers
 */
export type BuiltinProvider =
  | "anthropic"
  | "openai"
  | "gemini"
  | "deepseek"
  | "minimax"
  | "kimi"

/**
 * Provider identifier (builtin or custom)
 */
export type ProviderId = BuiltinProvider | `custom:${string}`

/**
 * Provider configuration
 */
export interface ProviderConfig {
  /** Display name */
  name: string
  /** Provider type */
  provider: BuiltinProvider | "custom"
  /** API base URL */
  baseUrl: string
  /** Default model to use */
  defaultModel: string
  /** Environment variable name for API key */
  envKey?: string
  /** Whether this is the default provider */
  isDefault?: boolean
  /** Creation timestamp (ISO string) */
  createdAt: string
  /** Last modified timestamp (ISO string) */
  updatedAt?: string
}

/**
 * Provider configuration file structure
 * Stored at ~/.lite-opencode/providers.json
 */
export interface ProvidersFile {
  /** Config file version for future migrations */
  version: 1
  /** Current default provider ID */
  defaultProvider: string
  /** All provider configurations */
  providers: Record<string, ProviderConfig>
}

/**
 * LLM runtime configuration (merged from Provider + Token)
 */
export interface LLMConfig {
  model: string
  baseURL: string
  apiKey: string
}
