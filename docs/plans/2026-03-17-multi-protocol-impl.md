# Multi-Protocol LLM Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add multi-protocol support (Anthropic, OpenAI, Google) and in-session provider/model switching.

**Architecture:** Extend LLMClient to support multiple SDKs based on provider protocol. Add protocol mapping in registry. Enhance in-session tools for switching.

**Tech Stack:** TypeScript, Vercel AI SDK (@ai-sdk/anthropic, @ai-sdk/openai, @ai-sdk/google), Zod

---

## Task 1: Add Protocol Type

**Files:**
- Modify: `src/providers/types.ts`

**Step 1: Add Protocol type to types.ts**

Add after `BuiltinProvider` type:

```typescript
/**
 * Supported API protocols
 */
export type ProviderProtocol = "anthropic" | "openai" | "google"
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/providers/types.ts
git commit -m "feat(providers): add ProviderProtocol type"
```

---

## Task 2: Add Protocol Mapping

**Files:**
- Modify: `src/providers/registry.ts`

**Step 1: Import the new type**

Add to imports:

```typescript
import type { BuiltinProvider, ProviderProtocol } from "./types.js"
```

**Step 2: Add protocol mapping constant**

Add after `BUILTIN_PROVIDERS`:

```typescript
/**
 * Protocol mapping for each provider
 * Most Chinese providers use Anthropic-compatible API
 */
export const PROTOCOL_MAP: Record<BuiltinProvider, ProviderProtocol> = {
  anthropic: "anthropic",
  openai: "openai",
  gemini: "google",
  deepseek: "anthropic",
  minimax: "anthropic",
  kimi: "anthropic",
}

/**
 * Get the protocol for a provider
 */
export function getProviderProtocol(id: BuiltinProvider): ProviderProtocol {
  return PROTOCOL_MAP[id] ?? "anthropic"
}
```

**Step 3: Verify build**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/providers/registry.ts
git commit -m "feat(providers): add protocol mapping for providers"
```

---

## Task 3: Update Provider Index

**Files:**
- Modify: `src/providers/index.ts`

**Step 1: Export new functions**

Update the file to include new exports:

```typescript
export * from "./types.js"
export * from "./registry.js"
export { ProviderConfigService } from "./service.js"
```

(Note: `* from "./registry.js"` already exports `getProviderProtocol`)

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/providers/index.ts
git commit -m "feat(providers): ensure all exports are available"
```

---

## Task 4: Install New SDK Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install OpenAI and Google SDKs**

Run:
```bash
npm install @ai-sdk/openai @ai-sdk/google
```

