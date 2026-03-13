# Provider Configuration System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add quick LLM provider configuration with interactive wizard and in-session commands.

**Architecture:** Independent ProviderConfigService manages non-sensitive config in providers.json, integrating with existing TokenService for API keys. Ink components provide visual interactive configuration.

**Tech Stack:** TypeScript, Ink (React for CLI), Zod for validation, better-sqlite3 (existing)

---

## Task 1: Define Types

**Files:**
- Create: `src/providers/types.ts`

**Step 1: Create types file**

```typescript
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
```

**Step 2: Verify TypeScript compiles**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/providers/types.ts
git commit -m "feat(providers): add type definitions"
```

---

## Task 2: Create Provider Registry

**Files:**
- Create: `src/providers/registry.ts`

**Step 1: Create registry file**

```typescript
// src/providers/registry.ts

import type { BuiltinProvider } from "./types.js"

/**
 * Built-in provider information
 */
export interface BuiltinProviderInfo {
  id: BuiltinProvider
  name: string
  baseUrl: string
  defaultModel: string
  envKey: string
  models: string[]
}

/**
 * Registry of all built-in providers
 */
export const BUILTIN_PROVIDERS: BuiltinProviderInfo[] = [
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-6",
    envKey: "ANTHROPIC_API_KEY",
    models: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
  },
  {
    id: "openai",
    name: "OpenAI (GPT)",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    envKey: "OPENAI_API_KEY",
    models: ["gpt-4o", "gpt-4o-mini", "o1", "o3-mini"],
  },
  {
    id: "gemini",
    name: "Google (Gemini)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.0-flash",
    envKey: "GEMINI_API_KEY",
    models: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    envKey: "DEEPSEEK_API_KEY",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "minimax",
    name: "MiniMax",
    baseUrl: "https://api.minimax.chat/v1",
    defaultModel: "MiniMax-Text-01",
    envKey: "MINIMAX_API_KEY",
    models: ["MiniMax-Text-01"],
  },
  {
    id: "kimi",
    name: "Kimi (Moonshot)",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-128k",
    envKey: "KIMI_API_KEY",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
  },
]

/**
 * Get provider info by ID
 */
export function getBuiltinProvider(id: BuiltinProvider): BuiltinProviderInfo | undefined {
  return BUILTIN_PROVIDERS.find((p) => p.id === id)
}

/**
 * Check if a string is a valid builtin provider
 */
export function isBuiltinProvider(id: string): id is BuiltinProvider {
  return BUILTIN_PROVIDERS.some((p) => p.id === id)
}
```

**Step 2: Verify TypeScript compiles**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/providers/registry.ts
git commit -m "feat(providers): add builtin provider registry"
```

---

## Task 3: Create Provider Index Export

**Files:**
- Create: `src/providers/index.ts`

**Step 1: Create index file**

```typescript
// src/providers/index.ts

export * from "./types.js"
export * from "./registry.js"
export { ProviderConfigService } from "./service.js"
```

**Step 2: Verify TypeScript compiles**

Run: `npm run build`
Expected: May have error about missing service.js (that's OK, we'll create it next)

**Step 3: Commit**

```bash
git add src/providers/index.ts
git commit -m "feat(providers): add module exports"
```

---

## Task 4: Write Service Tests

**Files:**
- Create: `src/providers/__tests__/service.test.ts`

**Step 1: Create test file**

