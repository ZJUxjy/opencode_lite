# Lite OpenCode 开发计划

> 综合开发路线图：ReAct 系统 + Plan Mode + 未来规划

---

## 目录

1. [项目概述](#1-项目概述)
2. [版本历史与里程碑](#2-版本历史与里程碑)
3. [Phase 1-4: ReAct 系统（已完成）](#3-phase-1-4-react-系统已完成)
4. [Phase 5: Plan Mode 开发计划](#4-phase-5-plan-mode-开发计划)
5. [Phase 6-8: 未来规划](#5-phase-6-8-未来规划)
6. [技术架构总览](#6-技术架构总览)
7. [风险与缓解措施](#7-风险与缓解措施)

---

## 1. 项目概述

### 1.1 项目定位

Lite OpenCode 是一个轻量级 AI 编程 Agent，实现 ReAct（Reasoning + Acting）模式，支持双策略（FC/CoT）架构。

### 1.2 核心特性

| 特性 | 状态 | 说明 |
|------|------|------|
| ReAct 双策略 | ✅ | FC + CoT 自动选择 |
| 三层循环检测 | ✅ | 工具/内容/LLM 辅助 |
| 渐进式压缩 | ✅ | light/moderate/aggressive |
| 模块化 Prompt | ✅ | 9 Section 架构 |
| Policy 引擎 | ✅ | 权限控制 |
| Plan Mode | 🚧 | Phase 5 开发中 |
| MCP 集成 | 📋 | Phase 6 规划中 |

---

## 2. 版本历史与里程碑

### 2.1 已发布版本

| 版本 | 日期 | 里程碑 |
|------|------|--------|
| v1.0.0 | 2026-02 | 基础 Agent 循环 + 6 工具 + 上下文压缩 + Ink TUI |
| v1.1.0 | 2026-02 | 三层循环检测 + Policy 策略引擎 |
| v1.2.0 | 2026-02 | 模块化 Prompt 系统 (4 sections) |
| v1.3.0 | 2026-02 | ReAct 系统 Phase 1-3 (FC/CoT 双策略 + 思考持久化) |
| v1.4.0 | 2026-02 | ReAct 系统 Phase 4 (9 sections + 渐进式压缩) |

### 2.2 开发中版本

| 版本 | 预计日期 | 里程碑 |
|------|----------|--------|
| v1.5.0 | 2026-03 | Plan Mode Phase 1-2 (基础 + 5阶段工作流) |
| v1.6.0 | 2026-03 | Plan Mode Phase 3-4 (Handover + 高级功能) |
| v2.0.0 | 2026-Q2 | MCP 集成 + 工具系统增强 |

---

## 3. Phase 1-4: ReAct 系统（已完成）

> 详细设计见：[react-development-plan.md](./react-development-plan.md)

### 3.1 Phase 1: 基础架构

**交付物**:
- ✅ ReActRunner (策略路由)
- ✅ FCRunner (Function Calling 实现)
- ✅ CoTRunner (Chain-of-Thought 实现)
- ✅ ReActParser (流式解析器)

### 3.2 Phase 2: 流式解析增强

**交付物**:
- ✅ 5 组状态变量完整实现
- ✅ JSON 提取（代码块 + 纯文本）
- ✅ 嵌套 JSON 支持
- ✅ 25 个测试用例

### 3.3 Phase 3: 思考过程持久化

**交付物**:
- ✅ ScratchpadManager (思考管理)
- ✅ ThoughtPersistence (数据库存储)
- ✅ 历史恢复机制

### 3.4 Phase 4: 高级特性

**交付物**:
- ✅ 探测验证机制
- ✅ 渐进式压缩恢复
- ✅ 9 Section Prompt 系统
- ✅ 多停止词支持

---

## 4. Phase 5: Plan Mode 开发计划

> 基于对 gemini-cli、Kode-Agent、kilocode 的深度调研

### 4.1 设计目标

| 目标 | 说明 | 参考项目 |
|------|------|----------|
| **只读规划** | Plan Mode 下禁止写操作 | gemini-cli, Kode-Agent |
| **结构化工作流** | 5阶段规划指导 | Kode-Agent |
| **计划持久化** | Markdown 计划文件 | Kode-Agent, kilocode |
| **Handover 交接** | 跨会话计划传递 | kilocode |
| **子代理支持** | Explore/Plan Agent 并行 | Kode-Agent |
| **模型路由** | Plan用强模型，执行用快模型 | gemini-cli |

### 4.2 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    Plan Mode Architecture                    │
├─────────────────────────────────────────────────────────────┤
│  UI Layer (Ink)                                              │
│  ├── ModeIndicator (状态栏显示 Plan Mode)                    │
│  ├── PlanExitDialog (退出确认对话框)                         │
│  └── PlanView (计划文件查看器)                               │
├─────────────────────────────────────────────────────────────┤
│  Tool Layer                                                  │
│  ├── EnterPlanModeTool (进入 Plan Mode)                     │
│  ├── ExitPlanModeTool (退出 Plan Mode)                      │
│  └── WritePlanTool (写入计划文件 - 仅允许 plans 目录)       │
├─────────────────────────────────────────────────────────────┤
│  Policy Layer (扩展)                                         │
│  ├── mode: "plan" 规则支持                                  │
│  ├── readOnlyHint 工具注解                                  │
│  └── plans 目录写权限例外                                     │
├─────────────────────────────────────────────────────────────┤
│  Prompt Layer (扩展)                                         │
│  ├── PlanModeSection (Plan Mode 专用 Prompt)                │
│  ├── 5阶段工作流指导                                         │
│  └── 动态注入机制                                             │
├─────────────────────────────────────────────────────────────┤
│  State Layer                                                 │
│  ├── PlanModeManager (状态管理)                             │
│  ├── PlanFileManager (文件管理)                             │
│  └── HandoverManager (交接管理)                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 Phase 5.1: 基础 Plan Mode (Week 1)

**目标**: 实现进入/退出机制和基础权限控制

| 任务 | 说明 | 文件 | 优先级 |
|------|------|------|--------|
| 5.1.1 Plan Mode 状态管理 | 创建 `src/plan/manager.ts` | 状态存储、切换逻辑 | P0 |
| 5.1.2 Policy 引擎扩展 | 扩展 `src/policy.ts` | 支持 `mode` 过滤 | P0 |
| 5.1.3 EnterPlanModeTool | 创建 `src/tools/enter-plan-mode.ts` | 进入工具 | P0 |
| 5.1.4 ExitPlanModeTool | 创建 `src/tools/exit-plan-mode.ts` | 退出工具 | P0 |
| 5.1.5 工具注册 | 更新 `src/tools/index.ts` | 注册新工具 | P0 |
| 5.1.6 UI 指示器 | 更新 `src/App.tsx` | 状态栏显示 Plan Mode | P1 |

**关键实现**:

```typescript
// src/plan/manager.ts
export class PlanModeManager {
  private isPlanMode = false
  private planFilePath: string | null = null

  enter(): { planFilePath: string }
  exit(): void
  isEnabled(): boolean
  getPlanFilePath(): string | null
  isPlanFilePath(path: string): boolean
}

// src/policy.ts 扩展
export interface PolicyRule {
  mode?: "default" | "plan" | "all"  // 新增
  readOnlyHint?: boolean             // 新增
}
```

**验收标准**:
- [ ] 可进入/退出 Plan Mode
- [ ] Plan Mode 下只能使用只读工具
- [ ] 尝试写操作会被 Policy 引擎拒绝
- [ ] 状态栏显示当前模式

### 4.4 Phase 5.2: 5阶段工作流 (Week 2)

**目标**: 实现结构化规划流程指导

| 任务 | 说明 | 文件 | 优先级 |
|------|------|------|--------|
| 5.2.1 Plan Mode Prompt Section | 创建 `src/prompts/sections/plan.ts` | 5阶段工作流提示词 | P0 |
| 5.2.2 PromptProvider 集成 | 更新 `src/prompts/index.ts` | 条件渲染 | P0 |
| 5.2.3 System Prompt 注入 | 更新 `src/agent.ts` | 动态注入逻辑 | P0 |
| 5.2.4 计划文件模板 | 创建 `src/plan/template.ts` | 标准计划格式 | P1 |
| 5.2.5 WritePlanTool | 创建 `src/tools/write-plan.ts` | 专用写入工具 | P1 |

**5阶段工作流**:

```markdown
## Plan Mode Workflow

### Phase 1: Initial Understanding
Goal: 全面理解用户需求
- 使用 read-only 工具探索代码库
- 启动最多 3 个 Explore Agent 并行探索
- 使用 ask_user 澄清需求

### Phase 2: Design
Goal: 设计实现方案
- 启动 Plan Agent 设计实现方案
- 可并行启动多个获取不同视角
- 考虑多种方案的 trade-offs

### Phase 3: Review
Goal: 审查并确认计划
- 审查计划是否符合用户意图
- 使用 ask_user 确认方案
- 迭代修改计划

### Phase 4: Final Plan
Goal: 写入最终计划
- 将计划写入 plan file（唯一可编辑文件）
- 确保计划清晰可执行
- 包含关键文件路径

### Phase 5: Exit
Goal: 退出 Plan Mode
- 调用 exit_plan_mode 工具
- 等待用户批准开始执行
```

**验收标准**:
- [ ] Plan Mode 下 System Prompt 包含 5阶段指导
- [ ] AI 遵循工作流进行规划
- [ ] 计划文件格式标准化
- [ ] 子代理支持 Plan Mode（如果已支持子代理）

### 4.5 Phase 5.3: Handover 和跨会话 (Week 3)

**目标**: 实现计划交接和跨会话支持

| 任务 | 说明 | 文件 | 优先级 |
|------|------|------|--------|
| 5.3.1 Handover 生成 | 创建 `src/plan/handover.ts` | 摘要生成逻辑 | P0 |
| 5.3.2 PlanFollowup | 创建 `src/plan/followup.ts` | 退出后询问 | P0 |
| 5.3.3 会话切换支持 | 更新 `src/store.ts` | 跨会话传递 | P1 |
| 5.3.4 Todo 传递 | 更新 Todo 系统 | 与计划集成 | P2 |
| 5.3.5 历史恢复 | 更新 `src/agent.ts` | 恢复 Plan Mode 状态 | P2 |

**Handover 格式**:

```markdown
## Discoveries
[代码探索发现 - 架构模式、注意事项、边界情况]

## Relevant Files
[相关文件列表及说明]

## Implementation Notes
[实现注意事项、潜在陷阱、依赖关系]
```

**PlanFollowup 流程**:

```
exit_plan_mode
    ↓
显示 PlanFollowup 对话框
    ↓
用户选择:
├── "Start new session" → 创建新会话，传递 Handover + Todo
├── "Continue here" → 当前会话继续，切换到 Build Mode
└── 自定义反馈 → 继续 Plan Mode 迭代
```

**验收标准**:
- [ ] 退出 Plan Mode 时生成 Handover 摘要
- [ ] 支持 "Start new session" 和 "Continue here" 选项
- [ ] 新会话接收计划上下文
- [ ] Todo 列表跨会话传递

### 4.6 Phase 5.4: 高级功能 (Week 4-5)

**目标**: 子代理支持、模型路由、性能优化

| 任务 | 说明 | 优先级 |
|------|------|--------|
| 5.4.1 子代理 Plan Mode | TaskTool 支持 Plan Mode | P1 |
| 5.4.2 模型路由 | Plan 用强模型，执行用快模型 | P2 |
| 5.4.3 并行探索 | 多个 Explore Agent | P2 |
| 5.4.4 外部编辑器 | Ctrl+X 打开编辑器 | P3 |
| 5.4.5 计划版本控制 | 计划文件历史 | P3 |

**模型路由策略**:

```typescript
// config.ts
export const planModeConfig = {
  // Plan Mode 使用更强的模型
  planModel: "claude-opus-4",
  // 执行使用更快的模型
  buildModel: "claude-sonnet-4",
  // 是否自动切换
  autoRouting: true,
}
```

**验收标准**:
- [ ] 子代理可在 Plan Mode 下运行
- [ ] 自动模型路由工作正常
- [ ] 支持并行 Explore Agent
- [ ] 可从外部编辑器编辑计划

---

## 5. Phase 6-8: 未来规划

### 5.1 Phase 6: MCP 集成

**目标**: 集成 Model Context Protocol，扩展工具生态

| 任务 | 说明 | 预计工作量 |
|------|------|-----------|
| 6.1 MCP 客户端 | 连接 MCP 服务器 | ~150 行 |
| 6.2 多传输协议 | stdio/sse/ws 支持 | ~100 行 |
| 6.3 工具包装 | MCP 工具转内部格式 | ~80 行 |
| 6.4 配置发现 | 自动发现 .mcp.json | ~50 行 |

**MCP 工具命名空间**:
```typescript
// mcp__serverName__toolName
const mcpTools = await getMCPTools()
// 返回: [
//   { name: 'mcp__filesystem__read_file', ... },
//   { name: 'mcp__github__create_issue', ... }
// ]
```

### 5.2 Phase 7: 多模型适配器

**目标**: 统一多模型接口，支持更多 LLM 提供商

| 任务 | 说明 | 预计工作量 |
|------|------|-----------|
| 7.1 适配器基类 | 统一接口定义 | ~50 行 |
| 7.2 模型能力注册表 | 预定义模型能力 | ~100 行 |
| 7.3 Anthropic 适配器 | 迁移现有代码 | ~80 行 |
| 7.4 OpenAI 适配器 | 支持 GPT 系列 | ~80 行 |
| 7.5 适配器工厂 | 自动选择适配器 | ~50 行 |

### 5.3 Phase 8: Hook 系统

**目标**: 支持生命周期钩子，增强可扩展性

| Hook 点 | 触发时机 | 用途 |
|---------|----------|------|
| `onUserPromptSubmit` | 用户提交 prompt | 预处理、验证 |
| `onPreToolUse` | 工具执行前 | 权限检查、日志 |
| `onPostToolUse` | 工具执行后 | 后处理、统计 |
| `onSessionStop` | 会话停止 | 清理、保存 |
| `onEnterPlanMode` | 进入 Plan Mode | 初始化 |
| `onExitPlanMode` | 退出 Plan Mode | 清理、交接 |

---

## 6. 技术架构总览

### 6.1 完整架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         UI Layer (Ink)                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │   App.tsx    │ │ ModeIndicator│ │    PlanExitDialog        │ │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                        Agent Layer                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                      Agent (agent.ts)                   │   │
│  │  - 会话管理                                              │   │
│  │  - Plan Mode 状态集成                                    │   │
│  │  - System Prompt 注入                                    │   │
│  └────────────────────────┬────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  ReActRunner                            │   │
│  │              (策略路由 + Plan Mode 感知)                │   │
│  └────────────────────────┬────────────────────────────────┘   │
│                           │                                     │
│         ┌─────────────────┼─────────────────┐                   │
│         │                 │                 │                   │
│         ▼                 ▼                 ▼                   │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────────────┐   │
│  │  FCRunner   │   │  CoTRunner  │   │   PlanModeManager   │   │
│  └─────────────┘   └─────────────┘   └─────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                      Tool Layer (8 tools)                       │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐        │
│  │  bash  │ │  read  │ │  write │ │  edit  │ │  grep  │        │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘        │
│  ┌────────┐ ┌────────────────┐ ┌──────────────────────────┐    │
│  │  glob  │ │ EnterPlanMode  │ │     ExitPlanMode         │    │
│  └────────┘ └────────────────┘ └──────────────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│                    Policy Layer (扩展)                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Policy Engine                        │   │
│  │  - mode 过滤 ("default" | "plan")                       │   │
│  │  - readOnlyHint 注解                                    │   │
│  │  - plans 目录例外                                       │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                   Prompt Layer (9 sections)                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ identity │ │objectives│ │environment│ │  tools   │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ workflow │ │  memory  │ │errorHandling│ │constraints│          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│  ┌──────────┐ ┌──────────┐                                      │
│  │  react   │ │   plan   │  ← 新增 (Plan Mode 专用)             │
│  └──────────┘ └──────────┘                                      │
├─────────────────────────────────────────────────────────────────┤
│                   Infrastructure Layer                          │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐   │
│  │  LLMClient  │ │    Store    │ │  Compression Service    │   │
│  │   (llm.ts)  │ │  (store.ts) │ │    (compression.ts)     │   │
│  └─────────────┘ └─────────────┘ └─────────────────────────┘   │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐   │
│  │LoopDetection│ │   PlanFile  │ │    HandoverManager      │   │
│  │(loopDetection)│ │  (plan/)   │ │       (plan/)           │   │
│  └─────────────┘ └─────────────┘ └─────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 文件结构规划

```
src/
├── index.tsx                 # CLI 入口
├── App.tsx                   # TUI 组件
├── agent.ts                  # Agent 核心
├── llm.ts                    # LLM 客户端
├── store.ts                  # 消息持久化
├── types.ts                  # 类型定义
├── policy.ts                 # Policy 引擎（扩展）
├── compression.ts            # 上下文压缩
├── loopDetection.ts          # 循环检测
│
├── react/                    # ReAct 系统
│   ├── index.ts
│   ├── runner.ts
│   ├── fc-runner.ts
│   ├── cot-runner.ts
│   ├── parser.ts
│   ├── scratchpad.ts
│   └── persistence.ts
│
├── prompts/                  # Prompt 系统
│   ├── index.ts              # PromptProvider
│   ├── types.ts
│   ├── utils.ts
│   └── sections/             # 10 个 Sections
│       ├── identity.ts
│       ├── objectives.ts
│       ├── environment.ts
│       ├── tools.ts
│       ├── workflow.ts
│       ├── memory.ts
│       ├── errorHandling.ts
│       ├── constraints.ts
│       ├── react.ts
│       └── plan.ts           # 新增
│
├── plan/                     # Plan Mode 系统（新增）
│   ├── index.ts              # 导出
│   ├── manager.ts            # PlanModeManager
│   ├── file.ts               # PlanFileManager
│   ├── handover.ts           # HandoverManager
│   ├── followup.ts           # PlanFollowup
│   ├── template.ts           # 计划模板
│   └── types.ts              # 类型定义
│
└── tools/                    # 8 个工具
    ├── index.ts
    ├── bash.ts
    ├── read.ts
    ├── write.ts
    ├── edit.ts
    ├── grep.ts
    ├── glob.ts
    ├── enter-plan-mode.ts    # 新增
    └── exit-plan-mode.ts     # 新增
```

---

## 7. 风险与缓解措施

### 7.1 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Policy 引擎扩展复杂性 | 可能影响现有权限判断 | 充分测试，保持向后兼容 |
| Plan Mode 状态丢失 | 上下文压缩后状态不一致 | 状态持久化到数据库 |
| 计划文件路径逃逸 | 安全风险 | 严格路径验证 |
| Handover 生成失败 | 上下文传递中断 | 降级到计划文件原文 |

### 7.2 用户体验风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Plan Mode 流程过于复杂 | 用户不愿使用 | 提供 MVP 版本，逐步增强 |
| AI 不遵循 5阶段工作流 | 规划质量下降 | 强化 Prompt，添加验证 |
| 计划文件难以阅读 | 用户不批准 | 标准化模板，支持外部编辑 |

### 7.3 实施建议

1. **MVP 优先**: 先实现基础 Plan Mode（进入/退出 + 权限控制），验证用户价值
2. **渐进增强**: 在 MVP 基础上逐步添加 5阶段工作流、Handover 等功能
3. **充分测试**: Plan Mode 涉及权限控制，需要充分测试安全边界
4. **文档先行**: 用户使用 Plan Mode 需要清晰的文档指导

---

## 附录

### A. 参考文档

- [react-development-plan.md](./react-development-plan.md) - ReAct 系统详细设计
- [modular-prompt-research.md](./modular-prompt-research.md) - Prompt 系统调研
- [agent-architecture-research.md](./agent-architecture-research.md) - Agent 架构调研
- [dify-architecture-deep-dive.md](./dify-architecture-deep-dive.md) - Dify 架构分析
- [hook-system-design.md](./hook-system-design.md) - Hook 系统设计

### B. 外部参考项目

| 项目 | Plan Mode 特色 | 学习点 |
|------|---------------|--------|
| [gemini-cli](https://github.com/google-gemini/gemini-cli) | Policy Engine + TOML 配置 | 权限控制机制 |
| [Kode-Agent](https://github.com/shareAI-lab/kode) | 5阶段工作流 + 子代理 | 结构化规划流程 |
| [kilocode](https://github.com/Kilo-Org/kilocode) | Handover + 跨会话 | 上下文传递机制 |

### C. 术语表

| 术语 | 说明 |
|------|------|
| Plan Mode | 只读规划模式，AI 只能探索不能修改 |
| Handover | 计划交接摘要，传递给下一个会话 |
| Explore Agent | 专门用于探索代码的子代理 |
| Plan Agent | 专门用于设计方案的子代理 |
| Slug | 短标识符，用于计划文件命名 |
| MCP | Model Context Protocol，工具扩展协议 |

---

*文档版本: 1.0*
*创建日期: 2026-02-28*
*更新日期: 2026-02-28*
