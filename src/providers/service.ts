// src/providers/service.ts

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import type { ProviderConfig, ProvidersFile, LLMConfig, BuiltinProvider } from "./types.js"
import { BUILTIN_PROVIDERS, getBuiltinProvider } from "./registry.js"
import { getTokenService } from "../tokens/index.js"

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
  version: 1,
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
 * Manages LLM provider configurations (non-sensitive data).
 * API keys are stored separately in TokenService.
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
      // Validate version
      if (data.version !== 1) {
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
      configured: true,
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
      configured: true,
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
   */
  setProvider(
    id: string,
    config: Omit<ProviderConfig, "createdAt" | "updatedAt">
  ): void {
    const now = new Date().toISOString()
    const existing = this.data.providers[id]

    this.data.providers[id] = {
      ...config,
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
        configured: !!config,
        config,
      }
    })
  }

  /**
   * Check if a provider has an API key configured
   */
  async isConfigured(id: string): Promise<boolean> {
    const config = this.data.providers[id]
    if (!config) return false

    // Check if API key exists in TokenService
    const tokenService = getTokenService()
    const token = await tokenService.getToken(id as any)
    return !!token
  }

  /**
   * Get LLM runtime configuration for a provider
   * Merges provider config with API key from TokenService
   */
  async getLLMConfig(id?: string): Promise<LLMConfig> {
    const providerId = id ?? this.data.defaultProvider
    if (!providerId) {
      throw new Error("No provider configured")
    }

    const config = this.data.providers[providerId]
    if (!config) {
      throw new Error(`Provider '${providerId}' not found`)
    }

    // Get API key from TokenService
    const tokenService = getTokenService()
    const apiKey = await tokenService.getToken(providerId as any)

    // Fallback to environment variable
    const finalApiKey =
      apiKey ??
      (config.envKey ? process.env[config.envKey] : null) ??
      ""

    return {
      model: config.defaultModel,
      baseURL: config.baseUrl,
      apiKey: finalApiKey,
    }
  }

  /**
   * Check if any provider is configured
   */
  hasProviders(): boolean {
    return Object.keys(this.data.providers).length > 0
  }
}
