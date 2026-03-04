# MCP Status Monitoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 MCP 服务器状态监控、使用统计和诊断工具，提供 `/mcp status` 命令查看各服务器状态。

**Architecture:** 扩展 MCPManager 添加统计追踪，创建 status 工具展示服务器健康状态，添加诊断命令。

**Tech Stack:** TypeScript, MCP SDK, Ink (UI)

---

## Overview

当前 MCP 支持功能：
- 服务器连接和工具注册
- 基本错误处理

需要添加：
1. **状态监控**: 服务器在线/离线状态
2. **使用统计**: 工具调用次数、成功率
3. **诊断命令**: /mcp status, /mcp diagnose
4. **错误提示**: 配置错误诊断

---

## Task 1: Add MCP Statistics Tracking

**Files:**
- Create: `src/mcp/stats.ts`

**Step 1: Create statistics tracker**

```typescript
// src/mcp/stats.ts

export interface ToolCallRecord {
  toolName: string
  serverName: string
  timestamp: number
  duration: number
  success: boolean
  error?: string
}

export interface ServerStats {
  name: string
  totalCalls: number
  successfulCalls: number
  failedCalls: number
  averageDuration: number
  lastCallAt?: number
  lastError?: string
  lastErrorAt?: number
}

export interface MCPStats {
  servers: Map<string, ServerStats>
  toolCalls: ToolCallRecord[]
  totalCalls: number
  startTime: number
}

/**
 * Tracks MCP server usage statistics
 */
export class MCPStatsTracker {
  private stats: MCPStats
  private maxHistory: number

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
   * Record a tool call
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

    // Add to history
    this.stats.toolCalls.push(record)
    if (this.stats.toolCalls.length > this.maxHistory) {
      this.stats.toolCalls.shift()
    }

    // Update server stats
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

    // Update average duration
    const totalDuration = serverStats.averageDuration * (serverStats.totalCalls - 1) + duration
    serverStats.averageDuration = totalDuration / serverStats.totalCalls

    this.stats.totalCalls++
  }

  /**
   * Get stats for a specific server
   */
  getServerStats(name: string): ServerStats | undefined {
    return this.stats.servers.get(name)
  }

  /**
   * Get all server stats
   */
  getAllStats(): ServerStats[] {
    return Array.from(this.stats.servers.values())
  }

  /**
   * Get recent errors
   */
  getRecentErrors(limit: number = 5): ToolCallRecord[] {
    return this.stats.toolCalls
      .filter((call) => !call.success)
      .slice(-limit)
  }

  /**
   * Get uptime
   */
  getUptime(): number {
    return Date.now() - this.stats.startTime
  }

  /**
   * Clear all stats
   */
  clear(): void {
    this.stats.servers.clear()
    this.stats.toolCalls = []
    this.stats.totalCalls = 0
    this.stats.startTime = Date.now()
  }

  /**
   * Export stats as JSON
   */
  export(): object {
    return {
      servers: Array.from(this.stats.servers.entries()),
      totalCalls: this.stats.totalCalls,
      uptime: this.getUptime(),
    }
  }
}
```

**Step 2: Run TypeScript check**

Run: `npx tsc --noEmit src/mcp/stats.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add src/mcp/stats.ts
git commit -m "feat(mcp): add statistics tracker"
```

---

## Task 2: Integrate Stats with MCPManager

**Files:**
- Modify: `src/mcp/manager.ts:1-50`
- Modify: `src/mcp/manager.ts:200-230` (callTool method)

**Step 1: Add stats tracker to MCPManager**

