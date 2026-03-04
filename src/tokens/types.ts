export type TokenProvider = "anthropic" | "openai" | "minimax" | "gemini" | "deepseek" | "custom"

export interface TokenInfo {
  provider: TokenProvider
  key: string // The actual API key (sensitive)
  name?: string // User-friendly name
  createdAt: Date
  lastUsedAt?: Date
}

export interface TokenStorage {
  /**
   * Store a token securely
   */
  set(provider: TokenProvider, key: string): Promise<void>

  /**
   * Retrieve a token
   */
  get(provider: TokenProvider): Promise<string | null>

  /**
   * Delete a token
   */
  delete(provider: TokenProvider): Promise<void>

  /**
   * List all stored tokens (without keys)
   */
  list(): Promise<Omit<TokenInfo, "key">[]>

  /**
   * Check if storage is available
   */
  isAvailable(): Promise<boolean>
}

export interface TokenServiceConfig {
  serviceName: string
  fallbackToFile: boolean
  fileEncryptionKey?: Buffer // Optional: custom encryption key
}

export const DEFAULT_TOKEN_CONFIG: TokenServiceConfig = {
  serviceName: "lite-opencode",
  fallbackToFile: true,
}
