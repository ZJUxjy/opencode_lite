/**
 * MCP (Model Context Protocol) 管理器
 *
 * 负责管理多个 MCP 服务器的连接，统一工具注册和调用
 */

import { EventEmitter } from "events"
import type {
  MCPServerConfig,
  MCPConnectionState,
  MCPToolInfo,
  MCPResourceInfo,
  MCPCallToolResult,
  MCPManagerEvents,
} from "./types.js"
import { MCPConnection } from "./connection.js"
import {
  MCPServerExistsError,
  MCPServerNotFoundError,
  MCPToolNotFoundError,
  MCPConfigError,
} from "./errors.js"
import { mcpLog } from "./logger.js"

// ============================================================================
// 管理器选项
// ============================================================================

export interface MCPManagerOptions {
  /** 服务器配置列表 */
  servers?: MCPServerConfig[]
  /** 是否启用 MCP */
  enabled?: boolean
}

// ============================================================================
// MCP 管理器类
// ============================================================================

export class MCPManager extends EventEmitter {
  private connections: Map<string, MCPConnection> = new Map()
  private configs: Map<string, MCPServerConfig> = new Map()
  private enabled: boolean

  /**
   * 工具注册表：toolName -> { tool: MCPToolInfo, connection: MCPConnection }
   *
   * 工具命名格式：{originalToolName} 或 {server}_{originalToolName}（如果冲突）
   */
  private toolRegistry: Map<
    string,
    {
      tool: MCPToolInfo
      connection: MCPConnection
      originalName: string
    }
  > = new Map()

  constructor(options: MCPManagerOptions = {}) {
    super()
    this.enabled = options.enabled ?? true

    // 初始化服务器配置
    if (options.servers) {
      for (const config of options.servers) {
        this.configs.set(config.name, config)
      }
    }

    // 设置默认错误监听器，避免 ERR_UNHANDLED_ERROR
    // Node.js EventEmitter 要求 error 事件必须有监听器
    this.on("error", (serverName: string, error: Error) => {
      mcpLog.error(`MCP server error [${serverName}]:`, error.message)
    })
  }

  // ==========================================================================
  // 生命周期管理
  // ==========================================================================

  /**
   * 初始化所有启用的服务器连接
   */
  async initialize(): Promise<void> {
    if (!this.enabled) {
      return
    }

    const configs = Array.from(this.configs.values()).filter((c) => c.enabled)

    // 并行连接所有服务器
    await Promise.all(
      configs.map(async (config) => {
        try {
          await this.connectServer(config)
        } catch (error) {
          // 单个服务器连接失败不影响其他服务器
          console.error(`[MCP] Failed to connect server ${config.name}:`, error)
        }
      })
    )
  }

  /**
   * 清理所有连接
   */
  async dispose(): Promise<void> {
    await Promise.all(
      Array.from(this.connections.values()).map((conn) => conn.disconnect())
    )
    this.connections.clear()
    this.toolRegistry.clear()
    this.removeAllListeners()
  }

  // ==========================================================================
  // 服务器管理
  // ==========================================================================

  /**
   * 添加并连接服务器
   */
  async addServer(config: MCPServerConfig): Promise<void> {
    if (this.connections.has(config.name)) {
      throw new MCPServerExistsError(config.name)
    }

    this.configs.set(config.name, config)

    if (config.enabled && this.enabled) {
      await this.connectServer(config)
    }
  }

  /**
   * 移除服务器
   */
  async removeServer(name: string): Promise<void> {
    const connection = this.connections.get(name)
    if (connection) {
      await connection.disconnect()
      this.connections.delete(name)
      this.unregisterServerTools(name)
    }
    this.configs.delete(name)
  }

  /**
   * 重启服务器
   */
  async restartServer(name: string): Promise<void> {
    const connection = this.connections.get(name)
    if (!connection) {
      throw new MCPServerNotFoundError(name)
    }

    await connection.reconnect()
  }

  /**
   * 更新服务器配置
   */
  async updateServerConfig(
    name: string,
    updates: Partial<Omit<MCPServerConfig, "name">>
  ): Promise<void> {
    const existing = this.configs.get(name)
    if (!existing) {
      throw new MCPServerNotFoundError(name)
    }

    const newConfig = { ...existing, ...updates }
    this.configs.set(name, newConfig)

    // 如果连接存在，需要重新连接以应用配置
    if (this.connections.has(name)) {
      await this.removeServer(name)
      if (newConfig.enabled) {
        await this.addServer(newConfig)
      }
    }
  }

  // ==========================================================================
  // 工具管理
  // ==========================================================================

  /**
   * 获取所有可用工具
   */
  getAllTools(): MCPToolInfo[] {
    return Array.from(this.toolRegistry.values()).map((entry) => entry.tool)
  }

  /**
   * 查找工具
   */
  findTool(toolName: string):
    | {
        tool: MCPToolInfo
        connection: MCPConnection
        originalName: string
      }
    | undefined {
    return this.toolRegistry.get(toolName)
  }

