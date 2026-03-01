import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import {
  ThinkingBudgetManager,
  prependThinkingPrompt,
  DEFAULT_THINKING_CONFIG,
  THINKING_PROMPT_TEMPLATE,
  type ThinkingBudgetConfig,
} from "../index.js"

describe("ThinkingBudgetManager", () => {
  const testDir = path.resolve(process.cwd(), ".test-thinking")

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

  describe("constructor", () => {
    it("should use default config", () => {
      const manager = new ThinkingBudgetManager()
      const config = manager.getConfig()

      expect(config.enabled).toBe(DEFAULT_THINKING_CONFIG.enabled)
      expect(config.maxThinkingTokens).toBe(DEFAULT_THINKING_CONFIG.maxThinkingTokens)
      expect(config.outputThinkingProcess).toBe(DEFAULT_THINKING_CONFIG.outputThinkingProcess)
    })

    it("should merge custom config", () => {
      const manager = new ThinkingBudgetManager({
        maxThinkingTokens: 20000,
        enabledRoles: ["planner"],
      })
      const config = manager.getConfig()

      expect(config.maxThinkingTokens).toBe(20000)
      expect(config.enabledRoles).toEqual(["planner"])
    })
  })

  describe("isEnabledForRole", () => {
    it("should return true for enabled roles", () => {
      const manager = new ThinkingBudgetManager()

      expect(manager.isEnabledForRole("planner")).toBe(true)
      expect(manager.isEnabledForRole("leader")).toBe(true)
      expect(manager.isEnabledForRole("reviewer")).toBe(true)
    })

    it("should return false for disabled roles", () => {
      const manager = new ThinkingBudgetManager()

      expect(manager.isEnabledForRole("worker")).toBe(false)
      expect(manager.isEnabledForRole("executor")).toBe(false)
    })

    it("should return false when disabled", () => {
      const manager = new ThinkingBudgetManager({ enabled: false })

      expect(manager.isEnabledForRole("planner")).toBe(false)
    })
  })

  describe("getThinkingPrompt", () => {
    it("should return prompt for enabled roles", () => {
      const manager = new ThinkingBudgetManager()
      const prompt = manager.getThinkingPrompt("planner")

      expect(prompt).toContain("Thinking Process")
      expect(prompt).toContain("UNDERSTANDING")
    })

    it("should return empty string for disabled roles", () => {
      const manager = new ThinkingBudgetManager()
      const prompt = manager.getThinkingPrompt("worker")

      expect(prompt).toBe("")
    })
  })

  describe("parseThinkingArtifact", () => {
    it("should parse thinking block from response", () => {
      const manager = new ThinkingBudgetManager()
      const response = `Here is my thinking:

\`\`\`thinking
UNDERSTANDING:
Need to implement a feature

ANALYSIS:
- Approach 1: Use pattern A
- Approach 2: Use pattern B

PLAN:
1. Step one
2. Step two

CONSIDERATIONS:
- Edge case X
- Performance Y

CONCLUSION:
Will use approach 1
\`\`\`

Now I will implement it.`

      const artifact = manager.parseThinkingArtifact(response, "task-1", "agent-1", "planner")

      expect(artifact).not.toBeNull()
      expect(artifact?.taskId).toBe("task-1")
      expect(artifact?.agentId).toBe("agent-1")
      expect(artifact?.role).toBe("planner")
      expect(artifact?.analysisSteps).toHaveLength(2)
      expect(artifact?.considerations).toHaveLength(2)
      expect(artifact?.conclusion).toContain("approach 1")
    })

    it("should return null for response without thinking block", () => {
      const manager = new ThinkingBudgetManager()
      const response = "Just a regular response without thinking"

      const artifact = manager.parseThinkingArtifact(response, "task-1", "agent-1", "planner")

      expect(artifact).toBeNull()
    })
  })

  describe("hasThinkingBlock", () => {
    it("should return true for response with thinking block", () => {
      const manager = new ThinkingBudgetManager()
      const response = "```thinking\nSome thinking\n```"

      expect(manager.hasThinkingBlock(response)).toBe(true)
    })

    it("should return false for response without thinking block", () => {
      const manager = new ThinkingBudgetManager()
      const response = "Just regular text"

      expect(manager.hasThinkingBlock(response)).toBe(false)
    })
  })

  describe("removeThinkingBlock", () => {
    it("should remove thinking block from response", () => {
      const manager = new ThinkingBudgetManager()
      const response = "```thinking\nSecret thinking\n```\n\nActual response"

      const cleaned = manager.removeThinkingBlock(response)

      expect(cleaned).toBe("Actual response")
      expect(cleaned).not.toContain("Secret thinking")
    })
  })

  describe("estimateThinkingTokens", () => {
    it("should estimate tokens for thinking block", () => {
      const manager = new ThinkingBudgetManager()
      const response = "```thinking\nThis is some thinking content\n```"

      const tokens = manager.estimateThinkingTokens(response)

      expect(tokens).toBeGreaterThan(0)
    })

    it("should return 0 for response without thinking block", () => {
      const manager = new ThinkingBudgetManager()
      const response = "No thinking here"

      const tokens = manager.estimateThinkingTokens(response)

      expect(tokens).toBe(0)
    })
  })

  describe("saveThinkingArtifact", () => {
    it("should save thinking artifact to file", () => {
      const manager = new ThinkingBudgetManager({ cwd: testDir })
      const artifact = {
        taskId: "task-1",
        agentId: "agent-1",
        role: "planner" as const,
        thinkingProcess: "My thinking",
        analysisSteps: ["Step 1"],
        considerations: ["Consider 1"],
        conclusion: "Done",
        createdAt: Date.now(),
        tokenUsage: 100,
      }

      const filePath = manager.saveThinkingArtifact(artifact)

      expect(fs.existsSync(filePath)).toBe(true)
      const content = fs.readFileSync(filePath, "utf-8")
      expect(content).toContain("task-1")
      expect(content).toContain("My thinking")
    })
  })

  describe("updateConfig", () => {
    it("should update config", () => {
      const manager = new ThinkingBudgetManager()
      manager.updateConfig({ maxThinkingTokens: 50000 })

      const config = manager.getConfig()
      expect(config.maxThinkingTokens).toBe(50000)
    })
  })
})

