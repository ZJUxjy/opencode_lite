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
