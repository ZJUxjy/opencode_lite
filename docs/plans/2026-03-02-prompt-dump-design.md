# Prompt Dump 功能设计

## 概述

实现一个 Prompt Dump 功能，将发送给 LLM 的完整 prompt（包括 system prompt、消息历史）和 LLM 的响应保存到文件中，便于调试和理解 Agent 的工作流程。

## 需求

- 记录完整的 system prompt
- 记录消息历史
- 记录 LLM 响应
- 支持 CLI 参数和 TUI 命令两种触发方式

## 实现方案

### 架构

```
Agent.run()
    → LLMClient.chatStream()
        → PromptDumper.dump()  ← 在这里拦截
```

选择在 LLMClient 中拦截的原因：
- 所有 LLM 调用都经过 LLMClient
- 代码改动集中
- 容易获取完整的 prompt 信息

### 核心组件

**PromptDumper 类** (`src/utils/promptDumper.ts`)
- 管理 dump 文件的创建和写入
- 格式化输出内容
- 支持动态开关

### 触发方式

| 方式 | 说明 |
|-----|------|
| CLI 参数 | `--dump-prompt` 启用 dump |
| TUI 命令 | `/dump` 切换开/关，显示 dump 文件路径 |

### 输出文件

- 位置: `~/.lite-opencode/dumps/session-{id}.md`
- 格式: Markdown
- 模式: 追加写入，每个 session 一个文件

### 输出格式

```markdown
# Session: test-session-abc123
# Started: 2026-03-02 16:00:00

---

## Request #1 @ 16:00:05

### System Prompt (1498 tokens)
```
[完整 system prompt]
```

### Messages (3 messages)
```
[0] USER: 读取 package.json
[1] ASSISTANT: [tool: read(...)]
[2] USER: [tool result: {...}]
```

### LLM Response
```
响应内容...
```

---

## Request #2 @ 16:00:10
...
```

## 文件变更

| 文件 | 变更 |
|------|------|
| `src/utils/promptDumper.ts` | 新增 - PromptDumper 类 |
| `src/llm.ts` | 修改 - 添加 dump 调用 |
| `src/agent.ts` | 修改 - 传递 dump 配置 |
| `src/index.tsx` | 修改 - 添加 CLI 参数 |
| `src/commands/builtins.ts` | 修改 - 添加 /dump 命令 |

## 测试计划

1. 单元测试 PromptDumper 的格式化功能
2. 测试 CLI 参数 `--dump-prompt`
3. 测试 TUI 命令 `/dump`
4. 验证输出文件格式正确
