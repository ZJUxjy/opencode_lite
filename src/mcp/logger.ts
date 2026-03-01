/**
 * MCP (Model Context Protocol) 日志工具
 *
 * 提供统一的日志输出接口，支持不同的日志级别
 */

export type MCPLogLevel = "debug" | "info" | "warn" | "error"

export interface MCPLogger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

// 默认日志级别
let globalLogLevel: MCPLogLevel =
  process.env.DEBUG_MCP === "1" ? "debug" : "warn"

/**
 * 设置全局日志级别
 */
export function setMCPLogLevel(level: MCPLogLevel): void {
  globalLogLevel = level
}

/**
 * 获取当前日志级别
 */
export function getMCPLogLevel(): MCPLogLevel {
  return globalLogLevel
}

// 日志级别优先级
const LOG_LEVEL_PRIORITY: Record<MCPLogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

/**
 * 检查是否需要输出该级别的日志
 */
function shouldLog(level: MCPLogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[globalLogLevel]
}

/**
 * 创建带前缀的日志消息
 */
function formatMessage(prefix: string, message: string): string {
  return `[${prefix}] ${message}`
}

/**
 * 默认日志实现
 */
export const defaultLogger: MCPLogger = {
  debug(message: string, ...args: unknown[]): void {
    if (shouldLog("debug")) {
      console.log(formatMessage("MCP", message), ...args)
    }
  },

  info(message: string, ...args: unknown[]): void {
    if (shouldLog("info")) {
      console.info(formatMessage("MCP", message), ...args)
    }
  },

  warn(message: string, ...args: unknown[]): void {
    if (shouldLog("warn")) {
      console.warn(formatMessage("MCP", message), ...args)
    }
  },

  error(message: string, ...args: unknown[]): void {
    if (shouldLog("error")) {
      console.error(formatMessage("MCP", message), ...args)
    }
  },
}

// 当前使用的 logger 实例
let currentLogger: MCPLogger = defaultLogger

/**
 * 设置自定义 logger
 */
export function setMCPLogger(logger: MCPLogger): void {
  currentLogger = logger
}

/**
 * 获取当前 logger
 */
export function getMCPLogger(): MCPLogger {
  return currentLogger
}

/**
 * 创建服务器特定的 logger
 */
export function createServerLogger(serverName: string): MCPLogger {
  const prefix = `MCP:${serverName}`
  return {
    debug(message: string, ...args: unknown[]): void {
      if (shouldLog("debug")) {
        console.log(`[${prefix}] ${message}`, ...args)
      }
    },
    info(message: string, ...args: unknown[]): void {
      if (shouldLog("info")) {
        console.info(`[${prefix}] ${message}`, ...args)
      }
    },
    warn(message: string, ...args: unknown[]): void {
      if (shouldLog("warn")) {
        console.warn(`[${prefix}] ${message}`, ...args)
      }
    },
    error(message: string, ...args: unknown[]): void {
      if (shouldLog("error")) {
        console.error(`[${prefix}] ${message}`, ...args)
      }
    },
  }
}

// 导出便捷函数
export const mcpLog = {
  debug: (message: string, ...args: unknown[]) =>
    currentLogger.debug(message, ...args),
  info: (message: string, ...args: unknown[]) =>
    currentLogger.info(message, ...args),
  warn: (message: string, ...args: unknown[]) =>
    currentLogger.warn(message, ...args),
  error: (message: string, ...args: unknown[]) =>
    currentLogger.error(message, ...args),
}
