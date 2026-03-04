# Skills Hot Reload Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 Skills 目录监听和热重载，修改 SKILL.md 文件后自动重新加载，无需重启应用。

**Architecture:** 使用 Node.js fs.watch API 监听 skills 目录变更，通过 SkillRegistry 重新加载变更的技能。

**Tech Stack:** TypeScript, Node.js fs.watch, EventEmitter

---

## Overview

当前技能系统需要重启应用才能加载新技能或更新现有技能。本计划添加：
1. 文件系统监听，监控 skills 目录变更
2. 防抖机制，避免频繁重载
3. 增量更新，只重载变更的技能
4. UI 通知，告知用户技能已更新

---

## Task 1: Create File Watcher Module

**Files:**
- Create: `src/skills/watcher.ts`

**Step 1: Implement file watcher**

```typescript
// src/skills/watcher.ts
import { watch, type FSWatcher } from "fs"
import { join } from "path"
import { EventEmitter } from "events"

export interface SkillWatcherEvents {
  "skill-changed": (skillId: string, path: string) => void
  "skill-added": (path: string) => void
  "skill-removed": (skillId: string) => void
  "error": (error: Error) => void
}

export interface SkillWatcherOptions {
  paths: string[]           // Directories to watch
  debounceMs: number        // Debounce time in ms
  recursive: boolean        // Watch subdirectories
}

const DEFAULT_OPTIONS: SkillWatcherOptions = {
  paths: [],
  debounceMs: 300,
  recursive: true,
}

/**
 * Watches skills directories for changes
 */
export class SkillWatcher extends EventEmitter {
  private watchers: Map<string, FSWatcher> = new Map()
  private options: SkillWatcherOptions
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map()
  private isWatching: boolean = false

  constructor(options: Partial<SkillWatcherOptions> = {}) {
    super()
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * Start watching directories
   */
  start(): void {
    if (this.isWatching) return

    for (const path of this.options.paths) {
      this.watchDirectory(path)
    }

    this.isWatching = true
  }

  /**
   * Stop all watchers
   */
  stop(): void {
    for (const [path, watcher] of this.watchers) {
      watcher.close()
    }
    this.watchers.clear()
    this.debounceTimers.clear()
    this.isWatching = false
  }

  /**
   * Add a directory to watch
   */
  addPath(path: string): void {
    if (this.isWatching && !this.watchers.has(path)) {
      this.watchDirectory(path)
    }
    if (!this.options.paths.includes(path)) {
      this.options.paths.push(path)
    }
  }

  /**
   * Remove a directory from watching
   */
  removePath(path: string): void {
    const watcher = this.watchers.get(path)
    if (watcher) {
      watcher.close()
      this.watchers.delete(path)
    }
    this.options.paths = this.options.paths.filter((p) => p !== path)
  }

  private watchDirectory(path: string): void {
    try {
      const watcher = watch(
        path,
        { recursive: this.options.recursive },
        (eventType, filename) => {
          if (!filename) return

          // Only care about SKILL.md files
          if (!filename.includes("SKILL") && !filename.includes("skill")) return

          const fullPath = join(path, filename)

          // Debounce to avoid multiple rapid reloads
          this.debounce(fullPath, () => {
            this.handleFileChange(eventType, fullPath, filename)
          })
        }
      )

      watcher.on("error", (error) => {
        this.emit("error", error)
      })

      this.watchers.set(path, watcher)
    } catch (error) {
      this.emit("error", error instanceof Error ? error : new Error(String(error)))
    }
  }

  private debounce(key: string, fn: () => void): void {
    // Clear existing timer
    const existing = this.debounceTimers.get(key)
    if (existing) {
      clearTimeout(existing)
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(key)
      fn()
    }, this.options.debounceMs)

    this.debounceTimers.set(key, timer)
  }

  private handleFileChange(
    eventType: "rename" | "change",
    fullPath: string,
    filename: string
  ): void {
    // Extract skill ID from path
    // Assuming path structure: /path/to/skills/skill-id/SKILL.md
    const skillId = this.extractSkillId(fullPath)

    if (eventType === "change") {
      this.emit("skill-changed", skillId, fullPath)
    } else if (eventType === "rename") {
      // File was added or removed
      // Need to check if file exists to know which
      this.emit("skill-added", fullPath)
    }
  }

  private extractSkillId(filePath: string): string {
    // Extract skill ID from path
    // /path/to/skills/skill-name/SKILL.md -> skill-name
    const parts = filePath.split("/")
    const skillsIndex = parts.findIndex((p) =>
      p === "skills" || p.endsWith("skills")
    )

    if (skillsIndex >= 0 && parts[skillsIndex + 1]) {
      return parts[skillsIndex + 1]
    }

    return "unknown"
  }
}

// Type declarations for EventEmitter
export declare interface SkillWatcher {
  on<K extends keyof SkillWatcherEvents>(
    event: K,
    listener: SkillWatcherEvents[K]
  ): this
  emit<K extends keyof SkillWatcherEvents>(
    event: K,
    ...args: Parameters<SkillWatcherEvents[K]>
  ): boolean
}
```