```typescript
// src/providers/__tests__/service.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdirSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { ProviderConfigService } from "../service.js"
import { BUILTIN_PROVIDERS } from "../registry.js"

describe("ProviderConfigService", () => {
  let tempDir: string
  let configPath: string
  let service: ProviderConfigService

  beforeEach(() => {
    tempDir = mkdirSync(join(tmpdir(), `provider-test-${Date.now()}`), { recursive: true })
    configPath = join(tempDir, "providers.json")
    service = new ProviderConfigService(configPath)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe("initialization", () => {
    it("should create empty config if file doesn't exist", () => {
      expect(existsSync(configPath)).toBe(true)
    })

    it("should have no providers initially", () => {
      const providers = service.listProviders()
      expect(providers).toHaveLength(0)
    })

    it("should have no default provider initially", () => {
      expect(() => service.getDefaultProvider()).toThrow()
    })
  })

  describe("setProvider", () => {
    it("should add a new provider", () => {
      service.setProvider("anthropic", {
        name: "Anthropic (Claude)",
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        defaultModel: "claude-sonnet-4-6",
      })

      const config = service.getProvider("anthropic")
      expect(config).toBeDefined()
      expect(config?.name).toBe("Anthropic (Claude)")
      expect(config?.createdAt).toBeDefined()
    })

    it("should update existing provider", () => {
      service.setProvider("anthropic", {
        name: "Anthropic",
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        defaultModel: "claude-sonnet-4-6",
      })

      service.setProvider("anthropic", {
        name: "Anthropic Claude",
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        defaultModel: "claude-opus-4-6",
      })

      const config = service.getProvider("anthropic")
      expect(config?.name).toBe("Anthropic Claude")
      expect(config?.defaultModel).toBe("claude-opus-4-6")
    })
  })

  describe("setDefault", () => {
    it("should set default provider", () => {
      service.setProvider("anthropic", {
        name: "Anthropic",
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        defaultModel: "claude-sonnet-4-6",
      })

      service.setDefault("anthropic")

      const defaultProvider = service.getDefaultProvider()
      expect(defaultProvider.id).toBe("anthropic")
    })

    it("should throw if provider doesn't exist", () => {
      expect(() => service.setDefault("nonexistent")).toThrow()
    })
  })

  describe("listProviders", () => {
    it("should list all configured providers", () => {
      service.setProvider("anthropic", {
        name: "Anthropic",
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        defaultModel: "claude-sonnet-4-6",
      })
      service.setProvider("openai", {
        name: "OpenAI",
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-4o",
      })

      const providers = service.listProviders()
      expect(providers).toHaveLength(2)
      expect(providers.map((p) => p.id)).toContain("anthropic")
      expect(providers.map((p) => p.id)).toContain("openai")
    })
  })

  describe("persistence", () => {
    it("should persist config to file", () => {
      service.setProvider("anthropic", {
        name: "Anthropic",
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        defaultModel: "claude-sonnet-4-6",
      })
      service.setDefault("anthropic")
      service.save()

      // Create new service instance to test persistence
      const newService = new ProviderConfigService(configPath)
      const provider = newService.getProvider("anthropic")
      expect(provider).toBeDefined()
      expect(newService.getDefaultProvider().id).toBe("anthropic")
    })
  })

  describe("getBuiltinProviders", () => {
    it("should return all builtin providers with configured status", () => {
      service.setProvider("anthropic", {
        name: "Anthropic",
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        defaultModel: "claude-sonnet-4-6",
      })

      const builtinProviders = service.getBuiltinProviders()
      expect(builtinProviders.length).toBe(BUILTIN_PROVIDERS.length)

      const anthropic = builtinProviders.find((p) => p.id === "anthropic")
      expect(anthropic?.configured).toBe(true)

      const openai = builtinProviders.find((p) => p.id === "openai")
      expect(openai?.configured).toBe(false)
    })
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npm run test src/providers/__tests__/service.test.ts`
Expected: FAIL with "Cannot find module '../service.js'"

**Step 3: Commit**

```bash
git add src/providers/__tests__/service.test.ts
git commit -m "test(providers): add service tests"
```

---

## Task 5: Implement ProviderConfigService

**Files:**
- Create: `src/providers/service.ts`

**Step 1: Create service implementation**

```typescript
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
      return { ...DEFAULT_PROVIDERS_FILE }
    }

    try {
      const content = readFileSync(this.filePath, "utf-8")
      const data = JSON.parse(content)
      // Validate version
      if (data.version !== 1) {
        console.warn(`[ProviderConfig] Unknown version ${data.version}, using default`)
        return { ...DEFAULT_PROVIDERS_FILE }
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
```

**Step 2: Run tests to verify they pass**

Run: `npm run test src/providers/__tests__/service.test.ts`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/providers/service.ts
git commit -m "feat(providers): implement ProviderConfigService"
```

---

## Task 6: Create CLI Config Wizard Component

**Files:**
- Create: `src/cli/config-wizard.tsx`

**Step 1: Create wizard component**

```typescript
// src/cli/config-wizard.tsx