**Step 2: Verify installation**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add @ai-sdk/openai and @ai-sdk/google"
```

---

## Task 5: Update LLMConfig Type

**Files:**
- Modify: `src/llm.ts`

**Step 1: Import protocol type and add to LLMConfig**

At the top, add import:

```typescript
import type { ProviderProtocol } from "./providers/types.js"
```

Update `LLMConfig` interface:

```typescript
export interface LLMConfig {
  model?: string
  baseURL?: string
  apiKey?: string
  /** API protocol to use */
  protocol?: ProviderProtocol
  /** Request timeout in milliseconds, default 120000 (2 minutes) */
  timeout?: number
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/llm.ts
git commit -m "feat(llm): add protocol to LLMConfig"
```

---

## Task 6: Refactor LLMClient Constructor

**Files:**
- Modify: `src/llm.ts`

**Step 1: Add imports for all SDKs**

Replace the import section:

```typescript
import { generateText, streamText, CoreMessage, Tool } from "ai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import type { Message, ToolCall } from "./types.js"
import type { ProviderProtocol } from "./providers/types.js"
```

**Step 2: Add protocol field to class**

Add after `private isMiniMax: boolean`:

```typescript
private protocol: ProviderProtocol
```

**Step 3: Refactor constructor to support multi-protocol**

Replace the constructor with:

```typescript
constructor(config: LLMConfig = {}) {
  // Priority: passed config > env vars > defaults
  this.protocol = config.protocol ?? "anthropic"
  this.baseURL = config.baseURL || process.env.ANTHROPIC_BASE_URL
  this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN
  this.modelId = config.model || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514"
  this.originalModelId = this.modelId
  this.timeout = config.timeout || parseInt(process.env.API_TIMEOUT_MS || "120000", 10)

  // Model routing configuration
  this.modelRouting = {
    planModel: process.env.PLAN_MODE_MODEL || "claude-opus-4",
    buildModel: this.modelId,
    enabled: process.env.ENABLE_MODEL_ROUTING !== "false",
  }

  // Initialize provider based on protocol
  this.initProvider(config)

  if (process.env.DEBUG_LLM === "1") {
    console.log(`[LLM] Initialized with model: ${this.modelId}, protocol: ${this.protocol}, timeout: ${this.timeout}ms`)
    if (this.modelRouting.enabled) {
      console.log(`[LLM] Model routing enabled: Plan=${this.modelRouting.planModel}, Build=${this.modelRouting.buildModel}`)
    }
  }
}
```

**Step 4: Add initProvider method**

Add after constructor:

```typescript
/**
 * Initialize the AI provider based on protocol
 */
private initProvider(config: LLMConfig): void {
  switch (this.protocol) {
    case "openai":
      this.provider = createOpenAI({
        ...(this.baseURL && { baseURL: this.baseURL }),
        ...(this.apiKey && { apiKey: this.apiKey }),
      })
      break

    case "google":
      this.provider = createGoogleGenerativeAI({
        ...(this.apiKey && { apiKey: this.apiKey }),
      })
      break

    default: // anthropic
      // Handle MiniMax special case
      this.isMiniMax = this.baseURL?.includes("minimax") || false
      const anthropicConfig: any = {
        ...(this.baseURL && { baseURL: this.baseURL }),
      }

      if (this.apiKey) {
        anthropicConfig.apiKey = this.apiKey
        if (this.isMiniMax) {
          anthropicConfig.headers = {
            Authorization: `Bearer ${this.apiKey}`,
          }
        }
      }

      this.provider = createAnthropic(anthropicConfig)
  }

  this.model = this.provider(this.modelId)
}
```

**Step 5: Verify build**

Run: `npm run build`
Expected: No errors

**Step 6: Commit**

```bash
git add src/llm.ts
git commit -m "refactor(llm): support multi-protocol initialization"
```

---

## Task 7: Add switchProvider Method

**Files:**
- Modify: `src/llm.ts`

**Step 1: Add switchProvider method**

Add after `setModelRoutingConfig` method:

```typescript
/**
 * Switch to a different provider configuration
 * @param config - New provider configuration
 */
switchProvider(config: LLMConfig): void {
  if (config.protocol) {
    this.protocol = config.protocol
  }
  if (config.model) {
    this.modelId = config.model
    this.originalModelId = config.model
  }
  if (config.baseURL !== undefined) {
    this.baseURL = config.baseURL
  }
  if (config.apiKey !== undefined) {
    this.apiKey = config.apiKey
  }

  // Reinitialize provider
  this.initProvider({
    model: this.modelId,
    baseURL: this.baseURL,
    apiKey: this.apiKey,
    protocol: this.protocol,
  })

  if (process.env.DEBUG_LLM === "1") {
    console.log(`[LLM] Switched provider: protocol=${this.protocol}, model=${this.modelId}`)
  }
}

/**
 * Switch to a different model within current provider
 */
switchModel(modelId: string): void {
  this.modelId = modelId
  this.originalModelId = modelId
  this.model = this.provider(modelId)

  if (process.env.DEBUG_LLM === "1") {
    console.log(`[LLM] Switched model: ${modelId}`)
  }
}

/**
 * Get current protocol
 */
getProtocol(): ProviderProtocol {
  return this.protocol
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/llm.ts
git commit -m "feat(llm): add switchProvider and switchModel methods"
```

---

## Task 8: Add Tests for Protocol Mapping

**Files:**
- Create: `src/providers/__tests__/protocol.test.ts`

**Step 1: Create test file**

```typescript
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
```

**Step 2: Run tests**

Run: `npm run test src/providers/__tests__/protocol.test.ts`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/providers/__tests__/protocol.test.ts
git commit -m "test(providers): add protocol mapping tests"
```

---

## Task 9: Update Agent - Add switchProvider Method

**Files:**
- Modify: `src/agent.ts`

**Step 1: Import protocol utilities**

Add to imports:

```typescript
import { getProviderProtocol, getBuiltinProvider } from "./providers/registry.js"
import type { BuiltinProvider, ProviderProtocol } from "./providers/types.js"
import { ProviderConfigService } from "./providers/service.js"
```

**Step 2: Add providerService field**

Add after other private fields:

```typescript
private providerService: ProviderConfigService
```

**Step 3: Initialize in constructor**

Add in constructor after other initializations:

```typescript
this.providerService = new ProviderConfigService()
```

**Step 4: Add switchProvider method**

Add at the end of the class:

```typescript
/**
 * Switch to a different provider
 * @param providerId - Provider ID to switch to
 * @returns Result message
 */
async switchProvider(providerId: string): Promise<{ success: boolean; message: string }> {
  try {
    // Get provider config
    const config = await this.providerService.getLLMConfig(providerId)

    // Get protocol for this provider
    const protocol = getProviderProtocol(providerId as BuiltinProvider)

    // Switch LLM client
    this.llm.switchProvider({
      model: config.model,
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      protocol,
    })

    // Save as default
    this.providerService.setDefault(providerId)
    this.providerService.save()

    const providerInfo = getBuiltinProvider(providerId as BuiltinProvider)
    return {
      success: true,
      message: `✓ Switched to **${providerInfo?.name ?? providerId}**
- Model: \`${config.model}\`
- Protocol: ${protocol}
- Saved as default.`,
    }
  } catch (error) {
    return {
      success: false,
      message: `❌ Failed to switch provider: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
```

**Step 5: Verify build**

Run: `npm run build`
Expected: No errors

**Step 6: Commit**

```bash
git add src/agent.ts
git commit -m "feat(agent): add switchProvider method"
```

---

## Task 10: Update Agent - Add switchModel Method

**Files:**
- Modify: `src/agent.ts`

**Step 1: Add switchModel method**

Add after `switchProvider` method:

```typescript
/**
 * Switch to a different model within current provider
 * @param modelId - Model ID to switch to
 * @returns Result message
 */
switchModel(modelId: string): { success: boolean; message: string } {
  try {
    // Switch LLM client model
    this.llm.switchModel(modelId)

    // Save to current provider config
    const currentProvider = this.providerService.getDefaultProvider()
    this.providerService.setProvider(currentProvider.id, {
      name: currentProvider.name,
      provider: currentProvider.provider,
      baseUrl: currentProvider.baseUrl,
      defaultModel: modelId,
    })
    this.providerService.save()

    return {
      success: true,
      message: `✓ Switched to model: \`${modelId}\`
- Provider: ${currentProvider.name}
- Saved as default.`,
    }
  } catch (error) {
    return {
      success: false,
      message: `❌ Failed to switch model: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/**
 * Get available models for a provider
 * @param providerId - Optional provider ID, defaults to current provider
 */
getAvailableModels(providerId?: string): string[] {
  const id = providerId ?? this.providerService.getDefaultProvider()?.id
  if (!id) return []

  const info = getBuiltinProvider(id as BuiltinProvider)
  return info?.models ?? []
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/agent.ts
git commit -m "feat(agent): add switchModel and getAvailableModels methods"
```

---

## Task 11: Update In-Session Tools - show_config

**Files:**
- Modify: `src/tools/provider-config.ts`

**Step 1: Update showConfigTool**

Replace the entire tool:

```typescript
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
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/tools/provider-config.ts
git commit -m "feat(tools): enhance show_config with protocol and models"
```

---

## Task 12: Update In-Session Tools - switch_provider

**Files:**
- Modify: `src/tools/provider-config.ts`

**Step 1: Update switchProviderTool**

Replace the tool:

```typescript
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

  execute: async (params, ctx) => {
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

    return `✓ Switched to **${providerInfo?.name ?? params.provider}**
- Model: \`${config.defaultModel}\`
- Protocol: ${protocol}
- Base URL: \`${config.baseUrl}\`

Note: Provider switch will take effect for new messages.
Saved as default provider.`
  },
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/tools/provider-config.ts
git commit -m "feat(tools): enhance switch_provider with auto-save"
```

---

## Task 13: Add switch_model Tool

**Files:**
- Modify: `src/tools/provider-config.ts`

**Step 1: Add switchModelTool**

Add after `switchProviderTool`:

```typescript
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

  execute: async (params, ctx) => {
    const service = new ProviderConfigService()

    try {
      const current = service.getDefaultProvider()
      const providerInfo = BUILTIN_PROVIDERS.find((p) => p.id === current.id)

      // Check if model is in the list (warning only)
      const availableModels = providerInfo?.models ?? []
      const modelWarning =
        availableModels.length > 0 && !availableModels.includes(params.model)
          ? `\n\n⚠️ Warning: \`${params.model}\` is not in the standard model list for ${providerInfo?.name}.`
          : ""

      // Update provider config with new model
      service.setProvider(current.id, {
        name: current.name,
        provider: current.provider,
        baseUrl: current.baseUrl,
        defaultModel: params.model,
      })
      service.save()

      return `✓ Switched to model: \`${params.model}\`
- Provider: ${current.name}
- Protocol: ${getProviderProtocol(current.id as BuiltinProvider)}${modelWarning}

Saved as default model.`
    } catch (error) {
      return `❌ Failed to switch model: ${error instanceof Error ? error.message : String(error)}`
    }
  },
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/tools/provider-config.ts
git commit -m "feat(tools): add switch_model tool"
```

---

## Task 14: Add list_models Tool

**Files:**
- Modify: `src/tools/provider-config.ts`
- Modify: `src/tools/index.ts`

**Step 1: Add listModelsTool**

Add after `switchModelTool`:

```typescript
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

  execute: async (params, ctx) => {
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
```

**Step 2: Register new tools in index.ts**

Update `src/tools/index.ts` to export the new tools:

```typescript
export {
  showConfigTool,
  switchProviderTool,
  switchModelTool,
  listModelsTool,
} from "./provider-config.js"
```

**Step 3: Verify build**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/tools/provider-config.ts src/tools/index.ts
git commit -m "feat(tools): add list_models tool and register all tools"
```

---

## Task 15: Run Full Test Suite

**Step 1: Run all tests**

Run: `npm run test`
Expected: All tests PASS (except potentially keyring tests due to environment)

**Step 2: Build verification**

Run: `npm run build`
Expected: No errors

**Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: resolve any test/build issues"
```

---

## Task 16: Update Documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update in-session tools section**

Find the Provider Configuration section and update the in-session tools:

```markdown
**In-session tools:**

```
show_config                        # Show current configuration
switch_provider provider="openai"  # Switch provider (auto-saves)
switch_model model="gpt-4o"        # Switch model (auto-saves)
list_models provider="openai"      # List available models
```
```

**Step 2: Add protocol information**

Add to the Supported providers table:

```markdown
**Supported providers:**
| Provider | Default Model | Protocol |
|----------|---------------|----------|
| Anthropic | claude-sonnet-4-6 | anthropic |
| OpenAI | gpt-4o | openai |
| Gemini | gemini-2.0-flash | google |
| DeepSeek | deepseek-chat | anthropic (compatible) |
| MiniMax | MiniMax-Text-01 | anthropic (compatible) |
| Kimi | moonshot-v1-128k | anthropic (compatible) |
```

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update provider config documentation with protocols"
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Add ProviderProtocol type |
| 2 | Add protocol mapping to registry |
| 3 | Update provider index exports |
| 4 | Install @ai-sdk/openai and @ai-sdk/google |
| 5 | Update LLMConfig with protocol |
| 6 | Refactor LLMClient constructor |
| 7 | Add switchProvider/switchModel to LLMClient |
| 8 | Add protocol mapping tests |
| 9 | Add switchProvider to Agent |
| 10 | Add switchModel to Agent |
| 11 | Enhance show_config tool |
| 12 | Enhance switch_provider tool |
| 13 | Add switch_model tool |
| 14 | Add list_models tool |
| 15 | Run full test suite |
| 16 | Update documentation |
