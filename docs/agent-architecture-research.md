# 开源 AI Agent 架构调研报告

> 调研日期: 2026-02-27
> 调研项目: OpenManus, Roo-Code, dify, gemini-cli, goose, kilocode, opencode, pi-mono

---

## 目录

1. [概述](#概述)
2. [上下文保持策略对比](#1-上下文保持策略对比)
3. [主 Agent 循环设计对比](#2-主-agent-循环设计对比)
4. [Prompt 模块设计对比](#3-prompt-模块设计对比)
5. [各项目详细调研](#各项目详细调研)
6. [关键发现与建议](#关键发现与建议)

---

## 概述

| 项目 | 语言 | 架构特点 |
|------|------|----------|
| **OpenManus** | Python | ReAct 模式，分层 Agent 设计，MCP 集成 |
| **Roo-Code** | TypeScript | VS Code 扩展，非破坏性压缩，双层存储 |
| **dify** | Python | FC + CoT 双策略，流式 ReAct 解析器 |
| **gemini-cli** | TypeScript | 三层压缩机制，事件驱动架构，探测验证 |
| **goose** | Rust | 模块化 Prompt，双重消息可见性，渐进式压缩恢复 |
| **kilocode** | TypeScript | 4 层 Prompt 模块化，OpenTelemetry 集成 |
| **opencode** | TypeScript | 三层上下文管理，Prompt 两段缓存优化 |
| **pi-mono** | TypeScript | 树形会话存储，双层循环，技能系统 |

---

## 1. 上下文保持策略对比

### 1.1 存储方式

| 项目 | 存储方式 | 持久化位置 |
|------|----------|------------|
| OpenManus | Pydantic Memory (内存) | 无持久化 |
| Roo-Code | JSON 文件 | `<globalStorage>/tasks/<taskId>/` |
| dify | SQLAlchemy + 数据库 | 数据库 (Message, MessageAgentThought 表) |
| gemini-cli | JSON 文件 | `~/.gemini/tmp/<hash>/chats/` |
| goose | SQLite | `Paths::data_dir()` |
| kilocode | SQLite (Drizzle ORM) | SessionTable, MessageTable, PartTable |
| opencode | SQLite (Drizzle ORM) | 三表级联存储 |
| pi-mono | JSONL (树形结构) | `~/.pi/agent/sessions/` 或项目目录 |

### 1.2 压缩触发条件

| 项目 | 触发阈值 | 压缩方式 |
|------|----------|----------|
| OpenManus | 100 条消息 | 滑动窗口丢弃 |
| Roo-Code | 可配置百分比 | LLM 摘要 + 滑动窗口截断 |
| dify | Token 限制动态计算 | 滑动窗口（保留 System 消息） |
| gemini-cli | 50% token 限制 | 三层压缩：截断 → 分割 → LLM 摘要 → 验证 |
| goose | 80% token 限制 | 渐进式工具响应移除 + LLM 摘要 |
| kilocode | 动态计算 (预留 buffer) | 主动压缩 + 被动修剪 |
| opencode | 92% (预留 20K buffer) | compaction agent + 工具输出修剪 |
| pi-mono | contextWindow - reserveTokens | 智能切割点 + LLM 摘要 |

### 1.3 压缩策略亮点

**gemini-cli - 三层压缩 + 探测验证**
```
1. Token 预算截断（大工具输出 → 临时文件）
2. 分割历史（保留最新 30%）
3. LLM 摘要（生成 <state_snapshot> XML）
4. 探测验证（第二轮 LLM 检查遗漏）
```

**goose - 渐进式恢复压缩**
```rust
let removal_percentages = [0, 10, 20, 50, 100];
for remove_percent in removal_percentages {
    // 尝试压缩，如果 ContextLengthExceeded 则增加移除比例
}
```

**Roo-Code - 非破坏性压缩**
```typescript
// 消息标记而非删除
condenseParent: 指向替换此消息的摘要
truncationParent: 指向隐藏此消息的截断标记
// 支持 Rewind 操作
```

**pi-mono - 智能切割点**
```typescript
// 切割点优先级
1. 用户消息（最佳）
2. 助手消息（保留随后的 tool results）
3. 避免 tool result 处（保持完整性）
```

---

## 2. 主 Agent 循环设计对比

### 2.1 循环模式

| 项目 | 循环模式 | 最大轮次 |
|------|----------|----------|
| OpenManus | ReAct (Think → Act) | 10 (可配置) |
| Roo-Code | Stack-based 迭代 | 无限制 |
| dify | while(function_call_state) | 99 + 1 |
| gemini-cli | while(true) + 递归 submitQuery | 100 |
| goose | loop + yield stream | DEFAULT_MAX_TURNS |
| kilocode | while(true) + 多退出条件 | agent.steps ?? Infinity |
| opencode | while(true) + processor | agent.steps ?? Infinity |
| pi-mono | 双层循环 (内层工具 + 外层后续) | 无限制 |

### 2.2 循环终止条件

```
通用终止条件:
├── 无工具调用 (no tool calls)
├── 用户中断 (abort/取消)
├── 达到最大轮次 (max turns)
├── 最终答案 (final answer / attempt_completion)
└── 错误/异常 (error)

特殊终止条件:
├── gemini-cli: ContextWindowWillOverflow, LoopDetected
├── goose: final_output_tool.final_output.is_some()
├── kilocode: doom_loop 权限拒绝
└── opencode: 结构化输出捕获
```

### 2.3 循环检测机制

| 项目 | 检测方式 | 阈值 |
|------|----------|------|
| OpenManus | 内容重复检测 | 2 次 |
| Roo-Code | 连续错误限制 | 可配置 |
| dify | Max iteration | 99 |
| gemini-cli | 三层检测 | 工具 5 次 / 内容 10 次 / LLM 30 轮后 |
| goose | 轮次限制 | max_turns |
| kilocode | doom_loop 检测 | 连续 3 次相同工具+参数 |
| opencode | doom_loop + MAX_STEPS | 3 次 + agent.steps |
| **opencode_lite** | 三层检测 | 工具 5 次 / 内容 3 次 / LLM 30 轮 |

### 2.4 工具执行流程对比

**典型流程:**
```
LLM 响应 → 提取工具调用 → 权限检查 → 执行工具 → 收集结果 → 继续循环
```

**goose - 工具分类执行**
```rust
工具分类
├── 前端工具 → handle_frontend_tool_request
└── 普通工具
    └── 权限检查
        ├── 已批准 → 立即执行
        ├── 需批准 → 等待用户
        └── 拒绝
```

**pi-mono - 导航中断**
```typescript
// 工具执行过程中检查导航消息
if (getSteeringMessages) {
  const steering = await getSteeringMessages();
  if (steering.length > 0) {
    // 跳过剩余工具
    break;
  }
}
```

---

## 3. Prompt 模块设计对比

### 3.1 模块化程度

| 项目 | 模块化方式 | 模板引擎 |
|------|------------|----------|
| OpenManus | 文件级模块 | Python format() |
| Roo-Code | 10+ 独立 Section | 函数组合 |
| dify | 占位符模板 | {{variable}} |
| gemini-cli | 完全模块化 Section | withSection() |
| goose | MiniJinja 模板 | {{variable}}, {% for %} |
| kilocode | 4 层模块化 (soul/provider/env/instruction) | 字符串拼接 |
| opencode | Provider 特定 + Agent 自定义 | 字符串拼接 |
| pi-mono | 函数式构建 | 文件模板 + 参数替换 |

### 3.2 Prompt 组成结构

**gemini-cli - 最完整的模块化**
```typescript
SystemPromptOptions {
  preamble,              // 前言
  coreMandates,          // 核心指令
  subAgents,             // 子代理描述
  agentSkills,           // 技能列表
  primaryWorkflows,      // 主工作流
  planningWorkflow,      // 规划工作流 (条件)
  operationalGuidelines, // 操作指南
  sandbox,               // 沙箱模式
  interactiveYoloMode,   // YOLO 模式 (条件)
  gitRepo,               // Git 相关 (条件)
}
```

**goose - SystemPromptBuilder 模式**
```rust
SystemPromptBuilder::new(manager)
  .with_extension(extension)
  .with_extensions(extensions)
  .with_frontend_instructions(instructions)
  .with_code_execution_mode(enabled)
  .with_hints(working_dir)
  .with_enable_subagents(enabled)
  .build()
```

**kilocode - 4 层 Prompt**
```typescript
system.push([
  soul(),              // 核心身份和个性
  provider(model),     // Provider 特定提示
  environment(model),  // 环境信息
  instruction(),       // 项目级指令
].join("\n"))
```

### 3.3 动态数据注入

| 注入类型 | 实现项目 |
|----------|----------|
| 环境信息 (cwd, platform, date) | 所有项目 |
| 工具列表 | 所有项目 |
| 项目指令 (CLAUDE.md, AGENTS.md) | Roo-Code, kilocode, opencode |
| 远程指令 (URL) | Roo-Code, kilocode |
| Git 状态 | gemini-cli, kilocode |
| IDE 上下文 | gemini-cli |
| 技能系统 | gemini-cli, pi-mono |
| 用户记忆 | gemini-cli, goose |
| 编辑器上下文 | kilocode |

### 3.4 Prompt 缓存优化

**opencode - 两段结构**
```typescript
// 保持两段结构以便缓存 (header 不变时)
if (system.length > 2 && system[0] === header) {
  const rest = system.slice(1)
  system.length = 0
  system.push(header, rest.join("\n"))
}
```

**goose - 时间戳固定化**
```rust
// 按小时固定时间戳，提高多会话缓存命中率
current_date_timestamp: Utc::now().format("%Y-%m-%d %H:00").to_string()
```

---

## 4. 各项目详细调研

### 4.1 OpenManus (Python)

**架构亮点:**
- 分层 Agent: BaseAgent → ReActAgent → ToolCallAgent → 具体 Agent
- MCP 动态工具加载
- Flow 系统支持多 Agent 协作

**关键文件:**
- `/home/xu/code/agent/OpenManus/app/agent/base.py` - Agent 基类
- `/home/xu/code/agent/OpenManus/app/agent/toolcall.py` - 工具调用 Agent
- `/home/xu/code/agent/OpenManus/app/prompt/` - Prompt 模块

**可借鉴:**
- Token 精确计数 (tiktoken)
- 累计 Token 跟踪
- ToolResult 标准化

### 4.2 Roo-Code (TypeScript)

**架构亮点:**
- 非破坏性压缩（消息标记而非删除）
- 双层存储（API 消息 + UI 消息）
- 完整的消息 Rewind 支持

**关键文件:**
- `/home/xu/code/agent/Roo-Code/src/core/task/Task.ts` - 主循环
- `/home/xu/code/agent/Roo-Code/src/core/context-management/index.ts` - 压缩
- `/home/xu/code/agent/Roo-Code/src/core/prompts/sections/` - Prompt 模块

**可借鉴:**
- 非破坏性压缩设计
- MessageManager 集中管理
- 流式工具执行

### 4.3 dify (Python)

**架构亮点:**
- FC + CoT 双策略支持
- 流式 ReAct 输出解析器
- 完整的思考过程持久化

**关键文件:**
- `/home/xu/code/agent/dify/api/core/agent/fc_agent_runner.py` - FC 循环
- `/home/xu/code/agent/dify/api/core/agent/cot_agent_runner.py` - CoT 循环
- `/home/xu/code/agent/dify/api/core/agent/output_parser/` - 输出解析

**可借鉴:**
- TokenBufferMemory 基于 Token 的管理
- 动态 Max Tokens 重计算
- 流式 ReAct 解析器

### 4.4 gemini-cli (TypeScript)

**架构亮点:**
- 三层压缩 + 探测验证
- 三层循环检测
- 事件驱动架构

**关键文件:**
- `/home/xu/code/agent/gemini-cli/packages/core/src/services/chatCompressionService.ts` - 压缩
- `/home/xu/code/agent/gemini-cli/packages/core/src/services/loopDetectionService.ts` - 循环检测
- `/home/xu/code/agent/gemini-cli/packages/core/src/prompts/promptProvider.ts` - Prompt

**可借鉴:**
- 反向 Token 预算截断
- 探测验证模式
- 状态快照 XML 结构

### 4.5 goose (Rust)

**架构亮点:**
- 双重消息可见性 (agent_visible, user_visible)
- 渐进式压缩恢复
- MiniJinja 模板引擎

**关键文件:**
- `/home/xu/code/agent/goose/crates/goose/src/agents/agent.rs` - Agent 核心
- `/home/xu/code/agent/goose/crates/goose/src/context_mgmt/mod.rs` - 压缩
- `/home/xu/code/agent/goose/crates/goose/src/agents/prompt_manager.rs` - Prompt

**可借鉴:**
- 双重消息可见性设计
- 渐进式恢复压缩
- Builder 模式构建 Prompt

### 4.6 kilocode (TypeScript)

**架构亮点:**
- 4 层 Prompt 模块化 (soul/provider/env/instruction)
- OpenTelemetry 集成
- 计划跟进机制

**关键文件:**
- `/home/xu/code/agent/kilocode/packages/opencode/src/session/prompt.ts` - 主循环
- `/home/xu/code/agent/kilocode/packages/opencode/src/session/system.ts` - System Prompt
- `/home/xu/code/agent/kilocode/packages/opencode/src/session/compaction.ts` - 压缩

**可借鉴:**
- soul 层定义核心身份
- 插件系统扩展点
- 遥测集成

### 4.7 opencode (TypeScript)

**架构亮点:**
- 三层上下文管理（自动压缩 + 主动修剪 + 缓存优化）
- Prompt 两段缓存结构
- 消息三段式存储 (Session → Message → Part)

**关键文件:**
- `/home/xu/code/agent/opencode/packages/opencode/src/session/prompt.ts` - 主循环
- `/home/xu/code/agent/opencode/packages/opencode/src/session/compaction.ts` - 压缩
- `/home/xu/code/agent/opencode/src/storage/schema.ts` - 数据模型

**可借鉴:**
- 工具输出修剪（保护重要工具）
- Prompt 两段缓存
- 消息 Part 细粒度管理

### 4.8 pi-mono (TypeScript)

**架构亮点:**
- 树形会话存储（支持分支）
- 双层循环（内层工具 + 外层后续）
- 技能系统

**关键文件:**
- `/home/xu/code/agent/pi-mono/packages/coding-agent/src/core/session-manager.ts` - 会话管理
- `/home/xu/code/agent/pi-mono/packages/agent/src/agent-loop.ts` - 主循环
- `/home/xu/code/agent/pi-mono/packages/coding-agent/src/core/compaction/` - 压缩

**可借鉴:**
- 树形会话结构
- 智能切割点算法
- 技能文件注入

---

## 5. 关键发现与建议

### 5.1 上下文管理最佳实践

1. **Token 精确计数**: 使用 tiktoken 或模型 API 返回的 usage 而非估算
2. **非破坏性压缩**: 标记消息而非删除，支持 Rewind
3. **渐进式恢复**: 压缩失败时逐步移除更多内容
4. **探测验证**: LLM 摘要后再验证一次，确保无信息丢失

### 5.2 循环设计最佳实践

1. **多层安全机制**: 最大轮次 + 循环检测 + 用户中断
2. **工具分类执行**: 前端工具 vs 后端工具，已批准 vs 需批准
3. **导航中断**: 支持在工具执行过程中响应用户操作
4. **流式工具更新**: 实时反馈工具执行进度

### 5.3 Prompt 设计最佳实践

1. **完全模块化**: 每个 Section 独立，支持条件渲染
2. **Builder 模式**: 链式调用构建复杂 Prompt
3. **缓存优化**: 固定部分 + 动态部分分离
4. **多源注入**: 支持文件、URL、IDE 上下文、技能系统

### 5.4 对 opencode_lite 的改进建议

| 方面 | 当前状态 | 建议改进 |
|------|----------|----------|
| Token 计数 | 估算 (4 chars/token) | 使用 tiktoken 或 API usage |
| 压缩策略 | 首尾保留 | 非破坏性压缩 + 智能切割点 |
| Prompt 模块化 | 基础 4 Section | 扩展到 8+ Section，支持条件渲染 |
| 循环检测 | 三层检测 | 增加 doom_loop 权限询问 |
| 消息存储 | 单表 | 考虑 Session → Message → Part 三表结构 |

---

## 附录：对比矩阵

### 上下文压缩策略

| 项目 | 滑动窗口 | LLM 摘要 | 渐进式 | 非破坏性 |
|------|:--------:|:--------:|:------:|:--------:|
| OpenManus | ✅ | ❌ | ❌ | ❌ |
| Roo-Code | ✅ | ✅ | ❌ | ✅ |
| dify | ✅ | ❌ | ❌ | ❌ |
| gemini-cli | ✅ | ✅ | ✅ | ❌ |
| goose | ✅ | ✅ | ✅ | ❌ |
| kilocode | ✅ | ✅ | ❌ | ❌ |
| opencode | ✅ | ✅ | ❌ | ❌ |
| pi-mono | ✅ | ✅ | ❌ | ❌ |

### Prompt 模块化程度

| 项目 | 文件级 | Section 级 | Builder 模式 | 模板引擎 |
|------|:------:|:----------:|:------------:|:--------:|
| OpenManus | ✅ | ❌ | ❌ | ❌ |
| Roo-Code | ✅ | ✅ | ❌ | ❌ |
| dify | ✅ | ❌ | ❌ | ✅ |
| gemini-cli | ✅ | ✅ | ✅ | ❌ |
| goose | ✅ | ✅ | ✅ | ✅ |
| kilocode | ✅ | ✅ | ✅ | ❌ |
| opencode | ✅ | ✅ | ❌ | ❌ |
| pi-mono | ✅ | ✅ | ❌ | ✅ |

---

*报告生成时间: 2026-02-27*
