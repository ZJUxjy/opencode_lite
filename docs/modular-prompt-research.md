# 模块化 Prompt 系统调研报告

> **实现状态**: ✅ v1.2.0 已实现（2026-02-27）
>
> 已实现的目录结构：
> ```
> src/prompts/
> ├── index.ts              # PromptProvider 主类
> ├── types.ts              # PromptContext, PromptSection 类型定义
> ├── utils.ts              # 模板变量替换工具
> └── sections/
>     ├── identity.ts       # Agent 身份定义
>     ├── environment.ts    # 环境上下文
>     ├── tools.ts          # 工具使用指南
>     └── constraints.ts    # 行为约束
> ```

## 概述

本文档调研了四个知名 AI Agent 项目的 Prompt 系统设计，为 lite-opencode 的模块化 Prompt 系统提供设计参考。

| 项目 | 语言 | Prompt 存储 | 模板引擎 | 特点 |
|------|------|-------------|----------|------|
| kimi-cli | Python | YAML + Markdown | Jinja2 | 继承机制、渐进式加载 |
| opencode | TypeScript | .txt 文件 | 简单替换 | 两部分缓存优化、插件扩展 |
| kilocode | TypeScript | .txt 文件 | 简单替换 | Soul 概念、Provider 分离 |
| gemini-cli | TypeScript | 函数内联 | 函数组合 | 条件渲染、模型变体 |

---

## 1. kimi-cli (Python)

### 1.1 目录结构

```
kimi-cli/src/kimi_cli/
├── agents/
│   ├── default/
│   │   ├── agent.yaml      # Agent 配置
│   │   ├── sub.yaml        # 子 Agent (继承 agent.yaml)
│   │   └── system.md       # 系统 prompt 模板
│   └── okabe/
│       └── agent.yaml      # 扩展 default agent
├── tools/
│   ├── multiagent/
│   │   ├── task.md         # 工具描述模板
│   │   └── task.py
│   └── file/
│       ├── read.md
│       └── read.py
├── skills/
│   └── skill-name/
│       └── SKILL.md        # 技能定义 (YAML frontmatter)
└── prompts/
    ├── init.md
    └── compact.md
```

### 1.2 核心设计

#### Agent 继承机制

```yaml
# agents/default/agent.yaml
version: 1
agent:
  name: ""
  system_prompt_path: ./system.md
  system_prompt_args:
    ROLE_ADDITIONAL: ""
  tools:
    - "kimi_cli.tools.file:ReadFile"
  subagents:
    coder:
      path: ./sub.yaml

# agents/default/sub.yaml (继承)
version: 1
agent:
  extend: ./agent.yaml
  system_prompt_args:
    ROLE_ADDITIONAL: |
      You are now running as a subagent...
  exclude_tools:
    - "kimi_cli.tools.multiagent:Task"
```

#### Jinja2 模板语法

```python
env = JinjaEnvironment(
    variable_start_string="${",  # 自定义分隔符
    variable_end_string="}",
    undefined=StrictUndefined,   # 缺失变量时报错
)
```

```markdown
<!-- system.md -->
You are Kimi Code CLI...

Current date: ${KIMI_NOW}
Working directory: ${KIMI_WORK_DIR}

${ROLE_ADDITIONAL}  <!-- 运行时注入 -->
```

#### 渐进式 Skill 加载

```python
# 三层加载策略
1. 元数据 (始终加载): YAML frontmatter (~100 words)
2. SKILL.md 正文 (按需): 完整指令 (<5k words)
3. 附加资源 (按需): 脚本、参考文档
```

### 1.3 关键洞察

- **继承优于组合**: YAML extend 机制实现配置复用
- **两种未定义策略**: 严格模式 vs 保留占位符
- **分层 Skill 发现**: Built-in → User → Project

---

## 2. opencode (TypeScript)

### 2.1 目录结构

```
opencode/packages/opencode/src/
├── session/prompt/         # Provider 特定 prompts
│   ├── anthropic.txt       # Claude
│   ├── beast.txt           # GPT
│   ├── gemini.txt          # Gemini
│   ├── qwen.txt            # Qwen
│   ├── plan.txt            # Plan 模式
│   └── max-steps.txt       # 最大步数提醒
├── agent/prompt/           # Agent 特定 prompts
│   ├── explore.txt
│   ├── compaction.txt
│   └── summary.txt
└── command/template/       # 命令模板
    ├── initialize.txt
    └── review.txt
```

