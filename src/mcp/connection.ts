/**
 * MCP (Model Context Protocol) 连接管理
 *
 * 负责单个 MCP 服务器的连接生命周期管理：
 * - 建立和维护连接
 * - 工具发现和缓存
 * - 资源发现
 * - 工具调用执行
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import type {
  MCPServerConfig,
  MCPConnectionStatus,
  MCPToolInfo,
  MCPResourceInfo,
  MCPCallToolResult,
} from "./types.js"
import { createTransport } from "./transport.js"
import {
  MCPConnectionError,
  MCPConnectionTimeoutError,
  MCPServerNotConnectedError,
  MCPToolError,
  MCPToolNotFoundError,
  MCPToolTimeoutError,
} from "./errors.js"
import { createServerLogger, type MCPLogger } from "./logger.js"

// ============================================================================
// 连接选项
// ============================================================================

export interface MCPConnectionOptions {
  /** 服务器配置 */
  config: MCPServerConfig
  /** 连接状态变更回调 */
  onStatusChange?: (status: MCPConnectionStatus) => void
  /** 工具列表变更回调 */
  onToolsChange?: (tools: MCPToolInfo[]) => void
  /** 错误回调 */
  onError?: (error: Error) => void
}

// ============================================================================
// MCP 连接类
// ============================================================================

export class MCPConnection {
  readonly name: string
  private config: MCPServerConfig
  private client: Client | null = null
  private status: MCPConnectionStatus = { type: "disconnected" }
  private tools: MCPToolInfo[] = []
  private resources: MCPResourceInfo[] = []
  private errorHistory: Array<{
    message: string
    timestamp: number
    level: "error" | "warn" | "info"
  }> = []

  // 回调函数
  private onStatusChange?: (status: MCPConnectionStatus) => void
  private onToolsChange?: (tools: MCPToolInfo[]) => void
  private onError?: (error: Error) => void

  // 重连定时器
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private reconnectAttempts = 0
  private readonly maxReconnectAttempts = 5
  private readonly reconnectDelay = 5000 // 5 秒

  // Logger
  private logger: MCPLogger

  constructor(options: MCPConnectionOptions) {
    this.name = options.config.name
    this.config = options.config
    this.onStatusChange = options.onStatusChange
    this.onToolsChange = options.onToolsChange
    this.onError = options.onError
    this.logger = createServerLogger(this.name)
  }

  // ==========================================================================
  // 连接管理
  // ==========================================================================

  /**
   * 建立连接
   */
  async connect(): Promise<void> {
    if (this.status.type === "connected" || this.status.type === "connecting") {
      return
    }

    this.setStatus({ type: "connecting" })

    try {
      // 清理之前的连接
      await this.disconnect()

      // 创建传输层
      const transport = await createTransport(this.name, this.config)

      // 创建 MCP Client
      this.client = new Client(
        {
          name: "lite-opencode",
          version: "1.0.0",
        },
        {
          capabilities: {
            // 声明客户端能力
            sampling: {},
          },
        }
      )

      // 建立连接
      await this.client.connect(transport)

      // 获取服务器信息
      const serverInfo = this.client.getServerVersion()
      const instructions = this.client.getInstructions()

      this.logger.debug("Connected to server:", serverInfo)
      if (instructions) {
        this.logger.debug("Instructions:", instructions)
      }

      // 获取工具列表
      this.tools = await this.listTools()

      // 尝试获取资源列表（某些服务器可能不支持）
      try {
        this.resources = await this.listResources()
      } catch {
        // 资源列表是可选的，失败不阻断连接
        this.resources = []
      }

      // 更新状态
      this.setStatus({
        type: "connected",
        tools: this.tools,
        resources: this.resources,
      })

      // 重置重连计数
      this.reconnectAttempts = 0

      // 通知工具变更
      this.onToolsChange?.(this.tools)

      // 设置关闭监听
      transport.onClose(() => {
        this.handleDisconnect("Transport closed")
      })

      // 设置错误监听
      transport.onError((error: Error) => {
        this.handleError(error)
      })
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      this.appendError(errorMessage, "error")
      this.setStatus({
        type: "disconnected",
        error: errorMessage,
      })

      // 触发错误回调
      if (error instanceof Error) {
        this.onError?.(error)
      }

      // 安排重连
      this.scheduleReconnect()

      throw new MCPConnectionError(
        this.name,
        `Failed to connect: ${errorMessage}`,
        true,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    // 取消重连定时器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }

    if (this.client) {
      try {
        await this.client.close()
      } catch (error) {
        // 关闭时的错误通常可以忽略
        this.logger.debug("Error during disconnect:", error)
      }
      this.client = null
    }

    this.setStatus({ type: "disconnected" })
  }

  /**
   * 重新连接
   */
  async reconnect(): Promise<void> {
    await this.disconnect()
    await this.connect()
  }

  // ==========================================================================
  // 工具操作
  // ==========================================================================

  /**
   * 获取工具列表
   */
  async listTools(): Promise<MCPToolInfo[]> {
    if (!this.client) {
      throw new MCPServerNotConnectedError(this.name)
    }

    try {
      const result = await this.client.listTools()

      return result.tools.map((tool: any) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema || {},
        server: this.name,
      }))
    } catch (error) {
      throw new MCPConnectionError(
        this.name,
        `Failed to list tools: ${error instanceof Error ? error.message : String(error)}`,
        true,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * 调用工具
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<MCPCallToolResult> {
    if (!this.client || this.status.type !== "connected") {
      throw new MCPServerNotConnectedError(this.name)
    }

    // 检查工具是否存在
    const tool = this.tools.find((t) => t.name === toolName)
    if (!tool) {
      throw new MCPToolNotFoundError(this.name, toolName)
    }

    const actualTimeout = timeoutMs || this.config.timeout * 1000

    // 使用 Promise.race 实现超时，确保超时定时器被正确清理
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    try {
      const result = await Promise.race([
        this.client.callTool(
          {
            name: toolName,
            arguments: args,
          },
          CallToolResultSchema,
          { timeout: actualTimeout }
        ),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () =>
              reject(
                new MCPToolTimeoutError(this.name, toolName, actualTimeout)
              ),
            actualTimeout
          )
        }),
      ])

      // 清理超时定时器
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = undefined
      }

      return {
        content: result.content as MCPCallToolResult["content"],
        isError: result.isError as boolean | undefined,
      }
    } catch (error) {
      // 清理超时定时器（如果尚未清理）
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = undefined
      }
      if (error instanceof MCPToolTimeoutError) {
        throw error
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error)

