// src/tools/provider-config.ts

import { z } from "zod"
import type { Tool } from "../types.js"
import { ProviderConfigService } from "../providers/service.js"
import { BUILTIN_PROVIDERS, getProviderProtocol } from "../providers/registry.js"
import type { BuiltinProvider } from "../providers/types.js"

/**
 * Show current provider configuration
 */
export const showConfigTool: Tool = {
  name: "show_config",
  description: `Show current LLM provider configuration.

Displays:
- Current provider and model
- Protocol type
- List of all configured providers
- Available models for current provider

Example: show_config`,

  parameters: z.object({}),

  execute: async () => {
    const service = new ProviderConfigService()

    try {
      const current = service.getDefaultProvider()
      const protocol = getProviderProtocol(current.id as BuiltinProvider)
      const allProviders = service.getBuiltinProviders()
      const providerInfo = BUILTIN_PROVIDERS.find((p) => p.id === current.id)

      const lines = [
        "## Current Configuration",
        "",
        `**Provider:** ${current.name} ${current.isDefault ? "(default)" : ""}`,
        `**Model:** ${current.defaultModel}`,
        `**Protocol:** ${protocol}`,
        `**Base URL:** ${current.baseUrl}`,
        "",
        "### Available Models",
        "",
      ]

      // Show models for current provider
      if (providerInfo?.models) {
        for (const model of providerInfo.models) {
          const marker = model === current.defaultModel ? "✓ " : "  "
          lines.push(`${marker}\`${model}\``)
        }
      }

      lines.push("")
      lines.push("### All Providers")
      lines.push("")

      for (const p of allProviders) {
        const marker = p.configured ? "✓" : "○"
        const defaultMarker = p.id === current.id ? " (current)" : ""
        const pProtocol = getProviderProtocol(p.id)
        lines.push(`- ${marker} **${p.info.name}** [${pProtocol}]${defaultMarker}`)
      }

      lines.push("")
      lines.push("Use `switch_provider` to change provider.")
      lines.push("Use `switch_model` to change model.")
      lines.push("Use `list_models` to see all models for a provider.")

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
The switch is saved as the default provider.

Example: switch_provider provider="openai"`,

  parameters: z.object({
    provider: z
      .enum(["anthropic", "openai", "gemini", "deepseek", "minimax", "kimi"])
      .describe("The provider to switch to"),
  }),

  execute: async (params) => {
    const service = new ProviderConfigService()

    // Check if provider is configured
    const config = service.getProvider(params.provider)
    if (!config) {
      const providerInfo = BUILTIN_PROVIDERS.find((p) => p.id === params.provider)
      return `Provider '${params.provider}' is not configured.

Run the CLI command to configure it:
\`\`\`
lite-opencode config
\`\`\`

Then select **${providerInfo?.name ?? params.provider}**.`
    }

    // Set as default and save
    service.setDefault(params.provider)
    service.save()

    const protocol = getProviderProtocol(params.provider)
    const providerInfo = BUILTIN_PROVIDERS.find((p) => p.id === params.provider)

    return `Switched to **${providerInfo?.name ?? params.provider}**
- Model: \`${config.defaultModel}\`
- Protocol: ${protocol}
- Base URL: \`${config.baseUrl}\`

Note: Provider switch will take effect for new messages.
Saved as default provider.`
  },
}

/**
 * Switch to a different model
 */
export const switchModelTool: Tool = {
  name: "switch_model",
  description: `Switch to a different model within the current provider.

Use \`list_models\` to see available models.
The switch is saved as the default model for the provider.

Example: switch_model model="gpt-4o"`,

  parameters: z.object({
    model: z.string().describe("Model ID to switch to"),
  }),

  execute: async (params) => {
    const service = new ProviderConfigService()

    try {
      const current = service.getDefaultProvider()
      const providerInfo = BUILTIN_PROVIDERS.find((p) => p.id === current.id)

      // Check if model is in the list (warning only)
      const availableModels = providerInfo?.models ?? []
      const modelWarning =
        availableModels.length > 0 && !availableModels.includes(params.model)
          ? `\n\nWarning: \`${params.model}\` is not in the standard model list for ${providerInfo?.name}.`
          : ""

      // Update provider config with new model
      service.setProvider(current.id, {
        name: current.name,
        provider: current.provider,
        baseUrl: current.baseUrl,
        defaultModel: params.model,
      })
      service.save()

      return `Switched to model: \`${params.model}\`
- Provider: ${current.name}
- Protocol: ${getProviderProtocol(current.id as BuiltinProvider)}${modelWarning}

Saved as default model.`
    } catch (error) {
      return `Failed to switch model: ${error instanceof Error ? error.message : String(error)}`
    }
  },
}

/**
 * List available models for a provider
 */
export const listModelsTool: Tool = {
  name: "list_models",
  description: `List available models for a provider.

If no provider specified, shows models for the current provider.

Example: list_models
Example: list_models provider="openai"`,

  parameters: z.object({
    provider: z
      .enum(["anthropic", "openai", "gemini", "deepseek", "minimax", "kimi"])
      .optional()
      .describe("Provider ID (optional, defaults to current)"),
  }),

  execute: async (params) => {
    const service = new ProviderConfigService()
    let providerId: string

    if (params.provider) {
      providerId = params.provider
    } else {
      try {
        const current = service.getDefaultProvider()
        providerId = current.id
      } catch {
        return "No provider configured. Run `lite-opencode config` to set up."
      }
    }

    const providerInfo = BUILTIN_PROVIDERS.find((p) => p.id === providerId)
    if (!providerInfo) {
      return `Unknown provider: ${providerId}`
    }

    const config = service.getProvider(providerId)
    const currentModel = config?.defaultModel

    const lines = [
      `## Models for ${providerInfo.name}`,
      "",
      `Protocol: ${getProviderProtocol(providerId as BuiltinProvider)}`,
      "",
    ]

    for (const model of providerInfo.models) {
      const marker = model === currentModel ? "✓ " : "  "
      lines.push(`${marker}\`${model}\``)
    }

    lines.push("")
    lines.push("Use `switch_model model=\"<name>\"` to switch.")

    return lines.join("\n")
  },
}
