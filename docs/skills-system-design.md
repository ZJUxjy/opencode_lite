# Skills System 设计文档

> **状态**: ✅ 已完成 (2026-02-28)
>
> 基于对 claude-code、gemini-cli、kimi-cli 的深度调研

---

## 1. 背景与动机

### 1.1 调研发现

通过对三个主流 AI CLI 工具的调研，发现它们都采用了相似的 Skills 系统架构：

| 项目 | 格式 | 发现机制 | 加载策略 |
|------|------|----------|----------|
| **claude-code** | SKILL.md + YAML | Auto-discovery | Progressive disclosure |
| **gemini-cli** | Markdown + YAML | ToolRegistry | Declarative activation |
| **kimi-cli** | agentskills.io | Layered discovery | Slash command activation |

### 1.2 核心共识

1. **Markdown + YAML Frontmatter**: 统一、易读、易维护
2. **Auto-discovery**: 自动扫描特定目录，无需手动注册
3. **Progressive Disclosure**: 按需加载，避免一次性加载过多内容
4. **Dynamic Activation**: 支持多种激活策略

---

## 2. 架构设计

### 2.1 核心概念

```
┌─────────────────────────────────────────────────────────────┐
│                      Skill 生命周期                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Discovery → Loading → Registration → Activation → Injection │
│      │          │           │            │          │       │
│      ▼          ▼           ▼            ▼          ▼       │
│  ┌──────┐  ┌──────┐   ┌──────────┐  ┌────────┐  ┌────────┐ │
│  │扫描  │  │解析  │   │注册到    │  │激活    │  │Prompt  │ │
│  │skills│  │YAML  │   │Registry  │  │策略    │  │注入    │ │
│  │目录  │  │+MD   │   │          │  │判断    │  │        │ │
│  └──────┘  └──────┘   └──────────┘  └────────┘  └────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 数据结构

```typescript
// Skill 元数据 (YAML Frontmatter)
interface SkillMetadata {
  id: string                    // 唯一标识符
  name: string                  // 显示名称
  description: string           // 简短描述
  version: string               // 版本号
  author?: string               // 作者
  tags?: string[]               // 标签/分类
  activation: "auto" | "manual" | "always"  // 激活策略
  triggers?: {                   // 自动触发条件
    filePatterns?: string[]     // 文件匹配模式
    keywords?: string[]         // 关键词匹配
  }
  dependencies?: string[]       // 依赖的 skills
  conflicts?: string[]          // 冲突的 skills
}

// 完整 Skill 定义
interface Skill {
  metadata: SkillMetadata       // YAML frontmatter
  content: string               // Markdown body
  resources?: SkillResource[]   // 资源文件（懒加载）
  resourcePaths?: string[]      // 资源路径列表
  basePath: string              // Skill 目录路径
  isActive: boolean             // 是否已激活
  activatedAt?: number          // 激活时间
}
```

---

## 3. 实现细节

### 3.1 模块结构

```
src/skills/
├── types.ts          # 类型定义
├── loader.ts         # SkillLoader 类
├── registry.ts       # SkillRegistry 类
└── index.ts          # 模块导出
```

### 3.2 SkillLoader

负责加载和解析 SKILL.md 文件：

```typescript
class SkillLoader {
  // 从文件加载
  async loadFromFile(filePath: string, options?: SkillLoadOptions): Promise<Skill>

  // 从目录加载（查找 SKILL.md）
  async loadFromDirectory(dirPath: string): Promise<Skill | null>

  // 发现所有 skills
  async discover(config: SkillDiscoveryConfig): Promise<Skill[]>

  // 加载资源文件（延迟加载）
  async loadResources(skill: Skill): Promise<SkillResource[]>
  async loadResource(skill: Skill, resourcePath: string): Promise<SkillResource | null>
}
```

**YAML 解析**:
- 简单实现，支持基本类型（string, number, boolean, array）
- 不使用外部依赖，保持轻量

### 3.3 SkillRegistry

管理所有已加载的 skills：

```typescript
class SkillRegistry {
  // 发现并加载所有 skills
  async discoverAndLoad(): Promise<Skill[]>

  // 注册 skill
  register(skill: Skill): void

  // 激活/停用
  activate(id: string): SkillActivationResult
  deactivate(id: string): boolean

  // 自动激活（基于上下文）
  autoActivate(context: SkillContext): SkillActivationResult[]

