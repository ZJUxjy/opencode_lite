# Superpowers Skills 使用指南

## 概述

**Superpowers** 是由 Claude Code 核心贡献者 Jesse Vincent (@obra) 开发的技能集，包含 14+ 核心技能，强制 AI 遵循标准化软件开发流程。

## Anthropic Skills vs obra/superpowers 对比

| 维度 | Anthropic 官方 Skills | obra/superpowers |
|------|----------------------|------------------|
| **定位** | 功能型技能 (PDF、MCP、测试) | 流程型技能 (TDD、Debug、Review) |
| **风格** | 工具使用指南 | 工程纪律强制 |
| **强制程度** | 建议性 | **强制性 (HARD-GATE)** |
| **核心价值** | 扩展能力边界 | 提升代码质量 |
| **适合场景** | 特定任务 (生成 PDF、构建 MCP) | 日常开发 (写代码、修 Bug) |

**结论**: 两者互补，Anthropic 提供"能力"，Superpowers 提供"纪律"。

---

## 核心工作流

```
用户需求 → brainstorming (设计) → writing-plans (计划) → executing-plans (执行) → code-review (审查) → finishing (完成)
```

### 完整流程示例

```
1. 用户: "帮我添加用户认证功能"
2. AI: [自动触发 brainstorming]
   - 探索项目上下文
   - 问澄清问题
   - 提出 2-3 种方案
   - 获得用户批准
   - 写设计文档

3. AI: [自动触发 writing-plans]
   - 创建详细实施计划
   - 每个步骤 2-5 分钟
   - 包含完整代码和命令

4. AI: [自动触发 executing-plans]
   - 按计划逐步执行
   - 每批次完成后审查

5. AI: [自动触发 code-review]
   - 派遣审查子代理
   - 检查代码质量

6. AI: [自动触发 finishing-a-development-branch]
   - 运行测试
   - 提供合并/PR/清理选项
```

---

## 核心技能详解

### 1. using-superpowers (入口技能)

**触发条件**: 开始任何对话时

**核心规则**:
```
只要有 1% 的可能性某个 skill 适用，你必须调用它
```

**红牌警告** (出现这些想法 = 停止并检查):
| 错误想法 | 现实 |
|---------|------|
| "这只是简单问题" | 问题都需要 skill |
| "我先收集信息" | Skill 告诉你如何收集 |
| "这个不需要正式 skill" | 如果存在就使用 |
| "我记住这个 skill 了" | Skill 会更新，必须重读 |

**使用方式**:
```
# 在 Claude Code 中
/skill using-superpowers
```

---

### 2. brainstorming (设计技能)

**触发条件**: 任何创造性工作之前

**硬性规则**:
```
<HARD-GATE>
在展示设计并获得用户批准之前，不得:
- 调用任何实现 skill
- 写任何代码
- 脚手架任何项目
- 执行任何实现操作
</HARD-GATE>
```

**流程**:
1. **探索项目上下文** - 检查文件、文档、最近提交
2. **问澄清问题** - 一次一个问题
3. **提出 2-3 种方案** - 包含权衡和推荐
4. **展示设计** - 按复杂度分节
5. **写设计文档** - 保存到 `docs/plans/YYYY-MM-DD-<topic>-design.md`
6. **转交实现** - 调用 writing-plans skill

**反模式**:
```
"这太简单了不需要设计" ← 这是错误的想法
简单项目正是未经审视的假设导致浪费工作的地方
```

---

### 3. writing-plans (计划技能)

**触发条件**: 有规格或需求后，触碰代码之前

**核心原则**:
- 假设工程师对代码库零上下文
- 文档化所有需要知道的内容
- DRY, YAGNI, TDD, 频繁提交

**任务粒度** (每个步骤 2-5 分钟):
```
- "写失败测试" - 一个步骤
- "运行确认失败" - 一个步骤
- "实现最小代码使测试通过" - 一个步骤
- "运行测试确认通过" - 一个步骤
- "提交" - 一个步骤
```

