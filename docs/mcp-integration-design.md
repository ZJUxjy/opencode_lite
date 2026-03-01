# MCP (Model Context Protocol) 开发计划

## 概述

为 lite-opencode 项目添加 MCP 客户端支持，使 Agent 能够调用外部 MCP 服务器提供的工具。

## 技术选型

| 技术点 | 选择 | 说明 |
|-------|------|------|
| SDK | `@modelcontextprotocol/sdk` v1.x | 官方 Node.js SDK |
| 连接方式 | Stdio + StreamableHTTP | 初期支持 stdio，后续支持 HTTP |
| 工具命名 | `mcp__{server}___{tool}` | 使用双下划线分隔服务器和工具，避免冲突 |
| 配置位置 | `~/.lite-opencode/mcp.json` + 项目级 `./.lite-opencode/mcp.json` | 支持全局和项目配置 |
| 资源支持 | Phase 2 | MCP Resources |

## 配置文件格式

```json
{
  "mcpServers": {
    "server-name": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@some/mcp-server"],
      "env": { "KEY": "value" },
      "cwd": "/path/to/workdir",
      "timeout": 60,
      "disabled": false,
      "disabledTools": ["tool-name"]
    }
  }
}
```

## 开发计划

### Phase 1: MCP 核心框架 ✅

- [x] 1.1 安装 MCP SDK 依赖
- [x] 1.2 创建 MCP 模块目录结构
- [x] 1.3 实现 MCPClient 类 - 客户端连接管理
- [x] 1.4 实现 McpServer 类 - 单服务器管理
- [x] 1.5 实现 McpHub 类 - 多服务器管理
- [x] 1.6 定义配置文件 Schema

### Phase 2: 工具集成 ✅

- [x] 2.1 创建 MCP 工具适配器
- [x] 2.2 实现工具名称解析
- [x] 2.3 注册到 ToolRegistry
- [x] 2.4 添加 MCP 工具列表命令

### Phase 3: 配置与 CLI 集成 ✅

- [x] 3.1 配置文件加载逻辑
- [x] 3.2 添加 CLI 参数支持
- [x] 3.3 MCP 状态显示 (TUI)
- [x] 3.4 连接错误处理

### Phase 4: 进阶功能

- [x] 4.1 配置文件热重载
- [x] 4.2 MCP Resources 支持
- [x] 4.3 连接超时与重试
- [x] 4.4 日志与调试模式

## 核心文件结构

```
src/mcp/
├── index.ts           # 导出入口
├── types.ts          # 类型定义
├── config.ts         # 配置加载与验证
├── name.ts           # 工具名称处理
├── client.ts         # MCP 客户端 (单连接)
├── server.ts         # MCP 服务器管理
├── hub.ts            # MCP Hub (多服务器)
└── resource.ts       # Resources 支持 (Phase 4)

src/tools/
└── mcp-tool.ts       # MCP 工具适配器
```

## 实现参考

- Roo-Code: `src/services/mcp/McpHub.ts`
- gemini-cli: `packages/core/src/tools/mcp-client.ts`
- kilocode: `packages/opencode/src/mcp/index.ts`

## CLI 使用示例

```bash
# 配置文件 ~/.lite-opencode/mcp.json
{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    }
  }
}

# 使用 MCP 工具
> mcp_tool server_name: "filesystem" tool_name: "read_file" arguments: {"path": "/tmp/test.txt"}

# 或使用 /mcp 命令查看服务器状态
/mcp
```