### 2.2 核心设计

#### 分层组装

```typescript
const system = []
system.push([
  // 1. Soul/Identity (可选)
  ...(isCodex ? [] : SystemPrompt.soul()),

  // 2. Provider 特定 prompt
  ...(input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(model)),

  // 3. 调用时传入的自定义 prompt
  ...input.system,

  // 4. 用户消息中的自定义 prompt
  ...(input.user.system ? [input.user.system] : []),
].join("\n"))
```

#### 环境上下文注入

```typescript
async function environment(model) {
  return [
    `You are powered by ${model.api.id}.`,
    `<env>`,
    `  Working directory: ${Instance.directory}`,
    `  Platform: ${process.platform}`,
    `  Today's date: ${new Date().toDateString()}`,
    `</env>`,
  ].join("\n")
}
```

#### 两部分缓存优化

```typescript
// 保持两部分结构以最大化缓存命中
const header = system[0]
if (system.length > 2 && system[0] === header) {
  const rest = system.slice(1)
  system.length = 0
  system.push(header, rest.join("\n"))
}
```

### 2.3 关键洞察

- **静态文件存储**: .txt 文件易于编辑和版本控制
- **分层组装**: Environment → Provider → Agent → User
- **缓存感知结构**: 稳定 header + 动态 body

---

## 3. kilocode (TypeScript)

### 3.1 与 opencode 的差异

kilocode 在 opencode 架构基础上增加了：

#### Soul 概念

```
kilocode/soul.txt:
"You are Kilo, a highly skilled software engineer..."
```

定义 Agent 的核心身份和沟通风格。

#### 工具描述分离

```
tool/
├── bash.txt      # 工具描述
├── bash.ts       # 工具实现
```

```typescript
// bash.ts
import DESCRIPTION from "./bash.txt"

export const BashTool = Tool.define("bash", async () => ({
  description: DESCRIPTION
    .replaceAll("${directory}", Instance.directory)
    .replaceAll("${maxLines}", String(Truncate.MAX_LINES)),
}))
```

#### 指令加载系统

```typescript
// 自动搜索 AGENTS.md, CLAUDE.md
async function systemPaths() {
  // 向上搜索项目目录
  for (const file of FILES) {
    const matches = await Filesystem.findUp(file, Instance.directory)
  }
  // 包含全局配置目录
  // 包含 URL 指令
}
```

---

## 4. gemini-cli (TypeScript)

### 4.1 函数式组合

gemini-cli 使用 TypeScript 函数而非文件存储：

```typescript
export function getCoreSystemPrompt(options: SystemPromptOptions): string {
  return `
${renderPreamble(options.preamble)}
${renderCoreMandates(options.coreMandates)}
${renderSubAgents(options.subAgents)}
${renderAgentSkills(options.agentSkills)}
${renderPrimaryWorkflows(options.primaryWorkflows)}
${renderOperationalGuidelines(options.operationalGuidelines)}
`.trim()
}
```

### 4.2 条件渲染

```typescript
private withSection<T>(key: string, factory: () => T, guard: boolean = true): T | undefined {
  return guard && isSectionEnabled(key) ? factory() : undefined
}

// 使用
options: {
  preamble: this.withSection('preamble', () => ({ interactive })),
  planningWorkflow: this.withSection('planningWorkflow', () => ({...}), isPlanMode),
}
```

### 4.3 模型变体

```typescript
const isModernModel = supportsModernFeatures(desiredModel)
const activeSnippets = isModernModel ? snippets : legacySnippets
```

- **Modern models**: Gemini 2.0+，优化 prompts
- **Legacy models**: Gemini 1.5，包含 finalReminder

### 4.4 环境变量控制

```typescript
// Section 级别开关
export function isSectionEnabled(key: string): boolean {
  const envVar = process.env[`GEMINI_PROMPT_${key.toUpperCase()}`]
  return envVar?.trim().toLowerCase() !== '0'
}

