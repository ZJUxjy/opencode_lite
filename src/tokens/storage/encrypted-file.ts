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
  tokens: Partial<Record<TokenProvider, { key: string; createdAt: string }>>
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
