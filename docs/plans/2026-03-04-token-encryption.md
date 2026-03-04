# Token Encryption Storage Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 API Token 的加密存储，使用系统 keyring 安全保存 token，替代明文存储在 settings.json 中。

**Architecture:** 创建 TokenService 抽象层，支持多种存储后端（keyring 优先，回退到文件加密）。提供 CLI 命令管理 token。

**Tech Stack:** TypeScript, keyring (via keytar library or similar), crypto (Node.js built-in)

---

## Overview

当前 token 存储方式：
- `settings.json`: 明文存储 `ANTHROPIC_API_KEY` 等
- 环境变量: 明文存储

安全风险：
- 配置文件可能被提交到 git
- 其他用户可以读取配置文件

解决方案：
- 使用系统 keyring (macOS Keychain, Windows Credential Manager, Linux Secret Service)
- 回退方案：加密文件存储

---

## Task 1: Create Token Service Interface

**Files:**
- Create: `src/tokens/types.ts`
- Create: `src/tokens/service.ts`

**Step 1: Define token types**

```typescript
// src/tokens/types.ts

export type TokenProvider = "anthropic" | "openai" | "minimax" | "gemini" | "deepseek" | "custom"

export interface TokenInfo {
  provider: TokenProvider
  key: string        // The actual API key (sensitive)
  name?: string      // User-friendly name
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
  fileEncryptionKey?: Buffer  // Optional: custom encryption key
}

export const DEFAULT_TOKEN_CONFIG: TokenServiceConfig = {
  serviceName: "lite-opencode",
  fallbackToFile: true,
}
```

**Step 2: Run TypeScript check**

Run: `npx tsc --noEmit src/tokens/types.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add src/tokens/types.ts
git commit -m "feat(tokens): add token service types"
```

---

## Task 2: Implement Keyring Storage (with fallback)

**Files:**
- Create: `src/tokens/storage/keyring.ts`
- Modify: `package.json` (add optional dependency)

**Step 1: Install keytar (or use native implementation)**

Run: `npm install keytar --save-optional`
Expected: Package installed

**Step 2: Implement keyring storage**

```typescript
// src/tokens/storage/keyring.ts
import type { TokenStorage, TokenProvider, TokenInfo } from "../types.js"

// Try to import keytar, but don't fail if not available
let keytar: typeof import("keytar") | null = null
try {
  keytar = await import("keytar")
} catch {
  // keytar not available
}

const SERVICE_NAME = "lite-opencode"

/**
 * Keyring-based token storage using OS credential manager
 */
export class KeyringStorage implements TokenStorage {
  async set(provider: TokenProvider, key: string): Promise<void> {
    if (!keytar) {
      throw new Error("Keyring not available")
    }

    const account = this.getAccountName(provider)
    await keytar.setPassword(SERVICE_NAME, account, key)
  }

  async get(provider: TokenProvider): Promise<string | null> {
    if (!keytar) {
      return null
    }

    const account = this.getAccountName(provider)
    return keytar.getPassword(SERVICE_NAME, account)
  }

  async delete(provider: TokenProvider): Promise<void> {
    if (!keytar) {
      throw new Error("Keyring not available")
    }

    const account = this.getAccountName(provider)
    await keytar.deletePassword(SERVICE_NAME, account)
  }

  async list(): Promise<Omit<TokenInfo, "key">[]> {
    if (!keytar) {
      return []
    }

    const credentials = await keytar.findCredentials(SERVICE_NAME)
    return credentials.map((cred) => ({
      provider: this.parseAccountName(cred.account),
      createdAt: new Date(), // keytar doesn't store metadata
    }))
  }

  async isAvailable(): Promise<boolean> {
    return keytar !== null
  }

  private getAccountName(provider: TokenProvider): string {
    return `api-key-${provider}`
  }

  private parseAccountName(account: string): TokenProvider {
    const match = account.match(/^api-key-(.+)$/)
    if (match) {
      return match[1] as TokenProvider
    }
    return "custom"
  }
}
```

**Step 3: Commit**

```bash
git add package.json package-lock.json src/tokens/storage/keyring.ts
git commit -m "feat(tokens): implement keyring storage backend"
```

---

## Task 3: Implement Encrypted File Storage (Fallback)

