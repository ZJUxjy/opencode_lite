# MCP (Model Context Protocol) 集成方案设计

## 1. 设计目标

为 Lite OpenCode 添加 MCP 客户端能力，支持连接外部 MCP 服务器并使用其提供的工具。

### 核心功能
- 连接多个 MCP 服务器（stdio/SSE/StreamableHTTP）
- 自动发现和注册 MCP 工具到 ToolRegistry
- 工具调用和结果处理
- 配置热重载
- 连接状态管理

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Agent (agent.ts)                               │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                      MCPManager (mcp/manager.ts)                 │    │
│  │  - 多服务器管理                                                  │    │
│  │  - 配置管理                                                      │    │
│  │  - 生命周期协调                                                  │    │
│  └─────────────────────────────┬───────────────────────────────────┘    │
│                                │                                        │
│              ┌─────────────────┼─────────────────┐                      │
│              │                 │                 │                      │
│              ▼                 ▼                 ▼                      │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐           │
│  │  MCPConnection  │ │  MCPConnection  │ │  MCPConnection  │           │
│  │  (server-1)     │ │  (server-2)     │ │  (server-N)     │           │
│  └────────┬────────┘ └────────┬────────┘ └────────┬────────┘           │
│           │                   │                   │                     │
│           ▼                   ▼                   ▼                     │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐           │
│  │  MCPTransport   │ │  MCPTransport   │ │  MCPTransport   │           │
│  │  (stdio/sse)    │ │  (streamable)   │ │  (sse)          │           │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      ToolRegistry (tools/index.ts)                       │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐           │
│  │  Built-in Tools │ │  MCP Tools      │ │  Skills Tools   │           │
│  │  (read/write)   │ │  (mcp_*)        │ │  (skill_*)      │           │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘           │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| MCP SDK | `@modelcontextprotocol/sdk` 1.25+ | 官方 SDK，支持 Streamable HTTP 新协议 |
| 传输协议 | 优先 SSE，回退 Streamable HTTP | 兼容性好，参考 Dify 实现 |
| 工具命名 | `mcp_{server}_{tool}` | 避免名称冲突，清晰标识来源 |
| 状态管理 | 可辨识联合类型 + EventEmitter | 类型安全，支持事件订阅 |
| 配置存储 | settings.json 扩展 | 与现有配置系统一致 |

---

## 3. 目录结构

```
src/mcp/
├── index.ts                 # 导出所有 MCP 相关类型和类
├── manager.ts               # MCPManager - 多服务器管理
├── connection.ts            # MCPConnection - 单连接管理
├── transport.ts             # MCPTransport 抽象基类
├── transports/
│   ├── stdio.ts             # StdioTransport 实现
│   ├── sse.ts               # SSETransport 实现
│   └── streamable-http.ts   # StreamableHTTPTransport 实现
├── tools.ts                 # MCP 工具包装器
├── resources.ts             # MCP 资源管理
├── prompts.ts               # MCP Prompts 管理
├── config.ts                # 配置定义和验证
├── config-watcher.ts        # 配置文件热重载
├── auth/
│   ├── oauth.ts             # OAuth 2.0 认证实现
│   └── token-storage.ts     # 安全令牌存储
├── logging.ts               # 调试日志和指标
├── types.ts                 # MCP 类型定义
├── errors.ts                # 错误类型定义
└── __tests__/               # 单元测试
    ├── config.test.ts
    ├── errors.test.ts
    ├── tools.test.ts
    └── connection.test.ts
```

---

## 4. 核心接口定义

### 4.1 MCP Server 配置

```typescript
// src/mcp/config.ts

import { z } from "zod"

export const MCPServerConfigSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  timeout: z.number().min(1).max(3600).default(60), // 秒

  // 传输类型
  transport: z.enum(["stdio", "sse", "streamable-http"]),

  // stdio 配置
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),

  // HTTP 配置
  url: z.string().url().optional(),
  headers: z.record(z.string()).optional(),
})

export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>

export const MCPGlobalConfigSchema = z.object({
  enabled: z.boolean().default(true),
  servers: z.array(MCPServerConfigSchema).default([]),
})

export type MCPGlobalConfig = z.infer<typeof MCPGlobalConfigSchema>
```

### 4.2 连接状态

