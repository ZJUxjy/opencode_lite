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
