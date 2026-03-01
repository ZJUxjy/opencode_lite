/**
 * MCP Streamable HTTP 传输层实现
 *
 * MCP 2025-03-26 协议新增的传输方式，支持流式双向通信
 */

import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"
import {
  MCPTransportBase,
  type MCPTransportConfig,
} from "../transport.js"
import { MCPTransportError } from "../errors.js"

/**
 * Streamable HTTP 传输层实现
 */
export class StreamableHTTPTransport extends MCPTransportBase {
  private transport?: StreamableHTTPClientTransport

  /**
   * 启动 Streamable HTTP 传输层
   */
  protected async _doStart(): Promise<void> {
    const { url, headers } = this.config

    if (!url) {
      throw new MCPTransportError(
        this.serverName,
        "URL is required for streamable-http transport",
        "streamable-http",
        false
      )
    }

    try {
      // 创建 Streamable HTTP 传输层
      this.transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: {
          headers: headers || {},
        },
      })

      // 设置错误处理
      this.transport.onerror = (error) => {
        this._triggerError(error)
      }

      // 设置关闭处理
      this.transport.onclose = () => {
        this._triggerClose()
      }

      // 设置消息处理
      this.transport.onmessage = (message: JSONRPCMessage) => {
        this._triggerMessage(message)
      }

      // 启动传输层
      await this.transport.start()
    } catch (error) {
      throw new MCPTransportError(
        this.serverName,
        `Failed to connect to streamable HTTP endpoint: ${error instanceof Error ? error.message : String(error)}`,
        "streamable-http",
        true,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * 发送消息
   */
  protected async _doSend(message: JSONRPCMessage): Promise<void> {
    if (!this.transport) {
      throw new MCPTransportError(
        this.serverName,
        "Transport not initialized",
        "streamable-http",
        false
      )
    }

    await this.transport.send(message)
  }

  /**
   * 关闭传输层
   */
  protected async _doClose(): Promise<void> {
    if (this.transport) {
      await this.transport.close()
      this.transport = undefined
    }
  }
}