```typescript
// src/mcp/types.ts

export type MCPConnectionStatus =
  | { type: "disconnected"; error?: string }
  | { type: "connecting" }
  | { type: "connected"; tools: MCPToolInfo[]; resources?: MCPResourceInfo[] }

export interface MCPToolInfo {
  name: string
  description?: string
  inputSchema: any
  server: string // 所属服务器
}

export interface MCPResourceInfo {
  uri: string
  name?: string
  mimeType?: string
}

export interface MCPConnectionState {
  name: string
  config: MCPServerConfig
  status: MCPConnectionStatus
  errorHistory: Array<{ message: string; timestamp: number; level: "error" | "warn" | "info" }>
}
```

### 4.3 MCPManager

```typescript
// src/mcp/manager.ts

import { EventEmitter } from "events"
import type { MCPServerConfig, MCPConnectionState, MCPToolInfo } from "./types.js"

export interface MCPManagerOptions {
  config: MCPServerConfig[]
  enabled?: boolean
}

export interface MCPManagerEvents {
  "server-connected": (name: string, tools: MCPToolInfo[]) => void
  "server-disconnected": (name: string, error?: string) => void
  "tools-changed": (server: string, tools: MCPToolInfo[]) => void
  "error": (server: string, error: Error) => void
}

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

export class MCPManager extends EventEmitter {
  private connections: Map<string, MCPConnection> = new Map()
  private toolRegistry: Map<string, MCPToolInfo> = new Map() // toolName -> toolInfo
  private config: MCPServerConfig[]
  private enabled: boolean

  constructor(options: MCPManagerOptions)

  // 生命周期管理
  async initialize(): Promise<void>
  async dispose(): Promise<void>

  // 服务器管理
  async addServer(config: MCPServerConfig): Promise<void>
  async removeServer(name: string): Promise<void>
  async restartServer(name: string): Promise<void>
  async updateServerConfig(name: string, config: Partial<MCPServerConfig>): Promise<void>

  // 查询接口
  getAllTools(): MCPToolInfo[]
  getServerState(name: string): MCPConnectionState | undefined
  getAllServerStates(): MCPConnectionState[]
  findTool(toolName: string): MCPToolInfo | undefined

  // 工具调用
  async callTool(toolName: string, args: Record<string, unknown>): Promise<{
    content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>
    isError?: boolean
  }>
}
```

### 4.4 MCPConnection

```typescript
// src/mcp/connection.ts

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { MCPServerConfig, MCPConnectionStatus, MCPToolInfo, MCPResourceInfo } from "./types.js"

export interface MCPConnectionOptions {
  config: MCPServerConfig
  onStatusChange?: (status: MCPConnectionStatus) => void
  onToolsChange?: (tools: MCPToolInfo[]) => void
  onError?: (error: Error) => void
}

export class MCPConnection {
  readonly name: string
  private config: MCPServerConfig
  private client: Client | null = null
  private status: MCPConnectionStatus = { type: "disconnected" }
  private tools: MCPToolInfo[] = []
  private resources: MCPResourceInfo[] = []

  constructor(options: MCPConnectionOptions)

  // 连接管理
  async connect(): Promise<void>
  async disconnect(): Promise<void>
  async reconnect(): Promise<void>

  // 工具和资源
  async listTools(): Promise<MCPToolInfo[]>
  async listResources(): Promise<MCPResourceInfo[]>
  async callTool(name: string, args: Record<string, unknown>, timeout?: number): Promise<any>
  async readResource(uri: string): Promise<any>

  // 状态查询
  getStatus(): MCPConnectionStatus
  getTools(): MCPToolInfo[]
  getResources(): MCPResourceInfo[]
}
```

### 4.5 MCP 工具包装器

```typescript
// src/mcp/tools.ts

import type { Tool } from "../types.js"
import type { MCPManager } from "./manager.js"
import type { MCPToolInfo } from "./types.js"

/**
 * 创建 MCP 工具包装器
 * 将 MCP 工具转换为 Lite OpenCode 的 Tool 接口
 */
export function createMCPToolWrapper(
  toolInfo: MCPToolInfo,
  manager: MCPManager
): Tool {
  const fullName = `mcp_${toolInfo.server}_${toolInfo.name}`

  return {
    name: fullName,
    description: formatToolDescription(toolInfo),
    parameters: convertJSONSchemaToZod(toolInfo.inputSchema),
    execute: async (params, ctx) => {
      const result = await manager.callTool(toolInfo.name, params)

      // 处理结果
      const textParts: string[] = []
      for (const item of result.content) {
        if (item.type === "text") {
          textParts.push(item.text)
        } else if (item.type === "image") {
          textParts.push(`[Image: ${item.mimeType}]`)
        }
      }

      return textParts.join("\n")
    },
  }
}

/**
 * 格式化工具描述
 */
function formatToolDescription(toolInfo: MCPToolInfo): string {
  const parts = [
    `[MCP:${toolInfo.server}]`,
    toolInfo.description || `Tool: ${toolInfo.name}`,
  ]
  return parts.filter(Boolean).join(" ")
}
```

