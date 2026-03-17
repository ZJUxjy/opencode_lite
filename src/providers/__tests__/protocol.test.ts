import { describe, it, expect } from "vitest"
import { PROTOCOL_MAP, getProviderProtocol } from "../registry.js"
import type { BuiltinProvider } from "../types.js"

describe("Protocol Mapping", () => {
  it("should have protocol for all builtin providers", () => {
    const providers: BuiltinProvider[] = ["anthropic", "openai", "gemini", "deepseek", "minimax", "kimi"]

    for (const provider of providers) {
      expect(PROTOCOL_MAP[provider]).toBeDefined()
    }
  })

  it("should map Anthropic to anthropic protocol", () => {
    expect(getProviderProtocol("anthropic")).toBe("anthropic")
  })

  it("should map OpenAI to openai protocol", () => {
    expect(getProviderProtocol("openai")).toBe("openai")
  })

  it("should map Gemini to google protocol", () => {
    expect(getProviderProtocol("gemini")).toBe("google")
  })

  it("should map DeepSeek to anthropic protocol (compatible)", () => {
    expect(getProviderProtocol("deepseek")).toBe("anthropic")
  })

  it("should map MiniMax to anthropic protocol (compatible)", () => {
    expect(getProviderProtocol("minimax")).toBe("anthropic")
  })

  it("should map Kimi to anthropic protocol (compatible)", () => {
    expect(getProviderProtocol("kimi")).toBe("anthropic")
  })
})
