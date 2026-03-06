import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { PlanStore, type PlanState } from "../store.js"
import { DatabaseManager } from "../../db.js"
import { mkdirSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("PlanStore", () => {
  const testDbPath = join(tmpdir(), `lite-opencode-test-plan-${Date.now()}.db`)
  let store: PlanStore

  beforeEach(() => {
    // 确保测试数据库目录存在
    const dbDir = join(tmpdir())
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true })
    }
    store = new PlanStore(testDbPath)
  })

  afterEach(() => {
    // 关闭数据库连接并清理
    const manager = DatabaseManager.getInstance(testDbPath)
    manager.close()

    // 删除测试数据库文件
    try {
      if (existsSync(testDbPath)) {
        rmSync(testDbPath)
      }
      // 也删除 WAL 文件
      const walPath = `${testDbPath}-wal`
      const shmPath = `${testDbPath}-shm`
      if (existsSync(walPath)) rmSync(walPath)
      if (existsSync(shmPath)) rmSync(shmPath)
    } catch {
      // 忽略清理错误
    }
  })

  describe("getOrCreate", () => {
    it("should create a new plan record for session", () => {
      const sessionId = "test-session-123"
      const filePath = "/path/to/plan.md"
      const slug = "bright-shining-moon"

      const state = store.getOrCreate(sessionId, filePath, slug)

      expect(state.isEnabled).toBe(false)
      expect(state.slug).toBe(slug)
      expect(state.hasExited).toBe(false)
      expect(state.filePath).toBe(filePath)
    })

    it("should return existing state if already created", () => {
      const sessionId = "test-session-456"
      const filePath = "/path/to/plan.md"
      const slug = "calm-walking-river"

      store.getOrCreate(sessionId, filePath, slug)
      store.update(sessionId, { isEnabled: true })

      // 第二次获取应该返回已更新的状态
      const state = store.getOrCreate(sessionId, filePath, slug)
      expect(state.isEnabled).toBe(true)
    })
  })

  describe("get", () => {
    it("should return null for non-existent session", () => {
      const state = store.get("non-existent-session")
      expect(state).toBeNull()
    })

    it("should return plan state for existing session", () => {
      const sessionId = "test-session-789"
      const filePath = "/path/to/plan.md"
      const slug = "wild-running-wolf"

      store.getOrCreate(sessionId, filePath, slug)
      store.update(sessionId, { isEnabled: true, hasExited: true })

      const state = store.get(sessionId)
      expect(state).not.toBeNull()
      expect(state!.isEnabled).toBe(true)
      expect(state!.hasExited).toBe(true)
      expect(state!.slug).toBe(slug)
      expect(state!.filePath).toBe(filePath)
    })
  })

  describe("update", () => {
    it("should update isEnabled status", () => {
      const sessionId = "test-session-update-1"
      store.getOrCreate(sessionId, "/path/to/plan.md", "test-slug")

      store.update(sessionId, { isEnabled: true })

      const state = store.get(sessionId)
      expect(state!.isEnabled).toBe(true)
    })

    it("should update hasExited status", () => {
      const sessionId = "test-session-update-2"
      store.getOrCreate(sessionId, "/path/to/plan.md", "test-slug")

      store.update(sessionId, { hasExited: true })

      const state = store.get(sessionId)
      expect(state!.hasExited).toBe(true)
    })

    it("should update filePath", () => {
      const sessionId = "test-session-update-3"
      store.getOrCreate(sessionId, "/old/path.md", "test-slug")

      store.update(sessionId, { filePath: "/new/path.md" })

      const state = store.get(sessionId)
      expect(state!.filePath).toBe("/new/path.md")
    })

    it("should update multiple fields at once", () => {
      const sessionId = "test-session-update-4"
      store.getOrCreate(sessionId, "/path/to/plan.md", "test-slug")

      store.update(sessionId, {
        isEnabled: true,
        hasExited: true,
        filePath: "/updated/path.md",
      })

      const state = store.get(sessionId)
      expect(state!.isEnabled).toBe(true)
      expect(state!.hasExited).toBe(true)
      expect(state!.filePath).toBe("/updated/path.md")
    })
  })

  describe("exists", () => {
    it("should return false for non-existent session", () => {
      expect(store.exists("non-existent")).toBe(false)
    })

    it("should return true for existing session", () => {
      const sessionId = "test-session-exists"
      store.getOrCreate(sessionId, "/path/to/plan.md", "test-slug")

      expect(store.exists(sessionId)).toBe(true)
    })
  })

  describe("findBySlug", () => {
    it("should return null for non-existent slug", () => {
      const result = store.findBySlug("non-existent-slug")
      expect(result).toBeNull()
    })

    it("should find plan by slug", () => {
      const sessionId = "test-session-by-slug"
      const slug = "unique-test-slug-123"
      store.getOrCreate(sessionId, "/path/to/plan.md", slug)
      store.update(sessionId, { isEnabled: true })

      const result = store.findBySlug(slug)

      expect(result).not.toBeNull()
      expect(result!.sessionId).toBe(sessionId)
      expect(result!.slug).toBe(slug)
      expect(result!.isEnabled).toBe(true)
    })
  })

  describe("delete", () => {
    it("should delete plan record", () => {
      const sessionId = "test-session-delete"
      store.getOrCreate(sessionId, "/path/to/plan.md", "test-slug")

      const deleted = store.delete(sessionId)

      expect(deleted).toBe(true)
      expect(store.exists(sessionId)).toBe(false)
    })

    it("should return false when deleting non-existent record", () => {
      const deleted = store.delete("non-existent")
      expect(deleted).toBe(false)
    })
  })

  describe("list", () => {
    it("should return empty array when no plans exist", () => {
      const plans = store.list()
      expect(plans).toEqual([])
    })

    it("should return all plans ordered by updated_at desc", () => {
      const session1 = "session-1"
      const session2 = "session-2"
      const session3 = "session-3"

      store.getOrCreate(session1, "/path/1.md", "slug-1")
      store.getOrCreate(session2, "/path/2.md", "slug-2")
      store.getOrCreate(session3, "/path/3.md", "slug-3")

      // 更新 session1 使其成为最新的
      store.update(session1, { isEnabled: true })

      const plans = store.list()

      expect(plans).toHaveLength(3)
      expect(plans[0].sessionId).toBe(session1) // 最新更新的应该在最前面
    })
  })

  describe("session isolation", () => {
    it("should keep separate state for different sessions", () => {
      const session1 = "isolated-session-1"
      const session2 = "isolated-session-2"

      store.getOrCreate(session1, "/path/1.md", "slug-1")
      store.getOrCreate(session2, "/path/2.md", "slug-2")

      store.update(session1, { isEnabled: true })

      const state1 = store.get(session1)
      const state2 = store.get(session2)

      expect(state1!.isEnabled).toBe(true)
      expect(state2!.isEnabled).toBe(false) // session2 不受影响
    })
  })
})
