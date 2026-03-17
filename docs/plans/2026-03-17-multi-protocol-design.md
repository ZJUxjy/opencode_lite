# Multi-Protocol LLM Support Design

## Overview

Enhance the LLM client to support multiple API protocols (Anthropic, OpenAI, Google) and add in-session provider/model switching capabilities.

## Requirements Summary

| Requirement | Decision |
|-------------|----------|
| Switch persistence | Auto-save as default |
| Model selection | List selection only |
| Protocol mapping | Auto-infer by provider |
| Switch effect | Immediate |

## Protocol Mapping

| Provider | Protocol | SDK |
|----------|----------|-----|
| Anthropic | anthropic | `@ai-sdk/anthropic` |
| OpenAI | openai | `@ai-sdk/openai` |
| Gemini | google | `@ai-sdk/google` |
| DeepSeek | anthropic | `@ai-sdk/anthropic` + custom URL |
| MiniMax | anthropic | `@ai-sdk/anthropic` + custom URL |
| Kimi | anthropic | `@ai-sdk/anthropic` + custom URL |
| Custom | anthropic | `@ai-sdk/anthropic` + custom URL |

## Architecture

### 1. Protocol Type Definition

```typescript
// src/providers/types.ts

export type ProviderProtocol = "anthropic" | "openai" | "google"

export interface ProviderConfig {
  // ... existing fields
  protocol?: ProviderProtocol  // Optional override
}
```

### 2. Protocol Registry

```typescript
// src/providers/registry.ts

import type { ProviderProtocol, BuiltinProvider } from "./types.js"

export const PROTOCOL_MAP: Record<BuiltinProvider, ProviderProtocol> = {
  anthropic: "anthropic",
  openai: "openai",
  gemini: "google",
  deepseek: "anthropic",
  minimax: "anthropic",
  kimi: "anthropic",
}

export function getProviderProtocol(id: BuiltinProvider): ProviderProtocol {
  return PROTOCOL_MAP[id] ?? "anthropic"
}
```

### 3. LLM Client Enhancement

```typescript
// src/llm.ts

import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"

export interface LLMConfig {
  model?: string
  baseURL?: string
  apiKey?: string
  protocol?: ProviderProtocol
  timeout?: number
}

export class LLMClient {
  private provider: any
  private protocol: ProviderProtocol
  private modelId: string
  private model: any

  constructor(config: LLMConfig = {}) {
    this.protocol = config.protocol ?? "anthropic"
    this.modelId = config.model ?? "claude-sonnet-4-6"
    this.initProvider(config)
  }

  private initProvider(config: LLMConfig): void {
    switch (this.protocol) {
      case "openai":
        this.provider = createOpenAI({
          baseURL: config.baseURL,
          apiKey: config.apiKey,
        })
        break
      case "google":
        this.provider = createGoogleGenerativeAI({
          apiKey: config.apiKey,
          // Note: Google SDK handles baseURL internally
        })
        break
      default: // anthropic
        this.provider = createAnthropic({
          baseURL: config.baseURL,
          apiKey: config.apiKey,
        })
    }
    this.model = this.provider(this.modelId)
  }

  /**
   * Switch to a different provider configuration
   */
  switchProvider(config: LLMConfig): void {
    if (config.protocol) {
      this.protocol = config.protocol
    }
    if (config.model) {
      this.modelId = config.model
    }
    this.initProvider({
      ...config,
      protocol: this.protocol,
      model: this.modelId,
    })
  }

  /**
   * Switch to a different model within current provider
   */
  switchModel(modelId: string): void {
    this.modelId = modelId
    this.model = this.provider(modelId)
  }

  /**
   * Get current protocol
   */
  getProtocol(): ProviderProtocol {
    return this.protocol
  }
}
```

### 4. In-Session Tools

