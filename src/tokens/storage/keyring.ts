import type { TokenStorage, TokenProvider, TokenInfo } from "../types.js"

// Keytar type definitions (for optional dependency)
interface Keytar {
  setPassword(service: string, account: string, password: string): Promise<void>
  getPassword(service: string, account: string): Promise<string | null>
  deletePassword(service: string, account: string): Promise<boolean>
  findCredentials(service: string): Promise<Array<{ account: string; password: string }>>
}

// Try to import keytar, but don't fail if not available
let keytar: Keytar | null = null

// Dynamic import with proper error handling
async function initializeKeytar(): Promise<void> {
  try {
    // @ts-expect-error keytar is optional dependency
    const keytarModule = await import("keytar")
    keytar = keytarModule as Keytar
  } catch {
    // keytar not available - will fallback to file storage
    keytar = null
  }
}

// Initialize on module load
await initializeKeytar()

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
