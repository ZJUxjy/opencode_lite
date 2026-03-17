# Interactive Model/Provider Switching Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add interactive in-session model and provider switching with slash commands and visual dialogs.

**Architecture:** Create Ink-based dialog components for model/provider selection. Add state persistence service for recent models. Integrate slash command detection into the input handler.

**Tech Stack:** TypeScript, Ink (React for CLI), ink-select-input, Zod

---

## Task 1: Create State Persistence Service

**Files:**
- Create: `src/state/persistence.ts`
- Create: `src/state/index.ts`

**Step 1: Create state types**

Create `src/state/persistence.ts`:

```typescript
// src/state/persistence.ts

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"

/**
 * Recent model entry
 */
export interface RecentModel {
  provider: string
  model: string
  timestamp: number
}

/**
 * Application state
 */
export interface AppState {
  recentModels: RecentModel[]
  lastUsed?: {
    provider: string
    model: string
  }
}

const DEFAULT_STATE: AppState = {
  recentModels: [],
}

const MAX_RECENT_MODELS = 5

function getStatePath(): string {
  return join(homedir(), ".lite-opencode", "state.json")
}

/**
 * State persistence service
 */
export class StatePersistence {
  private filePath: string
  private state: AppState

  constructor(filePath?: string) {
    this.filePath = filePath ?? getStatePath()
    this.state = this.load()
  }

  private load(): AppState {
    if (!existsSync(this.filePath)) {
      const dir = dirname(this.filePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      return { ...DEFAULT_STATE }
    }

    try {
      const content = readFileSync(this.filePath, "utf-8")
      return JSON.parse(content)
    } catch {
      return { ...DEFAULT_STATE }
    }
  }

  private save(): void {
    const dir = dirname(this.filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf-8")
  }

  /**
   * Get recent models
   */
  getRecentModels(): RecentModel[] {
    return [...this.state.recentModels].sort((a, b) => b.timestamp - a.timestamp)
  }

  /**
   * Add a model to recent list
   */
  addRecentModel(provider: string, model: string): void {
    // Remove existing entry for same provider/model
    this.state.recentModels = this.state.recentModels.filter(
      (m) => !(m.provider === provider && m.model === model)
    )

    // Add new entry at beginning
    this.state.recentModels.unshift({
      provider,
      model,
      timestamp: Date.now(),
    })

    // Keep only last N models
    if (this.state.recentModels.length > MAX_RECENT_MODELS) {
      this.state.recentModels = this.state.recentModels.slice(0, MAX_RECENT_MODELS)
    }

    // Update last used
    this.state.lastUsed = { provider, model }

    this.save()
  }

  /**
   * Get last used model
   */
  getLastUsed(): { provider: string; model: string } | undefined {
    return this.state.lastUsed
  }

  /**
   * Get current state
   */
  getState(): AppState {
    return { ...this.state }
  }
}

// Global instance
let globalState: StatePersistence | null = null

export function getStatePersistence(): StatePersistence {
  if (!globalState) {
    globalState = new StatePersistence()
  }
  return globalState
}
```

**Step 2: Create index export**

Create `src/state/index.ts`:

```typescript
export { StatePersistence, getStatePersistence, type AppState, type RecentModel } from "./persistence.js"
```

**Step 3: Verify build**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/state/persistence.ts src/state/index.ts
git commit -m "feat(state): add state persistence service for recent models"
```

---

## Task 2: Add State Persistence Tests

**Files:**
- Create: `src/state/__tests__/persistence.test.ts`

**Step 1: Create test file**

```typescript
// src/state/__tests__/persistence.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdirSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { StatePersistence } from "../persistence.js"

