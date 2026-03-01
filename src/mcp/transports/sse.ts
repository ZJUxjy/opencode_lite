/**
 * MCP SSE 传输层实现
 *
 * 通过服务器发送事件 (Server-Sent Events) 与 MCP 服务器通信
 */

import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"
import {
  MCPTransportBase,
  type MCPTransportConfig,
} from "../transport.js"
import { MCPTransportError } from "../errors.js"

/**
 * SSE 传输层实现
 */
export class SSETransport extends MCPTransportBase {
  private transport?: SSEClientTransport

  /**
   * 启动 SSE 传输层
   */
  protected async _doStart(): Promise<void> {
    const { url, headers } = this.config

    if (!url) {
      throw new MCPTransportError(
        this.serverName,
        "URL is required for SSE transport",
        "sse",
        false
      )
    }

    try {
      // 创建 SSE 传输层
      this.transport = new SSEClientTransport(new URL(url), {
        requestInit: {
          headers: headers || {},
        },
        // SSE 特定配置
        eventSourceInit: {},
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
        `Failed to connect to SSE endpoint: ${error instanceof Error ? error.message : String(error)}`,
        "sse",
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
        "sse",
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
