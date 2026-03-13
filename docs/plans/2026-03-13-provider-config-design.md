# Provider Configuration System Design

## Overview

Add a quick LLM provider configuration feature that allows users to easily configure and switch between multiple LLM providers (Anthropic, OpenAI, Gemini, DeepSeek, MiniMax, Kimi) through both CLI commands and in-session commands.

## Requirements Summary

| Requirement | Decision |
|-------------|----------|
| Scope | Complete config management (setup + switch + manage) |
| Access | Both CLI and in-session `/config` commands |
| Interactive Mode | Visual selection using Ink components |
| Config Options | API Key + Base URL + Default Model |
| Default Provider | Ask during configuration |
| In-session Commands | View, Switch, Add (no delete) |
| Storage Format | Independent `providers.json` file |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                 CLI / In-session Commands               │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│              ProviderConfigService (新增)               │
│  - 管理 Provider 配置（非敏感信息）                      │
│  - 存储: ~/.lite-opencode/providers.json                │
└─────────────────────────────────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          ▼                              ▼
┌─────────────────────┐      ┌─────────────────────┐
│   TokenService      │      │   settings.json     │
│   (API Keys)        │      │   (其他配置)         │
└─────────────────────┘      └─────────────────────┘
```

## File Structure

```
src/
├── providers/
│   ├── index.ts              # Export ProviderConfigService
│   ├── types.ts              # Type definitions
│   ├── registry.ts           # Built-in provider definitions
│   ├── service.ts            # ProviderConfigService implementation
│   └── __tests__/
│       └── service.test.ts   # Unit tests
├── cli/
│   └── config-wizard.tsx     # Ink interactive config component
└── index.tsx                 # Add new CLI commands
```

## Data Types

### types.ts

```typescript
// Built-in supported providers
export type BuiltinProvider =
  | "anthropic"
  | "openai"
  | "gemini"
  | "deepseek"
  | "minimax"
  | "kimi"

// Provider configuration
export interface ProviderConfig {
  name: string                    // Display name
  provider: BuiltinProvider | "custom"
  baseUrl: string                 // API endpoint
  defaultModel: string            // Default model
  apiKeyEnvKey?: string           // Environment variable name (optional)
  isDefault?: boolean             // Is default provider
  createdAt: string               // Creation timestamp
}

// Configuration file structure
export interface ProvidersFile {
  version: 1
  defaultProvider: string         // Current default provider ID
  providers: Record<string, ProviderConfig>
}
```

### Storage Location

`~/.lite-opencode/providers.json`

## Built-in Providers

| Provider | Default Base URL | Default Model | Env Key |
|----------|-----------------|---------------|---------|
| Anthropic | https://api.anthropic.com | claude-sonnet-4-6 | ANTHROPIC_API_KEY |
| OpenAI | https://api.openai.com/v1 | gpt-4o | OPENAI_API_KEY |
| Gemini | https://generativelanguage.googleapis.com/v1beta | gemini-2.0-flash | GEMINI_API_KEY |
| DeepSeek | https://api.deepseek.com | deepseek-chat | DEEPSEEK_API_KEY |
| MiniMax | https://api.minimax.chat/v1 | MiniMax-Text-01 | MINIMAX_API_KEY |
| Kimi | https://api.moonshot.cn/v1 | moonshot-v1-128k | KIMI_API_KEY |

## CLI Commands

```bash
# Interactive configuration wizard (visual selection)
lite-opencode config

# List all configured providers
lite-opencode config list

# Quick switch default provider
lite-opencode config switch <provider-id>