      throw new MCPToolError(
        this.name,
        toolName,
        errorMessage,
        true,
        error instanceof Error ? error : undefined
      )
    }
  }

  // ==========================================================================
  // 资源操作
  // ==========================================================================

  /**
   * 获取资源列表
   */
  async listResources(): Promise<MCPResourceInfo[]> {
    if (!this.client) {
      throw new MCPServerNotConnectedError(this.name)
    }

    try {
      const result = await this.client.listResources()

      return (result.resources || []).map((resource: any) => ({
        uri: resource.uri,
        name: resource.name,
        mimeType: resource.mimeType,
      }))
    } catch {
      // 资源列表是可选功能，失败返回空数组
      return []
    }
  }

  /**
   * 读取资源
   */
  async readResource(uri: string): Promise<any> {
    if (!this.client) {
      throw new MCPServerNotConnectedError(this.name)
    }

    try {
      return await this.client.readResource({ uri })
    } catch (error) {
      throw new MCPConnectionError(
        this.name,
        `Failed to read resource ${uri}: ${error instanceof Error ? error.message : String(error)}`,
        false,
        error instanceof Error ? error : undefined
      )
    }
  }

  // ==========================================================================
  // 状态查询
  // ==========================================================================

  /**
   * 获取连接状态
   */
  getStatus(): MCPConnectionStatus {
    return this.status
  }

  /**
   * 获取工具列表
   */
  getTools(): MCPToolInfo[] {
    return [...this.tools]
  }

  /**
   * 获取资源列表
   */
  getResources(): MCPResourceInfo[] {
    return [...this.resources]
  }

  /**
   * 获取错误历史
   */
  getErrorHistory(): typeof this.errorHistory {
    return [...this.errorHistory]
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.status.type === "connected"
  }

  // ==========================================================================
  // 内部方法
  // ==========================================================================

  /**
   * 设置连接状态
   */
  private setStatus(status: MCPConnectionStatus): void {
    this.status = status
    this.onStatusChange?.(status)
  }

  /**
   * 处理断开连接
   */
  private handleDisconnect(reason: string): void {
    if (this.status.type !== "disconnected") {
      this.setStatus({ type: "disconnected", error: reason })
      this.appendError(reason, "warn")
      this.scheduleReconnect()
    }
  }

  /**
   * 处理错误
   */
  private handleError(error: Error): void {
    this.appendError(error.message, "error")
    this.onError?.(error)
  }

  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return // 已经有重连计划
    }

    if (!this.config.enabled) {
      return // 服务器被禁用
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.appendError(
        `Max reconnect attempts (${this.maxReconnectAttempts}) reached`,
        "error"
      )
      return
    }

    this.reconnectAttempts++

    this.logger.debug(
      `Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${this.reconnectDelay}ms`
    )

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined
      try {
        await this.connect()
      } catch (error) {
        // 记录重连错误，但继续等待下次重连
        // 配置错误不应该重试，但这里只是记录
        const errorMessage = error instanceof Error ? error.message : String(error)
        this.appendError(`Reconnect attempt ${this.reconnectAttempts} failed: ${errorMessage}`, "warn")

        this.logger.debug(`Reconnect attempt ${this.reconnectAttempts} failed:`, error)
      }
    }, this.reconnectDelay)
  }

  /**
   * 添加错误到历史记录
   */
  private appendError(
    message: string,
    level: "error" | "warn" | "info" = "error"
  ): void {
    const MAX_ERROR_LENGTH = 500
    const truncatedMessage =
      message.length > MAX_ERROR_LENGTH
        ? `${message.substring(0, MAX_ERROR_LENGTH)}...`
        : message

    this.errorHistory.push({
      message: truncatedMessage,
      timestamp: Date.now(),
      level,
    })

    // 保留最近 100 条错误
    if (this.errorHistory.length > 100) {
      this.errorHistory = this.errorHistory.slice(-100)
    }
  }
}