---

## 5. 与现有系统集成

### 5.1 与 ToolRegistry 集成

```typescript
// src/tools/index.ts 修改

import type { MCPManager } from "../mcp/manager.js"
import { createMCPToolWrapper } from "../mcp/tools.js"

export class ToolRegistry {
  private tools = new Map<string, Tool>()
  private mcpManager?: MCPManager

  constructor() {
    // 注册内置工具...
  }

  /**
   * 设置 MCP Manager 并监听工具变更
   */
  setMCPManager(manager: MCPManager): void {
    this.mcpManager = manager

    // 注册现有 MCP 工具
    for (const toolInfo of manager.getAllTools()) {
      this.register(createMCPToolWrapper(toolInfo, manager))
    }

    // 监听新增/变更的工具
    manager.on("server-connected", (_, tools) => {
      for (const toolInfo of tools) {
        this.register(createMCPToolWrapper(toolInfo, manager))
      }
    })

    manager.on("tools-changed", (_, tools) => {
      // 重新注册该服务器的所有工具
      for (const toolInfo of tools) {
        const fullName = `mcp_${toolInfo.server}_${toolInfo.name}`
        this.tools.delete(fullName)
        this.register(createMCPToolWrapper(toolInfo, manager))
      }
    })

    manager.on("server-disconnected", (serverName) => {
      // 移除该服务器的所有工具
      for (const [name, tool] of this.tools.entries()) {
        if (name.startsWith(`mcp_${serverName}_`)) {
          this.tools.delete(name)
        }
      }
    })
  }
}
```

### 5.2 与 Agent 集成

```typescript
// src/agent.ts 修改

import { MCPManager } from "./mcp/manager.js"

export interface AgentConfig {
  // ... 现有配置
  mcp?: {
    enabled?: boolean
    servers?: MCPServerConfig[]
  }
}

export class Agent {
  private mcpManager?: MCPManager

  constructor(sessionId: string, config: AgentConfig) {
    // ... 现有初始化

    // 初始化 MCP
    if (config.mcp?.enabled !== false && config.mcp?.servers?.length) {
      this.mcpManager = new MCPManager({
        config: config.mcp.servers,
        enabled: config.mcp.enabled ?? true,
      })
      this.tools.setMCPManager(this.mcpManager)
    }
  }

  async initialize(): Promise<void> {
    // ... 现有初始化

    // 初始化 MCP 连接
    if (this.mcpManager) {
      await this.mcpManager.initialize()
    }
  }

  getMCPManager(): MCPManager | undefined {
    return this.mcpManager
  }
}
```

### 5.3 配置扩展

```typescript
// settings.json 扩展

{
  "env": {
    "ANTHROPIC_API_KEY": "..."
  },
  "mcp": {
    "enabled": true,
    "servers": [
      {
        "name": "filesystem",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/workspace"],
        "env": {}
      },
      {
        "name": "github",
        "transport": "sse",
        "url": "https://api.github.com/mcp",
        "headers": {
          "Authorization": "Bearer ${GITHUB_TOKEN}"
        }
      },
      {
        "name": "internal-api",
        "transport": "streamable-http",
        "url": "http://localhost:3000/mcp",
        "timeout": 120
      }
    ]
  }
}
```

### 5.4 TUI 集成

```typescript
// src/App.tsx 扩展 - MCP 状态显示

// 在状态栏添加 MCP 指示器
<Box marginBottom={1}>
  <Text>
    <Text color={contextStatus.color}>
      ▌Context: {contextStatus.percent}%
    </Text>
    <Text dimColor> | {modelDisplayName}</Text>
    {agent.isYoloMode() && <Text color="yellow" bold> 🚀 YOLO</Text>}
    {agent.isPlanMode() && <Text color="magenta" bold> 📋 PLAN</Text>}
    {mcpConnected && <Text color="green"> 🔌 MCP</Text>}
    {isProcessing && <Text color="cyan"> ● Processing...</Text>}
  </Text>
</Box>

// 添加 /mcp 命令显示 MCP 服务器状态
```