**Step 2: Run TypeScript check**

Run: `npx tsc --noEmit src/skills/watcher.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add src/skills/watcher.ts
git commit -m "feat(skills): add file watcher for hot reload"
```

---

## Task 2: Integrate Watcher with SkillRegistry

**Files:**
- Modify: `src/skills/registry.ts:20-50`
- Modify: `src/skills/registry.ts:360-386`

**Step 1: Add watcher integration to SkillRegistry**

```typescript
// src/skills/registry.ts
import { SkillWatcher } from "./watcher.js"

export interface SkillRegistryEvents {
  onSkillLoaded?: (skill: Skill) => void
  onSkillActivated?: (skill: Skill) => void
  onSkillDeactivated?: (skillId: string) => void
  onSkillReloaded?: (skill: Skill) => void  // NEW
  onSkillError?: (skillId: string, error: Error) => void
}

export class SkillRegistry {
  private skills = new Map<string, Skill>()
  private loader = new SkillLoader()
  private events: SkillRegistryEvents
  private discoveryConfig: SkillDiscoveryConfig
  private watcher?: SkillWatcher  // NEW

  // ... existing constructor ...

  /**
   * Enable hot reload watching
   */
  enableHotReload(): void {
    if (this.watcher) return

    this.watcher = new SkillWatcher({
      paths: this.discoveryConfig.searchPaths,
      debounceMs: 300,
      recursive: true,
    })

    // Handle skill changes
    this.watcher.on("skill-changed", async (skillId, path) => {
      console.log(`[Skills] Detected change in ${skillId}, reloading...`)
      await this.handleSkillChange(skillId, path)
    })

    this.watcher.on("skill-added", async (path) => {
      console.log(`[Skills] New skill detected at ${path}, loading...`)
      await this.handleSkillAdded(path)
    })

    this.watcher.on("error", (error) => {
      console.error("[Skills] Watcher error:", error)
    })

    this.watcher.start()
  }

  /**
   * Disable hot reload watching
   */
  disableHotReload(): void {
    this.watcher?.stop()
    this.watcher = undefined
  }

  /**
   * Handle skill file change
   */
  private async handleSkillChange(skillId: string, path: string): Promise<void> {
    // Check if it's an existing skill
    const existingSkill = this.skills.get(skillId)

    if (existingSkill) {
      try {
        const result = await this.reload(skillId)
        if (result.success) {
          this.events.onSkillReloaded?.(result.skill!)
        } else {
          this.events.onSkillError?.(skillId, new Error(result.error))
        }
      } catch (error) {
        this.events.onSkillError?.(
          skillId,
          error instanceof Error ? error : new Error(String(error))
        )
      }
    }
  }

  /**
   * Handle new skill detected
   */
  private async handleSkillAdded(path: string): Promise<void> {
    try {
      const skill = await this.loader.loadFromDirectory(path)
      if (skill) {
        this.register(skill)
      }
    } catch (error) {
      console.error(`[Skills] Failed to load new skill from ${path}:`, error)
    }
  }
}
```