// 自定义模板
GEMINI_SYSTEM_MD=/path/to/custom.md
GEMINI_PROMPT_HOOKCONTEXT=false
```

### 4.5 模板变量

```typescript
export function applySubstitutions(prompt: string, config: Config): string {
  let result = prompt
  result = result.replace(/\${AgentSkills}/g, skillsPrompt)
  result = result.replace(/\${SubAgents}/g, subAgentsContent)
  result = result.replace(/\${AvailableTools}/g, availableToolsList)
  return result
}
```

---

## 5. 设计对比总结

| 特性 | kimi-cli | opencode | kilocode | gemini-cli |
|------|----------|----------|----------|------------|
| 存储方式 | YAML+MD | .txt 文件 | .txt 文件 | 函数内联 |
| 模板语法 | Jinja2 `${}` | 简单替换 | 简单替换 | 无 |
| 继承机制 | ✅ YAML extend | ❌ | ❌ | ❌ |
| 分层组装 | ✅ | ✅ | ✅ | ✅ |
| 条件渲染 | ❌ | ❌ | ❌ | ✅ |
| 模型变体 | ❌ | ✅ | ✅ | ✅ |
| 缓存优化 | ❌ | ✅ 两部分 | ✅ 两部分 | ❌ |
| 渐进式加载 | ✅ Skills | ❌ | ❌ | ❌ |
| 环境变量控制 | ❌ | ❌ | ❌ | ✅ |
| 插件扩展 | ❌ | ✅ | ✅ | ❌ |

---

## 6. lite-opencode 设计建议

基于以上调研，为 lite-opencode 设计模块化 Prompt 系统时建议：

### 6.1 采用方案：文件存储 + 函数组装

- **存储**: 使用 `.txt` 文件（简单、易编辑）
- **组装**: 使用 TypeScript 函数（类型安全、条件渲染）
- **模板**: 简单 `${var}` 替换（足够用）

### 6.2 目录结构

```
src/prompts/
├── index.ts              # PromptProvider 类
├── sections/             # 模块化 section
│   ├── identity.ts       # Agent 身份
│   ├── environment.ts    # 环境上下文
│   ├── tools.ts          # 工具使用指南
│   ├── constraints.ts    # 行为约束
│   └── memory.ts         # 记忆系统
├── providers/            # Provider 特定
│   ├── anthropic.ts
│   ├── gemini.ts
│   └── default.ts
└── agents/               # Agent 特定 (未来)
    └── explore.ts
```

### 6.3 核心接口

```typescript
interface PromptSection {
  name: string
  render: (ctx: PromptContext) => string | undefined
  enabled?: (ctx: PromptContext) => boolean
}

interface PromptContext {
  model: string
  cwd: string
  platform: string
  tools: ToolDefinition[]
  instructions?: string
  isInteractive: boolean
}

class PromptProvider {
  getSystemPrompt(ctx: PromptContext): string
  getCompactionPrompt(): string
  getToolDescription(toolName: string, ctx: PromptContext): string
}
```

### 6.4 实现优先级

1. **P0 - 核心**: PromptProvider + identity/environment/tools sections ✅ **已完成**
2. **P1 - 扩展**: Provider 变体 + 条件渲染
3. **P2 - 高级**: 自定义模板 + 指令加载

### 6.5 已实现功能

| 功能 | 状态 | 说明 |
|------|------|------|
| PromptProvider 类 | ✅ | 组装 sections，生成完整 system prompt |
| identity section | ✅ | Agent 身份和基本行为准则 |
| environment section | ✅ | 工作目录、平台、模型、日期 |
| tools section | ✅ | 可用工具列表和使用指南 |
| constraints section | ✅ | 行为约束和边界 |
| getCompactionPrompt() | ✅ | 上下文压缩 prompt |
| addSection/removeSection | ✅ | 动态扩展 sections |
| system prompt 注入 | ✅ | LLM 调用时传入 system prompt |

---

## 7. 参考

- kimi-cli: `/home/xjingyao/code/kimi-cli`
- opencode: `/home/xjingyao/code/opencode`
- kilocode: `/home/xjingyao/code/kilocode`
- gemini-cli: `/home/xjingyao/code/gemini-cli`