**Files:**
- Create: `src/tokens/storage/encrypted-file.ts`

**Step 1: Implement encrypted file storage**

```typescript
// src/tokens/storage/encrypted-file.ts
import { readFile, writeFile, mkdir, access } from "fs/promises"
import { join } from "path"
import { homedir } from "os"
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto"
import type { TokenStorage, TokenProvider, TokenInfo } from "../types.js"

const STORAGE_DIR = join(homedir(), ".lite-opencode")
const STORAGE_FILE = join(STORAGE_DIR, "tokens.enc")
const ALGORITHM = "aes-256-gcm"

interface EncryptedData {
  iv: string
  authTag: string
  encrypted: string
}

interface TokenStore {
  version: number
  tokens: Record<TokenProvider, { key: string; createdAt: string }>
}

/**
 * Derive encryption key from machine-specific data
 * This provides basic obfuscation - not as secure as keyring
 */
function deriveKey(): Buffer {
  // Use machine-specific data as salt
  const salt = `${process.env.USER || process.env.USERNAME}-${process.platform}`
  return scryptSync(salt, "lite-opencode-salt", 32)
}

/**
 * Encrypt data
 */
function encrypt(text: string, key: Buffer): EncryptedData {
  const iv = randomBytes(16)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(text, "utf8", "hex")
  encrypted += cipher.final("hex")

  return {
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
    encrypted,
  }
}

/**
 * Decrypt data
 */
function decrypt(data: EncryptedData, key: Buffer): string {
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(data.iv, "hex")
  )
  decipher.setAuthTag(Buffer.from(data.authTag, "hex"))

  let decrypted = decipher.update(data.encrypted, "hex", "utf8")
  decrypted += decipher.final("utf8")

  return decrypted
}

/**
 * File-based encrypted token storage (fallback)
 */
export class EncryptedFileStorage implements TokenStorage {
  private key: Buffer

  constructor() {
    this.key = deriveKey()
  }

  async set(provider: TokenProvider, key: string): Promise<void> {
    const store = await this.loadStore()
    store.tokens[provider] = {
      key,
      createdAt: new Date().toISOString(),
    }
    await this.saveStore(store)
  }

  async get(provider: TokenProvider): Promise<string | null> {
    const store = await this.loadStore()
    return store.tokens[provider]?.key || null
  }

  async delete(provider: TokenProvider): Promise<void> {
    const store = await this.loadStore()
    delete store.tokens[provider]
    await this.saveStore(store)
  }

  async list(): Promise<Omit<TokenInfo, "key">[]> {
    const store = await this.loadStore()
    return Object.entries(store.tokens).map(([provider, data]) => ({
      provider: provider as TokenProvider,
      createdAt: new Date(data.createdAt),
    }))
  }

  async isAvailable(): Promise<boolean> {
    return true // Always available
  }

  private async loadStore(): Promise<TokenStore> {
    try {
      await access(STORAGE_FILE)
    } catch {
      return { version: 1, tokens: {} }
    }

    try {
      const data = await readFile(STORAGE_FILE, "utf-8")
      const encrypted: EncryptedData = JSON.parse(data)
      const decrypted = decrypt(encrypted, this.key)
      return JSON.parse(decrypted)
    } catch {
      // If decryption fails, return empty store
      return { version: 1, tokens: {} }
    }
  }

  private async saveStore(store: TokenStore): Promise<void> {
    await mkdir(STORAGE_DIR, { recursive: true })
    const json = JSON.stringify(store)
    const encrypted = encrypt(json, this.key)
    await writeFile(STORAGE_FILE, JSON.stringify(encrypted, null, 2))
  }
}
```

**Step 2: Commit**

```bash
git add src/tokens/storage/encrypted-file.ts
git commit -m "feat(tokens): implement encrypted file storage fallback"
```

---

## Task 4: Create Unified Token Service

**Files:**
- Create: `src/tokens/index.ts`

**Step 1: Implement TokenService**

```typescript
// src/tokens/index.ts
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
```

**Step 2: Commit**

```bash
git add src/tokens/index.ts
git commit -m "feat(tokens): create unified token service"
```

---

## Task 5: Add Token Management Tool

**Files:**
- Create: `src/tools/token.ts`
- Modify: `src/tools/index.ts` (register tool)