describe("prependThinkingPrompt", () => {
  it("should prepend thinking prompt for enabled roles", () => {
    const result = prependThinkingPrompt("Do something", "planner")

    expect(result).toContain("Thinking Process")
    expect(result).toContain("Do something")
  })

  it("should not prepend for disabled roles", () => {
    const result = prependThinkingPrompt("Do something", "worker")

    expect(result).toBe("Do something")
    expect(result).not.toContain("Thinking Process")
  })
})

describe("DEFAULT_THINKING_CONFIG", () => {
  it("should have correct defaults", () => {
    expect(DEFAULT_THINKING_CONFIG.enabled).toBe(true)
    expect(DEFAULT_THINKING_CONFIG.maxThinkingTokens).toBe(10000)
    expect(DEFAULT_THINKING_CONFIG.outputThinkingProcess).toBe(true)
    expect(DEFAULT_THINKING_CONFIG.enabledRoles).toContain("planner")
    expect(DEFAULT_THINKING_CONFIG.enabledRoles).toContain("leader")
    expect(DEFAULT_THINKING_CONFIG.enabledRoles).toContain("reviewer")
  })
})

describe("THINKING_PROMPT_TEMPLATE", () => {
  it("should contain required sections", () => {
    expect(THINKING_PROMPT_TEMPLATE).toContain("UNDERSTANDING")
    expect(THINKING_PROMPT_TEMPLATE).toContain("ANALYSIS")
    expect(THINKING_PROMPT_TEMPLATE).toContain("PLAN")
    expect(THINKING_PROMPT_TEMPLATE).toContain("CONSIDERATIONS")
    expect(THINKING_PROMPT_TEMPLATE).toContain("CONCLUSION")
  })
})
