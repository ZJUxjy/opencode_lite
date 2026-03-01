/**
 * ProgressPersistence Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import {
  ProgressPersistence,
  createProgressPersistence,
  type ProgressReport,
} from "../progress-persistence.js"

describe("ProgressPersistence", () => {
  let tempDir: string
  let persistence: ProgressPersistence

  beforeEach(() => {
    // Create a temporary directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "progress-test-"))
    persistence = new ProgressPersistence({
      outputPath: path.join(tempDir, "PROGRESS.md"),
      autoSaveInterval: 1000, // 1 second for faster tests
    })
  })

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  const createMockReport = (): ProgressReport => ({
    teamId: "team-123",
    timestamp: Date.now(),
    status: "in-progress",
    currentPhase: "Implementation",
    overallProgress: 50,
    summary: {
      objective: "Implement feature X",
      filesChanged: 5,
      iterationsCompleted: 3,
      totalIterations: 6,
    },
    current: {
      activeAgent: "agent-1",
      role: "worker",
      task: "Writing tests",
      startedAt: Date.now() - 60000,
    },
    issues: {
      p0: [],
      p1: [],
      p2: [],
      p3: [],
    },
    timeline: [
      {
        time: Date.now() - 3600000,
        event: "Started",
        agent: "agent-1",
        details: "Initial setup",
      },
      {
        time: Date.now() - 1800000,
        event: "Progress",
        agent: "agent-2",
        details: "Completed phase 1",
      },
    ],
    nextSteps: ["Complete tests", "Run validation"],
  })

  describe("saveProgress", () => {
    it("should create markdown file", async () => {
      const report = createMockReport()
      await persistence.saveProgress(report)

      const markdownPath = path.join(tempDir, "PROGRESS.md")
      expect(fs.existsSync(markdownPath)).toBe(true)

      const content = fs.readFileSync(markdownPath, "utf-8")
      expect(content).toContain("# Progress Report: Implement feature X")
      expect(content).toContain("team-123")
      expect(content).toContain("Implement feature X")
    })

    it("should contain teamId, objective, and progress in markdown", async () => {
      const report = createMockReport()
      await persistence.saveProgress(report)

      const markdownPath = path.join(tempDir, "PROGRESS.md")
      const content = fs.readFileSync(markdownPath, "utf-8")

      expect(content).toContain("team-123")
      expect(content).toContain("Implement feature X")
      expect(content).toContain("50%")
      expect(content).toContain("50")
    })

    it("should create JSON file when format is json", async () => {
      const jsonPersistence = new ProgressPersistence({
        outputPath: path.join(tempDir, "PROGRESS.json"),
        format: "json",
      })

      const report = createMockReport()
      await jsonPersistence.saveProgress(report)

      const jsonPath = path.join(tempDir, "PROGRESS.json")
      expect(fs.existsSync(jsonPath)).toBe(true)

      const content = fs.readFileSync(jsonPath, "utf-8")
      const parsed = JSON.parse(content)
      expect(parsed.teamId).toBe("team-123")
      expect(parsed.summary.objective).toBe("Implement feature X")
    })

    it("should create both markdown and JSON files when format is both", async () => {
      const bothPersistence = new ProgressPersistence({
        outputPath: path.join(tempDir, "PROGRESS.md"),
        format: "both",
      })

      const report = createMockReport()
      await bothPersistence.saveProgress(report)

      const markdownPath = path.join(tempDir, "PROGRESS.md")
      const jsonPath = path.join(tempDir, "PROGRESS.json")

      expect(fs.existsSync(markdownPath)).toBe(true)
      expect(fs.existsSync(jsonPath)).toBe(true)

      const markdownContent = fs.readFileSync(markdownPath, "utf-8")
      expect(markdownContent).toContain("# Progress Report: Implement feature X")

      const jsonContent = fs.readFileSync(jsonPath, "utf-8")
      const parsed = JSON.parse(jsonContent)
      expect(parsed.teamId).toBe("team-123")
    })

    it("should create directories recursively if they don't exist", async () => {
      const nestedPersistence = new ProgressPersistence({
        outputPath: path.join(tempDir, "nested", "deep", "PROGRESS.md"),
      })

      const report = createMockReport()
      await nestedPersistence.saveProgress(report)

      const markdownPath = path.join(tempDir, "nested", "deep", "PROGRESS.md")
      expect(fs.existsSync(markdownPath)).toBe(true)
    })
  })

  describe("shouldAutoSave", () => {
    it("should return true after interval has passed", async () => {
      const shortIntervalPersistence = new ProgressPersistence({
        outputPath: path.join(tempDir, "PROGRESS.md"),
        autoSaveInterval: 50, // 50ms for fast test
      })

      const report = createMockReport()
      await shortIntervalPersistence.saveProgress(report)

      // Immediately after save, should not auto-save
      expect(shortIntervalPersistence.shouldAutoSave()).toBe(false)

      // Wait for interval to pass
      await new Promise(resolve => setTimeout(resolve, 100))

      // Now should auto-save
      expect(shortIntervalPersistence.shouldAutoSave()).toBe(true)
    })

    it("should return false before interval has passed", async () => {
      const longIntervalPersistence = new ProgressPersistence({
        outputPath: path.join(tempDir, "PROGRESS.md"),
        autoSaveInterval: 60000, // 1 minute
      })

      const report = createMockReport()
      await longIntervalPersistence.saveProgress(report)

      // Immediately after save, should not auto-save
      expect(longIntervalPersistence.shouldAutoSave()).toBe(false)
    })
  })

  describe("markdown format", () => {
    it("should include status with emoji for in-progress", async () => {
      const report = createMockReport()
      report.status = "in-progress"
      await persistence.saveProgress(report)

      const markdownPath = path.join(tempDir, "PROGRESS.md")
      const content = fs.readFileSync(markdownPath, "utf-8")
      expect(content).toContain("🔄")
      expect(content).toContain("In-progress")
    })

    it("should include status with emoji for completed", async () => {
      const report = createMockReport()
      report.status = "completed"
      await persistence.saveProgress(report)

      const markdownPath = path.join(tempDir, "PROGRESS.md")
      const content = fs.readFileSync(markdownPath, "utf-8")
      expect(content).toContain("✅")
      expect(content).toContain("Completed")
    })

    it("should include status with emoji for failed", async () => {
      const report = createMockReport()
      report.status = "failed"
      await persistence.saveProgress(report)

      const markdownPath = path.join(tempDir, "PROGRESS.md")
      const content = fs.readFileSync(markdownPath, "utf-8")
      expect(content).toContain("❌")
      expect(content).toContain("Failed")
    })

    it("should include status with emoji for paused", async () => {
      const report = createMockReport()
      report.status = "paused"
      await persistence.saveProgress(report)

      const markdownPath = path.join(tempDir, "PROGRESS.md")
      const content = fs.readFileSync(markdownPath, "utf-8")
      expect(content).toContain("⏸️")
      expect(content).toContain("Paused")
    })

    it("should include progress bar", async () => {
      const report = createMockReport()
      report.overallProgress = 75
      await persistence.saveProgress(report)

      const markdownPath = path.join(tempDir, "PROGRESS.md")
      const content = fs.readFileSync(markdownPath, "utf-8")
      expect(content).toContain("[███████░░░]")
      expect(content).toContain("75%")
    })

    it("should include summary section", async () => {
      const report = createMockReport()
      await persistence.saveProgress(report)

      const markdownPath = path.join(tempDir, "PROGRESS.md")
      const content = fs.readFileSync(markdownPath, "utf-8")
      expect(content).toContain("## Summary")
      expect(content).toContain("**Objective:** Implement feature X")
      expect(content).toContain("**Files Changed:** 5")
      expect(content).toContain("**Iterations:** 3 / 6")
    })

    it("should include current activity section", async () => {
      const report = createMockReport()
      await persistence.saveProgress(report)

      const markdownPath = path.join(tempDir, "PROGRESS.md")
      const content = fs.readFileSync(markdownPath, "utf-8")
      expect(content).toContain("## Current Activity")
      expect(content).toContain("**Active Agent:** agent-1")
      expect(content).toContain("**Role:** worker")
      expect(content).toContain("**Task:** Writing tests")
    })

    it("should include P0 and P1 issues when present", async () => {
      const report = createMockReport()
      report.issues.p0 = ["Critical bug in auth", "Memory leak detected"]
      report.issues.p1 = ["Performance issue"]
      await persistence.saveProgress(report)

      const markdownPath = path.join(tempDir, "PROGRESS.md")
      const content = fs.readFileSync(markdownPath, "utf-8")
      expect(content).toContain("## Active Issues")
      expect(content).toContain("### P0 (Critical)")
      expect(content).toContain("- [ ] Critical bug in auth")
      expect(content).toContain("- [ ] Memory leak detected")
      expect(content).toContain("### P1 (High)")
      expect(content).toContain("- [ ] Performance issue")
    })

    it("should not include active issues section when no P0/P1 issues", async () => {
      const report = createMockReport()
      // No P0 or P1 issues
      report.issues.p2 = ["Minor style issue"]
      report.issues.p3 = ["Documentation update needed"]
      await persistence.saveProgress(report)

      const markdownPath = path.join(tempDir, "PROGRESS.md")
      const content = fs.readFileSync(markdownPath, "utf-8")
      expect(content).not.toContain("## Active Issues")
      expect(content).not.toContain("P0")
      expect(content).not.toContain("P1")
    })

    it("should include timeline section", async () => {
      const report = createMockReport()
      await persistence.saveProgress(report)

      const markdownPath = path.join(tempDir, "PROGRESS.md")
      const content = fs.readFileSync(markdownPath, "utf-8")
      expect(content).toContain("## Timeline")
      expect(content).toContain("Started")
      expect(content).toContain("Progress")
      expect(content).toContain("[agent-1]")
      expect(content).toContain("[agent-2]")
    })

    it("should include next steps section", async () => {
      const report = createMockReport()
      await persistence.saveProgress(report)

      const markdownPath = path.join(tempDir, "PROGRESS.md")
      const content = fs.readFileSync(markdownPath, "utf-8")
      expect(content).toContain("## Next Steps")
      expect(content).toContain("- [ ] Complete tests")
      expect(content).toContain("- [ ] Run validation")
    })

    it("should include team ID in footer", async () => {
      const report = createMockReport()
      await persistence.saveProgress(report)

      const markdownPath = path.join(tempDir, "PROGRESS.md")
      const content = fs.readFileSync(markdownPath, "utf-8")
      expect(content).toContain("*Generated by Agent Teams - Team ID: team-123*")
    })
  })

  describe("createProgressPersistence factory", () => {
    it("should create ProgressPersistence instance with default config", () => {
      const instance = createProgressPersistence()
      expect(instance).toBeInstanceOf(ProgressPersistence)
    })

    it("should create ProgressPersistence instance with custom config", () => {
      const instance = createProgressPersistence({
        outputPath: "/custom/path/PROGRESS.md",
        format: "json",
        autoSaveInterval: 30000,
      })
      expect(instance).toBeInstanceOf(ProgressPersistence)
    })
  })
})
