/**
 * MCP (Model Context Protocol) 配置定义和验证
 *
 * 使用 Zod 进行配置验证
 */

import { z } from "zod"

// ============================================================================
// 基础配置验证
// ============================================================================

/**
 * MCP 服务器配置验证 Schema
 *
 * 支持三种传输类型：
 * - stdio: 本地进程通信
 * - sse: 服务器发送事件
 * - streamable-http: 流式 HTTP (MCP 2025-03-26 协议)
 */
export const MCPServerConfigSchema = z
  .object({
    /** 服务器名称（唯一标识） */
    name: z.string().min(1, "Server name is required"),

    /** 是否启用此服务器 */
    enabled: z.boolean().default(true),

    /** 工具调用超时时间（秒） */
    timeout: z.number().min(1).max(3600).default(60),

    /** 传输类型 */
    transport: z.enum(["stdio", "sse", "streamable-http"], {
      required_error: "Transport type is required",
      invalid_type_error:
        "Transport must be one of: stdio, sse, streamable-http",
    }),

    // ===== stdio 配置 =====
    /** 命令（仅 stdio） */
    command: z.string().optional(),
    /** 命令参数（仅 stdio） */
    args: z.array(z.string()).default([]),
    /** 工作目录（仅 stdio） */
    cwd: z.string().optional(),
    /** 环境变量（仅 stdio） */
    env: z.record(z.string()).optional(),

    // ===== HTTP 配置 =====
    /** 服务器 URL（仅 sse/streamable-http） */
    url: z.string().url().optional(),
    /** 请求头（仅 sse/streamable-http） */
    headers: z.record(z.string()).optional(),
  })
  .refine(
    (data) => {
      // stdio 传输必须提供 command
      if (data.transport === "stdio" && !data.command) {
        return false
      }
      return true
    },
    {
      message: "Command is required when transport is 'stdio'",
      path: ["command"],
    }
  )
  .refine(
    (data) => {
      // sse/streamable-http 传输必须提供 url
      if (
        (data.transport === "sse" || data.transport === "streamable-http") &&
        !data.url
      ) {
        return false
      }
      return true
    },
    {
      message: "URL is required when transport is 'sse' or 'streamable-http'",
      path: ["url"],
    }
  )

/**
 * MCP 全局配置验证 Schema
 */
export const MCPGlobalConfigSchema = z.object({
  /** 是否启用 MCP 功能 */
  enabled: z.boolean().default(true),

  /** MCP 服务器列表 */
  servers: z.array(MCPServerConfigSchema).default([]),
})

// ============================================================================
// 类型导出
// ============================================================================

export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>
export type MCPGlobalConfig = z.infer<typeof MCPGlobalConfigSchema>

// ============================================================================
// 配置工具函数
// ============================================================================

/**
 * 解析环境变量占位符
 * 支持 ${VAR} 语法
 *
 * @example
 * resolveEnvVars("Bearer ${TOKEN}") // "Bearer abc123" (如果 TOKEN=abc123)
 */
export function resolveEnvVars(str: string): string {
  return str.replace(/\$\{([^}]+)\}/g, (_, varName) => {
    return process.env[varName] ?? ""
  })
}

/**
 * 解析服务器配置中的环境变量
 * 处理 url、headers、env 字段中的 ${VAR} 占位符
 */
export function resolveServerConfig(
  config: MCPServerConfig
): MCPServerConfig {
  return {
    ...config,
    url: config.url ? resolveEnvVars(config.url) : undefined,
    headers: config.headers
      ? Object.fromEntries(
          Object.entries(config.headers).map(([k, v]) => [
            k,
            resolveEnvVars(v),
          ])
        )
      : undefined,
    env: config.env
      ? Object.fromEntries(
          Object.entries(config.env).map(([k, v]) => [
            k,
            resolveEnvVars(v),
          ])
        )
      : undefined,
  }
}

/**
 * 验证并解析 MCP 全局配置
 *
 * @throws 如果配置无效会抛出 ZodError
 */
export function validateMCPConfig(
  config: unknown
): MCPGlobalConfig | undefined {
  if (!config) return undefined

  const result = MCPGlobalConfigSchema.safeParse(config)

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n")
    throw new Error(`MCP configuration error:\n${issues}`)
  }

  // 解析所有服务器配置中的环境变量
  return {
    ...result.data,
    servers: result.data.servers.map(resolveServerConfig),
  }
}

/**
 * 从 settings.json 结构中提取 MCP 配置
 *
 * settings.json 格式:
 * {
 *   "env": { ... },
 *   "mcp": {
 *     "enabled": true,
 *     "servers": [...]
 *   }
 * }
 */
export function extractMCPConfigFromSettings(
  settings: Record<string, unknown>
): MCPGlobalConfig | undefined {
  if (!settings.mcp) return undefined
  return validateMCPConfig(settings.mcp)
}
