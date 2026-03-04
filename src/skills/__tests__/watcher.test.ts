/**
 * Skills System - Watcher Tests
 *
 * Tests for the file watcher functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { SkillWatcher } from "../watcher.js"
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

describe("SkillWatcher", () => {
  let testDir: string
  let watcher: SkillWatcher

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "skill-watcher-test-"))
    mkdirSync(join(testDir, "skills", "test-skill"), { recursive: true })
    writeFileSync(
      join(testDir, "skills", "test-skill", "SKILL.md"),
      "# Test Skill"
    )
  })

  afterEach(() => {
    watcher?.stop()
    rmSync(testDir, { recursive: true, force: true })
  })

  it("should emit skill-changed event when file is modified", async () => {
    watcher = new SkillWatcher({
      paths: [join(testDir, "skills")],
      debounceMs: 100,
    })

    const changedPromise = new Promise<string>((resolve) => {
      watcher.on("skill-changed", (skillId) => {
        resolve(skillId)
      })
    })

    watcher.start()

    // Modify file after short delay
    await new Promise((resolve) => setTimeout(resolve, 200))
    writeFileSync(
      join(testDir, "skills", "test-skill", "SKILL.md"),
      "# Test Skill Modified"
    )

    const skillId = await changedPromise
    expect(skillId).toBe("test-skill")
  })

  it("should debounce multiple rapid changes", async () => {
    const changedSpy = vi.fn()

    watcher = new SkillWatcher({
      paths: [join(testDir, "skills")],
      debounceMs: 300,
    })

    watcher.on("skill-changed", changedSpy)
    watcher.start()

    // Rapid changes
    await new Promise((resolve) => setTimeout(resolve, 100))
    writeFileSync(
      join(testDir, "skills", "test-skill", "SKILL.md"),
      "# Change 1"
    )
    writeFileSync(
      join(testDir, "skills", "test-skill", "SKILL.md"),
      "# Change 2"
    )
    writeFileSync(
      join(testDir, "skills", "test-skill", "SKILL.md"),
      "# Change 3"
    )

    // Wait for debounce
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Should only fire once due to debounce
    expect(changedSpy).toHaveBeenCalledTimes(1)
  })

  it("should not emit events for non-skill files", async () => {
    const changedSpy = vi.fn()

    watcher = new SkillWatcher({
      paths: [join(testDir, "skills")],
      debounceMs: 100,
    })

    watcher.on("skill-changed", changedSpy)
    watcher.start()

    // Create a non-skill file
    await new Promise((resolve) => setTimeout(resolve, 100))
    writeFileSync(
      join(testDir, "skills", "test-skill", "README.md"),
      "# README"
    )

    // Wait
    await new Promise((resolve) => setTimeout(resolve, 300))

    // Should not fire for README.md
    expect(changedSpy).not.toHaveBeenCalled()
  })

  it("should add and remove paths dynamically", () => {
    watcher = new SkillWatcher({
      paths: [],
      debounceMs: 100,
    })

    watcher.start()

    // Initially no watchers
    expect(watcher["watchers"].size).toBe(0)

    // Add a path
    watcher.addPath(join(testDir, "skills"))
    expect(watcher["watchers"].size).toBe(1)

    // Remove the path
    watcher.removePath(join(testDir, "skills"))
    expect(watcher["watchers"].size).toBe(0)
  })

  it("should stop all watchers", () => {
    watcher = new SkillWatcher({
      paths: [join(testDir, "skills")],
      debounceMs: 100,
    })

    watcher.start()
    expect(watcher["isWatching"]).toBe(true)
    expect(watcher["watchers"].size).toBe(1)

    watcher.stop()
    expect(watcher["isWatching"]).toBe(false)
    expect(watcher["watchers"].size).toBe(0)
  })

  it("should not start multiple times", () => {
    watcher = new SkillWatcher({
      paths: [join(testDir, "skills")],
      debounceMs: 100,
    })

    watcher.start()
    expect(watcher["watchers"].size).toBe(1)

    // Starting again should not create duplicate watchers
    watcher.start()
    expect(watcher["watchers"].size).toBe(1)
  })
})
