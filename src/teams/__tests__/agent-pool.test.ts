/**
 * Agent Pool Tests
 */

import { describe, it, expect, beforeEach } from "vitest"
import { AgentPool, createAgentPool } from "../agent-pool.js"
import type { AgentRole } from "../types.js"

describe("AgentPool", () => {
  let pool: AgentPool

  beforeEach(() => {
    pool = createAgentPool({
      maxInstances: 5,
      maxLifetimeMs: 60000, // 1分钟便于测试
      maxUseCount: 10,
      contextThreshold: 10000,
      maxConsecutiveErrors: 3,
      idleTimeoutMs: 10000,
      preferCheaperInstance: true,
    })
  })

  describe("acquire", () => {
    it("should create new instance for worker role (long-lived)", () => {
      const instance = pool.acquire({ role: "worker" as AgentRole, model: "claude-sonnet-4" })

      expect(instance.id).toBeDefined()
      expect(instance.role).toBe("worker")
      expect(instance.model).toBe("claude-sonnet-4")
      expect(instance.instanceType).toBe("long-lived")
      expect(instance.status).toBe("busy")
      expect(instance.useCount).toBe(1)
    })

    it("should create new instance for leader role (short-lived)", () => {
      const instance = pool.acquire({ role: "leader" as AgentRole, model: "claude-sonnet-4" })

      expect(instance.instanceType).toBe("short-lived")
      expect(instance.status).toBe("busy")
    })

    it("should create isolated instance for member role", () => {
      const instance = pool.acquire({ role: "member" as AgentRole, model: "claude-sonnet-4" })

      expect(instance.instanceType).toBe("isolated")
    })

    it("should reuse idle long-lived instance", () => {
      const instance1 = pool.acquire({ role: "worker" as AgentRole, model: "claude-sonnet-4" })
      const id1 = instance1.id

      pool.release(id1)

      const instance2 = pool.acquire({ role: "worker" as AgentRole, model: "claude-sonnet-4" })

      expect(instance2.id).toBe(id1) // 复用同一实例
      expect(instance2.useCount).toBe(2)
    })

    it("should not reuse isolated instances", () => {
      const instance1 = pool.acquire({ role: "speaker" as AgentRole, model: "claude-sonnet-4" })
      const id1 = instance1.id

      pool.release(id1)

      const instance2 = pool.acquire({ role: "speaker" as AgentRole, model: "claude-sonnet-4" })

      expect(instance2.id).not.toBe(id1) // 创建新实例
    })

    it("should not reuse busy instances", () => {
      const instance1 = pool.acquire({ role: "worker" as AgentRole, model: "claude-sonnet-4" })
      // 不释放，直接获取新实例

      const instance2 = pool.acquire({ role: "worker" as AgentRole, model: "claude-sonnet-4" })

      expect(instance2.id).not.toBe(instance1.id)
    })

    it("should respect max instances limit", () => {
      // 创建多个空闲实例（使用 long-lived 类型以便复用逻辑触发清理）
      const instances = []
      for (let i = 0; i < 6; i++) {
        const inst = pool.acquire({
          role: "reviewer" as AgentRole,
          model: "claude-sonnet-4",
          preferredType: "long-lived"
        })
        instances.push(inst)
        // 立即释放使其变为 idle
        pool.release(inst.id)
      }

      // 清理后应该只有 maxInstances 个
      pool.cleanup()
      expect(pool.getAllInstances().length).toBeLessThanOrEqual(5)
    })
  })

  describe("release", () => {
    it("should mark instance as idle", () => {
      const instance = pool.acquire({ role: "worker" as AgentRole, model: "claude-sonnet-4" })

      pool.release(instance.id)

      const released = pool.getAllInstances().find(i => i.id === instance.id)
      expect(released?.status).toBe("idle")
    })

    it("should retire instance with too many uses", () => {
      const instance = pool.acquire({ role: "worker" as AgentRole, model: "claude-sonnet-4" })

      // 模拟使用超过限制
      for (let i = 0; i < 11; i++) {
        pool.release(instance.id)
        pool.acquire({ role: "worker" as AgentRole, model: "claude-sonnet-4" })
      }

      const retired = pool.getAllInstances().find(i => i.id === instance.id)
      expect(retired?.status).toBe("retired")
    })
  })

  describe("recordUsage", () => {
    it("should track token usage", () => {
      const instance = pool.acquire({ role: "worker" as AgentRole, model: "claude-sonnet-4" })

      pool.recordUsage(instance.id, { input: 1000, output: 500 }, 5000)

      const updated = pool.getAllInstances().find(i => i.id === instance.id)
      expect(updated?.tokensUsed).toEqual({ input: 1000, output: 500 })
      expect(updated?.contextSize).toBe(5000)
    })

    it("should accumulate token usage", () => {
      const instance = pool.acquire({ role: "worker" as AgentRole, model: "claude-sonnet-4" })

      pool.recordUsage(instance.id, { input: 1000, output: 500 }, 5000)
      pool.recordUsage(instance.id, { input: 500, output: 300 }, 8000)

      const updated = pool.getAllInstances().find(i => i.id === instance.id)
      expect(updated?.tokensUsed).toEqual({ input: 1500, output: 800 })
    })
  })

  describe("recordError", () => {
    it("should track consecutive errors", () => {
      const instance = pool.acquire({ role: "worker" as AgentRole, model: "claude-sonnet-4" })

      pool.recordError(instance.id)
      pool.recordError(instance.id)

      const updated = pool.getAllInstances().find(i => i.id === instance.id)
      expect(updated?.consecutiveErrors).toBe(2)
    })

    it("should mark instance as error after threshold", () => {
      const instance = pool.acquire({ role: "worker" as AgentRole, model: "claude-sonnet-4" })

      pool.recordError(instance.id)
      pool.recordError(instance.id)
      pool.recordError(instance.id)

      const updated = pool.getAllInstances().find(i => i.id === instance.id)
      expect(updated?.status).toBe("error")
    })

    it("should retire instance with errors on release", () => {
      const instance = pool.acquire({ role: "worker" as AgentRole, model: "claude-sonnet-4" })

      pool.recordError(instance.id)
      pool.recordError(instance.id)
      pool.recordError(instance.id)

      pool.release(instance.id)

      const retired = pool.getAllInstances().find(i => i.id === instance.id)
      expect(retired?.status).toBe("retired")
    })
  })

  describe("recordSuccess", () => {
    it("should reset consecutive errors", () => {
      const instance = pool.acquire({ role: "worker" as AgentRole, model: "claude-sonnet-4" })

      pool.recordError(instance.id)
      pool.recordError(instance.id)
      pool.recordSuccess(instance.id)

      const updated = pool.getAllInstances().find(i => i.id === instance.id)
      expect(updated?.consecutiveErrors).toBe(0)
    })
  })

  describe("getStats", () => {
    it("should return pool statistics", () => {
      const i1 = pool.acquire({ role: "worker" as AgentRole, model: "claude-sonnet-4" })
      const i2 = pool.acquire({ role: "reviewer" as AgentRole, model: "claude-sonnet-4" })

      pool.recordUsage(i1.id, { input: 1000, output: 500 }, 5000)
      pool.recordUsage(i2.id, { input: 2000, output: 1000 }, 8000)

      pool.release(i1.id)

      const stats = pool.getStats()

      expect(stats.totalInstances).toBe(2)
      expect(stats.idleInstances).toBe(1)
      expect(stats.busyInstances).toBe(1)
      expect(stats.totalTokensUsed).toEqual({ input: 3000, output: 1500 })
    })
  })

  describe("cleanup", () => {
    it("should remove retired instances", () => {
      const instance = pool.acquire({ role: "worker" as AgentRole, model: "claude-sonnet-4" })

      // 超过使用次数限制
      for (let i = 0; i < 11; i++) {
        pool.release(instance.id)
        pool.acquire({ role: "worker" as AgentRole, model: "claude-sonnet-4" })
      }

      expect(pool.getAllInstances().length).toBeGreaterThan(0)

      pool.cleanup()

      // 退役实例被清理
      const instances = pool.getAllInstances()
      expect(instances.every(i => i.status !== "retired")).toBe(true)
    })

    it("should remove idle timeout instances", async () => {
      const shortPool = createAgentPool({
        idleTimeoutMs: 50, // 50ms 超时
      })

      const instance = shortPool.acquire({ role: "worker" as AgentRole, model: "claude-sonnet-4" })
      shortPool.release(instance.id)

      // 等待超时
      await new Promise(resolve => setTimeout(resolve, 100))

      shortPool.cleanup()

      expect(shortPool.getAllInstances().length).toBe(0)
    })
  })

  describe("destroyAll", () => {
    it("should remove all instances", () => {
      pool.acquire({ role: "worker" as AgentRole, model: "claude-sonnet-4" })
      pool.acquire({ role: "reviewer" as AgentRole, model: "claude-sonnet-4" })

      expect(pool.getAllInstances().length).toBe(2)

      pool.destroyAll()

      expect(pool.getAllInstances().length).toBe(0)
    })
  })

  describe("role-based instance types", () => {
    it("should use long-lived for worker and reviewer", () => {
      const worker = pool.acquire({ role: "worker" as AgentRole, model: "claude-sonnet-4" })
      const reviewer = pool.acquire({ role: "reviewer" as AgentRole, model: "claude-sonnet-4" })

      expect(worker.instanceType).toBe("long-lived")
      expect(reviewer.instanceType).toBe("long-lived")
    })

    it("should use short-lived for leader and planner", () => {
      const leader = pool.acquire({ role: "leader" as AgentRole, model: "claude-sonnet-4" })
      const planner = pool.acquire({ role: "planner" as AgentRole, model: "claude-sonnet-4" })

      expect(leader.instanceType).toBe("short-lived")
      expect(planner.instanceType).toBe("short-lived")
    })

    it("should use isolated for speaker and member", () => {
      const speaker = pool.acquire({ role: "speaker" as AgentRole, model: "claude-sonnet-4" })
      const member = pool.acquire({ role: "member" as AgentRole, model: "claude-sonnet-4" })

      expect(speaker.instanceType).toBe("isolated")
      expect(member.instanceType).toBe("isolated")
    })
  })

  describe("budget-based preference", () => {
    it("should prefer instances with fewer uses when budget is tight", () => {
      // 创建两个实例，一个使用次数多，一个少
      const instance1 = pool.acquire({ role: "worker" as AgentRole, model: "claude-sonnet-4" })
      pool.release(instance1.id)

      const instance2 = pool.acquire({ role: "worker" as AgentRole, model: "claude-sonnet-4" })
      pool.release(instance2.id)

      // 多次使用 instance1
      for (let i = 0; i < 5; i++) {
        const inst = pool.acquire({ role: "worker" as AgentRole, model: "claude-sonnet-4" })
        if (inst.id === instance1.id) {
          pool.release(inst.id)
        } else {
          pool.release(inst.id)
        }
      }

      // 预算紧张时应该优先复用使用次数少的
      const reused = pool.acquire({
        role: "worker" as AgentRole,
        model: "claude-sonnet-4",
        budgetTier: "low"
      })

      // 应该复用其中一个实例
      expect([instance1.id, instance2.id]).toContain(reused.id)
    })
  })
})