**Step 2: Commit**

```bash
git add src/skills/registry.ts
git commit -m "feat(skills): integrate watcher with registry for hot reload"
```

---

## Task 3: Add UI Notification for Skill Reloads

**Files:**
- Modify: `src/App.tsx:225-245` (skills loading section)

**Step 1: Update App to show reload notifications**

```typescript
// src/App.tsx
// In the skills loading useEffect
const loadSkills = async () => {
  try {
    await agent.loadSkills()
    const skillCount = agent.getSkills().length
    if (skillCount > 0) {
      setMessages((prev) => [
        ...prev,
        createSystemMessage(`🎯 Loaded ${skillCount} skills. Use /skills to view and activate.`)
      ])
    }

    // Enable hot reload
    agent.enableSkillHotReload((skill, action) => {
      // Show notification when skill is reloaded
      if (action === "reloaded") {
        setMessages((prev) => [
          ...prev,
          createSystemMessage(`🔄 Skill reloaded: ${skill.metadata.name}`)
        ])
      } else if (action === "loaded") {
        setMessages((prev) => [
          ...prev,
          createSystemMessage(`✨ New skill detected: ${skill.metadata.name}`)
        ])
      }
    })
  } catch (error) {
    // Silent fail - skills are optional
  }
}
```

**Step 2: Add method to Agent**

```typescript
// src/agent.ts
export class Agent {
  // ... existing code ...

  enableSkillHotReload(
    callback?: (skill: Skill, action: "reloaded" | "loaded") => void
  ): void {
    const registry = getSkillRegistry()

    // Set up event handlers
    const originalOnReloaded = registry["events"].onSkillReloaded
    const originalOnLoaded = registry["events"].onSkillLoaded

    registry["events"].onSkillReloaded = (skill) => {
      originalOnReloaded?.(skill)
      callback?.(skill, "reloaded")
    }

    registry["events"].onSkillLoaded = (skill) => {
      originalOnLoaded?.(skill)
      callback?.(skill, "loaded")
    }

    registry.enableHotReload()
  }
}
```

**Step 3: Commit**

```bash
git add src/App.tsx src/agent.ts
git commit -m "feat(ui): show notifications for skill hot reload"
```

---

## Task 4: Add reload_skill Tool

**Files:**
- Create: `src/tools/skill-reload.ts` (or modify existing skill.ts)

**Step 1: Add reload skill tool**

```typescript
// In src/tools/skill.ts, add:

/**
 * Reload a skill from disk
 */
export const reloadSkillTool: Tool = {
  name: "reload_skill",
  description: `Reload a skill from disk, picking up any changes made to its SKILL.md file.

Useful when you've edited a skill file and want to apply changes without restarting.