  // 获取 prompt 注入
  getActivePromptInjection(): string
}
```

**激活策略**:

| 策略 | 说明 | 触发条件 |
|------|------|----------|
| **auto** | 自动激活 | 匹配文件模式或关键词 |
| **manual** | 手动激活 | 用户通过工具激活 |
| **always** | 总是激活 | 加载时自动激活 |

### 3.4 工具集成

```typescript
// src/tools/skill.ts
export const listSkillsTool: Tool       // 列出所有 skills
export const activateSkillTool: Tool    // 激活 skill
export const deactivateSkillTool: Tool  // 停用 skill
export const showSkillTool: Tool        // 显示 skill 详情
export const getActiveSkillsPromptTool: Tool  // 获取 prompt 注入
```

### 3.5 Prompt 集成

```typescript
// src/prompts/sections/skills.ts
export const skillsSection: PromptSection = {
  name: "skills",

  enabled: (ctx) => {
    return !!ctx.skills && ctx.skills.length > 0
  },

  render: (ctx) => ctx.skills || ""
}
```

Prompt 注入格式：

```markdown
# Active Skills

# Git Expert

Best practices for Git operations and commit message conventions

## Commit Message Conventions
...

---

# Code Review Expert

Guidelines for thorough and constructive code reviews
...
```

---

## 4. 内置 Skills

### 4.1 Git Expert (builtin:git)

```yaml
---
id: builtin:git
name: Git Expert
description: Best practices for Git operations
version: "1.0.0"
activation: manual
tags: [git, version-control]
---
```

功能：
- Commit message 规范
- 安全规则（--force 警告）
- 工作流指南

### 4.2 Code Review (builtin:code-review)

功能：
- 代码审查清单
- 沟通风格建议
- 审查优先级

### 4.3 TDD (builtin:tdd)

功能：
- Red-Green-Refactor 循环
- 测试设计原则
- AAA 模式

---

## 5. 使用方法

### 5.1 查看 Skills

```bash
# 在会话中查看
/skills
```

### 5.2 激活 Skill

```bash
# 使用工具激活
activate_skill id="builtin:git"
```

### 5.3 创建自定义 Skill

1. 创建目录：`./skills/my-skill/`
2. 创建 `SKILL.md`：

```markdown
---
id: my-custom-skill
name: My Skill
description: Custom skill for my project
version: "1.0.0"
activation: manual
tags:
  - custom
---

# My Skill Guidelines

Your skill content here...
```

3. 重启应用或使用 `/skills` 查看

---

## 6. 与其他系统集成

### 6.1 Agent 集成

```typescript
// src/agent.ts
class Agent {
  private skillRegistry: SkillRegistry

  async loadSkills(): Promise<void> {
    await this.skillRegistry.discoverAndLoad()
  }

  activateSkill(id: string): SkillActivationResult {
    return this.skillRegistry.activate(id)
  }
}
```

### 6.2 App 启动加载

```typescript
// src/App.tsx
useEffect(() => {
  const loadSkills = async () => {
    await agent.loadSkills()
    // 显示加载提示
  }
  loadSkills()
}, [])
```

### 6.3 Slash 命令

```typescript
// src/commands/builtins.ts
const skillsCommand: Command = {
  name: "/skills",
  handler: (args, ctx) => {
    const skills = ctx.agent.getSkills()
    // 显示 skills 列表
  }
}
```

---

## 7. 设计决策

### 7.1 为什么使用 Markdown + YAML？

- **可读性**: Markdown 是开发者最熟悉的格式
- **结构化**: YAML frontmatter 提供元数据
- **工具生态**: 丰富的编辑器支持
- **版本控制**: 与代码一起管理

### 7.2 为什么使用 Auto-discovery？

- **零配置**: 用户只需放置文件即可
- **可扩展**: 易于添加新 skills
- **社区友好**: 便于分享 skills

### 7.3 为什么 Progressive Disclosure？

- **性能**: 避免一次性加载大量内容
- **上下文**: 只在需要时加载资源
- **灵活性**: 可以动态调整

---

## 8. 未来扩展

### 8.1 可能的增强

| 功能 | 优先级 | 说明 |
|------|--------|------|
| Skill 市场 | P2 | 分享和下载 skills |
| 条件渲染 | P2 | 根据模型能力调整内容 |
| 版本管理 | P3 | Skill 依赖版本控制 |
| 远程 Skills | P3 | 从 URL 加载 skills |

### 8.2 与其他功能的结合

- **Plan Mode**: 自动激活相关 skills
- **MCP**: Skills 可以包含 MCP 工具配置
- **Session**: Skills 状态可以持久化

---

## 9. 参考资料

- [claude-code 文档](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview)
- [gemini-cli 代码](https://github.com/google-gemini/gemini-cli)
- [kimi-cli 代码](https://github.com/moonshot-ai/kimi-cli)
- [agentskills.io](https://agentskills.io/) (kimi-cli 格式参考)

---

*最后更新: 2026-02-28*