```typescript
// src/tools/provider-config.ts

// Enhanced: show_config
export const showConfigTool: Tool = {
  name: "show_config",
  description: `Show current LLM provider configuration with available models.`,
  parameters: z.object({}),
  execute: async () => {
    // Returns: provider, model, protocol, base URL, available models
  }
}

// Enhanced: switch_provider (auto-save, immediate effect)
export const switchProviderTool: Tool = {
  name: "switch_provider",
  description: `Switch the current LLM provider.`,
  parameters: z.object({
    provider: z.enum(["anthropic", "openai", "gemini", "deepseek", "minimax", "kimi"])
  }),
  execute: async (params, ctx) => {
    // 1. Get config from ProviderConfigService
    // 2. Get protocol from registry
    // 3. Call agent.switchProvider()
    // 4. Save as default
  }
}

// New: switch_model
export const switchModelTool: Tool = {
  name: "switch_model",
  description: `Switch to a different model within the current provider.`,
  parameters: z.object({
    model: z.string().describe("Model ID to switch to")
  }),
  execute: async (params, ctx) => {
    // 1. Validate model is in available list
    // 2. Call agent.switchModel()
    // 3. Save as default
  }
}

// New: list_models
export const listModelsTool: Tool = {
  name: "list_models",
  description: `List available models for a provider.`,
  parameters: z.object({
    provider: z.enum(["anthropic", "openai", "gemini", "deepseek", "minimax", "kimi"]).optional()
  }),
  execute: async (params, ctx) => {
    // Returns: list of models for specified or current provider
  }
}
```

### 5. Agent Integration

```typescript
// src/agent.ts

import { ProviderConfigService } from "./providers/service.js"
import { getProviderProtocol } from "./providers/registry.js"

export class Agent {
  private llmClient: LLMClient
  private providerService: ProviderConfigService

  /**
   * Switch to a different provider
   */
  async switchProvider(providerId: string): Promise<{ success: boolean; message: string }> {
    const config = await this.providerService.getLLMConfig(providerId)
    const protocol = getProviderProtocol(providerId as BuiltinProvider)

    this.llmClient.switchProvider({
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
      message: `✓ Switched to ${providerInfo?.name ?? providerId}\n  Model: ${config.model}\n  Protocol: ${protocol}\n  Saved as default.`
    }
  }

  /**
   * Switch to a different model
   */
  switchModel(modelId: string): { success: boolean; message: string } {
    this.llmClient.switchModel(modelId)

    // Save to current provider config
    const currentProvider = this.providerService.getDefaultProvider()
    this.providerService.setProvider(currentProvider.id, {
      ...currentProvider,
      defaultModel: modelId,
    })
    this.providerService.save()

    return {
      success: true,
      message: `✓ Switched to model: ${modelId}\n  Provider: ${currentProvider.name}\n  Saved as default.`
    }
  }

  /**
   * Get available models for a provider
   */
  getAvailableModels(providerId?: string): string[] {
    const id = providerId ?? this.providerService.getDefaultProvider()?.id
    if (!id) return []
    const info = getBuiltinProvider(id as BuiltinProvider)
    return info?.models ?? []
  }
}
```

## File Changes

| File | Change | Description |
|------|--------|-------------|
| `src/providers/types.ts` | Modify | Add `ProviderProtocol` type |
| `src/providers/registry.ts` | Modify | Add `PROTOCOL_MAP` and `getProviderProtocol` |
| `src/llm.ts` | Modify | Multi-protocol support, `switchProvider`, `switchModel` |
| `src/tools/provider-config.ts` | Modify | Enhance tools, add `switch_model`, `list_models` |
| `src/agent.ts` | Modify | Add `switchProvider`, `switchModel`, `getAvailableModels` |
| `package.json` | Modify | Add `@ai-sdk/openai`, `@ai-sdk/google` |

## Dependencies

```bash
npm install @ai-sdk/openai @ai-sdk/google
```

## Testing

1. Unit tests for protocol mapping
2. Integration tests for provider switching
3. Manual testing with each provider

## Security

- API keys remain in TokenService (keyring/encrypted file)
- providers.json only stores non-sensitive config
