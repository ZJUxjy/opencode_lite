/**
 * MCP (Model Context Protocol) 模块
 *
 * 提供 MCP 客户端功能，支持连接外部 MCP 服务器并使用其工具。
 *
 * @example
 * ```typescript
 * import { MCPManager } from "./mcp/index.js"
 *
 * const manager = new MCPManager({
 *   config: [
 *     {
 *       name: "filesystem",
 *       transport: "stdio",
 *       command: "npx",
 *       args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"],
 *     },
 *   ],
 * })
 *
 * await manager.initialize()
 * ```
 */

// ============================================================================
// 类型导出
// ============================================================================

export type {
  MCPServerConfig,
  MCPGlobalConfig,
  MCPConnectionStatus,
  MCPConnectionState,
  MCPToolInfo,
  MCPResourceInfo,
  MCPContent,
  MCPTextContent,
  MCPImageContent,
  MCPResourceContent,
  MCPCallToolResult,
  MCPTransportType,
  MCPTransportOptions,
  MCPManagerEvents,
} from "./types.js"

// ============================================================================
// 配置导出
// ============================================================================

export {
  MCPServerConfigSchema,
  MCPGlobalConfigSchema,
  resolveEnvVars,
  resolveServerConfig,
  validateMCPConfig,
  extractMCPConfigFromSettings,
} from "./config.js"

// ============================================================================
// 错误导出
// ============================================================================

export {
  MCPError,
  MCPConfigError,
  MCPServerConfigError,
  MCPConnectionError,
  MCPTransportError,
  MCPConnectionTimeoutError,
  MCPToolError,
  MCPToolNotFoundError,
  MCPToolTimeoutError,
  MCPToolParamError,
  MCPServerNotConnectedError,
  MCPServerExistsError,
  MCPServerNotFoundError,
  isMCPError,
  isRetryableError,
  formatMCPError,
} from "./errors.js"

// ============================================================================
// 传输层导出
// ============================================================================

export {
  MCPTransportBase,
  createTransport,
  type MCPTransportConfig,
} from "./transport.js"

export { StdioTransport } from "./transports/stdio.js"
export { SSETransport } from "./transports/sse.js"
export { StreamableHTTPTransport } from "./transports/streamable-http.js"

// ============================================================================
// 连接管理导出
// ============================================================================

export {
  MCPConnection,
  type MCPConnectionOptions,
} from "./connection.js"

// ============================================================================
// 管理器导出
// ============================================================================

export {
  MCPManager,
  type MCPManagerOptions,
} from "./manager.js"

// ============================================================================
// 工具导出
// ============================================================================

export {
  createMCPToolWrapper,
  isMCPToolName,
  parseMCPToolName,
} from "./tools.js"

// ============================================================================
// 日志导出
// ============================================================================

export {
  setMCPLogLevel,
  getMCPLogLevel,
  setMCPLogger,
  getMCPLogger,
  createServerLogger,
  mcpLog,
  defaultLogger,
  type MCPLogger,
  type MCPLogLevel,
} from "./logger.js"