---

## 6. 实施步骤

### Phase 1: 基础架构 (Week 1)
1. [ ] 创建 `src/mcp/` 目录结构
2. [ ] 实现 `types.ts` - 类型定义
3. [ ] 实现 `config.ts` - 配置验证
4. [ ] 实现 `errors.ts` - 错误类型
5. [ ] 实现 `transport.ts` - 传输层抽象

### Phase 2: 传输层实现 (Week 1-2)
1. [ ] 实现 `transports/stdio.ts`
2. [ ] 实现 `transports/sse.ts`
3. [ ] 实现 `transports/streamable-http.ts`
4. [ ] 编写传输层单元测试

### Phase 3: 连接管理 (Week 2)
1. [ ] 实现 `connection.ts` - 单连接管理
2. [ ] 实现 `manager.ts` - 多服务器管理
3. [ ] 实现工具发现和缓存
4. [ ] 实现连接状态管理

### Phase 4: 工具集成 (Week 3)
1. [ ] 实现 `tools.ts` - 工具包装器
2. [ ] 修改 `ToolRegistry` 集成 MCP
3. [ ] 修改 `Agent` 初始化 MCP
4. [ ] 实现工具调用链路

### Phase 5: 配置和 TUI (Week 3-4)
1. [ ] 扩展 `settings.json` 配置
2. [ ] 修改 `index.tsx` 加载 MCP 配置
3. [ ] 在 `App.tsx` 添加 MCP 状态显示
4. [ ] 添加 `/mcp` 命令

### Phase 6: 测试和文档 (Week 4)
1. [x] 编写集成测试
2. [x] 编写文档
3. [x] 测试常用 MCP 服务器
4. [x] 性能优化

### Phase 7: MCP Resources 支持 (High Priority)

**目标**: 实现 MCP Resources 协议支持，允许 LLM 读取外部资源（文件、API 数据等）。

**功能设计**:
```typescript
// 资源管理接口
export interface MCPResourceManager {
  // 列出所有可用资源
  listResources(): Promise<MCPResourceInfo[]>

  // 读取资源内容
  readResource(uri: string): Promise<ResourceContent>

  // 订阅资源变更通知
  subscribeResource(uri: string): Promise<void>

  // 取消订阅
  unsubscribeResource(uri: string): Promise<void>
}

// 资源内容类型
export interface ResourceContent {
  uri: string
  mimeType: string
  text?: string
  blob?: Uint8Array
  metadata?: Record<string, unknown>
}
```

**实施步骤**:
1. [ ] 扩展 `MCPConnection` 类，添加 `listResources()` 和 `readResource()` 方法
2. [ ] 实现资源缓存层，避免重复读取
3. [ ] 创建 `mcp_read_resource` 内置工具，供 LLM 调用
4. [ ] 实现资源变更订阅机制（SSE/Streamable HTTP 的 notification 支持）
5. [ ] 在 `/mcp` 命令输出中显示可用资源列表
6. [ ] 资源 URI 自动补全支持

**UI 集成**:
- 在 TUI 中添加资源浏览器侧边栏（可选）
- 资源读取结果显示专门的格式化视图（图片、JSON、文本等）

---

### Phase 8: MCP Prompts 支持 (High Priority)

**目标**: 实现 MCP Prompts 协议支持，允许从 MCP 服务器获取预定义的 prompt 模板。

**功能设计**:
```typescript
// Prompt 管理接口
export interface MCPPromptManager {
  // 列出所有可用 prompts
  listPrompts(): Promise<MCPPromptInfo[]>

  // 获取 prompt 详情
  getPrompt(name: string, arguments?: Record<string, string>): Promise<PromptMessage[]>
}

export interface MCPPromptInfo {
  name: string
  description?: string
  arguments?: PromptArgument[]
}

export interface PromptMessage {
  role: "user" | "assistant"
  content: string | ContentPart[]
}
```

