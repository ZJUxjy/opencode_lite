/**
 * MCP (Model Context Protocol) 错误类型定义
 *
 * 提供详细的错误分类和处理
 */

// ============================================================================
// 基础错误类
// ============================================================================

/**
 * MCP 基础错误类
 */
export class MCPError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = "MCPError"

    // 保持原型链
    Object.setPrototypeOf(this, MCPError.prototype)
  }
}

// ============================================================================
// 配置错误
// ============================================================================

/**
 * 配置验证错误
 */
export class MCPConfigError extends MCPError {
  constructor(message: string, public readonly validationErrors?: string[]) {
    super(message, "CONFIG_ERROR")
    this.name = "MCPConfigError"
    Object.setPrototypeOf(this, MCPConfigError.prototype)
  }
}

/**
 * 服务器配置错误
 */
export class MCPServerConfigError extends MCPConfigError {
  constructor(
    public readonly serverName: string,
    message: string,
    validationErrors?: string[]
  ) {
    super(`[${serverName}] ${message}`, validationErrors)
    this.name = "MCPServerConfigError"
    Object.setPrototypeOf(this, MCPServerConfigError.prototype)
  }
}

// ============================================================================
// 连接错误
// ============================================================================

/**
 * 连接错误
 */
export class MCPConnectionError extends MCPError {
  constructor(
    public readonly serverName: string,
    message: string,
    public readonly isRetryable: boolean = true,
    cause?: Error
  ) {
    super(
      `[${serverName}] Connection error: ${message}`,
      "CONNECTION_ERROR",
      cause
    )
    this.name = "MCPConnectionError"
    Object.setPrototypeOf(this, MCPConnectionError.prototype)
  }
}

/**
 * 传输层错误
 */
export class MCPTransportError extends MCPConnectionError {
  constructor(
    serverName: string,
    message: string,
    public readonly transportType: string,
    isRetryable: boolean = true,
    cause?: Error
  ) {
    super(serverName, `Transport (${transportType}): ${message}`, isRetryable, cause)
    this.name = "MCPTransportError"
    Object.setPrototypeOf(this, MCPTransportError.prototype)
  }
}

/**
 * 连接超时错误
 */
export class MCPConnectionTimeoutError extends MCPConnectionError {
  constructor(serverName: string, timeoutMs: number) {
    super(
      serverName,
      `Connection timeout after ${timeoutMs}ms`,
      true // 可重试
    )
    this.name = "MCPConnectionTimeoutError"
    Object.setPrototypeOf(this, MCPConnectionTimeoutError.prototype)
  }
}

// ============================================================================
// 工具调用错误
// ============================================================================

/**
 * 工具调用错误
 */
export class MCPToolError extends MCPError {
  constructor(
    public readonly serverName: string,
    public readonly toolName: string,
    message: string,
    public readonly isErrorResult: boolean = false,
    cause?: Error
  ) {
    super(
      `[${serverName}] Tool '${toolName}' error: ${message}`,
      "TOOL_ERROR",
      cause
    )
    this.name = "MCPToolError"
    Object.setPrototypeOf(this, MCPToolError.prototype)
  }
}

/**
 * 工具未找到错误
 */
export class MCPToolNotFoundError extends MCPToolError {
  constructor(serverName: string, toolName: string) {
    super(serverName, toolName, `Tool not found`, false)
    this.name = "MCPToolNotFoundError"
    Object.setPrototypeOf(this, MCPToolNotFoundError.prototype)
  }
}

/**
 * 工具调用超时错误
 */
export class MCPToolTimeoutError extends MCPToolError {
  constructor(serverName: string, toolName: string, timeoutMs: number) {
    super(
      serverName,
      toolName,
      `Tool call timeout after ${timeoutMs}ms`,
      true
    )
    this.name = "MCPToolTimeoutError"
    Object.setPrototypeOf(this, MCPToolTimeoutError.prototype)
  }
}

/**
 * 工具参数验证错误
 */
export class MCPToolParamError extends MCPToolError {
  constructor(
    serverName: string,
    toolName: string,
    public readonly paramErrors: string[]
  ) {
    super(
      serverName,
      toolName,
      `Invalid parameters:\n${paramErrors.map((e) => `  - ${e}`).join("\n")}`,
      false
    )
    this.name = "MCPToolParamError"
    Object.setPrototypeOf(this, MCPToolParamError.prototype)
  }
}

// ============================================================================
// 服务器状态错误
// ============================================================================

/**
 * 服务器未连接错误
 */
export class MCPServerNotConnectedError extends MCPError {
  constructor(public readonly serverName: string) {
    super(
      `[${serverName}] Server is not connected`,
      "SERVER_NOT_CONNECTED"
    )
    this.name = "MCPServerNotConnectedError"
    Object.setPrototypeOf(this, MCPServerNotConnectedError.prototype)
  }
}

/**
 * 服务器已存在错误
 */
export class MCPServerExistsError extends MCPError {
  constructor(public readonly serverName: string) {
    super(
      `[${serverName}] Server already exists`,
      "SERVER_EXISTS"
    )
    this.name = "MCPServerExistsError"
    Object.setPrototypeOf(this, MCPServerExistsError.prototype)
  }
}

/**
 * 服务器未找到错误
 */
export class MCPServerNotFoundError extends MCPError {
  constructor(public readonly serverName: string) {
    super(
      `[${serverName}] Server not found`,
      "SERVER_NOT_FOUND"
    )
    this.name = "MCPServerNotFoundError"
    Object.setPrototypeOf(this, MCPServerNotFoundError.prototype)
  }
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 检查错误是否是 MCP 错误
 */
export function isMCPError(error: unknown): error is MCPError {
  return error instanceof MCPError
}

/**
 * 检查错误是否是连接错误（可重试）
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof MCPConnectionError) {
    return error.isRetryable
  }
  if (error instanceof MCPToolError) {
    return !error.isErrorResult
  }
  return false
}

/**
 * 格式化错误消息用于显示
 */
export function formatMCPError(error: unknown): string {
  if (isMCPError(error)) {
    let message = error.message
    if (error.cause) {
      message += `\n  Caused by: ${error.cause.message}`
    }
    return message
  }

  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
