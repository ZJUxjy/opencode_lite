/**
 * MCP 配置模块测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  MCPServerConfigSchema,
  MCPGlobalConfigSchema,
  resolveEnvVars,
  resolveServerConfig,
  validateMCPConfig,
} from "../config.js"

describe("MCP Config", () => {
  describe("MCPServerConfigSchema", () => {
    it("should validate stdio config", () => {
      const config = {
        name: "test-server",
        transport: "stdio" as const,
        command: "npx",
        args: ["-y", "@test/server"],
      }

      const result = MCPServerConfigSchema.safeParse(config)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.name).toBe("test-server")
        expect(result.data.transport).toBe("stdio")
        expect(result.data.enabled).toBe(true) // default
        expect(result.data.timeout).toBe(60) // default
      }
    })

    it("should validate SSE config", () => {
      const config = {
        name: "sse-server",
        transport: "sse" as const,
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer token" },
      }

      const result = MCPServerConfigSchema.safeParse(config)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.url).toBe("https://example.com/mcp")
        expect(result.data.headers).toEqual({ Authorization: "Bearer token" })
      }
    })

    it("should validate streamable-http config", () => {
      const config = {
        name: "http-server",
        transport: "streamable-http" as const,
        url: "http://localhost:3000/mcp",
        timeout: 120,
      }

      const result = MCPServerConfigSchema.safeParse(config)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.timeout).toBe(120)
      }
    })

    it("should reject stdio config without command", () => {
      const config = {
        name: "bad-server",
        transport: "stdio" as const,
        // missing command
      }

      const result = MCPServerConfigSchema.safeParse(config)
      expect(result.success).toBe(false)
    })

    it("should reject SSE config without URL", () => {
      const config = {
        name: "bad-server",
        transport: "sse" as const,
        // missing url
      }

      const result = MCPServerConfigSchema.safeParse(config)
      expect(result.success).toBe(false)
    })

    it("should apply default values", () => {
      const config = {
        name: "minimal",
        transport: "stdio" as const,
        command: "echo",
      }

      const result = MCPServerConfigSchema.parse(config)
      expect(result.enabled).toBe(true)
      expect(result.timeout).toBe(60)
      expect(result.args).toEqual([])
    })
  })

  describe("MCPGlobalConfigSchema", () => {
    it("should validate global config", () => {
      const config = {
        enabled: true,
        servers: [
          {
            name: "server1",
            transport: "stdio" as const,
            command: "npx",
          },
        ],
      }

      const result = MCPGlobalConfigSchema.safeParse(config)
      expect(result.success).toBe(true)
    })

    it("should apply defaults", () => {
      const config = {}

      const result = MCPGlobalConfigSchema.parse(config)
      expect(result.enabled).toBe(true)
      expect(result.servers).toEqual([])
    })
  })

  describe("resolveEnvVars", () => {
    beforeEach(() => {
      process.env.TEST_VAR = "test_value"
      process.env.ANOTHER_VAR = "another_value"
    })

    afterEach(() => {
      delete process.env.TEST_VAR
      delete process.env.ANOTHER_VAR
    })

    it("should resolve environment variables", () => {
      const str = "Bearer ${TEST_VAR}"
      expect(resolveEnvVars(str)).toBe("Bearer test_value")
    })

    it("should resolve multiple variables", () => {
      const str = "${TEST_VAR}:${ANOTHER_VAR}"
      expect(resolveEnvVars(str)).toBe("test_value:another_value")
    })

    it("should handle missing variables", () => {
      const str = "Bearer ${MISSING_VAR}"
      expect(resolveEnvVars(str)).toBe("Bearer ")
    })

    it("should return unchanged string without variables", () => {
      const str = "no variables here"
      expect(resolveEnvVars(str)).toBe("no variables here")
    })
  })

  describe("resolveServerConfig", () => {
    beforeEach(() => {
      process.env.API_KEY = "secret_key"
    })

    afterEach(() => {
      delete process.env.API_KEY
    })

    it("should resolve env vars in URL", () => {
      const config = {
        name: "test",
        transport: "sse" as const,
        url: "https://api.example.com/${API_KEY}/mcp",
        enabled: true,
        timeout: 60,
        args: [] as string[],
      }

      const resolved = resolveServerConfig(config)
      expect(resolved.url).toBe("https://api.example.com/secret_key/mcp")
    })

    it("should resolve env vars in headers", () => {
      const config = {
        name: "test",
        transport: "sse" as const,
        url: "https://example.com",
        headers: { Authorization: "Bearer ${API_KEY}" },
        enabled: true,
        timeout: 60,
        args: [] as string[],
      }

      const resolved = resolveServerConfig(config)
      expect(resolved.headers?.Authorization).toBe("Bearer secret_key")
    })

    it("should resolve env vars in env field", () => {
      const config = {
        name: "test",
        transport: "stdio" as const,
        command: "echo",
        env: { API_KEY: "${API_KEY}" },
        enabled: true,
        timeout: 60,
        args: [] as string[],
      }

      const resolved = resolveServerConfig(config)
      expect(resolved.env?.API_KEY).toBe("secret_key")
    })
  })

  describe("validateMCPConfig", () => {
    it("should return undefined for null input", () => {
      expect(validateMCPConfig(null)).toBeUndefined()
      expect(validateMCPConfig(undefined)).toBeUndefined()
    })

    it("should validate and return config", () => {
      const config = {
        enabled: true,
        servers: [
          {
            name: "test",
            transport: "stdio" as const,
            command: "echo",
          },
        ],
      }

      const result = validateMCPConfig(config)
      expect(result).toBeDefined()
      expect(result?.enabled).toBe(true)
      expect(result?.servers).toHaveLength(1)
    })

    it("should throw for invalid config", () => {
      const config = {
        enabled: "not_boolean", // wrong type
        servers: [],
      }

      expect(() => validateMCPConfig(config)).toThrow()
    })
  })
})
