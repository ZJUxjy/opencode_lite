import { describe, it, expect } from "vitest"
import { ToolRegistry } from "../index.js"

describe("ToolRegistry", () => {
  describe("default mode (main agent)", () => {
    it("should include all tools including subagent tools", () => {
      const registry = new ToolRegistry()
      const tools = registry.getDefinitions()

      // Should include subagent tools
      expect(tools.find((t) => t.name === "task")).toBeDefined()
      expect(tools.find((t) => t.name === "get_subagent_result")).toBeDefined()
      expect(tools.find((t) => t.name === "parallel_explore")).toBeDefined()
      expect(tools.find((t) => t.name === "enter_plan_mode")).toBeDefined()
      expect(tools.find((t) => t.name === "exit_plan_mode")).toBeDefined()

      // Should include regular tools
      expect(tools.find((t) => t.name === "read")).toBeDefined()
      expect(tools.find((t) => t.name === "write")).toBeDefined()
      expect(tools.find((t) => t.name === "bash")).toBeDefined()
    })
  })

  describe("subagent mode", () => {
    it("should exclude subagent tools to prevent recursion", () => {
      const registry = new ToolRegistry({ isSubagent: true })
      const tools = registry.getDefinitions()

      // Should NOT include subagent tools
      expect(tools.find((t) => t.name === "task")).toBeUndefined()
      expect(tools.find((t) => t.name === "get_subagent_result")).toBeUndefined()
      expect(tools.find((t) => t.name === "parallel_explore")).toBeUndefined()
      expect(tools.find((t) => t.name === "enter_plan_mode")).toBeUndefined()
      expect(tools.find((t) => t.name === "exit_plan_mode")).toBeUndefined()

      // Should still include regular tools
      expect(tools.find((t) => t.name === "read")).toBeDefined()
      expect(tools.find((t) => t.name === "write")).toBeDefined()
      expect(tools.find((t) => t.name === "bash")).toBeDefined()
      expect(tools.find((t) => t.name === "grep")).toBeDefined()
      expect(tools.find((t) => t.name === "glob")).toBeDefined()
    })

    it("should have fewer tools than main agent", () => {
      const mainRegistry = new ToolRegistry()
      const subagentRegistry = new ToolRegistry({ isSubagent: true })

      const mainTools = mainRegistry.getDefinitions()
      const subagentTools = subagentRegistry.getDefinitions()

      expect(subagentTools.length).toBeLessThan(mainTools.length)
      expect(mainTools.length - subagentTools.length).toBe(5) // 5 subagent tools removed
    })
  })
})
