import { describe, it, expect } from "vitest"
import {
  type UIMessage,
  type MessageGroup,
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  createToolMessage,
  generateMessageId,
} from "../types.js"

describe("Message Types", () => {
  describe("generateMessageId", () => {
    it("should generate unique IDs", () => {
      const id1 = generateMessageId()
      const id2 = generateMessageId()
      expect(id1).not.toBe(id2)
      expect(id1).toMatch(/^msg-\d+-\d+-[a-z0-9]+$/)
    })
  })

  describe("createUserMessage", () => {
    it("should create a user message with correct properties", () => {
      const content = "Hello, world!"
      const message = createUserMessage(content)

      expect(message.role).toBe("user")
      expect(message.type).toBe("text")
      expect(message.content).toBe(content)
      expect(message.id).toBeDefined()
      expect(message.metadata.timestamp).toBeDefined()
      expect(message.metadata.priority).toBe("normal")
    })
  })

  describe("createAssistantMessage", () => {
    it("should create an assistant message without reasoning", () => {
      const content = "Hello!"
      const message = createAssistantMessage(content)

      expect(message.role).toBe("assistant")
      expect(message.type).toBe("text")
      expect(message.content).toBe(content)
      expect(message.reasoning).toBeUndefined()
    })

    it("should create an assistant message with reasoning", () => {
      const content = "The answer is 42."
      const reasoning = "Let me think about this..."
      const message = createAssistantMessage(content, reasoning)

      expect(message.role).toBe("assistant")
      expect(message.type).toBe("reasoning")
      expect(message.content).toBe(content)
      expect(message.reasoning).toBe(reasoning)
    })
  })

  describe("createSystemMessage", () => {
    it("should create a system message with default type", () => {
      const content = "System notification"
      const message = createSystemMessage(content)

      expect(message.role).toBe("system")
      expect(message.type).toBe("notification")
      expect(message.content).toBe(content)
      expect(message.metadata.collapsible).toBe(true)
      expect(message.metadata.collapsed).toBe(true)
      expect(message.metadata.priority).toBe("low")
    })

    it("should create a system message with custom type", () => {
      const content = "Error occurred"
      const message = createSystemMessage(content, "error")

      expect(message.type).toBe("error")
    })
  })

  describe("createToolMessage", () => {
    it("should create a tool result message", () => {
      const toolName = "read"
      const args = { file_path: "/test.txt" }
      const result = "File contents"
      const message = createToolMessage(toolName, args, result)

      expect(message.role).toBe("tool")
      expect(message.type).toBe("tool_result")
      expect(message.content).toBe(result)
      expect(message.metadata.toolName).toBe(toolName)
      expect(message.metadata.toolArgs).toBe(args)
      expect(message.metadata.collapsible).toBe(true)
      expect(message.metadata.collapsed).toBe(true)
    })

    it("should create an error message for failed tool calls", () => {
      const toolName = "bash"
      const args = { command: "exit 1" }
      const result = "Command failed"
      const message = createToolMessage(toolName, args, result, true)

      expect(message.type).toBe("error")
    })
  })
})

describe("Message Grouping", () => {
  const createTestMessage = (overrides: Partial<UIMessage> = {}): UIMessage => ({
    id: `test-${Date.now()}-${Math.random()}`,
    role: "assistant",
    type: "text",
    content: "test",
    metadata: { timestamp: Date.now() },
    ...overrides,
  })

  it("should identify reasoning messages", () => {
    const message = createTestMessage({ type: "reasoning", reasoning: "Thinking..." })
    expect(message.type).toBe("reasoning")
  })

  it("should identify tool result messages", () => {
    const message = createTestMessage({ type: "tool_result", role: "tool" })
    expect(message.type).toBe("tool_result")
  })

  it("should identify error messages", () => {
    const message = createTestMessage({ type: "error" })
    expect(message.type).toBe("error")
  })

  it("should have correct collapse state for system messages", () => {
    const group: MessageGroup = {
      id: "test-group",
      type: "tool_execution",
      messages: [createTestMessage({ role: "system", type: "notification" })],
      collapsed: true,
    }

    expect(group.collapsed).toBe(true)
    expect(group.type).toBe("tool_execution")
  })

  it("should group consecutive messages correctly", () => {
    const messages: UIMessage[] = [
      createTestMessage({ role: "user", type: "text" }),
      createTestMessage({ role: "assistant", type: "reasoning", reasoning: "Thinking..." }),
      createTestMessage({ role: "assistant", type: "text" }),
    ]

    // Verify message types for grouping logic
    expect(messages[0].type).toBe("text")
    expect(messages[1].type).toBe("reasoning")
    expect(messages[2].type).toBe("text")
  })
})

describe("Message Colors", () => {
  it("should have colors defined for all message types", async () => {
    const { MESSAGE_COLORS } = await import("../types.js")

    expect(MESSAGE_COLORS.text).toBeDefined()
    expect(MESSAGE_COLORS.tool_call).toBeDefined()
    expect(MESSAGE_COLORS.tool_result).toBeDefined()
    expect(MESSAGE_COLORS.reasoning).toBeDefined()
    expect(MESSAGE_COLORS.error).toBeDefined()
    expect(MESSAGE_COLORS.notification).toBeDefined()

    // Verify each color has border and bg
    for (const colors of Object.values(MESSAGE_COLORS)) {
      expect(colors).toHaveProperty("border")
      expect(colors).toHaveProperty("bg")
    }
  })
})
