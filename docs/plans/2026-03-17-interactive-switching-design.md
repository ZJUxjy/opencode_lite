# Interactive Model/Provider Switching Design

## Overview

Add interactive in-session model and provider switching using slash commands and visual dialogs, similar to OpenCode's approach.

## Requirements Summary

| Requirement | Decision |
|-------------|----------|
| Access method | Slash commands (`/models`, `/provider`) |
| Selection UI | Ink visual components with keyboard navigation |
| Recent/favorite | Recent models only (auto-record, max 5) |
| Provider connection | In-session API key input |
| Display | Status bar shows current provider/model |

## Slash Commands

```
/models              # Open model selection dialog
/provider            # Open provider selection/configuration dialog
```

## Model Selection Dialog

**`/models` command UI:**

```
┌─────────────────────────────────────────────────────┐
│  🤖 Select Model                                    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Recent                                             │
│    ❯ claude-sonnet-4-6 (Anthropic)                  │
│      gpt-4o (OpenAI)                                │
│                                                     │
│  Anthropic                                          │
│      claude-opus-4-6                                │
│      claude-sonnet-4-6                              │
│      claude-haiku-4-5                               │
│                                                     │
│  OpenAI                                             │
│      gpt-4o                                         │
│      gpt-4o-mini                                    │
│      o1                                             │
│                                                     │
├─────────────────────────────────────────────────────┤
│  ↑/↓ Navigate  Enter Select  Esc Cancel             │
└─────────────────────────────────────────────────────┘
```

**Features:**
- Recent section shows last 5 used models
- Models grouped by provider
- Keyboard navigation (↑/↓, Enter, Esc)
- Auto-save on selection

## Provider Dialog

**`/provider` command UI (selection):**

```
┌─────────────────────────────────────────────────────┐
│  🔌 Select Provider                                 │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Configured                                         │
│    ❯ ✓ Anthropic (Claude) [anthropic]              │
│        ✓ OpenAI (GPT) [openai]                      │
│                                                     │
│  Available                                          │
│      ○ Google (Gemini) [google]                     │
│      ○ DeepSeek [anthropic]                         │
│      ○ MiniMax [anthropic]                          │
│      ○ Kimi [Moonshot] [anthropic]                  │
│                                                     │
├─────────────────────────────────────────────────────┤
│  ↑/↓ Navigate  Enter Select  Esc Cancel             │
└─────────────────────────────────────────────────────┘
```

**Provider configuration (for unconfigured providers):**

```
┌─────────────────────────────────────────────────────┐
│  🔑 Configure Google (Gemini)                       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  API Key: **************                            │
│                                                     │
│  Base URL [https://generativelanguage.googleapis...│
│                                                     │
│  Default Model:                                     │
│    ❯ gemini-2.0-flash                               │
│      gemini-1.5-pro                                 │
│      gemini-1.5-flash                               │
│                                                     │
├─────────────────────────────────────────────────────┤
│  Tab Next  Enter Save  Esc Cancel                   │
└─────────────────────────────────────────────────────┘
```

## State Persistence

**Storage location:** `~/.lite-opencode/state.json`

```json
{
  "recentModels": [
    { "provider": "anthropic", "model": "claude-sonnet-4-6", "timestamp": 1710662400000 },
    { "provider": "openai", "model": "gpt-4o", "timestamp": 1710662000000 }
  ],
  "lastUsed": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-6"
  }
}
```

**Recent model rules:**
- Max 5 recent models
- Sorted by timestamp descending
- Auto-updated on model switch
- Duplicates replaced with newer entry

## Status Bar Display

**Enhanced bottom status bar:**

```
┌─────────────────────────────────────────────────────┐
│  [Message Area]                                     │
│  ...                                                │
├─────────────────────────────────────────────────────┤
│  Context: 45%  │  🤖 openai/gpt-4o  │  MCP 2/2      │
└─────────────────────────────────────────────────────┘
```

**Display format:** `{provider}/{model}`

**Color rules:**
- Normal: default color
- Switching: yellow
- Error: red

## File Structure

```
src/
├── components/
│   ├── index.ts                    # Component exports
│   ├── dialog-model.tsx            # Model selection dialog
│   └── dialog-provider.tsx         # Provider selection/config dialog
├── state/
│   └── persistence.ts              # State persistence service
├── app.tsx                         # Integrate dialogs, update status bar
└── input-handler.ts                # Slash command handling
```

## File Changes

| File | Change | Description |
|------|--------|-------------|
| `src/components/dialog-model.tsx` | Create | Model selection dialog component |
| `src/components/dialog-provider.tsx` | Create | Provider selection/config dialog |
| `src/components/index.ts` | Create | Component exports |
| `src/state/persistence.ts` | Create | State persistence service |
| `src/app.tsx` | Modify | Integrate dialogs, update status bar |
| `src/input-handler.ts` | Create | Slash command parsing |
| `CLAUDE.md` | Modify | Documentation update |

## Interaction Flow

### Switching Models

1. User types `/models`
2. System pauses current input
3. Dialog shows with recent + grouped models
4. User navigates and selects
5. System switches model, updates state
6. Dialog closes, input resumes
7. Status bar updates

### Configuring New Provider

1. User types `/provider`
2. Dialog shows configured + available providers
3. User selects unconfigured provider
4. Dialog transitions to config mode
5. User enters API key, selects model
6. System saves to TokenService + ProviderConfigService
7. Dialog closes
8. Provider is now available

## Technical Details

### State Management

```typescript
// src/state/persistence.ts

interface AppState {
  recentModels: Array<{
    provider: string
    model: string
    timestamp: number
  }>
  lastUsed: {
    provider: string
    model: string
  }
}

class StatePersistence {
  private filePath: string

  load(): AppState
  save(state: AppState): void
  addRecentModel(provider: string, model: string): void
  getRecentModels(): Array<{ provider: string, model: string }>
}
```

### Dialog Component Pattern

```typescript
// Using Ink components
import { Box, Text, useInput } from 'ink'
import SelectInput from 'ink-select-input'

function DialogModel({ onSelect, onCancel }) {
  const items = [
    // Recent models
    { label: 'Recent', value: null, disabled: true },
    ...recentModels,
    // Provider groups
    ...providerModels,
  ]

  useInput((input, key) => {
    if (key.escape) onCancel()
  })

  return (
    <Box flexDirection="column">
      <Text bold>🤖 Select Model</Text>
      <SelectInput items={items} onSelect={onSelect} />
    </Box>
  )
}
```

### Slash Command Detection

```typescript
// In input handler
function handleSlashCommand(input: string): boolean {
  if (input === '/models') {
    openModelDialog()
    return true
  }
  if (input === '/provider') {
    openProviderDialog()
    return true
  }
  return false
}
```
