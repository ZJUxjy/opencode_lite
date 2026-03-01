/**
 * Fallback mechanism tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  generateRecoveryPrompt,
  shouldFallback,
  formatFailureReport,
  executeWithFallback,
  type TeamFailureReport,
  type FallbackConfig,
} from "../fallback.js"
import type { TeamResult } from "../types.js"
import type { WorkArtifact, ReviewArtifact } from "../contracts.js"

describe("generateRecoveryPrompt", () => {
  it("should generate basic recovery prompt with no artifacts", () => {
    const report: Omit<TeamFailureReport, "recoveryPrompt"> = {
      teamId: "team-123",
      reason: "failed",
      originalRequirement: "Implement a hello world function",
      completedArtifacts: [],
      stats: {
        duration: 5000,
        iterations: 2,
        totalCost: 0.05,
        totalTokens: 1000,
      },
    }

    const prompt = generateRecoveryPrompt(report)

    expect(prompt).toContain("# Task Continuation Request")
    expect(prompt).toContain("Implement a hello world function")
    expect(prompt).toContain("The team execution failed")
    expect(prompt).toContain("Duration: 5.0s")
    expect(prompt).toContain("Iterations: 2")
    expect(prompt).toContain("Cost: $0.0500")
    expect(prompt).toContain("Start fresh with the original requirement")
  })

  it("should generate recovery prompt with completed artifacts", () => {
    const artifact: WorkArtifact = {
      taskId: "task-1",
      agentId: "worker-1",
      agentRole: "worker",
      summary: "Implemented hello world function",
      changedFiles: ["src/hello.ts"],
      patchRef: "patch-123",
      testResults: [{ command: "npm test", passed: true }],
      risks: ["May not work in all environments"],
      assumptions: ["TypeScript is available"],
      createdAt: Date.now(),
    }

    const report: Omit<TeamFailureReport, "recoveryPrompt"> = {
      teamId: "team-123",
      reason: "max_iterations",
      originalRequirement: "Implement a hello world function",
      completedArtifacts: [artifact],
      stats: {
        duration: 10000,
        iterations: 3,
        totalCost: 0.1,
        totalTokens: 2000,
      },
    }

    const prompt = generateRecoveryPrompt(report)

    expect(prompt).toContain("## Completed Work")
    expect(prompt).toContain("worker (worker-1)")
    expect(prompt).toContain("Implemented hello world function")
    expect(prompt).toContain("src/hello.ts")
    expect(prompt).toContain("May not work in all environments")
    expect(prompt).toContain("TypeScript is available")
    expect(prompt).toContain("reached the maximum iteration limit")
  })

  it("should include review feedback in recovery prompt", () => {
    const artifact: WorkArtifact = {
      taskId: "task-1",
      agentId: "worker-1",
      agentRole: "worker",
      summary: "Implemented hello world function",
      changedFiles: ["src/hello.ts"],
      patchRef: "patch-123",
      testResults: [],
      risks: [],
      assumptions: [],
      createdAt: Date.now(),
    }

    const review: ReviewArtifact = {
      workArtifactId: "task-1",
      reviewerId: "reviewer-1",
      status: "changes_requested",
      severity: "P1",
      mustFix: [
        {
          message: "Add error handling",
          category: "bug",
          file: "src/hello.ts",
          line: 10,
        },
      ],
      suggestions: [
        {
          message: "Consider using async/await",
          category: "style",
        },
      ],
      createdAt: Date.now(),
    }

    const report: Omit<TeamFailureReport, "recoveryPrompt"> = {
      teamId: "team-123",
      reason: "failed",
      originalRequirement: "Implement a hello world function",
      completedArtifacts: [artifact],
      lastReview: review,
      stats: {
        duration: 5000,
        iterations: 2,
        totalCost: 0.05,
        totalTokens: 1000,
      },
    }

    const prompt = generateRecoveryPrompt(report)

    expect(prompt).toContain("## Last Review Feedback")
    expect(prompt).toContain("changes_requested")
    expect(prompt).toContain("Add error handling")
    expect(prompt).toContain("src/hello.ts:10")
    expect(prompt).toContain("Consider using async/await")
    expect(prompt).toContain("Address the review feedback")
  })

  it("should handle timeout reason", () => {
    const report: Omit<TeamFailureReport, "recoveryPrompt"> = {
      teamId: "team-123",
      reason: "timeout",
      originalRequirement: "Complex task",
      completedArtifacts: [],
      stats: {
        duration: 300000,
        iterations: 5,
        totalCost: 0.5,
        totalTokens: 10000,
      },
    }

    const prompt = generateRecoveryPrompt(report)

    expect(prompt).toContain("The team execution timed out")
  })

  it("should handle budget_exceeded reason", () => {
    const report: Omit<TeamFailureReport, "recoveryPrompt"> = {
      teamId: "team-123",
      reason: "budget_exceeded",
      originalRequirement: "Expensive task",
      completedArtifacts: [],
      stats: {
        duration: 60000,
        iterations: 10,
        totalCost: 5.0,
        totalTokens: 100000,
      },
    }

    const prompt = generateRecoveryPrompt(report)

    expect(prompt).toContain("The team exceeded the budget limit")
  })
})

describe("shouldFallback", () => {
  it("should return true for failed team result", () => {
    const result: TeamResult = {
      status: "failure",
      summary: "Team failed",
      artifacts: [],
      stats: {
        duration: 1000,
        iterations: 1,
        totalCost: 0,
        totalTokens: 0,
      },
    }

    expect(shouldFallback(result)).toBe(true)
  })

  it("should return false for successful team result", () => {
    const result: TeamResult = {
      status: "success",
      summary: "Team succeeded",
      artifacts: [],
      stats: {
        duration: 1000,
        iterations: 1,
        totalCost: 0,
        totalTokens: 0,
      },
    }

    expect(shouldFallback(result)).toBe(false)
  })
})

describe("formatFailureReport", () => {
  it("should format failure report for display", () => {
    const report: TeamFailureReport = {
      teamId: "team-123",
      reason: "max_iterations",
      originalRequirement: "Test task",
      completedArtifacts: [
        {
          taskId: "task-1",
          agentId: "worker-1",
          agentRole: "worker",
          summary: "Partial work",
          changedFiles: ["file1.ts", "file2.ts"],
          patchRef: "patch-1",
          testResults: [],
          risks: [],
          assumptions: [],
          createdAt: Date.now(),
        },
      ],
      recoveryPrompt: "Recovery prompt...",
      stats: {
        duration: 10000,
        iterations: 3,
        totalCost: 0.1,
        totalTokens: 2000,
      },
    }

    const formatted = formatFailureReport(report)

    expect(formatted).toContain("Team Execution Failed")
    expect(formatted).toContain("max_iterations")
    expect(formatted).toContain("10.0s")
    expect(formatted).toContain("3")
    expect(formatted).toContain("$0.1000")
    expect(formatted).toContain("**Completed Artifacts**: 1")
    expect(formatted).toContain("worker: 2 files")
    expect(formatted).toContain("Falling back to single agent mode")
  })

  it("should format failure report without artifacts", () => {
    const report: TeamFailureReport = {
      teamId: "team-123",
      reason: "timeout",
      originalRequirement: "Test task",
      completedArtifacts: [],
      recoveryPrompt: "Recovery prompt...",
      stats: {
        duration: 5000,
        iterations: 1,
        totalCost: 0.01,
        totalTokens: 500,
      },
    }

    const formatted = formatFailureReport(report)

    expect(formatted).toContain("Team Execution Failed")
    expect(formatted).toContain("timeout")
    expect(formatted).not.toContain("Completed Artifacts")
  })
})

describe("executeWithFallback", () => {
  const mockAgent = {
    run: vi.fn(),
  } as unknown as import("../../agent.js").Agent

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("should return team-success when team succeeds", async () => {
    const teamResult: TeamResult = {
      status: "success",
      summary: "Task completed",
      artifacts: [],
      stats: {
        duration: 1000,
        iterations: 1,
        totalCost: 0,
        totalTokens: 0,
      },
    }

    const result = await executeWithFallback(
      () => Promise.resolve(teamResult),
      mockAgent,
      "Test requirement",
      { enabled: true }
    )

    expect(result.executionMode).toBe("team-success")
    expect(result.teamResult).toBe(teamResult)
    expect(result.finalSummary).toBe("Task completed")
    expect(mockAgent.run).not.toHaveBeenCalled()
  })

  it("should fallback to single agent when team fails and fallback is enabled", async () => {
    const teamResult: TeamResult = {
      status: "failure",
      summary: "Team failed with max iterations",
      artifacts: [],
      stats: {
        duration: 1000,
        iterations: 3,
        totalCost: 0.1,
        totalTokens: 1000,
      },
    }

    vi.mocked(mockAgent.run).mockResolvedValue("Single agent completed the task")

    const result = await executeWithFallback(
      () => Promise.resolve(teamResult),
      mockAgent,
      "Test requirement",
      { enabled: true }
    )

    expect(result.executionMode).toBe("fallback-single-agent")
    expect(result.fallbackReport).toBeDefined()
    expect(result.fallbackReport?.reason).toBe("max_iterations")
    expect(result.singleAgentResult).toBe("Single agent completed the task")
    expect(mockAgent.run).toHaveBeenCalledTimes(1)
    expect(mockAgent.run).toHaveBeenCalledWith(expect.stringContaining("Task Continuation Request"))
  })

  it("should not fallback when fallback is disabled", async () => {
    const teamResult: TeamResult = {
      status: "failure",
      summary: "Team failed",
      artifacts: [],
      stats: {
        duration: 1000,
        iterations: 1,
        totalCost: 0,
        totalTokens: 0,
      },
    }

    const result = await executeWithFallback(
      () => Promise.resolve(teamResult),
      mockAgent,
      "Test requirement",
      { enabled: false }
    )

    expect(result.executionMode).toBe("team-failure")
    expect(result.teamResult).toBe(teamResult)
    expect(mockAgent.run).not.toHaveBeenCalled()
  })

  it("should fallback when team executor throws an error", async () => {
    vi.mocked(mockAgent.run).mockResolvedValue("Recovered from error")

    const result = await executeWithFallback(
      () => Promise.reject(new Error("Network error")),
      mockAgent,
      "Test requirement",
      { enabled: true }
    )

    expect(result.executionMode).toBe("fallback-single-agent")
    expect(result.fallbackReport).toBeDefined()
    expect(result.fallbackReport?.reason).toBe("failed")
    expect(result.singleAgentResult).toBe("Recovered from error")
  })

  it("should use custom recovery prompt generator when provided", async () => {
    const teamResult: TeamResult = {
      status: "failure",
      summary: "Team failed",
      artifacts: [],
      stats: {
        duration: 1000,
        iterations: 1,
        totalCost: 0,
        totalTokens: 0,
      },
    }

    vi.mocked(mockAgent.run).mockResolvedValue("Done")

    const customGenerator = vi.fn((report) => `Custom prompt for: ${report.originalRequirement}`)

    const result = await executeWithFallback(
      () => Promise.resolve(teamResult),
      mockAgent,
      "Custom test",
      { enabled: true, customRecoveryPromptGenerator: customGenerator }
    )

    expect(customGenerator).toHaveBeenCalled()
    expect(mockAgent.run).toHaveBeenCalledWith("Custom prompt for: Custom test")
  })

  it("should detect budget exceeded from summary", async () => {
    const teamResult: TeamResult = {
      status: "failure",
      summary: "Budget exceeded the limit",
      artifacts: [],
      stats: {
        duration: 1000,
        iterations: 1,
        totalCost: 5.0,
        totalTokens: 10000,
      },
    }

    vi.mocked(mockAgent.run).mockResolvedValue("Done")

    const result = await executeWithFallback(
      () => Promise.resolve(teamResult),
      mockAgent,
      "Test",
      { enabled: true }
    )

    expect(result.fallbackReport?.reason).toBe("budget_exceeded")
  })

  it("should detect timeout from summary", async () => {
    const teamResult: TeamResult = {
      status: "failure",
      summary: "Execution timeout after 30 seconds",
      artifacts: [],
      stats: {
        duration: 30000,
        iterations: 5,
        totalCost: 0.5,
        totalTokens: 5000,
      },
    }

    vi.mocked(mockAgent.run).mockResolvedValue("Done")

    const result = await executeWithFallback(
      () => Promise.resolve(teamResult),
      mockAgent,
      "Test",
      { enabled: true }
    )

    expect(result.fallbackReport?.reason).toBe("timeout")
  })
})