**实施步骤**:
1. [ ] 扩展 `MCPConnection` 类，添加 `listPrompts()` 和 `getPrompt()` 方法
2. [ ] 创建 prompt 缓存和版本管理
3. [ ] 实现 `/prompts` 命令，显示所有可用 prompts
4. [ ] 实现 prompt 注入机制：用户可通过 `/use-prompt <name>` 将 MCP prompt 注入到当前对话
5. [ ] 支持 prompt 参数自动补全
6. [ ] Prompt 参数对话框（类似技能激活）

**使用场景**:
```
User: /prompts
System: Available MCP Prompts:
  📝 code_review - Review code changes
  📝 pr_description - Generate PR description
  📝 commit_message - Generate commit message

User: /use-prompt code_review
System: [Prompt injected] You can now paste the code to review.
```

---

### Phase 9: 配置热重载 (Medium Priority)

**目标**: 无需重启程序即可动态添加、移除或修改 MCP 服务器配置。

**功能设计**:
```typescript
export interface MCPConfigWatcher {
  // 监视配置文件变更
  watch(configPath: string): void

  // 停止监视
  unwatch(): void

  // 手动触发重载
  reload(): Promise<ConfigReloadResult>
}

export interface ConfigReloadResult {
  added: string[]      // 新增的服务器
  removed: string[]    // 移除的服务器
  modified: string[]   // 修改配置的服务器
  errors: Array<{ server: string; error: string }>
}
```

**实施步骤**:
1. [ ] 集成 `chokidar` 或 Node.js `fs.watch` 监视配置文件变更
2. [ ] 实现配置差异检测算法（对比新旧配置）
3. [ ] 扩展 `MCPManager` 添加 `reloadConfig()` 方法
4. [ ] 实现优雅的热重载：
   - 新增服务器：启动连接并注册工具
   - 移除服务器：断开连接并注销工具
   - 修改配置：重启对应服务器连接
5. [ ] 添加 `/mcp reload` 命令手动触发重载
6. [ ] 添加配置变更通知到 TUI 状态栏

**安全考虑**:
- 配置变更前进行备份
- 验证新配置有效性后再应用
- 提供回滚机制

---

### Phase 10: OAuth 认证支持 (Medium Priority)

**目标**: 支持 MCP 服务器的 OAuth 2.0 认证流程，用于连接需要用户授权的第三方服务。

**功能设计**:
```typescript
export interface MCPOAuthProvider {
  // 支持的 OAuth 流程
  flows: ("authorization_code" | "client_credentials" | "device_code")[]

  // 启动授权流程
  authorize(serverName: string, config: OAuthConfig): Promise<OAuthResult>

  // 刷新 access token
  refreshToken(serverName: string): Promise<boolean>

  // 清除授权状态
  revoke(serverName: string): Promise<void>
}

export interface OAuthConfig {
  clientId: string
  clientSecret?: string
  authorizationEndpoint: string
  tokenEndpoint: string
  scopes: string[]
  // Device flow 配置
  deviceAuthorizationEndpoint?: string
}
```

**实施步骤**:
1. [ ] 实现 OAuth 2.0 授权码流程
2. [ ] 实现 Device Authorization Flow（用于无浏览器环境）
3. [ ] 创建安全令牌存储（使用系统 keyring 或加密文件）
4. [ ] 扩展 `MCPServerConfig` 支持 OAuth 配置
5. [ ] 实现自动 token 刷新机制
6. [ ] 添加 `/mcp auth <server>` 命令启动授权
7. [ ] 添加授权状态显示到 `/mcp` 命令输出

**配置示例**:
```json
{
  "mcp": {
    "servers": [
      {
        "name": "github",
        "transport": "sse",
        "url": "https://api.github.com/mcp",
        "auth": {
          "type": "oauth",
          "flow": "authorization_code",
          "clientId": "${GITHUB_CLIENT_ID}",
          "scopes": ["repo", "read:user"]
        }
      }
    ]
  }
}
```

---

### Phase 11: 调试日志与可观测性 (Medium Priority)

**目标**: 提供完整的 MCP 调试和监控能力，便于排查问题和优化性能。

