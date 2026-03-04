import { describe, it, expect, beforeEach } from "vitest"
import { TokenService, resetTokenService } from "../index.js"
import { EncryptedFileStorage } from "../storage/encrypted-file.js"

describe("TokenService", () => {
  beforeEach(() => {
    resetTokenService()
  })

  it("should store and retrieve token using encrypted file storage", async () => {
    // Use only encrypted file storage for testing (keyring may not be available)
    const service = new TokenService({ fallbackToFile: true })

    await service.setToken("anthropic", "test-key-123")

    const retrieved = await service.getToken("anthropic")
    expect(retrieved).toBe("test-key-123")
  })

  it("should return null for non-existent token", async () => {
    const service = new TokenService({ fallbackToFile: true })
    const retrieved = await service.getToken("nonexistent" as any)
    expect(retrieved).toBeNull()
  })

  it("should delete token", async () => {
    const service = new TokenService({ fallbackToFile: true })
    await service.setToken("anthropic", "test-key")
    await service.deleteToken("anthropic")

    const retrieved = await service.getToken("anthropic")
    expect(retrieved).toBeNull()
  })

  it("should list tokens without exposing keys", async () => {
    const service = new TokenService({ fallbackToFile: true })
    await service.setToken("anthropic", "secret-key")
    await service.setToken("openai", "another-secret")

    const list = await service.listTokens()
    expect(list).toHaveLength(2)
    expect(list[0]).not.toHaveProperty("key")
    expect(list.map((t) => t.provider)).toContain("anthropic")
    expect(list.map((t) => t.provider)).toContain("openai")
  })

  it("should detect storage type", async () => {
    const service = new TokenService({ fallbackToFile: true })
    const storageType = await service.getStorageType()
    // Should be either "keyring" or "encrypted-file"
    expect(["keyring", "encrypted-file"]).toContain(storageType)
  })
})

describe("EncryptedFileStorage", () => {
  it("should encrypt and decrypt data correctly", async () => {
    const storage = new EncryptedFileStorage()

    // Store tokens
    await storage.set("anthropic", "sk-ant-test123")
    await storage.set("openai", "sk-openai-test456")

    // Retrieve tokens
    const anthropicKey = await storage.get("anthropic")
    const openaiKey = await storage.get("openai")

    expect(anthropicKey).toBe("sk-ant-test123")
    expect(openaiKey).toBe("sk-openai-test456")
  })

  it("should update existing token", async () => {
    const storage = new EncryptedFileStorage()

    await storage.set("anthropic", "old-key")
    await storage.set("anthropic", "new-key")

    const retrieved = await storage.get("anthropic")
    expect(retrieved).toBe("new-key")
  })

  it("should be always available", async () => {
    const storage = new EncryptedFileStorage()
    const available = await storage.isAvailable()
    expect(available).toBe(true)
  })
})
