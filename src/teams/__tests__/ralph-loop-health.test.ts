import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as fs from "fs"
import * as path from "path"
import { RalphLoop, type HealthStatus, type RalphEvent } from "../index.js"

describe("RalphLoop Health Status", () => {
  const testDir = path.resolve(process.cwd(), ".test-ralph-health")

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true })
    }
  })

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe("getHealthStatus", () => {
    it("should return stopped status when not running", () => {
      const loop = new RalphLoop(
        { run: async () => "done" } as any,
        null,
        { cwd: testDir, maxIterations: 0 }
      )

      const status = loop.getHealthStatus()

      expect(status.status).toBe("stopped")
      expect(status.uptime).toBeGreaterThanOrEqual(0)
    })

    it("should include stats in health status", () => {
      const loop = new RalphLoop(
        { run: async () => "done" } as any,
        null,
        { cwd: testDir, maxIterations: 0 }
      )

      const status = loop.getHealthStatus()

      expect(status.stats).toBeDefined()
      expect(status.stats.totalTasks).toBe(0)
      expect(status.lastHeartbeat).toBeGreaterThanOrEqual(0)
    })

    it("should return running status when executing", async () => {
      fs.writeFileSync(path.join(testDir, "TASKS.md"), "- [ ] Test task\n")

      const loop = new RalphLoop(
        { run: async () => {
          await new Promise(r => setTimeout(r, 100))
          return "done"
        }} as any,
        null,
        { cwd: testDir, maxIterations: 1, cooldownMs: 0 }
      )

      const runPromise = loop.run()

      // Give it a moment to start
      await new Promise(r => setTimeout(r, 30))

      const status = loop.getHealthStatus()
      expect(status.status).toBe("running")

      await runPromise
    })
  })

  describe("Heartbeat", () => {
    it("should emit heartbeat events at interval", async () => {
      fs.writeFileSync(path.join(testDir, "TASKS.md"), "- [ ] Test task\n")

      const events: RalphEvent[] = []
      const heartbeatInterval = 50

      const loop = new RalphLoop(
        { run: async () => {
          await new Promise(r => setTimeout(r, 150))
          return "done"
        }} as any,
        null,
        { cwd: testDir, maxIterations: 1, heartbeatInterval, cooldownMs: 0 }
      )

      loop.emitEvent = (event: RalphEvent) => {
        events.push(event)
      }

      await loop.run()

      const heartbeats = events.filter(e => e.type === "heartbeat")
      expect(heartbeats.length).toBeGreaterThanOrEqual(1)
    })

    it("should not emit heartbeat when interval is 0", async () => {
      fs.writeFileSync(path.join(testDir, "TASKS.md"), "- [ ] Test task\n")

      const events: RalphEvent[] = []

      const loop = new RalphLoop(
        { run: async () => {
          await new Promise(r => setTimeout(r, 100))
          return "done"
        }} as any,
        null,
        { cwd: testDir, maxIterations: 1, heartbeatInterval: 0, cooldownMs: 0 }
      )

      loop.emitEvent = (event: RalphEvent) => {
        events.push(event)
      }

      await loop.run()

      const heartbeats = events.filter(e => e.type === "heartbeat")
      expect(heartbeats.length).toBe(0)
    })
  })
})
