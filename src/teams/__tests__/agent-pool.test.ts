import { describe, it, expect, beforeEach } from "vitest"
import { AgentPool, createAgentPool } from "../client/agent-pool.js"
import type { AgentPoolConfig, InstanceRequest } from "../client/agent-pool.js"

describe("AgentPool", () => {
  let pool: AgentPool

  beforeEach(() => {
    pool = new AgentPool({ maxInstances: 5 })
  })

  describe("construction", () => {
    it("should create pool with config", () => {
      expect(pool).toBeDefined()
    })

    it("should use default config values", () => {
      const defaultPool = new AgentPool()
      expect(defaultPool).toBeDefined()
    })

    it("should support factory function", () => {
      const factoryPool = createAgentPool({ maxInstances: 3 })
      expect(factoryPool).toBeDefined()
    })
  })

  describe("acquire", () => {
    it("should acquire agent instance", () => {
      const instance = pool.acquire({
        role: "worker",
        model: "claude-3-5-sonnet-20241022",
      })
      expect(instance).toBeDefined()
      expect(instance.role).toBe("worker")
      expect(instance.status).toBe("busy")
    })

    it("should create instance with unique ID", () => {
      const instance1 = pool.acquire({ role: "worker", model: "test" })
      const instance2 = pool.acquire({ role: "worker", model: "test" })
      expect(instance1.id).not.toBe(instance2.id)
    })

    it("should set instance type based on role", () => {
      const worker = pool.acquire({ role: "worker", model: "test" })
      expect(worker.instanceType).toBe("long-lived")

      const leader = pool.acquire({ role: "leader", model: "test" })
      expect(leader.instanceType).toBe("short-lived")
    })

    it("should reuse idle instance for same role and model", () => {
      const instance1 = pool.acquire({ role: "worker", model: "test-model" })
      pool.release(instance1.id)

      const instance2 = pool.acquire({ role: "worker", model: "test-model" })
      expect(instance2.id).toBe(instance1.id)
      expect(instance2.useCount).toBe(2)
    })

    it("should not reuse instance with different model", () => {
      const instance1 = pool.acquire({ role: "worker", model: "model-a" })
      pool.release(instance1.id)

      const instance2 = pool.acquire({ role: "worker", model: "model-b" })
      expect(instance2.id).not.toBe(instance1.id)
    })

    it("should always create new isolated instance", () => {
      const instance1 = pool.acquire({
        role: "worker",
        model: "test",
        preferredType: "isolated",
      })
      pool.release(instance1.id)

      const instance2 = pool.acquire({
        role: "worker",
        model: "test",
        preferredType: "isolated",
      })
      expect(instance2.id).not.toBe(instance1.id)
    })
  })

  describe("release", () => {
    it("should release instance back to pool", () => {
      const instance = pool.acquire({ role: "worker", model: "test" })
      expect(instance.status).toBe("busy")

      pool.release(instance.id)
      expect(instance.status).toBe("idle")
    })

    it("should handle releasing non-existent instance", () => {
      expect(() => pool.release("non-existent-id")).not.toThrow()
    })
  })

  describe("usage tracking", () => {
    it("should track instance usage", () => {
      const instance = pool.acquire({ role: "worker", model: "test" })
      pool.recordUsage(instance.id, { input: 100, output: 50 }, 5000)

      expect(instance.tokensUsed.input).toBe(100)
      expect(instance.tokensUsed.output).toBe(50)
      expect(instance.contextSize).toBe(5000)
    })

    it("should accumulate usage over multiple calls", () => {
      const instance = pool.acquire({ role: "worker", model: "test" })
      pool.recordUsage(instance.id, { input: 100, output: 50 }, 5000)
      pool.recordUsage(instance.id, { input: 200, output: 100 }, 8000)

      expect(instance.tokensUsed.input).toBe(300)
      expect(instance.tokensUsed.output).toBe(150)
    })

    it("should handle recording usage for non-existent instance", () => {
      expect(() => pool.recordUsage("non-existent", { input: 100, output: 50 }, 1000)).not.toThrow()
    })
  })

  describe("error tracking", () => {
    it("should record errors", () => {
      const instance = pool.acquire({ role: "worker", model: "test" })
      pool.recordError(instance.id)
      expect(instance.consecutiveErrors).toBe(1)
    })

    it("should retire instances with too many errors", () => {
      const instance = pool.acquire({ role: "worker", model: "test" })
      pool.recordError(instance.id)
      pool.recordError(instance.id)
      pool.recordError(instance.id)

      // After 3 errors (default maxConsecutiveErrors), status should be error
      expect(instance.status).toBe("error")
    })

    it("should reset consecutive errors on success", () => {
      const instance = pool.acquire({ role: "worker", model: "test" })
      pool.recordError(instance.id)
      pool.recordError(instance.id)
      pool.recordSuccess(instance.id)
      expect(instance.consecutiveErrors).toBe(0)
    })
  })

  describe("max instances limit", () => {
    it("should enforce max instances limit", () => {
      // Acquire max instances
      for (let i = 0; i < 5; i++) {
        pool.acquire({ role: "worker", model: `test-${i}` })
      }

      // Should throw when trying to acquire another
      expect(() => pool.acquire({ role: "worker", model: "test-6" })).toThrow()
    })

    it("should allow acquiring after release", () => {
      // Acquire max instances
      const instances = []
      for (let i = 0; i < 5; i++) {
        instances.push(pool.acquire({ role: "worker", model: `test-${i}` }))
      }

      // Release one
      pool.release(instances[0].id)

      // Should now be able to acquire
      expect(() => pool.acquire({ role: "worker", model: "test-6" })).not.toThrow()
    })
  })

  describe("getStats", () => {
    it("should return pool statistics", () => {
      const instance1 = pool.acquire({ role: "worker", model: "test" })
      const instance2 = pool.acquire({ role: "reviewer", model: "test" })
      pool.release(instance1.id)

      pool.recordUsage(instance1.id, { input: 100, output: 50 }, 0)
      pool.recordUsage(instance2.id, { input: 200, output: 100 }, 0)

      const stats = pool.getStats()

      expect(stats.totalInstances).toBe(2)
      expect(stats.idleInstances).toBe(1)
      expect(stats.busyInstances).toBe(1)
      expect(stats.totalTokensUsed.input).toBe(300)
      expect(stats.totalTokensUsed.output).toBe(150)
    })
  })

  describe("getAllInstances", () => {
    it("should return all instances", () => {
      pool.acquire({ role: "worker", model: "test" })
      pool.acquire({ role: "reviewer", model: "test" })

      const instances = pool.getAllInstances()
      expect(instances.length).toBe(2)
    })
  })

  describe("cleanup", () => {
    it("should remove retired instances", () => {
      const instance = pool.acquire({ role: "worker", model: "test" })

      // Force retire by exceeding errors
      pool.recordError(instance.id)
      pool.recordError(instance.id)
      pool.recordError(instance.id)
      pool.release(instance.id)

      pool.cleanup()

      const instances = pool.getAllInstances()
      expect(instances.find((i) => i.id === instance.id)).toBeUndefined()
    })
  })

  describe("destroyAll", () => {
    it("should destroy all instances", () => {
      pool.acquire({ role: "worker", model: "test" })
      pool.acquire({ role: "reviewer", model: "test" })

      pool.destroyAll()

      expect(pool.getAllInstances().length).toBe(0)
    })
  })
})