**功能设计**:
```typescript
export interface MCPLogger {
  // 日志级别
  level: "debug" | "info" | "warn" | "error"

  // 记录 MCP 协议消息
  logProtocol(server: string, direction: "send" | "receive", message: unknown): void

  // 记录工具调用
  logToolCall(server: string, tool: string, args: unknown, duration: number, result?: unknown): void

  // 记录连接事件
  logConnection(server: string, event: "connecting" | "connected" | "disconnected" | "error", details?: unknown): void
}

export interface MCPMetrics {
  // 连接指标
  connectionUptime: Map<string, number>

  // 工具调用指标
  toolCallCount: Map<string, number>
  toolCallLatency: Map<string, { avg: number; p95: number; p99: number }>
  toolCallErrors: Map<string, number>

  // 资源读取指标
  resourceReadCount: Map<string, number>
  resourceCacheHitRate: number
}
```

**实施步骤**:
1. [ ] 实现结构化日志系统（支持 JSON/文本格式）
2. [ ] 在 transport 层拦截和记录所有 MCP 协议消息
3. [ ] 添加性能指标收集：
   - 连接建立时间
   - 工具调用延迟（avg/p95/p99）
   - 消息吞吐量
4. [ ] 实现 `/mcp logs [server]` 命令查看实时日志
5. [ ] 实现 `/mcp metrics` 命令显示性能统计
6. [ ] 添加日志文件轮转和归档
7. [ ] 可选：集成 OpenTelemetry 导出指标

**日志输出示例**:
```
[2025-01-15 10:23:45] [MCP:filesystem] → {"jsonrpc":"2.0","id":1,"method":"tools/list"}
[2025-01-15 10:23:45] [MCP:filesystem] ← {"jsonrpc":"2.0","id":1,"result":{"tools":[...]}}
[2025-01-15 10:24:12] [MCP:filesystem] TOOL_CALL read_file {"path":"/tmp/test.txt"} (45ms)
```

---

## 7. 关键技术细节

### 7.1 工具命名冲突处理

```typescript
/**
 * 生成唯一的工具名
 * 格式: mcp_{server}_{tool}
 * 如果冲突，添加数字后缀: mcp_{server}_{tool}_1
 */
function generateUniqueToolName(
  serverName: string,
  toolName: string,
  existingNames: Set<string>
): string {
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, "_")
  const base = `mcp_${sanitize(serverName)}_${sanitize(toolName)}`

  if (!existingNames.has(base)) return base

  let counter = 1
  while (existingNames.has(`${base}_${counter}`)) {
    counter++
  }
  return `${base}_${counter}`
}
```

### 7.2 超时和取消处理

```typescript
async callTool(
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs?: number
): Promise<CallToolResult> {
  const connection = this.findConnectionForTool(toolName)
  if (!connection) throw new Error(`Tool ${toolName} not found`)

  const actualTimeout = timeoutMs ?? connection.config.timeout * 1000

  return await Promise.race([
    connection.callTool(toolName, args),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Tool call timeout after ${actualTimeout}ms`)), actualTimeout)
    ),
  ])
}
```

### 7.3 错误处理和重连

```typescript
async connect(): Promise<void> {
  try {
    this.setStatus({ type: "connecting" })

    // 创建 transport
    const transport = await this.createTransport()

    // 设置错误处理
    transport.onerror = (error) => {
      console.error(`MCP transport error for ${this.name}:`, error)
      this.appendError(error.message, "error")
    }

    transport.onclose = () => {
      if (this.status.type !== "disconnected") {
        this.setStatus({ type: "disconnected", error: "Connection closed" })
        this.scheduleReconnect()
      }
    }

    // 创建 client 并连接
    this.client = new Client({ name: "lite-opencode", version: "1.0.0" })
    await this.client.connect(transport)

    // 获取工具列表
    this.tools = await this.listTools()
    this.setStatus({ type: "connected", tools: this.tools })

  } catch (error) {
    this.setStatus({
      type: "disconnected",
      error: error instanceof Error ? error.message : String(error),
    })
    this.scheduleReconnect()
    throw error
  }
}

private scheduleReconnect(): void {
  if (this.reconnectTimer) return

  this.reconnectTimer = setTimeout(() => {
    this.reconnectTimer = undefined
    if (this.config.enabled) {
      this.connect().catch(() => {
        // 重连失败，继续等待下次重连
      })
    }
  }, 5000) // 5秒后重连
}
```

### 7.4 环境变量注入

```typescript
/**
 * 处理环境变量，支持 ${VAR} 语法
 */
function resolveEnvVars(str: string): string {
  return str.replace(/\$\{([^}]+)\}/g, (_, varName) => {
    return process.env[varName] || ""
  })
}

