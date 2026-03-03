/**
 * MCP (Model Context Protocol) 传输层抽象基类
 *
 * 定义传输层的通用接口，由具体实现类（stdio, sse, streamable-http）继承
 */

import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import type { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js"
import type { MCPServerConfig } from "./types.js"
import { MCPTransportError } from "./errors.js"
import { mcpLog } from "./logger.js"

export type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"

// ============================================================================
// 传输层配置
// ============================================================================

export interface MCPTransportConfig {
  /** 服务器名称（用于日志和错误） */
  serverName: string
  /** 服务器配置 */
  config: MCPServerConfig
  /** 连接超时（毫秒） */
  connectTimeout?: number
}

// ============================================================================
// 传输层抽象基类
// ============================================================================

/**
 * MCP 传输层抽象基类
 *
 * 所有具体传输层实现（StdioTransport, SSETransport, StreamableHTTPTransport）
 * 都需要继承此类并实现抽象方法
 */
export abstract class MCPTransportBase implements Transport {
  protected readonly serverName: string
  protected readonly config: MCPServerConfig
  protected readonly connectTimeout: number

  /** 是否已连接 */
  protected _connected = false

  // ==========================================================================
  // SDK Transport 接口属性（SDK 会直接设置这些属性）
  // ==========================================================================

  /** 消息回调（SDK 直接设置此属性） */
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void

  /** 错误回调（SDK 直接设置此属性） */
  onerror?: (error: Error) => void

  /** 关闭回调（SDK 直接设置此属性） */
  onclose?: () => void

  /** 会话 ID */
  sessionId?: string

  constructor(config: MCPTransportConfig) {
    this.serverName = config.serverName
    this.config = config.config
    this.connectTimeout = config.connectTimeout ?? 30000 // 默认 30 秒
  }

  // -------------------------------------------------------------------------
  // Transport 接口实现
  // -------------------------------------------------------------------------

  /**
   * 启动传输层连接
   * 子类应该实现 _doStart 方法
   */
  async start(): Promise<void> {
    if (this._connected) {
      throw new MCPTransportError(
        this.serverName,
        "Transport already started",
        this.config.transport,
        false
      )
    }

    try {
      await this._doStart()
      this._connected = true
    } catch (error) {
      throw new MCPTransportError(
        this.serverName,
        `Failed to start transport: ${error instanceof Error ? error.message : String(error)}`,
        this.config.transport,
        true,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * 发送消息
   * 子类应该实现 _doSend 方法
   */
  async send(message: JSONRPCMessage): Promise<void> {
    if (!this._connected) {
      throw new MCPTransportError(
        this.serverName,
        "Transport not connected",
        this.config.transport,
        false
      )
    }

    try {
      await this._doSend(message)
    } catch (error) {
      throw new MCPTransportError(
        this.serverName,
        `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
        this.config.transport,
        true,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * 关闭传输层连接
   * 子类应该实现 _doClose 方法
   */
  async close(): Promise<void> {
    if (!this._connected) {
      return
    }

    this._connected = false

    try {
      await this._doClose()
    } catch (error) {
      // 关闭时的错误通常不需要抛出，只需要记录
      mcpLog.error(
        `[${this.serverName}] Error during transport close: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  // -------------------------------------------------------------------------
  // 状态查询
  // -------------------------------------------------------------------------

  /**
   * 检查传输层是否已连接
   */
  get connected(): boolean {
    return this._connected
  }

  // -------------------------------------------------------------------------
  // 抽象方法（子类必须实现）
  // -------------------------------------------------------------------------

  /**
   * 启动传输层的具体实现
   */
  protected abstract _doStart(): Promise<void>

  /**
   * 发送消息的具体实现
   */
  protected abstract _doSend(message: JSONRPCMessage): Promise<void>

  /**
   * 关闭传输层的具体实现
   */
  protected abstract _doClose(): Promise<void>

  // -------------------------------------------------------------------------
  // 受保护的方法（供子类使用）
  // -------------------------------------------------------------------------

  /**
   * 触发错误事件
   */
  protected _triggerError(error: Error): void {
    if (this.onerror) {
      this.onerror(error)
    }
  }

  /**
   * 触发关闭事件
   */
  protected _triggerClose(): void {
    this._connected = false
    if (this.onclose) {
      this.onclose()
    }
  }

  /**
   * 触发消息事件
   */
  protected _triggerMessage(message: JSONRPCMessage): void {
    if (this.onmessage) {
      this.onmessage(message)
    }
  }

  /**
   * 包装错误为 MCPTransportError
   */
  protected _wrapError(message: string, cause?: Error): MCPTransportError {
    return new MCPTransportError(
      this.serverName,
      message,
      this.config.transport,
      true,
      cause
    )
  }
}

// ============================================================================
// 传输层工厂
// ============================================================================

/**
 * 创建传输层的工厂函数
 *
 * 根据配置自动选择对应的具体实现类
 */
export async function createTransport(
  serverName: string,
  config: MCPServerConfig
): Promise<MCPTransportBase> {
  const transportConfig: MCPTransportConfig = {
    serverName,
    config,
  }

  switch (config.transport) {
    case "stdio": {
      const { StdioTransport } = await import("./transports/stdio.js")
      return new StdioTransport(transportConfig)
    }

    case "sse": {
      const { SSETransport } = await import("./transports/sse.js")
      return new SSETransport(transportConfig)
    }

    case "streamable-http": {
      const { StreamableHTTPTransport } = await import(
        "./transports/streamable-http.js"
      )
      return new StreamableHTTPTransport(transportConfig)
    }

    default: {
      // TypeScript 穷尽检查 - 如果到达这里说明有未知的传输类型
      const unknownTransport: string =
        typeof config.transport === "string" ? config.transport : "unknown"
      throw new MCPTransportError(
        serverName,
        `Unknown transport type: ${unknownTransport}`,
        unknownTransport,
        false
      )
    }
  }
}
