import { describe, it, expect, vi } from "vitest"
import { AgentLLMClient, createAgentLLMClient, WorkerOutput, ReviewerOutput } from "../client/llm-client.js"

describe("AgentLLMClient", () => {
  describe("constructor", () => {
    it("should create client with config", () => {
      const client = new AgentLLMClient({
        model: "claude-3-5-sonnet-20241022",
      })
      expect(client).toBeDefined()
    })

    it("should create client with all config options", () => {
      const client = new AgentLLMClient({
        model: "claude-3-5-sonnet-20241022",
        baseURL: "https://api.anthropic.com",
        apiKey: "test-key",
        timeout: 60000,
        temperature: 0.5,
      })
      expect(client).toBeDefined()
    })
  })

  describe("setters", () => {
    it("should have cost controller setter", () => {
      const client = new AgentLLMClient({ model: "test" })
      expect(client.setCostController).toBeDefined()
      expect(typeof client.setCostController).toBe("function")
    })

    it("should have blackboard setter", () => {
      const client = new AgentLLMClient({ model: "test" })
      expect(client.setBlackboard).toBeDefined()
      expect(typeof client.setBlackboard).toBe("function")
    })
  })

  describe("worker execution", () => {
    it("should have executeWorker method", () => {
      const client = new AgentLLMClient({ model: "test" })
      expect(client.executeWorker).toBeDefined()
      expect(typeof client.executeWorker).toBe("function")
    })
  })

  describe("reviewer execution", () => {
    it("should have executeReviewer method", () => {
      const client = new AgentLLMClient({ model: "test" })
      expect(client.executeReviewer).toBeDefined()
      expect(typeof client.executeReviewer).toBe("function")
    })
  })
})

describe("createAgentLLMClient factory", () => {
  it("should create client using factory", () => {
    const client = createAgentLLMClient({ model: "test-model" })
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