```typescript
// src/mcp/manager.ts
import { MCPStatsTracker } from "./stats.js"

export class MCPManager extends EventEmitter {
  private connections: Map<string, MCPConnection> = new Map()
  private configs: Map<string, MCPServerConfig> = new Map()
  private toolRegistry: Map<string, { tool: MCPToolInfo; connection: MCPConnection; originalName: string }> = new Map()
  private enabled: boolean
  private stats: MCPStatsTracker  // NEW

  constructor(options: MCPManagerOptions = {}) {
    super()
    this.enabled = options.enabled ?? true
    this.stats = new MCPStatsTracker()  // NEW

    // ... rest of constructor ...
  }

  /**
   * Get stats tracker
   */
  getStats(): MCPStatsTracker {
    return this.stats
  }

  /**
   * Get server health status
   */
  getServerHealth(name: string): {
    status: "healthy" | "degraded" | "unhealthy"
    connected: boolean
    stats?: ServerStats
  } {
    const connection = this.connections.get(name)
    const serverStats = this.stats.getServerStats(name)

    if (!connection) {
      return { status: "unhealthy", connected: false }
    }

    const status = connection.getStatus()
    const connected = status.type === "connected"

    if (!connected) {
      return { status: "unhealthy", connected: false }
    }

    // Determine health based on recent errors
    if (serverStats) {
      const errorRate = serverStats.failedCalls / serverStats.totalCalls
      if (errorRate > 0.5) {
        return { status: "degraded", connected: true, stats: serverStats }
      }
    }

    return { status: "healthy", connected: true, stats: serverStats }
  }

  /**
   * Wrap callTool to track stats
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<MCPCallToolResult> {
    const entry = this.toolRegistry.get(toolName)
    if (!entry) {
      throw new MCPToolNotFoundError("unknown", toolName)
    }

    const startTime = Date.now()
    const serverName = entry.connection["config"].name

    try {
      const result = await entry.connection.callTool(
        entry.originalName,
        args,
        timeoutMs
      )

      const duration = Date.now() - startTime
      this.stats.recordCall(serverName, toolName, duration, true)

      return result
    } catch (error) {
      const duration = Date.now() - startTime
      const errorMsg = error instanceof Error ? error.message : String(error)
      this.stats.recordCall(serverName, toolName, duration, false, errorMsg)
      throw error
    }
  }
}
```

**Step 2: Commit**

```bash
git add src/mcp/manager.ts
git commit -m "feat(mcp): integrate stats tracking with manager"
```

---

## Task 3: Create MCP Status Tool

**Files:**
- Create: `src/tools/mcp-status.ts`

**Step 1: Create MCP status tool**

```typescript
// src/tools/mcp-status.ts
import { z } from "zod"
import type { Tool } from "../types.js"
import { getMCPManager } from "../mcp/index.js"

/**
 * Show MCP server status
 */
export const mcpStatusTool: Tool = {
  name: "mcp_status",
  description: `Show MCP (Model Context Protocol) server status and statistics.

Displays:
- Server connection status (connected/disconnected)
- Health status (healthy/degraded/unhealthy)
- Tool count per server
- Recent error counts
- Average response times

Use this to diagnose MCP connectivity issues.`,

  parameters: z.object({
    server: z.string().optional().describe("Filter to specific server name"),
  }),

  execute: async (params) => {
    const manager = getMCPManager()
    if (!manager) {
      return "MCP not initialized"
    }

    const states = manager.getAllServerStates()
    const lines: string[] = []

    lines.push("# MCP Server Status")
    lines.push("")

    for (const state of states) {
      // Skip if filtering
      if (params.server && state.name !== params.server) {
        continue
      }

      const health = manager.getServerHealth(state.name)
      const statusIcon = health.connected ? "🟢" : "🔴"
      const healthIcon = health.status === "healthy" ? "✓" : health.status === "degraded" ? "⚠" : "✗"

      lines.push(`${statusIcon} **${state.name}**`)
      lines.push(`   Status: ${state.status.type}`)
      lines.push(`   Health: ${healthIcon} ${health.status}`)

      if (health.stats) {
        lines.push(`   Calls: ${health.stats.totalCalls} (${health.stats.successfulCalls} success, ${health.stats.failedCalls} failed)`)
        lines.push(`   Avg Duration: ${Math.round(health.stats.averageDuration)}ms`)
      }

      const tools = manager.getAllTools().filter(t => t.server === state.name)
      lines.push(`   Tools: ${tools.length}`)

      if (health.stats?.lastError) {
        lines.push(`   Last Error: ${health.stats.lastError.slice(0, 100)}`)
      }

      lines.push("")
    }

    if (lines.length === 2) {
      lines.push("No MCP servers configured.")
      lines.push("")
      lines.push("Add servers to settings.json:")
      lines.push('```json')
      lines.push('"mcp": {')
      lines.push('  "servers": {')
      lines.push('    "my-server": {')
      lines.push('      "command": "node",')
      lines.push('      "args": ["server.js"]')
      lines.push('    }')
      lines.push('  }')
      lines.push('}')
      lines.push('```')
    }

    return lines.join("\n")
  },
}

/**
 * Diagnose MCP issues
 */
