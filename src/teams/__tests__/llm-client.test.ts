import { describe, it, expect, vi } from "vitest"
import { AgentLLMClient, createAgentLLMClient, WorkerOutput, ReviewerOutput } from "../client/llm-client.js"
import { LLMClient } from "../../llm.js"

// Mock LLMClient for testing
function createMockLLMClient(): LLMClient {
  return new LLMClient({
    model: "claude-sonnet-4-6",
    apiKey: "test-key",
  })
}

describe("AgentLLMClient", () => {
  describe("constructor", () => {
    it("should create client with LLMClient", () => {
      const mockLLM = createMockLLMClient()
      const client = new AgentLLMClient({
        llmClient: mockLLM,
      })
      expect(client).toBeDefined()
    })

    it("should create client with all config options", () => {
      const mockLLM = createMockLLMClient()
      const client = new AgentLLMClient({
        llmClient: mockLLM,
        temperature: 0.5,
        onTokenUsage: vi.fn(),
      })
      expect(client).toBeDefined()
    })
  })

  describe("setters", () => {
    it("should have cost controller setter", () => {
      const mockLLM = createMockLLMClient()
      const client = new AgentLLMClient({ llmClient: mockLLM })
      expect(client.setCostController).toBeDefined()
      expect(typeof client.setCostController).toBe("function")
    })

    it("should have blackboard setter", () => {
      const mockLLM = createMockLLMClient()
      const client = new AgentLLMClient({ llmClient: mockLLM })
      expect(client.setBlackboard).toBeDefined()
      expect(typeof client.setBlackboard).toBe("function")
    })
  })

  describe("worker execution", () => {
    it("should have executeWorker method", () => {
      const mockLLM = createMockLLMClient()
      const client = new AgentLLMClient({ llmClient: mockLLM })
      expect(client.executeWorker).toBeDefined()
      expect(typeof client.executeWorker).toBe("function")
    })
  })

  describe("reviewer execution", () => {
    it("should have executeReviewer method", () => {
      const mockLLM = createMockLLMClient()
      const client = new AgentLLMClient({ llmClient: mockLLM })
      expect(client.executeReviewer).toBeDefined()
      expect(typeof client.executeReviewer).toBe("function")
    })
  })
})

describe("createAgentLLMClient factory", () => {
  it("should create client using factory", () => {
    const mockLLM = createMockLLMClient()
    const client = createAgentLLMClient({ llmClient: mockLLM })
    expect(client).toBeInstanceOf(AgentLLMClient)
  })
})

describe("WorkerOutput type", () => {
  it("should have required fields", () => {
    const output: WorkerOutput = {
      summary: "Test summary",
      changedFiles: ["file1.ts"],
      patchRef: "ref-1",
      testResults: [{ command: "npm test", passed: true }],
      risks: [],
      assumptions: [],
    }
    expect(output.summary).toBe("Test summary")
    expect(output.changedFiles).toHaveLength(1)
  })
})

describe("ReviewerOutput type", () => {
  it("should have required fields for approved", () => {
    const output: ReviewerOutput = {
      status: "approved",
      severity: "P3",
      mustFix: [],
      suggestions: ["Minor improvement"],
    }
    expect(output.status).toBe("approved")
    expect(output.severity).toBe("P3")
  })

  it("should have required fields for changes_requested", () => {
    const output: ReviewerOutput = {
      status: "changes_requested",
      severity: "P1",
      mustFix: ["Fix this issue"],
      suggestions: [],
    }
    expect(output.status).toBe("changes_requested")
    expect(output.mustFix).toHaveLength(1)
  })
})
