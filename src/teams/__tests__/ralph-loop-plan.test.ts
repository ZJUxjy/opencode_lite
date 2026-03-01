import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import { RalphLoop, type PlanModeConfig } from "../index.js"

describe("RalphLoop Plan Mode Integration", () => {
  const testDir = path.resolve(process.cwd(), ".test-ralph-plan")

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

  describe("PlanModeConfig", () => {
    it("should define plan mode configuration", () => {
      const config: PlanModeConfig = {
        enabled: true,
        batchSize: 5,
        autoApprove: false,
      }
      expect(config.enabled).toBe(true)
      expect(config.batchSize).toBe(5)
    })

    it("should have planFirst disabled by default", () => {
      const loop = new RalphLoop(
        { run: async () => "done" } as any,
        null,
        { cwd: testDir, maxIterations: 0, cooldownMs: 0 }
      )

      const config = loop.getConfig()
      expect(config.planFirst).toBe(false)
    })

    it("should have default planBatchSize of 5", () => {
      const loop = new RalphLoop(
        { run: async () => "done" } as any,
        null,
        { cwd: testDir, maxIterations: 0, cooldownMs: 0 }
      )

      const config = loop.getConfig()
      expect(config.planBatchSize).toBe(5)
    })
  })

  describe("Plan Generation", () => {
    it("should generate plan before task execution when planFirst is enabled", async () => {
      fs.writeFileSync(path.join(testDir, "TASKS.md"), "- [ ] Implement feature X\n")

      const prompts: string[] = []

      const loop = new RalphLoop(
        {
          run: async (prompt: string) => {
            prompts.push(prompt)
            if (prompt.includes("Generate a plan")) {
              return "## Plan\n1. Step one\n2. Step two\n3. Step three"
            }
            return "done"
          }
        } as any,
        null,
        {
          cwd: testDir,
          maxIterations: 1,
          cooldownMs: 0,
          planFirst: true,
        }
      )

      await loop.run()

      const planPrompts = prompts.filter(p => p.includes("Generate a plan"))
      expect(planPrompts.length).toBeGreaterThan(0)
      expect(planPrompts[0]).toContain("Implement feature X")
    })

    it("should not generate plan when planFirst is disabled", async () => {
      fs.writeFileSync(path.join(testDir, "TASKS.md"), "- [ ] Test task\n")

      const prompts: string[] = []

      const loop = new RalphLoop(
        {
          run: async (prompt: string) => {
            prompts.push(prompt)
            return "done"
          }
        } as any,
        null,
        {
          cwd: testDir,
          maxIterations: 1,
          cooldownMs: 0,
          planFirst: false,
        }
      )

      await loop.run()

      const planPrompts = prompts.filter(p => p.includes("Generate a plan"))
      expect(planPrompts.length).toBe(0)
    })

    it("should save plan to file", async () => {
      fs.writeFileSync(path.join(testDir, "TASKS.md"), "- [ ] Test task\n")

      const loop = new RalphLoop(
        {
          run: async (prompt: string) => {
            if (prompt.includes("Generate a plan")) {
              return "## Plan\n1. Step one"
            }
            return "done"
          }
        } as any,
        null,
        {
          cwd: testDir,
          maxIterations: 1,
          cooldownMs: 0,
          planFirst: true,
        }
      )

      await loop.run()

      const planDir = path.join(testDir, ".agent-teams", "plans")
      expect(fs.existsSync(planDir)).toBe(true)

      const planFiles = fs.readdirSync(planDir)
      expect(planFiles.length).toBeGreaterThan(0)
    })

    it("should include plan in task prompt", async () => {
      fs.writeFileSync(path.join(testDir, "TASKS.md"), "- [ ] Build feature\n")

      const taskPrompts: string[] = []

      const loop = new RalphLoop(
        {
          run: async (prompt: string) => {
            if (prompt.includes("Generate a plan")) {
              return "## Plan\n1. Analyze\n2. Implement\n3. Test"
            }
            if (prompt.includes("Build feature")) {
              taskPrompts.push(prompt)
            }
            return "done"
          }
        } as any,
        null,
        {
          cwd: testDir,
          maxIterations: 1,
          cooldownMs: 0,
          planFirst: true,
        }
      )

      await loop.run()

      expect(taskPrompts[0]).toContain("## Plan")
      expect(taskPrompts[0]).toContain("Analyze")
    })
  })
})
