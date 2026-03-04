# Lite OpenCode

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

轻量级 AI 编程助手，实现 ReAct（推理+行动）模式。受 Claude Code、gemini-cli 和 kimi-cli 启发。

[English Documentation](README.md)

## ✨ 功能特性

### 🤖 双策略支持
- **函数调用 (FC)**: 支持原生工具调用的模型（Claude、GPT-4、Gemini 等）
- **思维链 (CoT)**: 为其他模型提供 ReAct 提示格式，支持流式解析

### 🛠️ 内置工具
- **文件操作**: read、write、edit、glob、grep
- **系统命令**: bash 命令执行
- **规划模式**: 任务分解和计划制定
- **子代理**: 并行探索，支持资源限制
- **技能系统**: 动态能力激活

### 🔐 安全特性（新增）
- **Token 加密**: 使用系统钥匙串或 AES-256-GCM 加密文件安全存储 API 密钥
- **风险分级审批**: 三级风险（低/中/高），支持配置自动批准
- **权限控制**: 始终允许 / 允许一次 / 拒绝，支持学习记忆

### 📊 MCP 集成（新增）
- **服务器管理**: 连接多个 MCP 服务器
- **状态监控**: 健康检查和用量统计
- **工具注册**: 自动发现和注册工具

### 🔄 技能系统（新增）
- **热重载**: SKILL.md 文件变更时自动重载
- **动态激活**: LLM 驱动的技能选择
- **依赖管理**: 自动解析依赖关系

### 💬 增强 TUI（新增）
- **消息分组**: 按类型折叠的消息组
- **颜色编码**: 不同类型消息的视觉效果
- **快捷键**: Ctrl+E（展开）、Ctrl+C（折叠）、Ctrl+H（隐藏系统消息）

### 📝 会话管理
- **持久化会话**: 基于 SQLite 的消息存储
- **会话恢复**: 继续之前的对话
- **上下文压缩**: 达到 92% 阈值时自动压缩

## 🚀 安装

```bash
# 克隆仓库
git clone https://github.com/ZJUxjy/opencode_lite.git
cd opencode_lite

# 安装依赖
npm install

# 构建项目
npm run build

# 可选：全局链接
npm link
```

## ⚡ 快速开始

### 1. 配置 API 密钥

```bash
# 使用安全 Token 存储（推荐）
npx lite-opencode config set-token anthropic sk-ant-xxxxx

# 或设置环境变量
export ANTHROPIC_API_KEY=sk-ant-xxxxx
```

### 2. 启动会话

```bash
# 开始新会话
npm start

# 或带参数启动
npm start -- -m claude-3-opus-20240229 -d ./my-project
```

### 3. 可用命令

```bash
# 会话管理
--list-sessions          # 列出所有会话
--resume [session-id]    # 恢复会话
--continue               # 继续当前目录的最后一个会话

# 高级选项
--no-stream              # 禁用流式输出
--compression-threshold 0.92  # 设置上下文压缩阈值
```

## ⚙️ 配置

### 配置文件

在项目根目录或 `~/.lite-opencode/` 创建 `settings.json`：

```json
{
  "env": {
    "ANTHROPIC_API_KEY": "sk-ant-xxxxx",
    "ANTHROPIC_MODEL": "claude-3-opus-20240229"
  },
  "mcp": {
    "servers": {
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
      }
    }
  },
  "policy": {
    "risk": {
      "autoApprove": ["low"],
      "promptApprove": ["medium", "high"],
      "deny": []
    }
  }
}
```

### 风险分级审批

配置自动批准级别：

```json
{
  "policy": {
    "risk": {
      "autoApprove": ["low"],        // 自动批准读取操作
      "promptApprove": ["medium", "high"],  // 写入/系统命令需询问
      "deny": []                      // 默认不禁用任何操作
    }
  }
}
```

## 🛠️ 开发

```bash
# 开发模式（热重载）
npm run dev

# 运行测试
npm test

# 监听模式运行测试
npm run test:watch

# 生产构建
npm run build
```

## 📁 项目结构

```
.
├── src/
│   ├── agent.ts           # 核心代理逻辑
│   ├── App.tsx            # TUI 界面
│   ├── llm.ts             # LLM 客户端
│   ├── policy.ts          # 权限引擎
│   ├── react/             # ReAct 系统
│   │   ├── runner.ts      # 策略路由器
│   │   ├── fc-runner.ts   # 函数调用
│   │   └── cot-runner.ts  # 思维链
│   ├── tools/             # 工具实现
│   ├── skills/            # 技能系统
│   ├── tokens/            # Token 加密（新增）
│   ├── mcp/               # MCP 集成（新增）
│   ├── messages/          # 消息类型（新增）
│   └── prompts/           # 系统提示词
├── skills/                # 内置技能
└── docs/                  # 文档
```

## 🧪 测试

```bash
# 运行所有测试
npm test

# 运行特定测试文件
npm test -- src/tokens/__tests__/service.test.ts

# 带覆盖率运行
npm run test:coverage
```

## 🔧 故障排除

### Token 存储问题

```bash
# 检查 Token 存储类型
npx lite-opencode config list-tokens

# 如果钥匙串不可用，将回退到加密文件
# 加密文件位置：~/.lite-opencode/tokens.enc
```

### MCP 连接问题

```bash
# 检查 MCP 服务器状态
npx lite-opencode mcp status

# 诊断特定服务器
npx lite-opencode mcp diagnose <server-name>
```

### 调试模式

```bash
# 启用调试输出
DEBUG=1 npm start
```

## 🤝 贡献

1. Fork 仓库
2. 创建功能分支（`git checkout -b feature/amazing-feature`）
3. 提交更改（`git commit -m 'feat: add amazing feature'`）
4. 推送到分支（`git push origin feature/amazing-feature`）
5. 打开 Pull Request

## 📄 许可

[MIT](LICENSE) © 2024 Lite OpenCode 贡献者

## 🙏 致谢

灵感来自：
- [Claude Code](https://claude.ai/code) - AI 结对编程
- [gemini-cli](https://github.com/google-gemini/gemini-cli) - Google 的 AI CLI
- [kimi-cli](https://github.com/moonshot-ai/kimi-cli) - Moonshot AI CLI

## 📞 支持

- [Issues](https://github.com/ZJUxjy/opencode_lite/issues)
- [Discussions](https://github.com/ZJUxjy/opencode_lite/discussions)

---

<p align="center">使用 ❤️ 和 TypeScript、Node.js 构建</p>
