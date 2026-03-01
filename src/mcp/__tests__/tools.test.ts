/**
 * MCP 工具包装器测试
 */

import { describe, it, expect, vi } from "vitest"
import { z } from "zod"
import {
  createMCPToolWrapper,
  isMCPToolName,
  parseMCPToolName,
} from "../tools.js"
import type { MCPManager } from "../manager.js"
import type { MCPToolInfo } from "../types.js"

describe("MCP Tools", () => {
  describe("isMCPToolName", () => {
    it("should return true for mcp_ prefix", () => {
      expect(isMCPToolName("mcp_server_tool")).toBe(true)
      expect(isMCPToolName("mcp_filesystem_read")).toBe(true)
    })

    it("should return false for non-mcp names", () => {
      expect(isMCPToolName("read")).toBe(false)
      expect(isMCPToolName("write")).toBe(false)
      expect(isMCPToolName("")).toBe(false)
    })
  })

  describe("parseMCPToolName", () => {
    it("should parse mcp_server_tool format", () => {
      const result = parseMCPToolName("mcp_server_tool")
      expect(result).toEqual({ server: "server", tool: "tool" })
    })

    it("should parse with underscore in tool name", () => {
      const result = parseMCPToolName("mcp_filesystem_read_file")
      expect(result).toEqual({ server: "filesystem", tool: "read_file" })
    })

    it("should parse with numeric suffix", () => {
      const result = parseMCPToolName("mcp_server_tool_1")
      expect(result).toEqual({ server: "server", tool: "tool" })
    })

    it("should return null for non-mcp names", () => {
      expect(parseMCPToolName("read")).toBeNull()
      expect(parseMCPToolName("")).toBeNull()
    })

    it("should return null for invalid format", () => {
      expect(parseMCPToolName("mcp_short")).toBeNull()
    })
  })

  describe("createMCPToolWrapper", () => {
    const mockManager = {
      callTool: vi.fn(),
    } as unknown as MCPManager

    it("should create tool wrapper with correct name", () => {
      const toolInfo: MCPToolInfo = {
        name: "read_file",
        description: "Read a file",
        inputSchema: { type: "object", properties: {} },
        server: "filesystem",
      }

      const tool = createMCPToolWrapper(toolInfo, mockManager)
      expect(tool.name).toBe("read_file")
      expect(tool.description).toContain("[MCP:filesystem]")
      expect(tool.description).toContain("Read a file")
    })

    it("should create Zod schema from JSON Schema", () => {
      const toolInfo: MCPToolInfo = {
        name: "test_tool",
        description: "Test tool",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            count: { type: "integer" },
          },
          required: ["path"],
        },
        server: "test",
      }

      const tool = createMCPToolWrapper(toolInfo, mockManager)
      expect(tool.parameters).toBeInstanceOf(z.ZodObject)
    })

    it("should execute and return text content", async () => {
      const toolInfo: MCPToolInfo = {
        name: "test_tool",
        description: "Test",
        inputSchema: { type: "object", properties: {} },
        server: "test",
      }

      vi.mocked(mockManager.callTool).mockResolvedValue({
        content: [{ type: "text", text: "result" }],
        isError: false,
      })

      const tool = createMCPToolWrapper(toolInfo, mockManager)
      const result = await tool.execute({}, { cwd: "/", messages: [] })

      expect(result).toBe("result")
    })

    it("should handle image content", async () => {
      const toolInfo: MCPToolInfo = {
        name: "test_tool",
        description: "Test",
        inputSchema: { type: "object", properties: {} },
        server: "test",
      }

      vi.mocked(mockManager.callTool).mockResolvedValue({
        content: [{ type: "image", data: "base64", mimeType: "image/png" }],
        isError: false,
      })

      const tool = createMCPToolWrapper(toolInfo, mockManager)
      const result = await tool.execute({}, { cwd: "/", messages: [] })

      expect(result).toContain("[Image: image/png]")
    })

    it("should handle resource content", async () => {
      const toolInfo: MCPToolInfo = {
        name: "test_tool",
        description: "Test",
        inputSchema: { type: "object", properties: {} },
        server: "test",
      }

      vi.mocked(mockManager.callTool).mockResolvedValue({
        content: [
          { type: "resource", resource: { uri: "file:///test", text: "content" } },
        ],
        isError: false,
      })

      const tool = createMCPToolWrapper(toolInfo, mockManager)
      const result = await tool.execute({}, { cwd: "/", messages: [] })

      expect(result).toBe("content")
    })

    it("should return error message on error result", async () => {
      const toolInfo: MCPToolInfo = {
        name: "test_tool",
        description: "Test",
        inputSchema: { type: "object", properties: {} },
        server: "test",
      }

      vi.mocked(mockManager.callTool).mockResolvedValue({
        content: [{ type: "text", text: "something went wrong" }],
        isError: true,
      })

      const tool = createMCPToolWrapper(toolInfo, mockManager)
      const result = await tool.execute({}, { cwd: "/", messages: [] })

      expect(result).toContain("Error from test_tool")
      expect(result).toContain("something went wrong")
    })

    it("should handle manager errors", async () => {
      const toolInfo: MCPToolInfo = {
        name: "test_tool",
        description: "Test",
        inputSchema: { type: "object", properties: {} },
        server: "test",
      }

      vi.mocked(mockManager.callTool).mockRejectedValue(new Error("connection failed"))

      const tool = createMCPToolWrapper(toolInfo, mockManager)
      const result = await tool.execute({}, { cwd: "/", messages: [] })

      expect(result).toContain("Error calling test_tool")
      expect(result).toContain("connection failed")
    })

    it("should handle empty result", async () => {
      const toolInfo: MCPToolInfo = {
        name: "test_tool",
        description: "Test",
        inputSchema: { type: "object", properties: {} },
        server: "test",
      }

      vi.mocked(mockManager.callTool).mockResolvedValue({
        content: [],
        isError: false,
      })

      const tool = createMCPToolWrapper(toolInfo, mockManager)
      const result = await tool.execute({}, { cwd: "/", messages: [] })

      expect(result).toBe("(empty result)")
    })
  })
})