export const mcpDiagnoseTool: Tool = {
  name: "mcp_diagnose",
  description: `Diagnose MCP server configuration and connectivity issues.

Checks:
- Configuration validity
- Server process availability
- Tool registration status
- Recent errors

Example: mcp_diagnose server="my-server"`,

  parameters: z.object({
    server: z.string().optional().describe("Specific server to diagnose (default: all)"),
  }),

  execute: async (params) => {
    const manager = getMCPManager()
    if (!manager) {
      return "❌ MCP not initialized"
    }

    const lines: string[] = []
    lines.push("# MCP Diagnostics")
    lines.push("")

    const states = manager.getAllServerStates()

    for (const state of states) {
      if (params.server && state.name !== params.server) {
        continue
      }

      lines.push(`## ${state.name}`)
      lines.push("")

      // Check connection
      if (state.status.type !== "connected") {
        lines.push("❌ Not connected")
        lines.push(`   Status: ${state.status.type}`)

        if (state.status.type === "error" && state.status.error) {
          lines.push(`   Error: ${state.status.error.message}`)
        }

        lines.push("")
        lines.push("**Possible causes:**")
        lines.push("- Server process not running")
        lines.push("- Incorrect command/path in settings.json")
        lines.push("- Missing dependencies")
        lines.push("")
        continue
      }

      lines.push("✅ Connected")

      // Check tools
      const tools = manager.getAllTools().filter(t => t.server === state.name)
      if (tools.length === 0) {
        lines.push("⚠️  No tools registered")
        lines.push("")
        lines.push("Server is connected but no tools are available.")
        lines.push("The server may not be implementing the tool protocol correctly.")
      } else {
        lines.push(`✅ ${tools.length} tools registered`)
        lines.push("")
        lines.push("Tools:")
        for (const tool of tools.slice(0, 5)) {
          lines.push(`  - ${tool.name}`)
        }
        if (tools.length > 5) {
          lines.push(`  ... and ${tools.length - 5} more`)
        }
      }

      lines.push("")
    }

    // Show recent errors
    const stats = manager.getStats()
    const recentErrors = stats.getRecentErrors(3)

    if (recentErrors.length > 0) {
      lines.push("## Recent Errors")
      lines.push("")

      for (const error of recentErrors) {
        lines.push(`- ${error.serverName}.${error.toolName}: ${error.error}`)
      }

      lines.push("")
    }

    return lines.join("\n")
  },
}
```

**Step 2: Create getMCPManager helper**

```typescript
// src/mcp/index.ts
// Export a helper to get the global manager instance
let globalMCPManager: MCPManager | null = null

export function setGlobalMCPManager(manager: MCPManager): void {
  globalMCPManager = manager
}

export function getMCPManager(): MCPManager | null {
  return globalMCPManager
}
```

**Step 3: Register tools**

```typescript
// src/tools/index.ts
import { mcpStatusTool, mcpDiagnoseTool } from "./mcp-status.js"

const allTools = [
  // ... existing tools ...
  mcpStatusTool,
  mcpDiagnoseTool,
]
```

**Step 4: Commit**

```bash
git add src/tools/mcp-status.ts src/tools/index.ts src/mcp/index.ts
git commit -m "feat(mcp): add status and diagnose tools"
```

---

## Task 4: Add CLI Commands

**Files:**
- Modify: `src/index.tsx` (CLI commands)

**Step 1: Add /mcp command**

```typescript
// In CLI command definitions
program
  .command("mcp")
  .description("MCP server management")
  .addCommand(
    new Command("status")
      .description("Show MCP server status")
      .argument("[server]", "Specific server name")
      .action(async (server) => {
        const { mcpStatusTool } = await import("./tools/mcp-status.js")
        const result = await mcpStatusTool.execute({ server })
        console.log(result)
      })
  )
  .addCommand(
    new Command("diagnose")
      .description("Diagnose MCP issues")
      .argument("[server]", "Specific server name")
      .action(async (server) => {
        const { mcpDiagnoseTool } = await import("./tools/mcp-status.js")
        const result = await mcpDiagnoseTool.execute({ server })
        console.log(result)
      })
  )
```

**Step 2: Commit**

```bash
git add src/index.tsx
git commit -m "feat(cli): add mcp status and diagnose commands"
```

---

## Task 5: Update UI Status Bar

**Files:**
- Modify: `src/App.tsx` (status bar component)

**Step 1: Enhance MCP status display**

```typescript
// In App status bar section
const getMcpStatusColor = () => {
  if (mcpStatus.total === 0) return "gray"
  const ratio = mcpStatus.connected / mcpStatus.total
  if (ratio === 1) return "green"
  if (ratio >= 0.5) return "yellow"
  return "red"
}

const getMcpStatusIcon = () => {
  if (mcpStatus.total === 0) return "○"
  const ratio = mcpStatus.connected / mcpStatus.total
  if (ratio === 1) return "🔌"
  if (ratio >= 0.5) return "⚠"
  return "🔴"
}