Example: reload_skill id="builtin:git"`,

  parameters: z.object({
    id: z.string().describe("The skill ID to reload"),
  }),

  execute: async (params) => {
    const registry = getSkillRegistry()
    const result = await registry.reload(params.id)

    if (!result.success) {
      return `Failed to reload skill: ${result.error}`
    }

    const lines: string[] = []
    lines.push(`✅ Reloaded skill: ${result.skill!.metadata.name}`)
    lines.push(``)
    lines.push(`Version: ${result.skill!.metadata.version}`)
    lines.push(`Status: ${result.skill!.isActive ? "Active" : "Inactive"}`)

    if (result.promptInjection) {
      lines.push(``)
      lines.push(`The skill's prompt injection has been updated.`)
    }

    return lines.join("\n")
  },
}
```

**Step 2: Register the tool**

```typescript
// src/tools/index.ts
// Add reloadSkillTool to allTools array
const allTools = [
  // ... existing tools ...
  reloadSkillTool,
]
```

**Step 3: Commit**

```bash
git add src/tools/skill.ts src/tools/index.ts
git commit -m "feat(skills): add reload_skill tool for manual reload"
```

---

## Task 5: Add Toggle Hot Reload Command

**Files:**
- Modify: `src/commands/handlers.ts` (or similar command handler file)

**Step 1: Add /skills watch command**

```typescript
// Add to command handlers
export const skillWatchCommand: CommandHandler = {
  name: "watch",
  description: "Toggle skill hot reload watching",
  execute: async (_args, context) => {
    const registry = getSkillRegistry()

    if (context.isWatching) {
      registry.disableHotReload()
      return "⏸️  Skill hot reload disabled"
    } else {
      registry.enableHotReload()
      return "▶️  Skill hot reload enabled - changes to SKILL.md files will auto-reload"
    }
  },
}
```

**Step 2: Commit**

```bash
git add src/commands/handlers.ts
git commit -m "feat(commands): add /skills watch command to toggle hot reload"
```

---

## Task 6: Add Tests

**Files:**
- Create: `src/skills/__tests__/watcher.test.ts`

**Step 1: Write watcher tests**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { SkillWatcher } from "../watcher.js"
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

describe("SkillWatcher", () => {
  let testDir: string
  let watcher: SkillWatcher

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "skill-watcher-test-"))
    mkdirSync(join(testDir, "skills", "test-skill"), { recursive: true })
    writeFileSync(
      join(testDir, "skills", "test-skill", "SKILL.md"),
      "# Test Skill"
    )
  })

  afterEach(() => {
    watcher?.stop()
    rmSync(testDir, { recursive: true, force: true })
  })

  it("should emit skill-changed event when file is modified", (done) => {
    watcher = new SkillWatcher({
      paths: [join(testDir, "skills")],
      debounceMs: 100,
    })

    watcher.on("skill-changed", (skillId) => {
      expect(skillId).toBe("test-skill")
      done()
    })

    watcher.start()

    // Modify file after short delay
    setTimeout(() => {
      writeFileSync(
        join(testDir, "skills", "test-skill", "SKILL.md"),
        "# Test Skill Modified"
      )
    }, 200)
  })

  it("should debounce multiple rapid changes", async () => {
    const changedSpy = vi.fn()

    watcher = new SkillWatcher({
      paths: [join(testDir, "skills")],
      debounceMs: 300,
    })

    watcher.on("skill-changed", changedSpy)
    watcher.start()

    // Rapid changes
    await new Promise((resolve) => setTimeout(resolve, 100))
    writeFileSync(
      join(testDir, "skills", "test-skill", "SKILL.md"),
      "# Change 1"
    )
    writeFileSync(
      join(testDir, "skills", "test-skill", "SKILL.md"),
      "# Change 2"
    )
    writeFileSync(
      join(testDir, "skills", "test-skill", "SKILL.md"),
      "# Change 3"
    )

    // Wait for debounce
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Should only fire once due to debounce
    expect(changedSpy).toHaveBeenCalledTimes(1)
  })
})
```

**Step 2: Run tests**

Run: `npm test -- --run src/skills/__tests__/watcher.test.ts`
Expected: Tests pass (may be flaky due to filesystem timing)

**Step 3: Commit**

```bash
git add src/skills/__tests__/watcher.test.ts
git commit -m "test(skills): add watcher tests"
```

---

## Task 7: Update Documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add hot reload documentation**

```markdown
### Skills Hot Reload

Skills can be reloaded automatically when their SKILL.md files change:

**Enable hot reload:**
```
/skills watch
```

**Manual reload:**
```
/reload_skill id="builtin:git"
```

When hot reload is enabled:
- Changes to SKILL.md are automatically detected
- Skills are reloaded with preserved activation state
- UI shows notification when skills are reloaded
- 300ms debounce prevents excessive reloads
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add skills hot reload documentation"
```

---

## Summary

This implementation adds:

1. **SkillWatcher**: File system watcher with debouncing
2. **Hot Reload Integration**: Automatic reload when SKILL.md changes
3. **UI Notifications**: Shows when skills are reloaded
4. **reload_skill Tool**: Manual reload capability
5. **Watch Command**: Toggle hot reload on/off
6. **Test Coverage**: Unit tests for watcher functionality

**Total estimated time**: 0.5-1 day
**Breaking changes**: None
**Performance impact**: Minimal (fs.watch is efficient, 300ms debounce)