# Show current config details
lite-opencode config show [provider-id]
```

### Interactive Config Flow

**Step 1: Select Provider**
```
┌─────────────────────────────────────────────────────┐
│  🎛️ Configure LLM Provider                          │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Select a provider to configure:                    │
│                                                     │
│    ❯ Anthropic (Claude)                             │
│      OpenAI (GPT)                                   │
│      Google (Gemini)                                │
│      DeepSeek                                       │
│      MiniMax                                        │
│      Kimi (Moonshot)                                │
│      ───────────────                                │
│      Custom Provider                                │
│                                                     │
├─────────────────────────────────────────────────────┤
│  ↑/↓ Select  Enter Confirm  Esc Cancel              │
└─────────────────────────────────────────────────────┘
```

**Step 2: Enter Configuration**
```
┌─────────────────────────────────────────────────────┐
│  🔑 Configure Anthropic                             │
├─────────────────────────────────────────────────────┤
│                                                     │
│  API Key: sk-ant-**************                     │
│                                                     │
│  Base URL [https://api.anthropic.com]: _            │
│                                                     │
│  Default Model [claude-sonnet-4-6]:                 │
│    ❯ claude-opus-4-6                                │
│      claude-sonnet-4-6                              │
│      claude-haiku-4-5                               │
│                                                     │
│  Set as default provider? [Y/n]: Y                  │
│                                                     │
├─────────────────────────────────────────────────────┤
│  Tab Next  Enter Confirm                            │
└─────────────────────────────────────────────────────┘
```

## In-session Commands

```
/config              # Show current config status
/config add          # Enter add provider wizard
/switch <provider>   # Switch current session's provider
```

### `/config` Output Example

```
┌─────────────────────────────────────────────────────┐
│  ⚙️ Current Configuration                           │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Provider: anthropic (default)                      │
│  Model: claude-sonnet-4-6                           │
│  Base URL: https://api.anthropic.com                │
│                                                     │
│  Available providers:                               │
│    ✓ anthropic  (configured, default)               │
│    ✓ openai     (configured)                        │
│    ○ gemini     (not configured)                    │
│                                                     │
├─────────────────────────────────────────────────────┤
│  /config add    Add new provider                    │
│  /switch <name> Switch provider                     │
└─────────────────────────────────────────────────────┘
```

### `/switch` Output Example

```
✓ Switched to OpenAI (GPT)
  Model: gpt-4o
  Base URL: https://api.openai.com/v1
```

## ProviderConfigService API

```typescript
export class ProviderConfigService {
  private filePath: string
  private data: ProvidersFile

  constructor(filePath?: string)

  // Get all provider configurations
  listProviders(): ProviderConfig[]

  // Get single provider configuration
  getProvider(id: string): ProviderConfig | undefined

  // Get default provider
  getDefaultProvider(): ProviderConfig

  // Add or update provider
  setProvider(id: string, config: Omit<ProviderConfig, 'createdAt'>): void

  // Set default provider
  setDefault(id: string): void

  // Check if provider is configured (has API key)
  isConfigured(id: string): Promise<boolean>

  // Get LLM runtime config (merge Token + Provider config)
  getLLMConfig(id?: string): Promise<{
    model: string
    baseURL: string
    apiKey: string
  }>

  // Save to file
  save(): void
}
```

## Integration with Existing System

### Loading Priority (modify `index.tsx`)

```
1. CLI arguments
2. ProviderConfigService (providers.json + TokenService)
3. settings.json (env config)
4. Environment variables
5. Default values
```

### Startup Flow Change

```typescript
// Original flow
const settings = loadSettings()
applySettingsEnvToProcess(settings)
await loadTokensFromService()

// New flow
const settings = loadSettings()
const providerService = new ProviderConfigService()

// 1. Get config from ProviderConfigService first
const defaultProvider = providerService.getDefaultProvider()
const llmConfig = await providerService.getLLMConfig()

// 2. Apply to process.env (for downstream use)
if (llmConfig.apiKey) {
  process.env[defaultProvider.envKey] = llmConfig.apiKey
}

// 3. settings.json as fallback
applySettingsEnvToProcess(settings)
```

### In-session Switch (add `/switch` command)

```typescript
// Add hot-switch support in agent.ts
async switchProvider(providerId: string): Promise<void> {
  const service = new ProviderConfigService()
  const config = await service.getLLMConfig(providerId)

  // Update current LLM client config
  this.llmConfig = config
}
```

## Implementation Tasks

| Task | File | Description |
|------|------|-------------|
| T1 | `src/providers/types.ts` | Define types |
| T2 | `src/providers/registry.ts` | Built-in provider definitions |
| T3 | `src/providers/service.ts` | ProviderConfigService implementation |
| T4 | `src/cli/config-wizard.tsx` | Ink interactive config component |
| T5 | `src/index.tsx` | Add CLI commands (`config`, `config list`, `config switch`) |
| T6 | `src/tools/config.ts` | In-session tools (`/config`, `/switch`) |
| T7 | `src/agent.ts` | Integrate ProviderConfigService, support hot-switch |
| T8 | `src/providers/__tests__/service.test.ts` | Unit tests |
| T9 | Documentation | Update CLAUDE.md |

### Dependencies

```
T1 → T2 → T3 → T4 → T5
          ↓
          T6 → T7
          ↓
          T8
```

## Security Considerations

- API Keys are stored in TokenService (keyring or encrypted file), NOT in providers.json
- providers.json only contains non-sensitive configuration (base URL, model names)
- In-session commands do not support delete to prevent accidental data loss