// In JSX
<Box>
  <Text color={getMcpStatusColor()}>
    {getMcpStatusIcon()} MCP {mcpStatus.connected}/{mcpStatus.total}
  </Text>
</Box>
```

**Step 2: Commit**

```bash
git add src/App.tsx
git commit -m "feat(ui): enhance MCP status bar with health colors"
```

---

## Task 6: Add Tests

**Files:**
- Create: `src/mcp/__tests__/stats.test.ts`

**Step 1: Write stats tests**

```typescript
import { describe, it, expect, beforeEach } from "vitest"
import { MCPStatsTracker } from "../stats.js"

describe("MCPStatsTracker", () => {
  let tracker: MCPStatsTracker

  beforeEach(() => {
    tracker = new MCPStatsTracker()
  })

  it("should record successful call", () => {
    tracker.recordCall("server1", "tool1", 100, true)

    const stats = tracker.getServerStats("server1")
    expect(stats).toBeDefined()
    expect(stats!.totalCalls).toBe(1)
    expect(stats!.successfulCalls).toBe(1)
    expect(stats!.failedCalls).toBe(0)
  })

  it("should record failed call", () => {
    tracker.recordCall("server1", "tool1", 100, false, "Timeout")

    const stats = tracker.getServerStats("server1")
    expect(stats!.totalCalls).toBe(1)
    expect(stats!.successfulCalls).toBe(0)
    expect(stats!.failedCalls).toBe(1)
    expect(stats!.lastError).toBe("Timeout")
  })

  it("should calculate average duration", () => {
    tracker.recordCall("server1", "tool1", 100, true)
    tracker.recordCall("server1", "tool1", 200, true)
    tracker.recordCall("server1", "tool1", 300, true)

    const stats = tracker.getServerStats("server1")
    expect(stats!.averageDuration).toBe(200)
  })

  it("should limit history size", () => {
    const smallTracker = new MCPStatsTracker(5)

    for (let i = 0; i < 10; i++) {
      smallTracker.recordCall("server1", "tool1", 100, true)
    }

    // Internal array should be limited to 5
    expect(smallTracker["stats"].toolCalls.length).toBe(5)
  })

  it("should return recent errors", () => {
    tracker.recordCall("server1", "tool1", 100, true)
    tracker.recordCall("server1", "tool2", 100, false, "Error 1")
    tracker.recordCall("server1", "tool1", 100, true)
    tracker.recordCall("server1", "tool3", 100, false, "Error 2")

    const errors = tracker.getRecentErrors(2)
    expect(errors).toHaveLength(2)
    expect(errors[0].error).toBe("Error 1")
    expect(errors[1].error).toBe("Error 2")
  })
})
```

**Step 2: Run tests**

Run: `npm test -- --run src/mcp/__tests__/stats.test.ts`
Expected: All tests pass

**Step 3: Commit**

```bash
git add src/mcp/__tests__/stats.test.ts
git commit -m "test(mcp): add stats tracker tests"
```

---

## Task 7: Update Documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add MCP monitoring documentation**

```markdown
### MCP Status Monitoring

Monitor MCP (Model Context Protocol) server health and usage:

**Check status:**
```
/mcp_status                    # Show all servers
/mcp_status server="my-mcp"    # Show specific server
```

**Diagnose issues:**
```
/mcp_diagnose                  # Diagnose all servers
/mcp_diagnose server="my-mcp"  # Diagnose specific server
```

**Status indicators:**
- 🟢 Connected and healthy
- ⚠️ Connected but degraded (high error rate)
- 🔴 Disconnected or unhealthy

**CLI commands:**
```bash
lite-opencode mcp status
lite-opencode mcp diagnose [server]
```

**Statistics tracked:**
- Total calls per server
- Success/failure rates
- Average response time
- Recent errors
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add MCP monitoring documentation"
```

---

## Summary

This implementation adds:

1. **MCPStatsTracker**: Records tool calls, tracks success/failure rates
2. **Server Health**: Healthy/degraded/unhealthy status based on error rates
3. **mcp_status Tool**: View server status and statistics
4. **mcp_diagnose Tool**: Diagnose configuration and connectivity issues
5. **CLI Commands**: mcp status and mcp diagnose
6. **Enhanced UI**: Status bar shows health with color coding
7. **Test Coverage**: Stats tracker unit tests

**Total estimated time**: 1 day
**Breaking changes**: None
**Observability improvement**: High (detailed MCP visibility)