**Step 1: Create token management tool**

```typescript
// src/tools/token.ts
import { z } from "zod"
import type { Tool } from "../types.js"
import { getTokenService } from "../tokens/index.js"

/**
 * List stored tokens
 */
export const listTokensTool: Tool = {
  name: "list_tokens",
  description: `List all securely stored API tokens.

Shows which providers have tokens configured (without revealing keys).`,

  parameters: z.object({}),

  execute: async () => {
    const service = getTokenService()
    const tokens = await service.listTokens()
    const storageType = await service.getStorageType()

    if (tokens.length === 0) {
      return "No tokens stored. Use set_token to add API keys."
    }

    const lines = [
      `# Stored Tokens (${tokens.length})`,
      "",
      `Storage: ${storageType}`,
      "",
      ...tokens.map((t) => `- ${t.provider}`),
      "",
      "Use set_token to add/update tokens, delete_token to remove.",
    ]

    return lines.join("\n")
  },
}

/**
 * Set/store a token
 */
export const setTokenTool: Tool = {
  name: "set_token",
  description: `Store an API key securely using system keyring or encrypted storage.

Supports providers: anthropic, openai, minimax, gemini, deepseek

Example: set_token provider="anthropic" key="sk-xxx..."`,

  parameters: z.object({
    provider: z.enum(["anthropic", "openai", "minimax", "gemini", "deepseek", "custom"])
      .describe("The API provider"),
    key: z.string().describe("The API key (will be encrypted)"),
  }),

  execute: async (params) => {
    const service = getTokenService()

    try {
      await service.setToken(params.provider, params.key)
      const storageType = await service.getStorageType()

      return `✅ Token for ${params.provider} stored securely (${storageType})`
    } catch (error) {
      return `❌ Failed to store token: ${error instanceof Error ? error.message : String(error)}`
    }
  },
}

/**
 * Delete a token
 */
export const deleteTokenTool: Tool = {
  name: "delete_token",
  description: "Delete a stored API token.",

  parameters: z.object({
    provider: z.enum(["anthropic", "openai", "minimax", "gemini", "deepseek", "custom"])
      .describe("The API provider"),
  }),

  execute: async (params) => {
    const service = getTokenService()

    try {
      await service.deleteToken(params.provider)
      return `🗑️  Token for ${params.provider} deleted`
    } catch (error) {
      return `❌ Failed to delete token: ${error instanceof Error ? error.message : String(error)}`
    }
  },
}
```

**Step 2: Register tools**

```typescript
// src/tools/index.ts - add imports
import { listTokensTool, setTokenTool, deleteTokenTool } from "./token.js"

// Add to allTools array
const allTools = [
  // ... existing tools ...
  listTokensTool,
  setTokenTool,
  deleteTokenTool,
]
```

**Step 3: Commit**

```bash
git add src/tools/token.ts src/tools/index.ts
git commit -m "feat(tokens): add token management tools"
```

---

## Task 6: Integrate Token Service with Config Loading

**Files:**
- Modify: `src/config/loader.ts` (or wherever config is loaded)
- Modify: `src/llm.ts` (where API keys are used)

**Step 1: Update config loading to use token service**

```typescript
// In config loading code
import { getTokenService } from "../tokens/index.js"

export async function loadConfig(): Promise<Config> {
  // Load settings.json
  const settings = await loadSettingsFile()

  // Merge with secure tokens
  const tokenService = getTokenService()
  const env = { ...settings.env }

  // Check for tokens in secure storage
  const providers = ["anthropic", "openai", "minimax", "gemini", "deepseek"] as const
  for (const provider of providers) {
    const token = await tokenService.getToken(provider)
    if (token) {
      const envKey = `${provider.toUpperCase()}_API_KEY`
      env[envKey] = token
    }
  }

  return {
    ...settings,
    env,
  }
}
```

**Step 2: Update LLM client to check token service**

```typescript
// src/llm.ts
import { getTokenService } from "./tokens/index.js"

