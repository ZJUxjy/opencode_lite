import type { TokenServiceConfig, TokenProvider, TokenInfo, TokenStorage } from "./types.js"
import { DEFAULT_TOKEN_CONFIG } from "./types.js"
import { KeyringStorage } from "./storage/keyring.js"
import { EncryptedFileStorage } from "./storage/encrypted-file.js"

export * from "./types.js"

/**
 * Token Service - Unified API for secure token storage
 *
 * Automatically chooses the best available storage:
 * 1. System keyring (most secure)
 * 2. Encrypted file (fallback)
 */
export class TokenService {
  private primaryStorage: TokenStorage
  private fallbackStorage: TokenStorage | null
  private config: TokenServiceConfig

  constructor(config: Partial<TokenServiceConfig> = {}) {
    this.config = { ...DEFAULT_TOKEN_CONFIG, ...config }
    this.primaryStorage = new KeyringStorage()
    this.fallbackStorage = this.config.fallbackToFile ? new EncryptedFileStorage() : null
  }

  /**
   * Get the active storage backend
   */
  private async getStorage(): Promise<TokenStorage> {
    if (await this.primaryStorage.isAvailable()) {
      return this.primaryStorage
    }
    if (this.fallbackStorage && (await this.fallbackStorage.isAvailable())) {
      console.warn("[TokenService] Keyring not available, using encrypted file storage")
      return this.fallbackStorage
    }
    throw new Error("No token storage backend available")
  }

  /**
   * Store a token
   */
  async setToken(provider: TokenProvider, key: string): Promise<void> {
    const storage = await this.getStorage()
    await storage.set(provider, key)
  }

  /**
   * Get a token
   */
  async getToken(provider: TokenProvider): Promise<string | null> {
    const storage = await this.getStorage()
    return storage.get(provider)
  }

  /**
   * Delete a token
   */
  async deleteToken(provider: TokenProvider): Promise<void> {
    const storage = await this.getStorage()
    await storage.delete(provider)
  }

  /**
   * List all stored tokens (without keys)
   */
  async listTokens(): Promise<Omit<TokenInfo, "key">[]> {
    const storage = await this.getStorage()
    return storage.list()
  }

  /**
   * Get storage type being used
   */
  async getStorageType(): Promise<"keyring" | "encrypted-file" | "none"> {
    if (await this.primaryStorage.isAvailable()) {
      return "keyring"
    }
    if (this.fallbackStorage && (await this.fallbackStorage.isAvailable())) {
      return "encrypted-file"
    }
    return "none"
  }

  /**
   * Migrate tokens from settings.json to secure storage
   */
  async migrateFromSettings(settings: Record<string, string>): Promise<{
    migrated: TokenProvider[]
    failed: TokenProvider[]
  }> {
    const result = { migrated: [] as TokenProvider[], failed: [] as TokenProvider[] }

    const providerMap: Record<string, TokenProvider> = {
      ANTHROPIC_API_KEY: "anthropic",
      OPENAI_API_KEY: "openai",
      MINIMAX_API_KEY: "minimax",
      GEMINI_API_KEY: "gemini",
      DEEPSEEK_API_KEY: "deepseek",
      KIMI_API_KEY: "kimi",
    }

    for (const [envKey, value] of Object.entries(settings)) {
      const provider = providerMap[envKey]
      if (provider && value) {
        try {
          await this.setToken(provider, value)
          result.migrated.push(provider)
        } catch {
          result.failed.push(provider)
        }
      }
    }

    return result
  }
}

// Global instance
let globalTokenService: TokenService | null = null

export function getTokenService(): TokenService {
  if (!globalTokenService) {
    globalTokenService = new TokenService()
  }
  return globalTokenService
}

export function resetTokenService(): void {
  globalTokenService = null
}
