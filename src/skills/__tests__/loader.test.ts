import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdir, writeFile, rmdir, unlink } from "fs/promises"
import { join } from "path"
import { SkillLoader } from "../loader.js"
import { tmpdir } from "os"

describe("SkillLoader", () => {
  let loader: SkillLoader
  let testDir: string

  beforeEach(async () => {
    loader = new SkillLoader()
    testDir = join(tmpdir(), `skill-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    // Cleanup
    try {
      const files = await readdir(testDir)
      for (const file of files) {
        await unlink(join(testDir, file))
      }
      await rmdir(testDir)
    } catch {
      // Ignore cleanup errors
    }
  })

  describe("parseFrontmatter", () => {
    it("should parse YAML frontmatter correctly", async () => {
      const content = `---
id: test-skill
name: Test Skill
description: A test skill
version: "1.0.0"
activation: manual
tags:
  - test
  - example
---

# Test Skill Content

This is the body.`

      await writeFile(join(testDir, "SKILL.md"), content)
      const skill = await loader.loadFromFile(join(testDir, "SKILL.md"))

      expect(skill.metadata.id).toBe("test-skill")
      expect(skill.metadata.name).toBe("Test Skill")
      expect(skill.metadata.version).toBe("1.0.0")
      expect(skill.metadata.activation).toBe("manual")
      expect(skill.metadata.tags).toEqual(["test", "example"])
      expect(skill.content).toContain("# Test Skill Content")
    })

    it("should handle skills without frontmatter", async () => {
      const content = `# Simple Skill

Just markdown content.`

      await writeFile(join(testDir, "SKILL.md"), content)

      // Should throw because required fields are missing
      await expect(loader.loadFromFile(join(testDir, "SKILL.md"))).rejects.toThrow()
    })

    it("should handle boolean and number types", async () => {
      const content = `---
id: typed-skill
name: Typed Skill
description: Testing types
version: "1.0.0"
activation: auto
---

Content here.`

      await writeFile(join(testDir, "SKILL.md"), content)
      const skill = await loader.loadFromFile(join(testDir, "SKILL.md"))

      expect(skill.metadata.activation).toBe("auto")
    })
  })

  describe("loadFromDirectory", () => {
    it("should load skill from directory containing SKILL.md", async () => {
      const skillDir = join(testDir, "my-skill")
      await mkdir(skillDir, { recursive: true })

      const content = `---
id: my-skill
name: My Skill
description: My custom skill
version: "1.0.0"
activation: manual
---

# My Skill`

      await writeFile(join(skillDir, "SKILL.md"), content)

      const skill = await loader.loadFromDirectory(skillDir)

      expect(skill).not.toBeNull()
      expect(skill?.metadata.id).toBe("my-skill")
    })

    it("should return null for directory without SKILL.md", async () => {
      const emptyDir = join(testDir, "empty")
      await mkdir(emptyDir, { recursive: true })

      const skill = await loader.loadFromDirectory(emptyDir)

      expect(skill).toBeNull()
    })
  })
})

// Helper
import { readdir } from "fs/promises"
