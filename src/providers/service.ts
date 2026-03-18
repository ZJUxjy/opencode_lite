// src/providers/service.ts

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "fs"
import { join, dirname } from "path"
import { homedir, userInfo } from "os"
import { createDecipheriv, createHash } from "crypto"
import type { ProviderConfig, ProvidersFile, LLMConfig, BuiltinProvider } from "./types.js"
import { BUILTIN_PROVIDERS, getBuiltinProvider } from "./registry.js"

/**
 * Provider with configuration status
 */
export interface ProviderWithStatus extends ProviderConfig {
  id: string
  configured: boolean
  builtin: boolean
}

/**
 * Default empty providers file
 */
const DEFAULT_PROVIDERS_FILE: ProvidersFile = {
  version: 2,
  defaultProvider: "",
  providers: {},
}

/**
 * Get the default config file path
 */
function getDefaultConfigPath(): string {
  return join(homedir(), ".lite-opencode", "providers.json")
}

/**
 * Provider Configuration Service
 *
 * Manages LLM provider configurations including API keys.
 */
export class ProviderConfigService {
  private filePath: string
  private data: ProvidersFile

  constructor(filePath?: string) {
    this.filePath = filePath ?? getDefaultConfigPath()
    this.data = this.load()
  }

  /**
   * Load configuration from file
   */
  private load(): ProvidersFile {
    if (!existsSync(this.filePath)) {
      // Create directory if needed
      const dir = dirname(this.filePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      // Write default config
      this.writeToFile(DEFAULT_PROVIDERS_FILE)
      // Return deep copy to avoid modifying DEFAULT_PROVIDERS_FILE
      return JSON.parse(JSON.stringify(DEFAULT_PROVIDERS_FILE))
    }

    try {
      const content = readFileSync(this.filePath, "utf-8")
      const data = JSON.parse(content)

      // Handle version migration from v1 to v2
      if (data.version === 1) {
        console.log("[ProviderConfig] Migrating configuration from v1 to v2...")
        data.version = 2

        // Attempt to migrate API keys from old encrypted token storage
        this.migrateTokensFromV1(data)
      }

      // Validate version
      if (data.version !== 2) {
        console.warn(`[ProviderConfig] Unknown version ${data.version}, using default`)
        return JSON.parse(JSON.stringify(DEFAULT_PROVIDERS_FILE))
      }
      return data
    } catch (error) {
      console.warn(`[ProviderConfig] Failed to load config: ${error}`)
      return { ...DEFAULT_PROVIDERS_FILE }
    }
  }

  /**
   * Write configuration to file
   */
  private writeToFile(data: ProvidersFile): void {
    const dir = dirname(this.filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8")
  }

  /**
   * Save current state to file
   */
  save(): void {
    this.writeToFile(this.data)
  }

  /**
   * Get all configured providers
   */
  listProviders(): ProviderWithStatus[] {
    return Object.entries(this.data.providers).map(([id, config]) => ({
      id,
      ...config,
      configured: !!(config.apiKey),
      builtin: getBuiltinProvider(id as BuiltinProvider) !== undefined,
    }))
  }

  /**
   * Get a specific provider configuration
   */
  getProvider(id: string): ProviderWithStatus | undefined {
    const config = this.data.providers[id]
    if (!config) return undefined
    return {
      id,
      ...config,
      configured: !!(config.apiKey),
      builtin: getBuiltinProvider(id as BuiltinProvider) !== undefined,
    }
  }

  /**
   * Get the default provider
   * @throws Error if no default provider is set
   */
  getDefaultProvider(): ProviderWithStatus {
    const defaultId = this.data.defaultProvider
    if (!defaultId) {
      throw new Error("No default provider configured")
    }
    const provider = this.getProvider(defaultId)
    if (!provider) {
      throw new Error(`Default provider '${defaultId}' not found in configuration`)
    }
    return provider
  }

  /**
   * Add or update a provider configuration
   * Merges with existing config to preserve fields like apiKey
   */
  setProvider(
    id: string,
    config: Omit<ProviderConfig, "createdAt" | "updatedAt">
  ): void {
    const now = new Date().toISOString()
    const existing = this.data.providers[id]

    // Merge with existing config to preserve fields like apiKey
    this.data.providers[id] = {
      ...existing,  // Preserve all existing fields
      ...config,    // Override with new values
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }

    // If this is the first provider, set as default
    if (!this.data.defaultProvider) {
      this.data.defaultProvider = id
    }
  }

  /**
   * Set the default provider
   * @throws Error if provider doesn't exist
   */
  setDefault(id: string): void {
    if (!this.data.providers[id]) {
      throw new Error(`Provider '${id}' not found`)
    }
    // Update isDefault flag on all providers
    for (const providerId of Object.keys(this.data.providers)) {
      this.data.providers[providerId].isDefault = providerId === id
    }
    this.data.defaultProvider = id
  }

  /**
   * Delete a provider configuration
   */
  deleteProvider(id: string): boolean {
    if (!this.data.providers[id]) return false
    delete this.data.providers[id]

    // If deleted provider was default, clear default
    if (this.data.defaultProvider === id) {
      // Set first remaining provider as default
      const remaining = Object.keys(this.data.providers)
      this.data.defaultProvider = remaining[0] ?? ""
    }
    return true
  }

  /**
   * Get all builtin providers with their configuration status
   */
  getBuiltinProviders(): Array<{
    id: BuiltinProvider
    info: (typeof BUILTIN_PROVIDERS)[0]
    configured: boolean
    config?: ProviderWithStatus
  }> {
    return BUILTIN_PROVIDERS.map((info) => {
      const config = this.getProvider(info.id)
      return {
        id: info.id,
        info,
        configured: !!(config?.apiKey),
        config,
      }
    })
  }

  /**
   * Check if a provider has an API key configured
   */
  isConfigured(id: string): boolean {
    const config = this.data.providers[id]
    return !!(config && config.apiKey)
  }

  /**
   * Get LLM runtime configuration for a provider
   */
  getLLMConfig(id?: string): LLMConfig {
    const providerId = id ?? this.data.defaultProvider
    if (!providerId) {
      throw new Error("No provider configured")
    }

    const config = this.data.providers[providerId]
    if (!config) {
      throw new Error(`Provider '${providerId}' not found`)
    }

    // Priority: config.apiKey > env variable
    const apiKey =
      config.apiKey ??
      (config.envKey ? process.env[config.envKey] : null) ??
      ""

    return {
      model: config.defaultModel,
      baseURL: config.baseUrl,
      apiKey,
    }
  }

  /**
   * Check if any provider is configured
   */
  hasProviders(): boolean {
    return Object.keys(this.data.providers).length > 0
  }

  /**
   * Set API key for a provider
   */
  setApiKey(id: string, apiKey: string): void {
    const config = this.data.providers[id]
    if (config) {
      config.apiKey = apiKey
      config.updatedAt = new Date().toISOString()
    }
  }

  /**
   * Migrate API keys from v1 encrypted token storage to v2 config format
   * Attempts to read and decrypt tokens from ~/.lite-opencode/tokens.enc
   */
  private migrateTokensFromV1(data: ProvidersFile): void {
    try {
      const tokenFilePath = join(dirname(this.filePath), "tokens.enc")

      if (!existsSync(tokenFilePath)) {
        // No old token file exists, nothing to migrate
        return
      }

      const encryptedContent = readFileSync(tokenFilePath, "utf-8")
      if (!encryptedContent) {
        return
      }

      // Try to decrypt using the old method (AES-256-GCM with machine-specific key)
      const tokens = this.decryptV1Tokens(encryptedContent)
      if (!tokens || Object.keys(tokens).length === 0) {
        return
      }

      // Migrate tokens to provider configs
      let migratedCount = 0
      for (const [providerId, apiKey] of Object.entries(tokens)) {
        if (data.providers[providerId] && apiKey) {
          data.providers[providerId].apiKey = apiKey as string
          data.providers[providerId].updatedAt = new Date().toISOString()
          migratedCount++
        }
      }

      if (migratedCount > 0) {
        console.log(`[ProviderConfig] Migrated ${migratedCount} API key(s) from v1 storage`)
        // Save immediately to persist the migration
        this.writeToFile(data)

        // Rename the old token file as backup (don't delete for safety)
        const backupPath = `${tokenFilePath}.backup`
        try {
          renameSync(tokenFilePath, backupPath)
          console.log(`[ProviderConfig] Backed up v1 token file to ${backupPath}`)
        } catch (backupError) {
          console.warn(`[ProviderConfig] Could not backup v1 token file: ${backupError}`)
        }
      }
    } catch (error) {
      // Migration failure should not block application startup
      console.warn(`[ProviderConfig] Token migration failed (non-fatal): ${error}`)
    }
  }

  /**
   * Decrypt v1 format tokens from encrypted file
   * Uses AES-256-GCM with a key derived from machine-specific identifiers
   */
  private decryptV1Tokens(encryptedContent: string): Record<string, string> | null {
    try {
      // Parse the encrypted payload format: iv:authTag:ciphertext (base64 encoded)
      const parts = encryptedContent.split(":")
      if (parts.length !== 3) {
        console.warn("[ProviderConfig] Invalid v1 token file format")
        return null
      }

      const [ivBase64, authTagBase64, ciphertextBase64] = parts
      const iv = Buffer.from(ivBase64, "base64")
      const authTag = Buffer.from(authTagBase64, "base64")
      const ciphertext = Buffer.from(ciphertextBase64, "base64")

      // Derive key from machine info (must match v1 implementation)
      const key = this.deriveV1EncryptionKey()
      if (!key) {
        return null
      }

      // Decrypt
      const decipher = createDecipheriv("aes-256-gcm", key, iv)
      decipher.setAuthTag(authTag)

      let decrypted = decipher.update(ciphertext, undefined, "utf8")
      decrypted += decipher.final("utf8")

      return JSON.parse(decrypted)
    } catch (error) {
      console.warn(`[ProviderConfig] Failed to decrypt v1 tokens: ${error}`)
      return null
    }
  }

  /**
   * Derive encryption key using the same method as v1
   * Uses machine-specific identifiers for key derivation
   */
  private deriveV1EncryptionKey(): Buffer | null {
    try {
      // Build a machine-specific string (same as v1 implementation)
      const info = userInfo()
      const machineId = `${info.username}-${info.uid}-${info.gid}-${process.env.HOME || process.env.USERPROFILE}`

      // Hash to 32 bytes for AES-256
      return createHash("sha256").update(machineId).digest()
    } catch (error) {
      console.warn(`[ProviderConfig] Failed to derive v1 encryption key: ${error}`)
      return null
    }
  }
}
