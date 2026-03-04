/**
 * MCP Statistics Tracking
 *
 * Tracks MCP server usage statistics including tool calls,
 * success/failure rates, and response times.
 */

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 单次工具调用记录
 */
export interface ToolCallRecord {
  /** 工具名称 */
  toolName: string
  /** 服务器名称 */
  serverName: string
  /** 调用时间戳 */
  timestamp: number
  /** 调用耗时（毫秒） */
  duration: number
  /** 是否成功 */
  success: boolean
  /** 错误信息（如果失败） */
  error?: string
}

/**
 * 服务器统计信息
 */
export interface ServerStats {
  /** 服务器名称 */
  name: string
  /** 总调用次数 */
  totalCalls: number
  /** 成功调用次数 */
  successfulCalls: number
  /** 失败调用次数 */
  failedCalls: number
  /** 平均耗时（毫秒） */
  averageDuration: number
  /** 最后调用时间 */
  lastCallAt?: number
  /** 最后错误信息 */
  lastError?: string
  /** 最后错误时间 */
  lastErrorAt?: number
}

/**
 * MCP 整体统计
 */
export interface MCPStats {
  /** 各服务器统计 */
  servers: Map<string, ServerStats>
  /** 工具调用历史 */
  toolCalls: ToolCallRecord[]
  /** 总调用次数 */
  totalCalls: number
  /** 启动时间 */
  startTime: number
}

// ============================================================================
// MCPStatsTracker 类
// ============================================================================

/**
 * MCP 服务器使用统计追踪器
 *
 * @example
 * ```typescript
 * const tracker = new MCPStatsTracker()
 *
 * // 记录成功调用
 * tracker.recordCall("filesystem", "read_file", 150, true)
 *
 * // 记录失败调用
 * tracker.recordCall("fetch", "fetch_url", 2000, false, "Timeout")
 *
 * // 获取统计
 * const stats = tracker.getServerStats("filesystem")
 * console.log(stats?.averageDuration) // 150
 * ```
 */
export class MCPStatsTracker {
  private stats: MCPStats
  private maxHistory: number

  /**
   * @param maxHistory 最大历史记录数量
   */
  constructor(maxHistory: number = 100) {
    this.maxHistory = maxHistory
    this.stats = {
      servers: new Map(),
      toolCalls: [],
      totalCalls: 0,
      startTime: Date.now(),
    }
  }

  /**
   * 记录一次工具调用
   *
   * @param serverName 服务器名称
   * @param toolName 工具名称
   * @param duration 调用耗时（毫秒）
   * @param success 是否成功
   * @param error 错误信息（如果失败）
   */
  recordCall(
    serverName: string,
    toolName: string,
    duration: number,
    success: boolean,
    error?: string
  ): void {
    const record: ToolCallRecord = {
      toolName,
      serverName,
      timestamp: Date.now(),
      duration,
      success,
      error,
    }

    // 添加到历史记录
    this.stats.toolCalls.push(record)
    if (this.stats.toolCalls.length > this.maxHistory) {
      this.stats.toolCalls.shift()
    }

    // 更新服务器统计
    let serverStats = this.stats.servers.get(serverName)
    if (!serverStats) {
      serverStats = {
        name: serverName,
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        averageDuration: 0,
      }
      this.stats.servers.set(serverName, serverStats)
    }

    serverStats.totalCalls++
    serverStats.lastCallAt = Date.now()

    if (success) {
      serverStats.successfulCalls++
    } else {
      serverStats.failedCalls++
      serverStats.lastError = error
      serverStats.lastErrorAt = Date.now()
    }

    // 更新平均耗时（增量计算）
    const totalDuration =
      serverStats.averageDuration * (serverStats.totalCalls - 1) + duration
    serverStats.averageDuration = totalDuration / serverStats.totalCalls

    this.stats.totalCalls++
  }

  /**
   * 获取指定服务器的统计信息
   */
  getServerStats(name: string): ServerStats | undefined {
    return this.stats.servers.get(name)
  }

  /**
   * 获取所有服务器的统计信息
   */
  getAllStats(): ServerStats[] {
    return Array.from(this.stats.servers.values())
  }

  /**
   * 获取最近的错误记录
   *
   * @param limit 最大返回数量
   */
  getRecentErrors(limit: number = 5): ToolCallRecord[] {
    return this.stats.toolCalls
      .filter((call) => !call.success)
      .slice(-limit)
  }

  /**
   * 获取运行时间（毫秒）
   */
  getUptime(): number {
    return Date.now() - this.stats.startTime
  }

  /**
   * 获取总调用次数
   */
  getTotalCalls(): number {
    return this.stats.totalCalls
  }

  /**
   * 清除所有统计
   */
  clear(): void {
    this.stats.servers.clear()
    this.stats.toolCalls = []
    this.stats.totalCalls = 0
    this.stats.startTime = Date.now()
  }

  /**
   * 导出统计为 JSON 格式
   */
  export(): object {
    return {
      servers: Array.from(this.stats.servers.entries()),
      totalCalls: this.stats.totalCalls,
      uptime: this.getUptime(),
    }
  }
}