import React, { useState, useCallback } from "react"
import { render, Box, Text, useApp, useInput } from "ink"
import TextInput from "ink-text-input"
import SelectInput from "ink-select-input"
import { ProviderConfigService, type ProviderWithStatus } from "../providers/service.js"
import { BUILTIN_PROVIDERS, type BuiltinProvider } from "../providers/registry.js"
import { getTokenService } from "../tokens/index.js"

interface WizardProps {
  onComplete?: () => void
}

type WizardStep = "select-provider" | "enter-api-key" | "enter-base-url" | "select-model" | "set-default" | "done"

export function ConfigWizard({ onComplete }: WizardProps) {
  const { exit } = useApp()
  const service = new ProviderConfigService()
  const tokenService = getTokenService()

  const [step, setStep] = useState<WizardStep>("select-provider")
  const [selectedProvider, setSelectedProvider] = useState<BuiltinProvider | "custom">()
  const [apiKey, setApiKey] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [model, setModel] = useState("")
  const [setAsDefault, setSetAsDefault] = useState(true)
  const [error, setError] = useState<string>()
  const [isCustom, setIsCustom] = useState(false)

  // Build provider selection items
  const providerItems = [
    ...BUILTIN_PROVIDERS.map((p) => ({
      label: p.name,
      value: p.id,
    })),
    { label: "───────────────", value: "separator" as const },
    { label: "Custom Provider", value: "custom" as const },
  ]

  const handleProviderSelect = useCallback((item: { value: string | BuiltinProvider | "custom" | "separator" }) => {
    if (item.value === "separator") return

    if (item.value === "custom") {
      setIsCustom(true)
      setSelectedProvider("custom")
      setStep("enter-base-url")
      return
    }

    const providerInfo = BUILTIN_PROVIDERS.find((p) => p.id === item.value)
    if (providerInfo) {
      setSelectedProvider(item.value as BuiltinProvider)
      setBaseUrl(providerInfo.baseUrl)
      setModel(providerInfo.defaultModel)
      setStep("enter-api-key")
    }
  }, [])

  const handleApiKeySubmit = useCallback(() => {
    if (!apiKey.trim()) {
      setError("API Key is required")
      return
    }
    setError(undefined)
    if (isCustom) {
      setStep("select-model")
    } else {
      setStep("enter-base-url")
    }
  }, [apiKey, isCustom])

  const handleBaseUrlSubmit = useCallback(() => {
    if (!baseUrl.trim()) {
      setError("Base URL is required")
      return
    }
    setError(undefined)
    setStep("enter-api-key")
  }, [baseUrl])

  const handleModelSelect = useCallback((item: { value: string }) => {
    setModel(item.value)
    setStep("set-default")
  }, [])

  const handleDefaultSelect = useCallback((item: { value: boolean }) => {
    setSetAsDefault(item.value)

    // Save configuration
    if (selectedProvider && selectedProvider !== "custom") {
      const providerInfo = BUILTIN_PROVIDERS.find((p) => p.id === selectedProvider)!
      service.setProvider(selectedProvider, {
        name: providerInfo.name,
        provider: selectedProvider,
        baseUrl,
        defaultModel: model,
        envKey: providerInfo.envKey,
      })
    } else if (isCustom) {
      const customId = `custom:${Date.now()}`
      service.setProvider(customId, {
        name: "Custom Provider",
        provider: "custom",
        baseUrl,
        defaultModel: model,
      })
    }

    if (setAsDefault && selectedProvider) {
      service.setDefault(selectedProvider === "custom" ? `custom:${Date.now()}` : selectedProvider)
    }

    service.save()

    // Store API key in TokenService
    if (selectedProvider) {
      tokenService.setToken(selectedProvider === "custom" ? "custom" : selectedProvider, apiKey)
    }

    setStep("done")
  }, [selectedProvider, baseUrl, model, setAsDefault, service, tokenService, apiKey, isCustom])

  const handleDone = useCallback(() => {
    onComplete?.()
    exit()
  }, [onComplete, exit])

  // Build model selection items
  const modelItems = selectedProvider && selectedProvider !== "custom"
    ? BUILTIN_PROVIDERS.find((p) => p.id === selectedProvider)?.models.map((m) => ({
        label: m,
        value: m,
      })) ?? []
    : [{ label: model || "default", value: model || "default" }]

  // Default selection items
  const defaultItems = [
    { label: "Yes, set as default", value: true },
    { label: "No, keep current default", value: false },
  ]

  // Render based on current step
  switch (step) {
    case "select-provider":
      return (
        <Box flexDirection="column" padding={1}>
          <Box marginBottom={1}>
            <Text bold color="cyan">🎛️ Configure LLM Provider</Text>
          </Box>
          <Box marginBottom={1}>
            <Text dimColor>Select a provider to configure:</Text>
          </Box>
          <SelectInput items={providerItems.filter(i => i.value !== "separator")} onSelect={handleProviderSelect} />
        </Box>
      )

    case "enter-api-key":
      return (
        <Box flexDirection="column" padding={1}>
          <Box marginBottom={1}>
            <Text bold color="cyan">🔑 Configure {selectedProvider}</Text>
          </Box>
          <Box marginBottom={1}>
            <Text>API Key: </Text>
            <TextInput
              value={apiKey}
              onChange={setApiKey}
              onSubmit={handleApiKeySubmit}
              placeholder="sk-..."
              mask="*"
            />
          </Box>
          {error && (
            <Box>
              <Text color="red">{error}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>Press Enter to continue</Text>
          </Box>
        </Box>
      )

    case "enter-base-url":
      return (
        <Box flexDirection="column" padding={1}>
          <Box marginBottom={1}>
            <Text bold color="cyan">🌐 Configure Base URL</Text>
          </Box>
          <Box marginBottom={1}>
            <Text>Base URL: </Text>
            <TextInput
              value={baseUrl}
              onChange={setBaseUrl}
              onSubmit={handleBaseUrlSubmit}
              placeholder={isCustom ? "https://api.example.com/v1" : baseUrl}
            />
          </Box>
          {error && (
            <Box>
              <Text color="red">{error}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>Press Enter to use default or enter custom URL</Text>
          </Box>
        </Box>
      )

    case "select-model":
      return (
        <Box flexDirection="column" padding={1}>
          <Box marginBottom={1}>
            <Text bold color="cyan">🤖 Select Default Model</Text>
          </Box>
          <SelectInput items={modelItems} onSelect={handleModelSelect} />
        </Box>
      )

    case "set-default":
      return (
        <Box flexDirection="column" padding={1}>
          <Box marginBottom={1}>
            <Text bold color="cyan">⭐ Set as Default?</Text>
          </Box>
          <SelectInput items={defaultItems} onSelect={handleDefaultSelect} />
        </Box>
      )

    case "done":
      return (
        <Box flexDirection="column" padding={1}>
          <Box marginBottom={1}>
            <Text bold color="green">✓ Configuration Complete!</Text>
          </Box>
          <Box>
            <Text>Provider: {selectedProvider}</Text>
          </Box>
          <Box>
            <Text>Model: {model}</Text>
          </Box>
          <Box>
            <Text>Base URL: {baseUrl}</Text>
          </Box>
          {setAsDefault && (
            <Box>
              <Text color="yellow">★ Set as default provider</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>Press Enter to exit</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Or any key to configure another provider</Text>
          </Box>
        </Box>
      )
  }
}

/**
 * Run the config wizard
 */
export async function runConfigWizard(): Promise<void> {
  return new Promise((resolve) => {
    const { unmount } = render(<ConfigWizard onComplete={() => {
      unmount()
      resolve()
    }} />)
  })
}
```

**Step 2: Verify TypeScript compiles**

Run: `npm run build`
Expected: May need to install ink-text-input and ink-select-input

**Step 3: Install dependencies if needed**

```bash
npm install ink-text-input ink-select-input
```

**Step 4: Commit**

```bash
git add src/cli/config-wizard.tsx package.json
git commit -m "feat(cli): add interactive config wizard"
```

---

## Task 7: Add CLI Commands

**Files:**
- Modify: `src/index.tsx` (add config commands)

**Step 1: Add imports at top of file**

Add after existing imports:

```typescript
import { ProviderConfigService, runConfigWizard } from "./providers/index.js"
```

**Step 2: Add config command group**

Replace the existing `program.command("config")` section with:

```typescript
// Provider configuration commands
program
  .command("config")
  .description("Configure LLM providers")
  .action(async () => {
    // Interactive wizard
    await runConfigWizard()
  })

program
  .command("config list")
  .description("List all configured providers")
  .action(() => {
    const service = new ProviderConfigService()
    const providers = service.listProviders()
    const builtinProviders = service.getBuiltinProviders()

    if (providers.length === 0 && builtinProviders.every(p => !p.configured)) {
      console.log("No providers configured. Run 'lite-opencode config' to set up.")
      return
    }

    console.log("\n# Configured Providers\n")

    for (const p of builtinProviders) {
      const marker = p.configured ? "✓" : "○"
      const defaultMarker = p.config?.isDefault ? " (default)" : ""
      console.log(`  ${marker} ${p.info.name}${defaultMarker}`)
      if (p.configured && p.config) {
        console.log(`      Model: ${p.config.defaultModel}`)
        console.log(`      Base URL: ${p.config.baseUrl}`)
      }
    }

    console.log("\nRun 'lite-opencode config' to add or modify providers.")
  })

program
  .command("config switch <provider>")
  .description("Switch default provider")
  .action((providerId: string) => {
    const service = new ProviderConfigService()

    try {
      service.setDefault(providerId)
      service.save()
      console.log(`✓ Switched default provider to '${providerId}'`)
    } catch (error) {
      console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  })

program
  .command("config show [provider]")
  .description("Show provider configuration details")
  .action((providerId?: string) => {
    const service = new ProviderConfigService()

    try {
      const provider = providerId
        ? service.getProvider(providerId)
        : service.getDefaultProvider()

      if (!provider) {
        console.log(`Provider '${providerId}' not found.`)
        return
      }

      console.log(`\n# ${provider.name}\n`)
      console.log(`  ID: ${provider.id}`)
      console.log(`  Model: ${provider.defaultModel}`)
      console.log(`  Base URL: ${provider.baseUrl}`)
      console.log(`  Default: ${provider.isDefault ? "Yes" : "No"}`)
      console.log()
    } catch (error) {
      console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  })
```

**Step 2: Verify TypeScript compiles**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/index.tsx
git commit -m "feat(cli): add config commands (list, switch, show)"
```

---

## Task 8: Add In-Session Config Tool

**Files:**
- Create: `src/tools/provider-config.ts`

**Step 1: Create tool file**

```typescript
// src/tools/provider-config.ts

import { z } from "zod"
import type { Tool } from "../types.js"
import { ProviderConfigService } from "../providers/service.js"
import { BUILTIN_PROVIDERS } from "../providers/registry.js"

/**
 * Show current provider configuration
 */
export const showConfigTool: Tool = {
  name: "show_config",
  description: `Show current LLM provider configuration.

Displays:
- Current provider and model
- List of all configured providers
- Which providers have API keys configured`,

  parameters: z.object({}),

  execute: async () => {
    const service = new ProviderConfigService()

    try {
      const current = service.getDefaultProvider()
      const allProviders = service.getBuiltinProviders()

      const lines = [
        "## Current Configuration",
        "",
        `**Provider:** ${current.name} ${current.isDefault ? "(default)" : ""}`,
        `**Model:** ${current.defaultModel}`,
        `**Base URL:** ${current.baseUrl}`,
        "",
        "### Available Providers",
        "",
      ]

      for (const p of allProviders) {
        const marker = p.configured ? "✓" : "○"
        const defaultMarker = p.config?.isDefault ? " (default)" : ""
        lines.push(`- ${marker} **${p.info.name}**${defaultMarker}`)
        if (p.configured && p.config) {
          lines.push(`  - Model: \`${p.config.defaultModel}\``)
        }
      }

      lines.push("")
      lines.push("Use `/switch <provider>` to switch providers.")
      lines.push("Use `/config add` to add a new provider.")

      return lines.join("\n")
    } catch (error) {
      return `No provider configured. Run \`lite-opencode config\` to set up a provider.`
    }
  },
}

/**
 * Switch to a different provider
 */
export const switchProviderTool: Tool = {
  name: "switch_provider",
  description: `Switch the current LLM provider.

After switching, all subsequent messages will use the new provider.

Example: switch_provider provider="openai"`,

  parameters: z.object({
    provider: z.enum(["anthropic", "openai", "gemini", "deepseek", "minimax", "kimi", "custom"])
      .describe("The provider to switch to"),
  }),

  execute: async (params, ctx) => {
    const service = new ProviderConfigService()

    try {
      const config = service.getProvider(params.provider)

      if (!config) {
        return `Provider '${params.provider}' is not configured. Use \`/config add\` to configure it first.`
      }

      service.setDefault(params.provider)
      service.save()

      return `✓ Switched to **${config.name}**\n- Model: \`${config.defaultModel}\`\n- Base URL: \`${config.baseUrl}\`\n\nNote: Provider switch will take effect for new messages.`
    } catch (error) {
      return `❌ Failed to switch provider: ${error instanceof Error ? error.message : String(error)}`
    }
  },
}
```

**Step 2: Register tools in `src/tools/index.ts`**

Add imports and exports:

```typescript
export { showConfigTool, switchProviderTool } from "./provider-config.js"
```

**Step 3: Commit**

```bash
git add src/tools/provider-config.ts src/tools/index.ts
git commit -m "feat(tools): add show_config and switch_provider tools"
```

---

## Task 9: Integrate with Agent Startup

**Files:**
- Modify: `src/index.tsx` (integrate ProviderConfigService)

**Step 1: Modify startup flow**

In the main action handler, replace the config loading logic:

```typescript
// Find the section that loads tokens and add this before it:

// Load provider configuration
const providerService = new ProviderConfigService()

// Get LLM config from provider service (if configured)
let llmConfigFromProvider: { model: string; baseURL: string; apiKey: string } | null = null
try {
  if (providerService.hasProviders()) {
    llmConfigFromProvider = await providerService.getLLMConfig()
  }
} catch (error) {
  // Provider service not configured, fall back to settings
}
```

**Step 2: Update config priority**

Replace the config variable assignments:

```typescript
// Get configuration with priority: CLI > ProviderService > settings > env > defaults
const baseURL =
  options.baseUrl ??
  llmConfigFromProvider?.baseURL ??
  getConfig(undefined, "ANTHROPIC_BASE_URL", settings, "https://api.anthropic.com")

const model =
  options.model ??
  llmConfigFromProvider?.model ??
  getConfig(undefined, "ANTHROPIC_MODEL", settings, "claude-sonnet-4-20250514")

const apiKey =
  llmConfigFromProvider?.apiKey ??
  getConfig(undefined, "ANTHROPIC_AUTH_TOKEN", settings, process.env.ANTHROPIC_API_KEY || "")
```

**Step 3: Verify build**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/index.tsx
git commit -m "feat: integrate ProviderConfigService into startup flow"
```

---

## Task 10: Update Documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add documentation section**

Add after the existing CLI Options section:

```markdown
### Provider Configuration

Configure LLM providers interactively:

```bash
# Interactive configuration wizard
lite-opencode config

# List all configured providers
lite-opencode config list

# Switch default provider
lite-opencode config switch anthropic

# Show provider details
lite-opencode config show [provider]
```

**In-session commands:**

```
/config          # Show current configuration
/switch <name>   # Switch provider for current session
```

**Configuration files:**
- `~/.lite-opencode/providers.json` - Provider configurations (non-sensitive)
- API keys stored securely in system keyring or encrypted file

**Supported providers:**
| Provider | Default Model |
|----------|---------------|
| Anthropic | claude-sonnet-4-6 |
| OpenAI | gpt-4o |
| Gemini | gemini-2.0-flash |
| DeepSeek | deepseek-chat |
| MiniMax | MiniMax-Text-01 |
| Kimi | moonshot-v1-128k |
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add provider configuration documentation"
```

---

## Task 11: Final Verification

**Step 1: Run all tests**

Run: `npm run test`
Expected: All tests PASS

**Step 2: Build project**

Run: `npm run build`
Expected: No errors

**Step 3: Test CLI manually**

```bash
# Test config wizard (should show interactive UI)
node dist/index.js config

# Test list command
node dist/index.js config list
```

**Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: resolve any remaining issues"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Define types | `src/providers/types.ts` |
| 2 | Create registry | `src/providers/registry.ts` |
| 3 | Create index | `src/providers/index.ts` |
| 4 | Write tests | `src/providers/__tests__/service.test.ts` |
| 5 | Implement service | `src/providers/service.ts` |
| 6 | Create wizard | `src/cli/config-wizard.tsx` |
| 7 | Add CLI commands | `src/index.tsx` |
| 8 | Add tools | `src/tools/provider-config.ts` |
| 9 | Integrate startup | `src/index.tsx` |
| 10 | Update docs | `CLAUDE.md` |
| 11 | Verify | - |
