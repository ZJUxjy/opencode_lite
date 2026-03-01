/**
 * ProgressTracker Tests
 */

import { describe, it, expect } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { TeamProgressTracker } from "../progress-tracker.js"

describe("TeamProgressTracker", () => {
  describe("progress recording", () => {
    it("should record code changes", () => {
      const tracker = new TeamProgressTracker({
        circuitBreaker: {
          maxConsecutiveFailures: 3,
          maxNoProgressRounds: 2,
          cooldownMs: 60000,
        },
      })

      tracker.recordCodeChange(5)
      tracker.checkProgress() // End round

      const stats = tracker.getStats()
      expect(stats.codeChanges).toBe(5)
    })

    it("should record test results", () => {
      const tracker = new TeamProgressTracker({
        circuitBreaker: {
          maxConsecutiveFailures: 3,
          maxNoProgressRounds: 2,
          cooldownMs: 60000,
        },
      })

      tracker.recordTestResult(true)
      tracker.checkProgress()

      const stats = tracker.getStats()
      expect(stats.testsPassed).toBe(1)
    })

    it("should record review issues", () => {
      const tracker = new TeamProgressTracker({
        circuitBreaker: {
          maxConsecutiveFailures: 3,
          maxNoProgressRounds: 2,
          cooldownMs: 60000,
        },
      })

      tracker.recordReviewIssue("P0")
      tracker.recordReviewIssue("P1")
      tracker.recordReviewIssue("P0", true) // Fixed

      const stats = tracker.getStats()
      expect(stats.p0Issues).toBe(0) // Net zero after fix
      expect(stats.p1Issues).toBe(1)
    })
  })

  describe("progress detection", () => {
    it("should detect progress when files changed", () => {
      const tracker = new TeamProgressTracker({
        circuitBreaker: {
          maxConsecutiveFailures: 3,
          maxNoProgressRounds: 2,
          cooldownMs: 60000,
        },
      })

      // First round - no changes
      tracker.checkProgress()

      // Second round - with changes
      tracker.recordCodeChange(3)
      const hasProgress = tracker.checkProgress()

      expect(hasProgress).toBe(true)
    })

    it("should detect no progress", () => {
      const tracker = new TeamProgressTracker({
        circuitBreaker: {
          maxConsecutiveFailures: 3,
          maxNoProgressRounds: 2,
          cooldownMs: 60000,
        },
      })

      // Multiple rounds with no changes
      tracker.checkProgress()
      tracker.checkProgress()
      tracker.checkProgress()

      const noProgressRounds = tracker.getConsecutiveNoProgressRounds()
      expect(noProgressRounds).toBeGreaterThan(0)
    })
  })

  describe("circuit breaker", () => {
    it("should trigger circuit breaker on no progress", () => {
      const tracker = new TeamProgressTracker({
        circuitBreaker: {
          maxConsecutiveFailures: 3,
          maxNoProgressRounds: 2,
          cooldownMs: 60000,
        },
      })

      // Simulate no progress rounds
      for (let i = 0; i < 3; i++) {
        tracker.checkProgress()
      }

      expect(tracker.shouldCircuitBreak()).toBe(true)
      expect(tracker.getCircuitBreakerReason()).toContain("No progress")
    })

    it("should trigger circuit breaker on consecutive failures", () => {
      const tracker = new TeamProgressTracker({
        circuitBreaker: {
          maxConsecutiveFailures: 3,
          maxNoProgressRounds: 2,
          cooldownMs: 60000,
        },
      })

      // Simulate consecutive test failures
      for (let i = 0; i < 4; i++) {
        tracker.recordTestResult(false)
        tracker.checkProgress()
      }

      expect(tracker.shouldCircuitBreak()).toBe(true)
    })

    it("should not trigger circuit breaker when progressing", () => {
      const tracker = new TeamProgressTracker({
        circuitBreaker: {
          maxConsecutiveFailures: 3,
          maxNoProgressRounds: 2,
          cooldownMs: 60000,
        },
      })

      // Round with progress
      tracker.recordCodeChange(1)
      tracker.checkProgress()

      expect(tracker.shouldCircuitBreak()).toBe(false)
      expect(tracker.getCircuitBreakerReason()).toBeNull()
    })
  })

  describe("reset", () => {
    it("should reset all stats", () => {
      const tracker = new TeamProgressTracker({
        circuitBreaker: {
          maxConsecutiveFailures: 3,
          maxNoProgressRounds: 2,
          cooldownMs: 60000,
        },
      })

      tracker.recordCodeChange(10)
      tracker.checkProgress()
      tracker.reset()

      const stats = tracker.getStats()
      expect(stats.totalRounds).toBe(0)
      expect(stats.codeChanges).toBe(0)
    })
  })

  describe("ProgressPersistence Integration", () => {
    it("should save progress through tracker", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "progress-test-"))

      const tracker = new TeamProgressTracker({
        circuitBreaker: {
          maxConsecutiveFailures: 3,
          maxNoProgressRounds: 3,
          cooldownMs: 1000,
        },
      })

      tracker.enablePersistence("test-team", "Test Objective", {
        outputPath: path.join(tempDir, "PROGRESS.md"),
        format: "markdown",
      })

      tracker.recordCodeChange(3)
      tracker.recordTestResult(true)
      tracker.checkProgress()

      await tracker.saveProgress()

      const content = fs.readFileSync(path.join(tempDir, "PROGRESS.md"), "utf-8")
      expect(content).toContain("Test Objective")
      expect(content).toContain("3")

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true })
    })
  })
})