describe("StatePersistence", () => {
  let tempDir: string
  let statePath: string
  let state: StatePersistence

  beforeEach(() => {
    tempDir = mkdirSync(join(tmpdir(), `state-test-${Date.now()}`), { recursive: true })
    statePath = join(tempDir, "state.json")
    state = new StatePersistence(statePath)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe("recentModels", () => {
    it("should start with empty recent models", () => {
      expect(state.getRecentModels()).toHaveLength(0)
    })

    it("should add a model to recent list", () => {
      state.addRecentModel("anthropic", "claude-sonnet-4-6")

      const recent = state.getRecentModels()
      expect(recent).toHaveLength(1)
      expect(recent[0].provider).toBe("anthropic")
      expect(recent[0].model).toBe("claude-sonnet-4-6")
    })

    it("should sort by timestamp descending", () => {
      state.addRecentModel("anthropic", "claude-sonnet-4-6")
      state.addRecentModel("openai", "gpt-4o")

      const recent = state.getRecentModels()
      expect(recent[0].provider).toBe("openai")
      expect(recent[1].provider).toBe("anthropic")
    })

    it("should limit to 5 recent models", () => {
      for (let i = 0; i < 10; i++) {
        state.addRecentModel("provider", `model-${i}`)
      }

      expect(state.getRecentModels()).toHaveLength(5)
    })

    it("should move duplicate to front", () => {
      state.addRecentModel("anthropic", "claude-sonnet-4-6")
      state.addRecentModel("openai", "gpt-4o")
      state.addRecentModel("anthropic", "claude-sonnet-4-6")

      const recent = state.getRecentModels()
      expect(recent).toHaveLength(2)
      expect(recent[0].provider).toBe("anthropic")
    })

    it("should persist across instances", () => {
      state.addRecentModel("anthropic", "claude-sonnet-4-6")

      const newState = new StatePersistence(statePath)
      expect(newState.getRecentModels()).toHaveLength(1)
    })
  })

  describe("lastUsed", () => {
    it("should track last used model", () => {
      state.addRecentModel("anthropic", "claude-sonnet-4-6")

      const lastUsed = state.getLastUsed()
      expect(lastUsed?.provider).toBe("anthropic")
      expect(lastUsed?.model).toBe("claude-sonnet-4-6")
    })
  })
})
```

**Step 2: Run tests**

Run: `npm run test src/state/__tests__/persistence.test.ts`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/state/__tests__/persistence.test.ts
git commit -m "test(state): add persistence service tests"
```

---

## Task 3: Create Model Selection Dialog Component

**Files:**
- Create: `src/components/dialog-model.tsx`
- Create: `src/components/index.ts`

**Step 1: Create dialog component**

Create `src/components/dialog-model.tsx`:

```typescript
// src/components/dialog-model.tsx

import React, { useState, useMemo } from "react"
import { Box, Text, useApp, useInput } from "ink"
import SelectInput from "ink-select-input"
import { BUILTIN_PROVIDERS, getBuiltinProvider } from "../providers/registry.js"
import { getStatePersistence, type RecentModel } from "../state/index.js"
import type { BuiltinProvider } from "../providers/types.js"

interface DialogModelProps {
  currentProvider: string
  currentModel: string
  onSelect: (provider: string, model: string) => void
  onCancel: () => void
}

interface ModelItem {
  label: string
  value: { provider: string; model: string }
  disabled?: boolean
  group?: string
}

export function DialogModel({ currentProvider, currentModel, onSelect, onCancel }: DialogModelProps) {
  const { exit } = useApp()
  const statePersistence = getStatePersistence()
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Build items list
  const items = useMemo(() => {
    const result: ModelItem[] = []
    const recentModels = statePersistence.getRecentModels()

    // Recent section
    if (recentModels.length > 0) {
      result.push({
        label: "── Recent ──",
        value: { provider: "", model: "" },
        disabled: true,
        group: "header",
      })

      for (const recent of recentModels) {
        const providerInfo = getBuiltinProvider(recent.provider as BuiltinProvider)
        result.push({
          label: `  ${recent.model} (${providerInfo?.name ?? recent.provider})`,
          value: { provider: recent.provider, model: recent.model },
          group: "recent",
        })
      }
    }

    // Provider sections
    for (const providerInfo of BUILTIN_PROVIDERS) {
      result.push({
        label: `── ${providerInfo.name} ──`,
        value: { provider: "", model: "" },
        disabled: true,
        group: "header",
      })

      for (const model of providerInfo.models) {
        const isCurrent = providerInfo.id === currentProvider && model === currentModel
        result.push({
          label: `  ${model}${isCurrent ? " ✓" : ""}`,
          value: { provider: providerInfo.id, model },
          group: providerInfo.id,
        })
      }
    }

    return result
  }, [currentProvider, currentModel, statePersistence])

  // Filter out disabled items for selection
  const selectableItems = items.filter((item) => !item.disabled)

  useInput((input, key) => {
    if (key.escape) {
      onCancel()
      exit()
    }
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : selectableItems.length - 1))
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => (prev < selectableItems.length - 1 ? prev + 1 : 0))
    }
    if (key.return) {
      const item = selectableItems[selectedIndex]
      if (item && item.value.provider) {
        // Add to recent
        statePersistence.addRecentModel(item.value.provider, item.value.model)
        onSelect(item.value.provider, item.value.model)
        exit()
      }
    }
  })

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          🤖 Select Model
        </Text>
      </Box>

      <Box flexDirection="column">
        {items.map((item, index) => {
          const isSelectable = !item.disabled
          const isSelected = isSelectable && selectableItems[selectedIndex]?.value === item.value

          if (item.disabled) {
            return (
              <Box key={`header-${index}`}>
                <Text dimColor>{item.label}</Text>
              </Box>
            )
          }

          return (
            <Box key={`${item.value.provider}-${item.value.model}`}>
              <Text color={isSelected ? "green" : undefined}>
                {isSelected ? "❯ " : "  "}
                {item.label}
              </Text>
            </Box>
          )
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>↑/↓ Navigate | Enter Select | Esc Cancel</Text>
      </Box>
    </Box>
  )
}
```

**Step 2: Create index export**

Create `src/components/index.ts`:

```typescript
export { DialogModel } from "./dialog-model.js"
export { DialogProvider } from "./dialog-provider.js"
```

**Step 3: Verify build**

Run: `npm run build`
Expected: May fail due to missing DialogProvider, that's OK

**Step 4: Commit**

```bash
git add src/components/dialog-model.tsx src/components/index.ts
git commit -m "feat(ui): add model selection dialog component"
```

---

## Task 4: Create Provider Selection Dialog Component

**Files:**
- Create: `src/components/dialog-provider.tsx`

**Step 1: Create provider dialog component**

Create `src/components/dialog-provider.tsx`:

```typescript
// src/components/dialog-provider.tsx

import React, { useState, useMemo, useCallback } from "react"
import { Box, Text, useApp, useInput } from "ink"
import TextInput from "ink-text-input"
import SelectInput from "ink-select-input"
import { BUILTIN_PROVIDERS, getBuiltinProvider } from "../providers/registry.js"
import { ProviderConfigService } from "../providers/service.js"
import { getTokenService } from "../tokens/index.js"
import type { BuiltinProvider } from "../providers/types.js"

interface DialogProviderProps {
  onSelect: (provider: string) => void
  onCancel: () => void
}

type Step = "select" | "configure"

interface ProviderItem {
  label: string
  value: string
  configured: boolean
  disabled?: boolean
}

export function DialogProvider({ onSelect, onCancel }: DialogProviderProps) {
  const { exit } = useApp()
  const providerService = new ProviderConfigService()
  const tokenService = getTokenService()

  const [step, setStep] = useState<Step>("select")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [selectedProvider, setSelectedProvider] = useState<string>("")

  // Configuration state
  const [apiKey, setApiKey] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [modelIndex, setModelIndex] = useState(0)
  const [configStep, setConfigStep] = useState<"apikey" | "baseurl" | "model">("apikey")
  const [error, setError] = useState<string>()

  // Build provider items
  const items = useMemo(() => {
    const configured: ProviderItem[] = []
    const available: ProviderItem[] = []

    for (const providerInfo of BUILTIN_PROVIDERS) {
      const config = providerService.getProvider(providerInfo.id)
      const item: ProviderItem = {
        label: `${providerInfo.name} [${providerInfo.id}]`,
        value: providerInfo.id,
        configured: !!config,
      }

      if (config) {
        configured.push(item)
      } else {
        available.push(item)
      }
    }

    return [...configured, ...available]
  }, [providerService])

  const handleProviderSelect = useCallback((providerId: string) => {
    const config = providerService.getProvider(providerId)

    if (config) {
      // Already configured, just switch
      providerService.setDefault(providerId)
      providerService.save()
      onSelect(providerId)
      exit()
    } else {
      // Need to configure
      const providerInfo = getBuiltinProvider(providerId as BuiltinProvider)
      setSelectedProvider(providerId)
      setBaseUrl(providerInfo?.baseUrl ?? "")
      setStep("configure")
    }
  }, [providerService, onSelect, exit])

  const handleConfigComplete = useCallback(async () => {
    if (!apiKey.trim()) {
      setError("API Key is required")
      return
    }

    const providerInfo = getBuiltinProvider(selectedProvider as BuiltinProvider)
    const selectedModel = providerInfo?.models[modelIndex] ?? ""

    // Save to provider config
    providerService.setProvider(selectedProvider, {
      name: providerInfo?.name ?? selectedProvider,
      provider: selectedProvider as BuiltinProvider,
      baseUrl,
      defaultModel: selectedModel,
    })
    providerService.setDefault(selectedProvider)
    providerService.save()

    // Save API key to token service
    await tokenService.setToken(selectedProvider as any, apiKey)

    onSelect(selectedProvider)
    exit()
  }, [apiKey, baseUrl, modelIndex, selectedProvider, providerService, tokenService, onSelect, exit])

  // Keyboard handling for select step
  useInput((input, key) => {
    if (step !== "select") return

    if (key.escape) {
      onCancel()
      exit()
    }
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1))
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0))
    }
    if (key.return) {
      handleProviderSelect(items[selectedIndex].value)
    }
  })

  // Render based on step
  if (step === "configure") {
    const providerInfo = getBuiltinProvider(selectedProvider as BuiltinProvider)

    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan">
        <Box marginBottom={1}>
          <Text bold color="cyan">
            🔑 Configure {providerInfo?.name}
          </Text>
        </Box>

        {configStep === "apikey" && (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text>API Key: </Text>
              <TextInput
                value={apiKey}
                onChange={setApiKey}
                onSubmit={() => setConfigStep("baseurl")}
                mask="*"
              />
            </Box>
            {error && <Text color="red">{error}</Text>}
            <Text dimColor>Press Enter to continue</Text>
          </Box>
        )}

        {configStep === "baseurl" && (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text>Base URL: </Text>
              <TextInput
                value={baseUrl}
                onChange={setBaseUrl}
                onSubmit={() => setConfigStep("model")}
              />
            </Box>
            <Text dimColor>Press Enter to continue (use default or enter custom)</Text>
          </Box>
        )}

        {configStep === "model" && (
          <Box flexDirection="column">
            <Text>Select Default Model:</Text>
            {providerInfo?.models.map((model, index) => (
              <Box key={model}>
                <Text color={index === modelIndex ? "green" : undefined}>
                  {index === modelIndex ? "❯ " : "  "}
                  {model}
                </Text>
              </Box>
            )) || <Text dimColor>No models available</Text>}

            <Box marginTop={1}>
              <Text dimColor>↑/↓ Select | Enter Save</Text>
            </Box>
          </Box>
        )}

        {configStep === "model" && (
          <Box marginTop={1}>
            <Text dimColor>Esc to cancel</Text>
          </Box>
        )}

        {configStep === "model" && (
          useInput((input, key) => {
            if (key.escape) {
              setStep("select")
              setConfigStep("apikey")
              setError(undefined)
            }
            if (key.upArrow && providerInfo) {
              setModelIndex((prev) => (prev > 0 ? prev - 1 : providerInfo.models.length - 1))
            }
            if (key.downArrow && providerInfo) {
              setModelIndex((prev) => (prev < providerInfo.models.length - 1 ? prev + 1 : 0))
            }
            if (key.return) {
              handleConfigComplete()
            }
          })
        )}
      </Box>
    )
  }

  // Select step
  return (
    <Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          🔌 Select Provider
        </Text>
      </Box>

      <Box flexDirection="column">
        {items.map((item, index) => (
          <Box key={item.value}>
            <Text color={index === selectedIndex ? "green" : undefined}>
              {index === selectedIndex ? "❯ " : "  "}
              {item.configured ? "✓ " : "○ "}
              {item.label}
            </Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>↑/↓ Navigate | Enter Select | Esc Cancel</Text>
      </Box>
    </Box>
  )
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/dialog-provider.tsx src/components/index.ts
git commit -m "feat(ui): add provider selection/configuration dialog component"
```

---

## Task 5: Add Slash Command Handler

**Files:**
- Create: `src/input/slash-commands.ts`

**Step 1: Create slash command handler**

Create `src/input/slash-commands.ts`:

```typescript
// src/input/slash-commands.ts

/**
 * Available slash commands
 */
export const SLASH_COMMANDS = {
  models: {
    description: "Open model selection dialog",
    usage: "/models",
  },
  provider: {
    description: "Open provider selection dialog",
    usage: "/provider",
  },
} as const

export type SlashCommand = keyof typeof SLASH_COMMANDS

/**
 * Parse input for slash commands
 * @returns Command name if input is a slash command, null otherwise
 */
export function parseSlashCommand(input: string): SlashCommand | null {
  const trimmed = input.trim()

  if (trimmed === "/models") {
    return "models"
  }
  if (trimmed === "/provider") {
    return "provider"
  }

  return null
}

/**
 * Check if input looks like a slash command (for autocomplete hints)
 */
export function isPartialSlashCommand(input: string): boolean {
  const trimmed = input.trim()
  return trimmed.startsWith("/") && !trimmed.includes(" ")
}

/**
 * Get matching commands for autocomplete
 */
export function getMatchingCommands(partial: string): SlashCommand[] {
  const trimmed = partial.trim().toLowerCase()

  if (!trimmed.startsWith("/")) {
    return []
  }

  const commands = Object.keys(SLASH_COMMANDS) as SlashCommand[]
  return commands.filter((cmd) => `/${cmd}`.startsWith(trimmed))
}
```

**Step 2: Create index export**

Create `src/input/index.ts`:

```typescript
export * from "./slash-commands.js"
```

**Step 3: Verify build**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/input/slash-commands.ts src/input/index.ts
git commit -m "feat(input): add slash command parser"
```

---

## Task 6: Integrate Dialogs into App

**Files:**
- Modify: `src/App.tsx`

**Step 1: Add dialog state and imports**

At the top of `src/App.tsx`, add imports:

```typescript
import { DialogModel, DialogProvider } from "./components/index.js"
import { parseSlashCommand, type SlashCommand } from "./input/slash-commands.js"
import { getStatePersistence } from "./state/index.js"
```

Add state after other useState hooks:

```typescript
// Dialog state
const [activeDialog, setActiveDialog] = useState<SlashCommand | null>(null)
const [currentProvider, setCurrentProvider] = useState<string>("anthropic")
const [currentModel, setCurrentModel] = useState<string>("claude-sonnet-4-6")
```

**Step 2: Add dialog handlers**

Add handler functions before the return statement:

```typescript
// Handle slash command detection
const handleSlashCommand = useCallback((command: SlashCommand) => {
  setActiveDialog(command)
}, [])

// Handle model selection
const handleModelSelect = useCallback((provider: string, model: string) => {
  setCurrentProvider(provider)
  setCurrentModel(model)
  setActiveDialog(null)
  // TODO: Also update agent's LLM client
}, [])

// Handle provider selection
const handleProviderSelect = useCallback((provider: string) => {
  setCurrentProvider(provider)
  // Get default model for this provider
  const providerInfo = getBuiltinProvider(provider as BuiltinProvider)
  if (providerInfo) {
    setCurrentModel(providerInfo.defaultModel)
  }
  setActiveDialog(null)
  // TODO: Also update agent's LLM client
}, [])

// Handle dialog cancel
const handleDialogCancel = useCallback(() => {
  setActiveDialog(null)
}, [])
```

**Step 3: Render dialogs**

Add dialog rendering before the main return, or modify the return to include dialogs:

```typescript
// In the render section, add before the main content:
{activeDialog === "models" && (
  <DialogModel
    currentProvider={currentProvider}
    currentModel={currentModel}
    onSelect={handleModelSelect}
    onCancel={handleDialogCancel}
  />
)}

{activeDialog === "provider" && (
  <DialogProvider
    onSelect={handleProviderSelect}
    onCancel={handleDialogCancel}
  />
)}
```

**Step 4: Update status bar**

Modify the status bar section to show current provider/model:

```typescript
// In the status bar component:
<Text>
  Context: {contextPercent}% │ 🤖 {currentProvider}/{currentModel} │ ...
</Text>
```

**Step 5: Verify build**

Run: `npm run build`
Expected: No errors

**Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(ui): integrate model/provider dialogs into app"
```

---

## Task 7: Wire Slash Commands to Input

**Files:**
- Modify: `src/App.tsx`

**Step 1: Add command detection to input handler**

Find the input handling logic and add slash command detection:

```typescript
// In the input submit handler:
const handleSubmit = (input: string) => {
  // Check for slash commands first
  const command = parseSlashCommand(input)
  if (command) {
    handleSlashCommand(command)
    return
  }

  // Normal message processing...
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(ui): wire slash commands to input handler"
```

---

## Task 8: Update Documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add slash commands to documentation**

Add to the in-session tools section:

```markdown
**Slash commands:**

```
/models              # Open model selection dialog
/provider            # Open provider selection/configuration dialog
```

**Keyboard navigation:**
- `↑/↓` - Navigate options
- `Enter` - Select
- `Esc` - Cancel
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add interactive switching documentation"
```

---

## Task 9: Run Full Test Suite

**Step 1: Run all tests**

Run: `npm run test`
Expected: All tests PASS

**Step 2: Build verification**

Run: `npm run build`
Expected: No errors

**Step 3: Final commit if needed**

```bash
git add -A
git commit -m "fix: resolve any remaining issues"
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Create state persistence service |
| 2 | Add persistence tests |
| 3 | Create model selection dialog |
| 4 | Create provider selection dialog |
| 5 | Add slash command parser |
| 6 | Integrate dialogs into App |
| 7 | Wire slash commands to input |
| 8 | Update documentation |
| 9 | Run full test suite |