function resolveServerConfig(config: MCPServerConfig): MCPServerConfig {
  return {
    ...config,
    url: config.url ? resolveEnvVars(config.url) : undefined,
    headers: config.headers
      ? Object.fromEntries(
          Object.entries(config.headers).map(([k, v]) => [k, resolveEnvVars(v)])
        )
      : undefined,
    env: config.env
      ? Object.fromEntries(
          Object.entries(config.env).map(([k, v]) => [k, resolveEnvVars(v)])
        )
      : undefined,
  }
}
```

---

## 8. 使用示例

### 8.1 配置文件示例

```json
{
  "mcp": {
    "enabled": true,
    "servers": [
      {
        "name": "filesystem",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/projects"],
        "timeout": 60
      },
      {
        "name": "fetch",
        "transport": "stdio",
        "command": "uvx",
        "args": ["mcp-server-fetch"]
      }
    ]
  }
}
```

### 8.2 代码使用示例

```typescript
import { Agent } from "./agent.js"

const agent = new Agent(sessionId, {
  cwd: process.cwd(),
  dbPath: "./history.db",
  mcp: {
    enabled: true,
    servers: [
      {
        name: "filesystem",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"],
      },
    ],
  },
})

await agent.initialize()

// MCP 工具会自动注册到 ToolRegistry
// LLM 可以调用 mcp_filesystem_read_file 等工具
```

---

## 9. 风险和对策

| 风险 | 影响 | 对策 |
|------|------|------|
| MCP 服务器不稳定 | 工具调用失败 | 连接状态监控 + 自动重连 + 优雅降级 |
| 工具名称冲突 | 工具被覆盖 | 命名空间隔离 `mcp_{server}_{tool}` |
| 工具调用超时 | Agent 卡住 | 可配置超时 + 取消支持 |
| 配置错误 | 启动失败 | Zod 验证 + 详细错误信息 |
| 安全漏洞 | 命令注入 | 严格的输入验证 + 环境变量白名单 |
| 资源读取滥用 | 带宽/存储耗尽 | 资源大小限制 + 缓存策略 + 权限控制 |
| OAuth Token 泄露 | 账户安全风险 | 加密存储 + 定期轮换 + 最小权限原则 |
| 配置热重载失败 | 部分服务器不可用 | 原子更新 + 回滚机制 + 健康检查 |
| 日志文件膨胀 | 磁盘空间耗尽 | 日志轮转 + 自动清理 + 可配置保留策略 |

---

## 10. 开发路线图总结

### 已完成 (Phase 1-6)
| 阶段 | 功能 | 状态 |
|------|------|------|
| Phase 1 | 基础架构 (types, config, errors, transport) | ✅ 完成 |
| Phase 2 | 传输层实现 (stdio, SSE, streamable-http) | ✅ 完成 |
| Phase 3 | 连接管理 (connection, manager) | ✅ 完成 |
| Phase 4 | 工具集成 (tool wrapper, ToolRegistry) | ✅ 完成 |
| Phase 5 | 配置和 TUI (settings, App.tsx, /mcp 命令) | ✅ 完成 |
| Phase 6 | 测试和文档 | ✅ 完成 |

### 高优先级 (Phase 7-8)
| 阶段 | 功能 | 预计时间 | 关键价值 |
|------|------|----------|----------|
| Phase 7 | MCP Resources 支持 | 1-2 周 | 允许 LLM 读取外部数据源 |
| Phase 8 | MCP Prompts 支持 | 1 周 | 复用服务器提供的专业提示词 |

### 中优先级 (Phase 9-11)
| 阶段 | 功能 | 预计时间 | 关键价值 |
|------|------|----------|----------|
| Phase 9 | 配置热重载 | 3-5 天 | 无需重启即可管理 MCP 服务器 |
| Phase 10 | OAuth 认证 | 1-2 周 | 连接第三方授权服务 |
| Phase 11 | 调试日志与可观测性 | 3-5 天 | 便于排查问题和性能优化 |

---

## 11. 参考资源

- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Roo-Code MCP Implementation](https://github.com/RooVetGit/Roo-Code/tree/main/src/services/mcp)
- [KiloCode MCP Implementation](https://github.com/Kilo-Org/kilocode/tree/main/packages/opencode/src/mcp)
- [OpenManus MCP Implementation](https://github.com/mannaandpoem/OpenManus/tree/main/app/tool)
