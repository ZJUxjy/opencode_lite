import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdir, readFile, rm } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import { PromptDumper } from "../promptDumper.js"
import type { Message } from "../../types.js"
import type { ChatResponse } from "../../llm.js"

// Mock the os.homedir to use a temp directory
const mockHomedir = join(tmpdir(), `prompt-dumper-test-${Date.now()}`)
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>()
  return {
    ...actual,
    homedir: () => mockHomedir,
  }
})

describe("PromptDumper", () => {
  let dumper: PromptDumper
  const sessionId = "test-session-123"

  beforeEach(async () => {
    // Create the mock home directory
    await mkdir(mockHomedir, { recursive: true })
  })

  afterEach(async () => {
    // Cleanup
    try {
      await rm(mockHomedir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe("Constructor", () => {
    it("should initialize with session ID and enabled state", () => {
      dumper = new PromptDumper(sessionId, true)
      expect(dumper.isEnabled()).toBe(true)
      expect(dumper.getDumpPath()).toContain(sessionId)
    })

    it("should initialize with disabled state", () => {
      dumper = new PromptDumper(sessionId, false)
      expect(dumper.isEnabled()).toBe(false)
    })

    it("should create dump file path in ~/.lite-opencode/dumps/", () => {
      dumper = new PromptDumper(sessionId, true)
      const path = dumper.getDumpPath()
      expect(path).toBe(join(mockHomedir, ".lite-opencode", "dumps", `session-${sessionId}.md`))
    })
  })

  describe("setEnabled", () => {
    it("should toggle enabled state", () => {
      dumper = new PromptDumper(sessionId, false)
      expect(dumper.isEnabled()).toBe(false)

      dumper.setEnabled(true)
      expect(dumper.isEnabled()).toBe(true)

      dumper.setEnabled(false)
      expect(dumper.isEnabled()).toBe(false)
    })
  })

  describe("dumpRequest", () => {
    it("should not write file when disabled", async () => {
      dumper = new PromptDumper(sessionId, false)

      const systemPrompt = "You are a helpful assistant."
      const messages: Message[] = [
        { role: "user", content: "Hello" }
      ]

      dumper.dumpRequest(systemPrompt, messages)

      // File should not exist
      await expect(readFile(dumper.getDumpPath(), "utf-8")).rejects.toThrow()
    })

    it("should create dump file with header when enabled", async () => {
      dumper = new PromptDumper(sessionId, true)

      const systemPrompt = "You are a helpful assistant."
      const messages: Message[] = [
        { role: "user", content: "Hello" }
      ]

      dumper.dumpRequest(systemPrompt, messages)

      const content = await readFile(dumper.getDumpPath(), "utf-8")
      expect(content).toContain(`# Session: ${sessionId}`)
      expect(content).toContain("# Started:")
      expect(content).toContain("## Request #1")
      expect(content).toContain("### System Prompt")
      expect(content).toContain("You are a helpful assistant.")
      expect(content).toContain("### Messages")
      expect(content).toContain("[0] USER:")
      expect(content).toContain("Hello")
    })

    it("should estimate tokens for system prompt", async () => {
      dumper = new PromptDumper(sessionId, true)

      const systemPrompt = "You are a helpful assistant."  // ~30 chars = ~8 tokens
      const messages: Message[] = []

      dumper.dumpRequest(systemPrompt, messages)

      const content = await readFile(dumper.getDumpPath(), "utf-8")
      expect(content).toContain("tokens)")
    })

    it("should format messages correctly", async () => {
      dumper = new PromptDumper(sessionId, true)

      const messages: Message[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!", toolCalls: [{ id: "tc-1", name: "read", arguments: { path: "/test" } }] },
        { role: "user", content: "", toolResults: [{ toolCallId: "tc-1", content: "file contents" }] }
      ]

      dumper.dumpRequest("System prompt", messages)

      const content = await readFile(dumper.getDumpPath(), "utf-8")
      expect(content).toContain("[0] USER: Hello")
      expect(content).toContain("[1] ASSISTANT:")
      expect(content).toContain("[tool: read")
      expect(content).toContain("[2] USER:")
      expect(content).toContain("[tool result:")
    })
  })

  describe("dumpResponse", () => {
    it("should not write when disabled", async () => {
      dumper = new PromptDumper(sessionId, false)

      // First dump a request to create file (though it won't be created)
      dumper.dumpRequest("System", [])
      dumper.dumpResponse({ content: "Response text" })

      await expect(readFile(dumper.getDumpPath(), "utf-8")).rejects.toThrow()
    })

    it("should append response to existing file", async () => {
      dumper = new PromptDumper(sessionId, true)

      dumper.dumpRequest("System prompt", [{ role: "user", content: "Hello" }])

      const response: ChatResponse = {
        content: "Hi! How can I help you?",
        finishReason: "stop"
      }

      dumper.dumpResponse(response)

      const content = await readFile(dumper.getDumpPath(), "utf-8")
      expect(content).toContain("### LLM Response")
      expect(content).toContain("Hi! How can I help you?")
    })

    it("should include tool calls in response", async () => {
      dumper = new PromptDumper(sessionId, true)

      dumper.dumpRequest("System prompt", [{ role: "user", content: "Read a file" }])

      const response: ChatResponse = {
        content: "I will read the file.",
        toolCalls: [
          { id: "tc-2", name: "read", arguments: { path: "/src/index.ts" } }
        ],
        finishReason: "tool_call"
      }

      dumper.dumpResponse(response)

      const content = await readFile(dumper.getDumpPath(), "utf-8")
      expect(content).toContain("Tool Calls:")
      expect(content).toContain("read")
      expect(content).toContain("/src/index.ts")
    })

    it("should include reasoning in response if present", async () => {
      dumper = new PromptDumper(sessionId, true)

      dumper.dumpRequest("System prompt", [{ role: "user", content: "Think about it" }])

      const response: ChatResponse = {
        content: "My answer.",
        reasoning: "Let me think about this step by step..."
      }

      dumper.dumpResponse(response)

      const content = await readFile(dumper.getDumpPath(), "utf-8")
      expect(content).toContain("Reasoning:")
      expect(content).toContain("Let me think about this step by step...")
    })
  })

  describe("Multiple requests (append mode)", () => {
    it("should append multiple requests to the same file", async () => {
      dumper = new PromptDumper(sessionId, true)

      // First request
      dumper.dumpRequest("System 1", [{ role: "user", content: "First" }])
      dumper.dumpResponse({ content: "First response" })

      // Second request
      dumper.dumpRequest("System 2", [{ role: "user", content: "Second" }])
      dumper.dumpResponse({ content: "Second response" })

      const content = await readFile(dumper.getDumpPath(), "utf-8")

      // Should have both requests
      expect(content).toContain("## Request #1")
      expect(content).toContain("## Request #2")

      // Should have both responses
      expect(content).toContain("First response")
      expect(content).toContain("Second response")

      // Should only have one session header
      const sessionHeaderCount = (content.match(/# Session:/g) || []).length
      expect(sessionHeaderCount).toBe(1)
    })

    it("should increment request counter", async () => {
      dumper = new PromptDumper(sessionId, true)

      dumper.dumpRequest("System", [{ role: "user", content: "1" }])
      dumper.dumpRequest("System", [{ role: "user", content: "2" }])
      dumper.dumpRequest("System", [{ role: "user", content: "3" }])

      const content = await readFile(dumper.getDumpPath(), "utf-8")

      expect(content).toContain("## Request #1")
      expect(content).toContain("## Request #2")
      expect(content).toContain("## Request #3")
    })
  })

  describe("File operations", () => {
    it("should create dumps directory if it doesn't exist", async () => {
      dumper = new PromptDumper(sessionId, true)

      // The directory shouldn't exist yet
      await expect(
        readFile(join(mockHomedir, ".lite-opencode", "dumps"), "utf-8")
      ).rejects.toThrow()

      dumper.dumpRequest("Test", [])

      // Now the file should exist
      const content = await readFile(dumper.getDumpPath(), "utf-8")
      expect(content).toContain("# Session:")
    })
  })
})
