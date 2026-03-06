import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { PlanModeManager, clearPlanModeManagerCache, getPlanModeManager } from "../manager.js"
import { DatabaseManager } from "../../db.js"
import { mkdirSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { setPlanContext, clearPlanContext } from "../context.js"

describe("PlanModeManager", () => {
  const testDbPath = join(tmpdir(), `lite-opencode-test-manager-${Date.now()}.db`)
  let manager: PlanModeManager
  const sessionId = `test-session-${Date.now()}`

  beforeEach(() => {
    // 确保测试数据库目录存在
    const dbDir = join(tmpdir())
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true })
    }

    // 清除缓存
    clearPlanModeManagerCache()
    clearPlanContext()

    // 创建管理器实例
    manager = new PlanModeManager(sessionId, testDbPath)

    // 设置全局上下文
    setPlanContext({ sessionId, dbPath: testDbPath })
  })

  afterEach(() => {
    // 清理上下文
    clearPlanContext()

    // 关闭数据库连接并清理
    const manager2 = DatabaseManager.getInstance(testDbPath)
    manager2.close()

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

  describe("enter/exit", () => {
    it("should enter plan mode", () => {
      const result = manager.enter()

      expect(manager.isEnabled()).toBe(true)
      expect(result.planFilePath).toBeDefined()
      expect(result.planFilePath.endsWith(".md")).toBe(true)
    })

    it("should exit plan mode", () => {
      manager.enter()
      const result = manager.exit()

      expect(manager.isEnabled()).toBe(false)
      expect(result.planFilePath).toBeDefined()
    })

    it("should persist state across instances", () => {
      // 第一个实例进入 plan mode
      manager.enter()

      // 创建新实例（模拟重启后恢复）
      clearPlanModeManagerCache()
      const newManager = new PlanModeManager(sessionId, testDbPath)

      // 状态应该被恢复
      expect(newManager.isEnabled()).toBe(true)
    })

    it("should track hasExited after exit", () => {
      manager.enter()
      manager.exit()

      expect(manager.needsExitAttachment()).toBe(true)
    })
  })

  describe("getPlanFilePath", () => {
    it("should return consistent path for same session", () => {
      const path1 = manager.getPlanFilePath()
      const path2 = manager.getPlanFilePath()

      expect(path1).toBe(path2)
    })

    it("should return different paths for different sessions", () => {
      const session1 = "session-a-123"
      const session2 = "session-b-456"

      const manager1 = new PlanModeManager(session1, testDbPath)
      const manager2 = new PlanModeManager(session2, testDbPath)

      const path1 = manager1.getPlanFilePath()
      const path2 = manager2.getPlanFilePath()

      expect(path1).not.toBe(path2)
    })

    it("should persist slug across instances", () => {
      const path1 = manager.getPlanFilePath()

      // 创建新实例
      clearPlanModeManagerCache()
      const newManager = new PlanModeManager(sessionId, testDbPath)
      const path2 = newManager.getPlanFilePath()

      expect(path1).toBe(path2)
    })
  })

  describe("getPlanModeManager (global function)", () => {
    it("should return same instance for same session and dbPath", () => {
      const m1 = getPlanModeManager(sessionId, testDbPath)
      const m2 = getPlanModeManager(sessionId, testDbPath)

      expect(m1).toBe(m2)
    })

    it("should return different instances for different sessions", () => {
      const m1 = getPlanModeManager("session-1", testDbPath)
      const m2 = getPlanModeManager("session-2", testDbPath)

      expect(m1).not.toBe(m2)
    })
  })

  describe("read/write plan file", () => {
    it("should read non-existent plan file", () => {
      const result = manager.readPlanFile()

      expect(result.exists).toBe(false)
      expect(result.content).toBe("")
    })

    it("should write and read plan file", () => {
      const content = "# Test Plan\n\nThis is a test plan."

      manager.writePlanFile(content)
      const result = manager.readPlanFile()

      expect(result.exists).toBe(true)
      expect(result.content).toBe(content)
    })

    it("should persist file path in state", () => {
      const { planFilePath } = manager.enter()

      // 创建新实例
      clearPlanModeManagerCache()
      const newManager = new PlanModeManager(sessionId, testDbPath)

      expect(newManager.getPlanFilePath()).toBe(planFilePath)
    })
  })

  describe("isPlanFilePath", () => {
    it("should return true for current plan file path", () => {
      const planPath = manager.getPlanFilePath()

      expect(manager.isPlanFilePath(planPath)).toBe(true)
    })

    it("should return false for different file", () => {
      expect(manager.isPlanFilePath("/some/other/file.md")).toBe(false)
    })

    it("should return false for file outside plan directory", () => {
      expect(manager.isPlanFilePath("/tmp/random.md")).toBe(false)
    })
  })

  describe("session isolation", () => {
    it("should maintain separate state for each session", () => {
      const session1 = "isolated-1"
      const session2 = "isolated-2"

      const manager1 = new PlanModeManager(session1, testDbPath)
      const manager2 = new PlanModeManager(session2, testDbPath)

      // 只让 session1 进入 plan mode
      manager1.enter()

      expect(manager1.isEnabled()).toBe(true)
      expect(manager2.isEnabled()).toBe(false)
    })

    it("should have different plan files for different sessions", () => {
      const session1 = "isolated-3"
      const session2 = "isolated-4"

      const manager1 = new PlanModeManager(session1, testDbPath)
      const manager2 = new PlanModeManager(session2, testDbPath)

      const path1 = manager1.getPlanFilePath()
      const path2 = manager2.getPlanFilePath()

      expect(path1).not.toBe(path2)
    })
  })
})
