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
- Which providers have API keys configured

Example: show_config`,

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
      lines.push("Use `switch_provider` to switch to a different provider.")
      lines.push("Use the CLI command `lite-opencode config` to add new providers.")

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

  execute: async (params) => {
    const service = new ProviderConfigService()

    try {
      const config = service.getProvider(params.provider)

      if (!config) {
        return `Provider '${params.provider}' is not configured. Use the CLI command \`lite-opencode config\` to configure it first.`
      }

      service.setDefault(params.provider)
      service.save()

      return `✓ Switched to **${config.name}**
- Model: \`${config.defaultModel}\`
- Base URL: \`${config.baseUrl}\`

Note: Provider switch will take effect for new messages.`
    } catch (error) {
      return `❌ Failed to switch provider: ${error instanceof Error ? error.message : String(error)}`
    }
  },
}
