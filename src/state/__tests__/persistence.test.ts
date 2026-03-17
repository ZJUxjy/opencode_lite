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
    const tempPath = join(tmpdir(), `state-test-${Date.now()}`)
    mkdirSync(tempPath, { recursive: true })
    tempDir = tempPath
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
