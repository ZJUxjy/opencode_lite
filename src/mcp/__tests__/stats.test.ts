import { describe, it, expect, beforeEach } from "vitest"
import { MCPStatsTracker } from "../stats.js"

describe("MCPStatsTracker", () => {
  let tracker: MCPStatsTracker

  beforeEach(() => {
    tracker = new MCPStatsTracker()
  })

  describe("recordCall", () => {
    it("should record successful call", () => {
      tracker.recordCall("server1", "tool1", 100, true)

      const stats = tracker.getServerStats("server1")
      expect(stats).toBeDefined()
      expect(stats!.totalCalls).toBe(1)
      expect(stats!.successfulCalls).toBe(1)
      expect(stats!.failedCalls).toBe(0)
    })

    it("should record failed call", () => {
      tracker.recordCall("server1", "tool1", 100, false, "Timeout")

      const stats = tracker.getServerStats("server1")
      expect(stats!.totalCalls).toBe(1)
      expect(stats!.successfulCalls).toBe(0)
      expect(stats!.failedCalls).toBe(1)
      expect(stats!.lastError).toBe("Timeout")
    })

    it("should track lastCallAt timestamp", () => {
      const before = Date.now()
      tracker.recordCall("server1", "tool1", 100, true)
      const after = Date.now()

      const stats = tracker.getServerStats("server1")
      expect(stats!.lastCallAt).toBeGreaterThanOrEqual(before)
      expect(stats!.lastCallAt).toBeLessThanOrEqual(after)
    })

    it("should track lastErrorAt timestamp on failure", () => {
      const before = Date.now()
      tracker.recordCall("server1", "tool1", 100, false, "Error")
      const after = Date.now()

      const stats = tracker.getServerStats("server1")
      expect(stats!.lastErrorAt).toBeGreaterThanOrEqual(before)
      expect(stats!.lastErrorAt).toBeLessThanOrEqual(after)
    })
  })

  describe("averageDuration", () => {
    it("should calculate average duration correctly", () => {
      tracker.recordCall("server1", "tool1", 100, true)
      tracker.recordCall("server1", "tool1", 200, true)
      tracker.recordCall("server1", "tool1", 300, true)

      const stats = tracker.getServerStats("server1")
      expect(stats!.averageDuration).toBe(200)
    })

    it("should update average incrementally", () => {
      tracker.recordCall("server1", "tool1", 100, true)
      let stats = tracker.getServerStats("server1")
      expect(stats!.averageDuration).toBe(100)

      tracker.recordCall("server1", "tool1", 200, true)
      stats = tracker.getServerStats("server1")
      expect(stats!.averageDuration).toBe(150)
    })
  })

  describe("history management", () => {
    it("should limit history size", () => {
      const smallTracker = new MCPStatsTracker(5)

      for (let i = 0; i < 10; i++) {
        smallTracker.recordCall("server1", "tool1", 100, true)
      }

      // Internal array should be limited to 5
      expect((smallTracker as unknown as { stats: { toolCalls: unknown[] } }).stats.toolCalls.length).toBe(5)
    })

    it("should return recent errors", () => {
      tracker.recordCall("server1", "tool1", 100, true)
      tracker.recordCall("server1", "tool2", 100, false, "Error 1")
      tracker.recordCall("server1", "tool1", 100, true)
      tracker.recordCall("server1", "tool3", 100, false, "Error 2")

      const errors = tracker.getRecentErrors(2)
      expect(errors).toHaveLength(2)
      expect(errors[0].error).toBe("Error 1")
      expect(errors[1].error).toBe("Error 2")
    })

    it("should limit recent errors", () => {
      tracker.recordCall("server1", "tool1", 100, false, "Error 1")
      tracker.recordCall("server1", "tool2", 100, false, "Error 2")
      tracker.recordCall("server1", "tool3", 100, false, "Error 3")
      tracker.recordCall("server1", "tool4", 100, false, "Error 4")

      const errors = tracker.getRecentErrors(2)
      expect(errors).toHaveLength(2)
      expect(errors[0].error).toBe("Error 3")
      expect(errors[1].error).toBe("Error 4")
    })
  })

  describe("getServerStats", () => {
    it("should return undefined for unknown server", () => {
      const stats = tracker.getServerStats("unknown")
      expect(stats).toBeUndefined()
    })

    it("should track multiple servers independently", () => {
      tracker.recordCall("server1", "tool1", 100, true)
      tracker.recordCall("server2", "tool1", 200, false, "Error")

      const stats1 = tracker.getServerStats("server1")
      const stats2 = tracker.getServerStats("server2")

      expect(stats1!.totalCalls).toBe(1)
      expect(stats1!.successfulCalls).toBe(1)
      expect(stats2!.totalCalls).toBe(1)
      expect(stats2!.failedCalls).toBe(1)
    })
  })

  describe("getAllStats", () => {
    it("should return all server stats", () => {
      tracker.recordCall("server1", "tool1", 100, true)
      tracker.recordCall("server2", "tool1", 200, true)

      const allStats = tracker.getAllStats()
      expect(allStats).toHaveLength(2)
      expect(allStats.map((s) => s.name)).toContain("server1")
      expect(allStats.map((s) => s.name)).toContain("server2")
    })

    it("should return empty array when no calls recorded", () => {
      const allStats = tracker.getAllStats()
      expect(allStats).toHaveLength(0)
    })
  })

  describe("getTotalCalls", () => {
    it("should track total calls across all servers", () => {
      tracker.recordCall("server1", "tool1", 100, true)
      tracker.recordCall("server1", "tool2", 100, true)
      tracker.recordCall("server2", "tool1", 100, true)

      expect(tracker.getTotalCalls()).toBe(3)
    })
  })

  describe("getUptime", () => {
    it("should return uptime in milliseconds", () => {
      const before = tracker.getUptime()
      // Small delay
      const start = Date.now()
      while (Date.now() - start < 10) {
        // Wait 10ms
      }
      const after = tracker.getUptime()
      expect(after).toBeGreaterThan(before)
    })
  })

  describe("clear", () => {
    it("should clear all stats", () => {
      tracker.recordCall("server1", "tool1", 100, true)
      tracker.recordCall("server2", "tool1", 100, false, "Error")

      tracker.clear()

      expect(tracker.getServerStats("server1")).toBeUndefined()
      expect(tracker.getServerStats("server2")).toBeUndefined()
      expect(tracker.getTotalCalls()).toBe(0)
    })
  })

  describe("export", () => {
    it("should export stats as JSON object", () => {
      tracker.recordCall("server1", "tool1", 100, true)

      const exported = tracker.export() as {
        servers: Array<[string, unknown]>
        totalCalls: number
        uptime: number
      }

      expect(exported.totalCalls).toBe(1)
      expect(exported.servers).toHaveLength(1)
      expect(exported.uptime).toBeGreaterThanOrEqual(0)
    })
  })
})
