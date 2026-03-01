/**
 * MCP (Model Context Protocol) 类型定义
 *
 * 定义 MCP 客户端所需的核心类型和接口
 */

import type { z } from "zod"
import type {
  MCPServerConfigSchema,
  MCPGlobalConfigSchema,
} from "./config.js"

// ============================================================================
// 配置类型
// ============================================================================

export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>
export type MCPGlobalConfig = z.infer<typeof MCPGlobalConfigSchema>

// ============================================================================
// 连接状态
// ============================================================================

export type MCPConnectionStatus =
  | { type: "disconnected"; error?: string }
  | { type: "connecting" }
  | {
      type: "connected"
      tools: MCPToolInfo[]
      resources?: MCPResourceInfo[]
    }

export interface MCPConnectionState {
  name: string
  config: MCPServerConfig
  status: MCPConnectionStatus
  errorHistory: Array<{
    message: string
    timestamp: number
    level: "error" | "warn" | "info"
  }>
}

// ============================================================================
// JSON Schema 类型定义
// ============================================================================

/** JSON Schema 基础类型 */
export type JSONSchemaType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null"

/** JSON Schema 定义 */
export interface JSONSchema {
  type?: JSONSchemaType | JSONSchemaType[]
  title?: string
  description?: string
  default?: unknown
  enum?: unknown[]
  const?: unknown

  // String properties
  minLength?: number
  maxLength?: number
  pattern?: string
  format?: string

  // Number properties
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
  multipleOf?: number

  // Object properties
  properties?: Record<string, JSONSchema>
  required?: string[]
  additionalProperties?: boolean | JSONSchema
  propertyNames?: JSONSchema
  minProperties?: number
  maxProperties?: number

  // Array properties
  items?: JSONSchema | JSONSchema[]
  prefixItems?: JSONSchema[]
  minItems?: number
  maxItems?: number
  uniqueItems?: boolean

  // Composition
  allOf?: JSONSchema[]
  anyOf?: JSONSchema[]
  oneOf?: JSONSchema[]
  not?: JSONSchema
  if?: JSONSchema
  then?: JSONSchema
  else?: JSONSchema

  // References
  $ref?: string
  $defs?: Record<string, JSONSchema>
  definitions?: Record<string, JSONSchema>

  // Additional metadata
  [key: string]: unknown
}

// ============================================================================
// 工具和资源
// ============================================================================

export interface MCPToolInfo {
  /** 工具原始名称（来自 MCP 服务器） */
  name: string
  /** 工具描述 */
  description?: string
  /** 工具输入参数的 JSON Schema */
  inputSchema: JSONSchema
  /** 所属服务器名称 */
  server: string
}

export interface MCPResourceInfo {
  /** 资源 URI */
  uri: string
  /** 资源名称 */
  name?: string
  /** MIME 类型 */
  mimeType?: string
}

// ============================================================================
// 工具调用结果
// ============================================================================

export type MCPTextContent = {
  type: "text"
  text: string
}

export type MCPImageContent = {
  type: "image"
  data: string // base64
  mimeType: string
}

export type MCPResourceContent = {
  type: "resource"
  resource: {
    uri: string
    mimeType?: string
    text?: string
    blob?: string // base64
  }
}

export type MCPContent = MCPTextContent | MCPImageContent | MCPResourceContent

export interface MCPCallToolResult {
  content: MCPContent[]
  isError?: boolean
}

// ============================================================================
// 传输层类型
// ============================================================================

export type MCPTransportType = "stdio" | "sse" | "streamable-http"

export interface MCPTransportOptions {
  /** 服务器配置 */
  config: MCPServerConfig
  /** 错误回调 */
  onError?: (error: Error) => void
  /** 关闭回调 */
  onClose?: () => void
}

// ============================================================================
// Manager 事件
// ============================================================================

export interface MCPManagerEvents {
  /** 服务器状态变更 */
  "server-status-changed": (name: string, status: MCPConnectionStatus) => void
  /** 服务器连接成功 */
  "server-connected": (name: string, tools: MCPToolInfo[]) => void
  /** 服务器断开连接 */
  "server-disconnected": (name: string, error?: string) => void
  /** 工具列表变更 */
  "tools-changed": (server: string, tools: MCPToolInfo[]) => void
  /** 发生错误 */
  error: (server: string, error: Error) => void
}
