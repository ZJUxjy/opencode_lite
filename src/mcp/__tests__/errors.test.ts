/**
 * MCP 错误模块测试
 */

import { describe, it, expect } from "vitest"
import {
  MCPError,
  MCPConfigError,
  MCPConnectionError,
  MCPTransportError,
  MCPToolError,
  MCPToolNotFoundError,
  MCPServerNotConnectedError,
  isMCPError,
  isRetryableError,
  formatMCPError,
} from "../errors.js"

describe("MCP Errors", () => {
  describe("Error classes", () => {
    it("should create MCPError with code", () => {
      const error = new MCPError("test error", "TEST_CODE")
      expect(error.message).toBe("test error")
      expect(error.code).toBe("TEST_CODE")
      expect(error.name).toBe("MCPError")
    })

    it("should create MCPError with cause", () => {
      const cause = new Error("original error")
      const error = new MCPError("wrapped error", "WRAPPED", cause)
      expect(error.cause).toBe(cause)
    })

    it("should create MCPConfigError", () => {
      const error = new MCPConfigError("config invalid", ["field1: required"])
      expect(error.message).toBe("config invalid")
      expect(error.validationErrors).toEqual(["field1: required"])
    })

    it("should create MCPConnectionError with retryable flag", () => {
      const error = new MCPConnectionError("server1", "connection failed", true)
      expect(error.serverName).toBe("server1")
      expect(error.isRetryable).toBe(true)
      expect(error.message).toContain("connection failed")
    })

    it("should create MCPTransportError", () => {
      const error = new MCPTransportError(
        "server1",
        "transport error",
        "stdio",
        true
      )
      expect(error.transportType).toBe("stdio")
    })

    it("should create MCPToolError", () => {
      const error = new MCPToolError("server1", "tool1", "tool failed")
      expect(error.serverName).toBe("server1")
      expect(error.toolName).toBe("tool1")
    })

    it("should create MCPToolNotFoundError", () => {
      const error = new MCPToolNotFoundError("server1", "missing_tool")
      expect(error.toolName).toBe("missing_tool")
      expect(error.message).toContain("not found")
    })

    it("should create MCPServerNotConnectedError", () => {
      const error = new MCPServerNotConnectedError("server1")
      expect(error.serverName).toBe("server1")
    })
  })

  describe("isMCPError", () => {
    it("should return true for MCPError instances", () => {
      const error = new MCPError("test", "CODE")
      expect(isMCPError(error)).toBe(true)
    })

    it("should return true for MCPError subclasses", () => {
      const error = new MCPConnectionError("s", "m", true)
      expect(isMCPError(error)).toBe(true)
    })

    it("should return false for regular Error", () => {
      const error = new Error("regular error")
      expect(isMCPError(error)).toBe(false)
    })

    it("should return false for null", () => {
      expect(isMCPError(null)).toBe(false)
    })
  })

  describe("isRetryableError", () => {
    it("should return true for retryable connection errors", () => {
      const error = new MCPConnectionError("s", "m", true)
      expect(isRetryableError(error)).toBe(true)
    })

    it("should return false for non-retryable connection errors", () => {
      const error = new MCPConnectionError("s", "m", false)
      expect(isRetryableError(error)).toBe(false)
    })

    it("should return false for regular Error", () => {
      const error = new Error("regular")
      expect(isRetryableError(error)).toBe(false)
    })
  })

  describe("formatMCPError", () => {
    it("should format MCPError with cause", () => {
      const cause = new Error("original")
      const error = new MCPError("wrapped", "CODE", cause)
      const formatted = formatMCPError(error)
      expect(formatted).toContain("wrapped")
      expect(formatted).toContain("original")
    })

    it("should format regular Error", () => {
      const error = new Error("simple error")
      expect(formatMCPError(error)).toBe("simple error")
    })

    it("should handle string", () => {
      expect(formatMCPError("string error")).toBe("string error")
    })

    it("should handle number", () => {
      expect(formatMCPError(42)).toBe("42")
    })
  })
})
