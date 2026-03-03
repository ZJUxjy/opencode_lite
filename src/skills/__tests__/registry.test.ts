import { describe, it, expect, beforeEach } from "vitest"
import { SkillRegistry } from "../registry.js"
import type { Skill, SkillMetadata } from "../types.js"

describe("SkillRegistry", () => {
  let registry: SkillRegistry

  beforeEach(() => {
    registry = new SkillRegistry()
  })

  const createMockSkill = (id: string, activation: SkillMetadata["activation"] = "manual"): Skill => ({
    metadata: {
      id,
      name: `Skill ${id}`,
      description: `Description for ${id}`,
      version: "1.0.0",
      activation,
      tags: [],
    },
    content: `# ${id}\n\nContent`,
    basePath: `/skills/${id}`,
    isActive: false,
  })

  describe("register", () => {
    it("should register a skill", () => {
      const skill = createMockSkill("test-skill")
      registry.register(skill)

      expect(registry.get("test-skill")).toBeDefined()
      expect(registry.get("test-skill")?.metadata.name).toBe("Skill test-skill")
    })

    it("should auto-activate skills with 'always' activation", () => {
      const skill = createMockSkill("always-skill", "always")
      registry.register(skill)

      const retrieved = registry.get("always-skill")
      expect(retrieved?.isActive).toBe(true)
    })

    it("should throw on ID conflict from different paths", () => {
      const skill1 = createMockSkill("conflict-skill")
      const skill2 = { ...createMockSkill("conflict-skill"), basePath: "/different/path" }

      registry.register(skill1)
      expect(() => registry.register(skill2)).toThrow(/conflict/)
    })
  })

  describe("activate", () => {
    it("should activate a skill", () => {
      const skill = createMockSkill("activatable")
      registry.register(skill)

      const result = registry.activate("activatable")

      expect(result.success).toBe(true)
      expect(result.skill?.isActive).toBe(true)
      expect(result.promptInjection).toContain("Skill activatable")
    })

    it("should fail for non-existent skill", () => {
      const result = registry.activate("non-existent")

      expect(result.success).toBe(false)
      expect(result.error).toContain("not found")
    })

    it("should handle dependencies", () => {
      const depSkill = createMockSkill("dependency")
      const mainSkill = {
        ...createMockSkill("main"),
        metadata: {
          ...createMockSkill("main").metadata,
          dependencies: ["dependency"],
        },
      }

      registry.register(depSkill)
      registry.register(mainSkill)

      const result = registry.activate("main")

      expect(result.success).toBe(true)
      expect(registry.get("dependency")?.isActive).toBe(true)
    })

    it("should fail when dependency is missing", () => {
      const skill = {
        ...createMockSkill("orphan"),
        metadata: {
          ...createMockSkill("orphan").metadata,
          dependencies: ["missing-dep"],
        },
      }

      registry.register(skill)
      const result = registry.activate("orphan")

      expect(result.success).toBe(false)
      expect(result.error).toContain("Missing dependency")
    })

    it("should fail on conflict", () => {
      const skill1 = createMockSkill("conflict-test", "always")
      const skill2 = {
        ...createMockSkill("conflict-other"),
        metadata: {
          ...createMockSkill("conflict-other").metadata,
          conflicts: ["conflict-test"],
        },
      }

      registry.register(skill1)
      registry.register(skill2)

      const result = registry.activate("conflict-other")

      expect(result.success).toBe(false)
      expect(result.error).toContain("Conflicts")
    })
  })

  describe("deactivate", () => {
    it("should deactivate a skill", () => {
      const skill = createMockSkill("deactivatable", "always")
      registry.register(skill)

      expect(registry.get("deactivatable")?.isActive).toBe(true)

      const result = registry.deactivate("deactivatable")

      expect(result).toBe(true)
      expect(registry.get("deactivatable")?.isActive).toBe(false)
    })

    it("should prevent deactivation when there are dependents", () => {
      const depSkill = createMockSkill("base-dep", "always")
      const mainSkill = {
        ...createMockSkill("main-dep"),
        metadata: {
          ...createMockSkill("main-dep").metadata,
          dependencies: ["base-dep"],
        },
      }

      registry.register(depSkill)
      registry.register(mainSkill)
      registry.activate("main-dep")

      const result = registry.deactivate("base-dep")

      expect(result).toBe(false)
    })
  })

  describe("getActivePromptInjection", () => {
    it("should combine all active skills", () => {
      const skill1 = createMockSkill("active-1", "always")
      const skill2 = createMockSkill("active-2", "always")

      registry.register(skill1)
      registry.register(skill2)

      const injection = registry.getActivePromptInjection()

      expect(injection).toContain("# Active Skills")
      expect(injection).toContain("Skill active-1")
      expect(injection).toContain("Skill active-2")
    })

    it("should return empty string when no skills active", () => {
      const injection = registry.getActivePromptInjection()
      expect(injection).toBe("")
    })
  })

  describe("getSummaries", () => {
    it("should return all skills as summaries", () => {
      registry.register(createMockSkill("skill-a"))
      registry.register(createMockSkill("skill-b", "always"))

      const summaries = registry.getSummaries()

      expect(summaries.length).toBe(2)
      expect(summaries[0].id).toBeDefined()
      expect(summaries[0].name).toBeDefined()
      expect(summaries[0].isActive).toBeDefined()
    })
  })
})