**计划文档头部**:
```markdown
# [功能名] Implementation Plan

> **For Claude**: REQUIRED SUB-SKILL: Use superpowers:executing-plans

**Goal:** [一句话描述]

**Architecture:** [2-3 句方法描述]

**Tech Stack:** [关键技术/库]

---
```

**完成后提供选择**:
```
计划已保存到 docs/plans/<filename>.md

1. Subagent-Driven (本会话) - 每个任务派遣新子代理，任务间审查
2. Parallel Session (单独) - 在新会话中批量执行

选择哪种方式？
```

---

### 4. systematic-debugging (调试技能)

**触发条件**: 遇到任何 bug、测试失败或意外行为

**铁律**:
```
没有根因调查就不能修复
```

**四阶段流程**:

| 阶段 | 活动 | 成功标准 |
|------|------|----------|
| **1. 根因调查** | 读错误、复现、检查变更、收集证据 | 理解 WHAT 和 WHY |
| **2. 模式分析** | 找工作示例、对比 | 识别差异 |
| **3. 假设测试** | 形成理论、最小测试 | 确认或新假设 |
| **4. 实现** | 创建测试、修复、验证 | Bug 解决，测试通过 |

**关键规则**:
- 3 次修复失败后 → 质疑架构
- 不要"再试一次修复"
- 每次只改一个变量

**红牌警告**:
```
"快速修复，稍后调查" ← 停止
"试试改 X 看看" ← 停止
"我大概知道问题" ← 停止
```

---

### 5. requesting-code-review (审查技能)

**触发条件**:
- 子代理驱动开发中每个任务后
- 完成主要功能后
- 合并到 main 前

**使用方式**:
```bash
# 获取 git SHAs
BASE_SHA=$(git rev-parse HEAD~1)
HEAD_SHA=$(git rev-parse HEAD)
```

**审查重点**:
- 代码质量
- 测试覆盖
- 潜在风险
- 改进建议

---

### 6. dispatching-parallel-agents (并行调度)

**触发条件**: 面临 2+ 独立任务，无共享状态或顺序依赖

**核心原则**:
```
每个独立问题域派遣一个代理
让他们并发工作
```

**决策树**:
```
多个失败?
├─ 它们独立吗?
│   ├─ 是 → 可以并行吗?
│   │   ├─ 是 → 并行派遣
│   │   └─ 否 → 顺序代理
│   └─ 否 → 单代理调查所有
```

---

### 7. finishing-a-development-branch (完成分支)

**触发条件**: 实现完成，所有测试通过

**流程**:
1. **验证测试** - 运行测试套件
2. **展示选项**:
   - 合并到主分支
   - 创建 Pull Request
   - 丢弃更改
3. **执行选择**
4. **清理** - 删除工作树（如适用）

---

## 快速参考卡

### 何时使用哪个 Skill

| 场景 | Skill |
|------|-------|
| 开始任何任务 | `using-superpowers` |
| 新功能/改动 | `brainstorming` |
| 有设计后写计划 | `writing-plans` |
| 执行计划 | `executing-plans` |
| Bug/测试失败 | `systematic-debugging` |
| 完成任务后 | `requesting-code-review` |
| 多个独立问题 | `dispatching-parallel-agents` |
| 工作完成 | `finishing-a-development-branch` |

### Skill 优先级

```
1. 流程 skills (brainstorming, debugging) → 决定如何处理任务
2. 实现 skills (frontend, mcp-builder) → 指导执行
```

---

## 安装验证

```bash
# 检查已安装的 skills
ls skills/

# 应该看到:
# brainstorming/
# executing-plans/
# finishing-a-development-branch/
# requesting-code-review/
# systematic-debugging/
# using-superpowers/
# writing-plans/
# ...
```

---

## 参考资料

- [Superpowers 详细用法教程](https://www.cnblogs.com/gyc567/p/19510203)
- [Claude Code Skills 开发实战](https://m.blog.csdn.net/hiliang521/article/details/157873423)
- [Anthropic Official Skills](https://github.com/anthropics/skills)
- [obra/superpowers](https://github.com/obra/superpowers)
