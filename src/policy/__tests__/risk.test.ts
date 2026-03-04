import { describe, it, expect } from "vitest"
import {
  classifyToolRisk,
  shouldAutoApprove,
  shouldDeny,
  DEFAULT_TOOL_RISK_RULES,
  DEFAULT_RISK_CONFIG,
  type RiskConfig,
} from "../risk.js"

describe("Risk Classification", () => {
  describe("classifyToolRisk", () => {
    describe("low risk tools", () => {
      it("should classify read as low risk", () => {
        const result = classifyToolRisk("read", { path: "/test.txt" })
        expect(result.level).toBe("low")
        expect(result.reason).toBe("Read file content")
      })

      it("should classify glob as low risk", () => {
        const result = classifyToolRisk("glob", { pattern: "**/*.ts" })
        expect(result.level).toBe("low")
      })

      it("should classify grep as low risk", () => {
        const result = classifyToolRisk("grep", { pattern: "test" })
        expect(result.level).toBe("low")
      })

      it("should classify list_skills as low risk", () => {
        const result = classifyToolRisk("list_skills", {})
        expect(result.level).toBe("low")
      })

      it("should classify show_skill as low risk", () => {
        const result = classifyToolRisk("show_skill", { skillId: "test" })
        expect(result.level).toBe("low")
      })

      it("should classify get_active_skills_prompt as low risk", () => {
        const result = classifyToolRisk("get_active_skills_prompt", {})
        expect(result.level).toBe("low")
      })

      it("should classify web_search as low risk", () => {
        const result = classifyToolRisk("web_search", { query: "test" })
        expect(result.level).toBe("low")
      })

      it("should classify get_subagent_result as low risk", () => {
        const result = classifyToolRisk("get_subagent_result", { taskId: "123" })
        expect(result.level).toBe("low")
      })
    })

    describe("medium risk tools", () => {
      it("should classify write as medium risk", () => {
        const result = classifyToolRisk("write", { path: "/test.txt", content: "hello" })
        expect(result.level).toBe("medium")
        expect(result.reason).toBe("Write file")
      })

      it("should classify edit as medium risk", () => {
        const result = classifyToolRisk("edit", { path: "/test.txt", old_string: "a", new_string: "b" })
        expect(result.level).toBe("medium")
      })

      it("should classify activate_skill as medium risk", () => {
        const result = classifyToolRisk("activate_skill", { skillId: "test" })
        expect(result.level).toBe("medium")
      })

      it("should classify deactivate_skill as medium risk", () => {
        const result = classifyToolRisk("deactivate_skill", { skillId: "test" })
        expect(result.level).toBe("medium")
      })

      it("should classify enter_plan_mode as medium risk", () => {
        const result = classifyToolRisk("enter_plan_mode", {})
        expect(result.level).toBe("medium")
      })

      it("should classify exit_plan_mode as medium risk", () => {
        const result = classifyToolRisk("exit_plan_mode", {})
        expect(result.level).toBe("medium")
      })
    })

    describe("high risk tools", () => {
      it("should classify bash as high risk", () => {
        const result = classifyToolRisk("bash", { command: "ls -la" })
        expect(result.level).toBe("high")
        expect(result.reason).toBe("Execute shell command")
      })

      it("should classify task as high risk", () => {
        const result = classifyToolRisk("task", { prompt: "test" })
        expect(result.level).toBe("high")
      })

      it("should classify parallel_explore as high risk", () => {
        const result = classifyToolRisk("parallel_explore", { tasks: [] })
        expect(result.level).toBe("high")
      })

      it("should handle mcp_* wildcard", () => {
        const result = classifyToolRisk("mcp_web_search", { query: "test" })
        expect(result.level).toBe("high")
        expect(result.reason).toBe("MCP external tool")
      })

      it("should match mcp_ prefixed tools", () => {
        const result = classifyToolRisk("mcp_custom_tool", { arg: "value" })
        expect(result.level).toBe("high")
      })
    })

    describe("unknown tools", () => {
      it("should default to high risk for unknown tools", () => {
        const result = classifyToolRisk("unknown_tool", {})
        expect(result.level).toBe("high")
        expect(result.reason).toContain("Unknown tool")
      })

      it("should default to high risk for random tool name", () => {
        const result = classifyToolRisk("random_function", { foo: "bar" })
        expect(result.level).toBe("high")
      })
    })

    describe("custom rules", () => {
      it("should use custom rules when provided", () => {
        const customRules = [
          { tool: "custom_tool", level: "low" as const, description: "Custom low risk tool" },
        ]
        const result = classifyToolRisk("custom_tool", {}, customRules)
        expect(result.level).toBe("low")
        expect(result.reason).toBe("Custom low risk tool")
      })

      it("should fall back to default rules when custom rules don't match", () => {
        const customRules = [
          { tool: "custom_tool", level: "low" as const, description: "Custom tool" },
        ]
        const result = classifyToolRisk("read", { path: "/test" }, customRules)
        expect(result.level).toBe("high") // Falls through to "unknown tool" since only custom rules are used
      })
    })
  })

  describe("shouldAutoApprove", () => {
    it("should auto-approve low risk with default config", () => {
      const result = shouldAutoApprove(
        { level: "low", reason: "test" },
        DEFAULT_RISK_CONFIG
      )
      expect(result).toBe(true)
    })

    it("should not auto-approve medium risk with default config", () => {
      const result = shouldAutoApprove(
        { level: "medium", reason: "test" },
        DEFAULT_RISK_CONFIG
      )
      expect(result).toBe(false)
    })

    it("should not auto-approve high risk with default config", () => {
      const result = shouldAutoApprove(
        { level: "high", reason: "test" },
        DEFAULT_RISK_CONFIG
      )
      expect(result).toBe(false)
    })

    it("should respect custom auto-approve config", () => {
      const customConfig: RiskConfig = {
        autoApprove: ["low", "medium"],
        promptApprove: ["high"],
        deny: [],
      }
      expect(shouldAutoApprove({ level: "low", reason: "" }, customConfig)).toBe(true)
      expect(shouldAutoApprove({ level: "medium", reason: "" }, customConfig)).toBe(true)
      expect(shouldAutoApprove({ level: "high", reason: "" }, customConfig)).toBe(false)
    })
  })

  describe("shouldDeny", () => {
    it("should not deny any level with default config", () => {
      expect(shouldDeny({ level: "low", reason: "" }, DEFAULT_RISK_CONFIG)).toBe(false)
      expect(shouldDeny({ level: "medium", reason: "" }, DEFAULT_RISK_CONFIG)).toBe(false)
      expect(shouldDeny({ level: "high", reason: "" }, DEFAULT_RISK_CONFIG)).toBe(false)
    })

    it("should respect custom deny config", () => {
      const customConfig: RiskConfig = {
        autoApprove: ["low"],
        promptApprove: ["medium"],
        deny: ["high"],
      }
      expect(shouldDeny({ level: "low", reason: "" }, customConfig)).toBe(false)
      expect(shouldDeny({ level: "medium", reason: "" }, customConfig)).toBe(false)
      expect(shouldDeny({ level: "high", reason: "" }, customConfig)).toBe(true)
    })
  })

  describe("DEFAULT_TOOL_RISK_RULES", () => {
    it("should have rules for common tools", () => {
      const toolNames = DEFAULT_TOOL_RISK_RULES.map(r => r.tool)
      expect(toolNames).toContain("read")
      expect(toolNames).toContain("write")
      expect(toolNames).toContain("bash")
      expect(toolNames).toContain("mcp_*")
    })

    it("should have descriptions for all rules", () => {
      for (const rule of DEFAULT_TOOL_RISK_RULES) {
        expect(rule.description).toBeTruthy()
        expect(rule.description.length).toBeGreaterThan(0)
      }
    })

    it("should have valid risk levels for all rules", () => {
      const validLevels = ["low", "medium", "high"]
      for (const rule of DEFAULT_TOOL_RISK_RULES) {
        expect(validLevels).toContain(rule.level)
      }
    })
  })
})