  /**
   * 调用工具
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<MCPCallToolResult> {
    const entry = this.toolRegistry.get(toolName)
    if (!entry) {
      // 尝试从工具名解析服务器名称（如果符合 mcp_server_tool 格式）
      const parsed = this.parseToolName(toolName)
      throw new MCPToolNotFoundError(parsed.server, parsed.tool || toolName)
    }

    return await entry.connection.callTool(
      entry.originalName,
      args,
      timeoutMs
    )
  }

  // ==========================================================================
  // 查询接口
  // ==========================================================================

  /**
   * 获取服务器状态
   */
  getServerState(name: string): MCPConnectionState | undefined {
    const connection = this.connections.get(name)
    const config = this.configs.get(name)

    if (!config) {
      return undefined
    }

    if (connection) {
      return {
        name,
        config,
        status: connection.getStatus(),
        errorHistory: connection.getErrorHistory(),
      }
    }

    // 未连接但有配置
    return {
      name,
      config,
      status: { type: "disconnected" },
      errorHistory: [],
    }
  }

  /**
   * 获取所有服务器状态
   */
  getAllServerStates(): MCPConnectionState[] {
    const states: MCPConnectionState[] = []

    // 已连接的服务器
    for (const [name, connection] of this.connections) {
      const config = this.configs.get(name)
      if (config) {
        states.push({
          name,
          config,
          status: connection.getStatus(),
          errorHistory: connection.getErrorHistory(),
        })
      }
    }

    // 有配置但未连接的服务器
    for (const [name, config] of this.configs) {
      if (!this.connections.has(name)) {
        states.push({
          name,
          config,
          status: { type: "disconnected" },
          errorHistory: [],
        })
      }
    }

    return states
  }

  /**
   * 获取连接实例
   */
  getConnection(name: string): MCPConnection | undefined {
    return this.connections.get(name)
  }

  /**
   * 检查管理器是否启用
   */
  isEnabled(): boolean {
    return this.enabled
  }

  // ==========================================================================
  // 内部方法
  // ==========================================================================

  /**
   * 连接单个服务器
   */
  private async connectServer(config: MCPServerConfig): Promise<void> {
    const connection = new MCPConnection({
      config,
      onStatusChange: (status) => {
        this.emit("server-status-changed", config.name, status)

        if (status.type === "connected") {
          // 获取已注册的工具（名称已修改为 mcp_server_tool 格式）
          const registeredTools = this.getAllTools().filter(t => t.server === config.name)
          this.emit("server-connected", config.name, registeredTools)
        } else if (status.type === "disconnected") {
          this.emit("server-disconnected", config.name, status.error)
        }
      },
      onToolsChange: (tools) => {
        this.registerServerTools(config.name, tools, connection)
        // 获取已注册的工具（名称已修改为 mcp_server_tool 格式）
        const registeredTools = this.getAllTools().filter(t => t.server === config.name)
        this.emit("tools-changed", config.name, registeredTools)
      },
      onError: (error) => {
        this.emit("error", config.name, error)
      },
    })

    this.connections.set(config.name, connection)
    await connection.connect()
  }

  /**
   * 注册服务器工具到全局注册表
   */
  private registerServerTools(
    serverName: string,
    tools: MCPToolInfo[],
    connection: MCPConnection
  ): void {
    // 先移除该服务器的旧工具
    this.unregisterServerTools(serverName)

    // 注册新工具
    for (const tool of tools) {
      const uniqueName = this.generateUniqueToolName(serverName, tool.name)

      this.toolRegistry.set(uniqueName, {
        tool: {
          ...tool,
          name: uniqueName, // 使用唯一名称
        },
        connection,
        originalName: tool.name,
      })

      mcpLog.debug(`Registered tool: ${uniqueName} (from ${serverName}:${tool.name})`)
    }
  }

  /**
   * 注销服务器的所有工具
   */
  private unregisterServerTools(serverName: string): void {
    for (const [toolName, entry] of this.toolRegistry) {
      if (entry.tool.server === serverName) {
        this.toolRegistry.delete(toolName)
      }
    }
  }

  /**
   * 生成唯一的工具名称
   *
   * 策略：
   * 1. 始终使用 mcp_{server}_{tool} 格式前缀，避免与内置工具冲突
   * 2. 如果冲突，添加数字后缀
   */
  private generateUniqueToolName(
    serverName: string,
    toolName: string
  ): string {
    // 清理名称（移除特殊字符）
    const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_")

    const cleanToolName = sanitize(toolName)
    const prefixedName = `mcp_${sanitize(serverName)}_${cleanToolName}`

    // 策略 1：使用标准前缀格式
    if (!this.toolRegistry.has(prefixedName)) {
      return prefixedName
    }

    // 策略 2：添加数字后缀
    let counter = 1
    while (this.toolRegistry.has(`${prefixedName}_${counter}`)) {
      counter++
    }
    return `${prefixedName}_${counter}`
  }

  /**
   * 解析工具名称，尝试提取服务器名称和工具名称
   */
  private parseToolName(toolName: string): { server: string; tool?: string } {
    // 如果符合 mcp_server_tool 格式，解析出服务器名
    if (toolName.startsWith("mcp_")) {
      const parts = toolName.split("_")
      if (parts.length >= 3) {
        return {
          server: parts[1],
          tool: parts.slice(2).join("_").replace(/_\d+$/, ""),
        }
      }
    }
    return { server: "unknown", tool: toolName }
  }
}

// 类型声明，使 EventEmitter 方法可用
export declare interface MCPManager {
  on<K extends keyof MCPManagerEvents>(
    event: K,
    listener: MCPManagerEvents[K]
  ): this
  emit<K extends keyof MCPManagerEvents>(
    event: K,
    ...args: Parameters<MCPManagerEvents[K]>
  ): boolean
}