export async function createLLMClient(config: LLMConfig) {
  // If no API key provided, check token service
  if (!config.apiKey) {
    const provider = detectProvider(config.model)
    const tokenService = getTokenService()
    const token = await tokenService.getToken(provider)
    if (token) {
      config.apiKey = token
    }
  }

  // ... rest of client creation
}
```

**Step 3: Commit**

```bash
git add src/config/loader.ts src/llm.ts
git commit -m "feat(tokens): integrate token service with config and llm"
```

---

## Task 7: Add Tests

**Files:**
- Create: `src/tokens/__tests__/service.test.ts`

**Step 1: Write tests**

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest"
import { TokenService } from "../index.js"
import { resetTokenService } from "../index.js"

describe("TokenService", () => {
  beforeEach(() => {
    resetTokenService()
  })

  it("should store and retrieve token", async () => {
    const service = new TokenService()
    await service.setToken("anthropic", "test-key-123")

    const retrieved = await service.getToken("anthropic")
    expect(retrieved).toBe("test-key-123")
  })

  it("should return null for non-existent token", async () => {
    const service = new TokenService()
    const retrieved = await service.getToken("nonexistent")
    expect(retrieved).toBeNull()
  })

  it("should delete token", async () => {
    const service = new TokenService()
    await service.setToken("anthropic", "test-key")
    await service.deleteToken("anthropic")

    const retrieved = await service.getToken("anthropic")
    expect(retrieved).toBeNull()
  })

  it("should list tokens without exposing keys", async () => {
    const service = new TokenService()
    await service.setToken("anthropic", "secret-key")
    await service.setToken("openai", "another-secret")

    const list = await service.listTokens()
    expect(list).toHaveLength(2)
    expect(list[0]).not.toHaveProperty("key")
    expect(list.map((t) => t.provider)).toContain("anthropic")
    expect(list.map((t) => t.provider)).toContain("openai")
  })
})
```

**Step 2: Run tests**

Run: `npm test -- --run src/tokens/__tests__/service.test.ts`
Expected: All tests pass

**Step 3: Commit**

```bash
git add src/tokens/__tests__/service.test.ts
git commit -m "test(tokens): add token service tests"
```

---

## Task 8: Update CLI Commands

**Files:**
- Modify: `src/index.tsx` (CLI commands)

**Step 1: Add token management CLI commands**

```typescript
// Add to CLI commands
program
  .command("config")
  .description("Manage configuration")
  .addCommand(
    new Command("set-token")
      .description("Store an API token securely")
      .argument("<provider>", "Provider name (anthropic, openai, etc.)")
      .argument("<key>", "API key")
      .action(async (provider, key) => {
        const { getTokenService } = await import("./tokens/index.js")
        const service = getTokenService()
        await service.setToken(provider, key)
        console.log(`Token for ${provider} stored securely`)
      })
  )
  .addCommand(
    new Command("list-tokens")
      .description("List stored tokens")
      .action(async () => {
        const { getTokenService } = await import("./tokens/index.js")
        const service = getTokenService()
        const tokens = await service.listTokens()
        console.log("Stored tokens:", tokens.map((t) => t.provider).join(", ") || "None")
      })
  )
```

**Step 2: Commit**

```bash
git add src/index.tsx
git commit -m "feat(cli): add token management commands"
```

---

## Task 9: Update Documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add token management documentation**

```markdown
### Token Management

API keys can be stored securely using system keyring (macOS Keychain, Windows Credential Manager, Linux Secret Service) or encrypted file storage.

**Set a token:**
```bash
lite-opencode config set-token anthropic sk-ant-xxxxx
```

**List stored tokens:**
```bash
lite-opencode config list-tokens
```

**Use in settings.json:**
Tokens stored securely take precedence over settings.json values.

```json
{
  "env": {
    // These will be overridden by secure tokens if present
    "ANTHROPIC_API_KEY": "..."
  }
}
```
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add token management documentation"
```

---

## Summary

This implementation adds:

1. **TokenService**: Unified API for secure token storage
2. **KeyringStorage**: Uses OS credential manager (most secure)
3. **EncryptedFileStorage**: Fallback using AES-256-GCM encryption
4. **Management Tools**: list_tokens, set_token, delete_token
5. **CLI Integration**: config set-token and config list-tokens commands
6. **Test Coverage**: Unit tests for service functionality

**Total estimated time**: 0.5-1 day
**Breaking changes**: None (fully backward compatible)
**Security improvement**: High (keys no longer stored in plain text)
