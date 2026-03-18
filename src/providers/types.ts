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
 * Supported API protocols
 */
export type ProviderProtocol = "anthropic" | "openai" | "google"

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
  /** API key (stored directly in config) */
  apiKey?: string
  /** Environment variable name for API key (fallback) */
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
 *
 * Version history:
 * - v1: Initial version (apiKey stored separately in tokens.enc)
 * - v2: Unified storage (apiKey stored directly in ProviderConfig)
 */
export interface ProvidersFile {
  /** Config file version for future migrations */
  version: 2
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
