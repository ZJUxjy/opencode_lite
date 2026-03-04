/**
 * Skills System - File Watcher
 *
 * Watches skills directories for changes and triggers hot reload
 */

import { watch, type FSWatcher } from "fs"
import { join } from "path"
import { homedir } from "os"
import { EventEmitter } from "events"
import { existsSync } from "fs"

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
 * Expand ~ to home directory
 */
function expandHome(filepath: string): string {
  if (filepath.startsWith("~/")) {
    return join(homedir(), filepath.slice(2))
  }
  return filepath
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
    const expandedPath = expandHome(path)
    if (this.isWatching && !this.watchers.has(expandedPath)) {
      this.watchDirectory(expandedPath)
    }
    if (!this.options.paths.includes(expandedPath)) {
      this.options.paths.push(expandedPath)
    }
  }

  /**
   * Remove a directory from watching
   */
  removePath(path: string): void {
    const expandedPath = expandHome(path)
    const watcher = this.watchers.get(expandedPath)
    if (watcher) {
      watcher.close()
      this.watchers.delete(expandedPath)
    }
    this.options.paths = this.options.paths.filter((p) => expandHome(p) !== expandedPath)
  }

  private watchDirectory(path: string): void {
    // Expand ~ to home directory
    const expandedPath = expandHome(path)

    // Skip if directory doesn't exist
    if (!existsSync(expandedPath)) {
      return
    }

    try {
      const watcher = watch(
        expandedPath,
        { recursive: this.options.recursive },
        (eventType, filename) => {
          if (!filename) return

          // Only care about SKILL.md files
          if (!filename.includes("SKILL") && !filename.includes("skill")) return

          const fullPath = join(expandedPath, filename)

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
      // File was added or removed - check if it still exists
      import("fs/promises")
        .then(({ access }) => access(fullPath))
        .then(() => {
          // File exists - it was added
          this.emit("skill-added", fullPath)
        })
        .catch(() => {
          // File doesn't exist - it was removed
          this.emit("skill-removed", skillId)
        })
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
