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
