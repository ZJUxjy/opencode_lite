import { describe, it, expect } from "vitest"
import {
  NonInteractiveExecutor,
  createNonInteractiveExecutor,
  DEFAULT_NON_INTERACTIVE_CONFIG,
  type NonInteractiveConfig,
  type NonInteractiveResult,
} from "../index.js"

// Mock Agent
const mockAgent = {
  run: async (prompt: string) => `Response for: ${prompt}`,
} as any

describe("NonInteractiveExecutor", () => {
  describe("constructor", () => {
    it("should use default config", () => {
      const executor = new NonInteractiveExecutor()
      const config = executor.getConfig()

      expect(config.outputFormat).toBe(DEFAULT_NON_INTERACTIVE_CONFIG.outputFormat)
      expect(config.verbose).toBe(DEFAULT_NON_INTERACTIVE_CONFIG.verbose)
      expect(config.exitOnFailure).toBe(DEFAULT_NON_INTERACTIVE_CONFIG.exitOnFailure)
    })

    it("should merge custom config", () => {
      const executor = new NonInteractiveExecutor({
        outputFormat: "json",
        verbose: true,
      })
      const config = executor.getConfig()

      expect(config.outputFormat).toBe("json")
      expect(config.verbose).toBe(true)
    })
  })

  describe("execute", () => {
    it("should execute with single agent", async () => {
      const executor = new NonInteractiveExecutor()
      const result = await executor.execute(mockAgent, "Test prompt", null)

      expect(result.success).toBe(true)
      expect(result.summary).toContain("Response for")
      expect(result.exitCode).toBe(0)
    })
  })

  describe("formatOutput", () => {
    const successResult: NonInteractiveResult = {
      success: true,
      summary: "Task completed successfully",
      stats: {
        duration: 1000,
        tokens: 100,
        cost: 0.01,
        iterations: 2,
      },
      exitCode: 0,
    }

    it("should format as text", () => {
      const executor = new NonInteractiveExecutor({ outputFormat: "text" })
      const output = executor.formatOutput(successResult)

      expect(output).toContain("✅ Success")
      expect(output).toContain("Task completed successfully")
      expect(output).toContain("Duration:")
      expect(output).toContain("Tokens:")
    })

    it("should format as json", () => {
      const executor = new NonInteractiveExecutor({ outputFormat: "json" })
      const output = executor.formatOutput(successResult)

      const parsed = JSON.parse(output)
      expect(parsed.success).toBe(true)
      expect(parsed.summary).toBe("Task completed successfully")
      expect(parsed.stats.tokens).toBe(100)
    })

    it("should format as markdown", () => {
      const executor = new NonInteractiveExecutor({ outputFormat: "markdown" })
      const output = executor.formatOutput(successResult)

      expect(output).toContain("# Execution Result")
      expect(output).toContain("## Summary")
      expect(output).toContain("## Statistics")
      expect(output).toContain("Task completed successfully")
    })

    it("should include error in verbose mode", () => {
      const executor = new NonInteractiveExecutor({ outputFormat: "text", verbose: true })
      const failedResult: NonInteractiveResult = {
        success: false,
        summary: "Failed",
        error: "Something went wrong",
        exitCode: 1,
      }
      const output = executor.formatOutput(failedResult)

      expect(output).toContain("❌ Failed")
      expect(output).toContain("Error:")
      expect(output).toContain("Something went wrong")
    })
  })
})

describe("createNonInteractiveExecutor", () => {
  it("should create an executor", () => {
    const executor = createNonInteractiveExecutor()
    expect(executor).toBeInstanceOf(NonInteractiveExecutor)
  })

  it("should accept custom config", () => {
    const executor = createNonInteractiveExecutor({ outputFormat: "json" })
    const config = executor.getConfig()

    expect(config.outputFormat).toBe("json")
  })
})

describe("DEFAULT_NON_INTERACTIVE_CONFIG", () => {
  it("should have correct defaults", () => {
    expect(DEFAULT_NON_INTERACTIVE_CONFIG.outputFormat).toBe("text")
    expect(DEFAULT_NON_INTERACTIVE_CONFIG.verbose).toBe(false)
    expect(DEFAULT_NON_INTERACTIVE_CONFIG.exitOnFailure).toBe(true)
    expect(DEFAULT_NON_INTERACTIVE_CONFIG.failureExitCode).toBe(1)
    expect(DEFAULT_NON_INTERACTIVE_CONFIG.timeout).toBe(300000)
    expect(DEFAULT_NON_INTERACTIVE_CONFIG.enableFallback).toBe(true)
    expect(DEFAULT_NON_INTERACTIVE_CONFIG.showProgress).toBe(false)
  })
})
