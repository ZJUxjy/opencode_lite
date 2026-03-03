# Skills System Simplification - LLM-Driven Activation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify the skills system from rule-based triggers to LLM-driven description-based activation, matching the industry standard approach used by Claude Code and gemini-cli.

**Architecture:** Remove the complex `triggers` system (filePatterns/keywords) and rely on LLM to read skill descriptions and decide when to activate. The system prompt will include a list of available skills with their descriptions, allowing the LLM to use `activate_skill` tool when relevant.

**Tech Stack:** TypeScript, existing skills infrastructure

---

## Background

Current design has a rule-based auto-activation system:
- `triggers.filePatterns` - glob patterns to match file paths
- `triggers.keywords` - keywords to match user input
- `autoActivate()` method in registry that checks these rules

**Problems:**
1. `autoActivate()` is never called in the agent flow
2. Only 2 skills (nodejs, react) have triggers configured
3. Industry standard (Claude Code, gemini-cli) uses LLM-driven activation instead
4. Complex code that provides no value

**Solution:**
Remove the rule-based system entirely. Let LLM read skill descriptions and call `activate_skill` tool when needed.

---

### Task 1: Simplify SkillMetadata Interface

**Files:**
- Modify: `src/skills/types.ts:38-41`

**Step 1: Write the failing test**

No new test needed - existing tests will fail after interface change. We'll update tests in Task 3.

**Step 2: Remove triggers interface from types.ts**

Remove the `triggers` field from `SkillMetadata` interface:

```typescript
// src/skills/types.ts - lines 38-41 should be removed
// DELETE:
  /**
   * 触发条件（auto 模式下使用）
   * 文件路径匹配 glob 模式时自动激活
   */
  triggers?: {
    filePatterns?: string[]
    keywords?: string[]
  }
```

Also update the comment on line 29:
```typescript
// CHANGE FROM:
  /**
   * 激活策略
   * - auto: 自动激活（基于触发器）
   * - manual: 手动激活（通过 /skill 命令）
   * - always: 总是激活
   */
// TO:
  /**
   * 激活策略
   * - auto: 可被 LLM 自动激活（基于 description 匹配）
   * - manual: 仅通过 /skill 命令或 activate_skill 工具激活
   * - always: 加载时自动激活
   */
```

**Step 3: Verify build fails**

Run: `npm run build`
Expected: Type errors in registry.ts and loader.ts referencing `triggers`

**Step 4: Commit**

```bash
git add src/skills/types.ts
git commit -m "refactor(skills): remove triggers interface from SkillMetadata

- Remove filePatterns and keywords triggers
- Update activation comment to reflect LLM-driven approach"
```

---

### Task 2: Simplify SkillRegistry - Remove Rule-Based Logic

**Files:**
- Modify: `src/skills/registry.ts:232-301`

**Step 1: Remove autoActivate method and helpers**

Remove the following methods from `SkillRegistry`:
- `autoActivate()` (lines 232-250)
- `shouldAutoActivate()` (lines 255-283)
- `matchGlob()` (lines 288-301)

Also update the class doc comment (lines 6-8):
```typescript
// CHANGE FROM:
/**
 * 负责：
 * - 管理所有已加载的 skills
 * - 处理 skill 激活/停用
 * - 自动激活逻辑（基于触发器）
 * - 生成 prompt 注入内容
 */
// TO:
/**
 * 负责：
 * - 管理所有已加载的 skills
 * - 处理 skill 激活/停用
 * - 生成 prompt 注入内容
 */
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build should succeed now

**Step 3: Commit**

```bash
git add src/skills/registry.ts
git commit -m "refactor(skills): remove rule-based auto-activation from registry

- Remove autoActivate() method
- Remove shouldAutoActivate() method
- Remove matchGlob() method
- LLM will decide activation based on description"
```

---

### Task 3: Simplify SkillLoader - Remove Triggers Validation

**Files:**
- Modify: `src/skills/loader.ts:132-134`

**Step 1: Remove triggers from validateMetadata**

In `validateMetadata()` function, remove the triggers handling:

```typescript
// DELETE lines 132-134:
    triggers: metadata.triggers as
      | { filePatterns?: string[]; keywords?: string[] }
      | undefined,
```

The `SkillMetadata` type will no longer include `triggers`, so this cast is unnecessary.

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/skills/loader.ts
git commit -m "refactor(skills): remove triggers handling from loader"
```

---

### Task 4: Update Registry Tests

**Files:**
- Modify: `src/skills/__tests__/registry.test.ts:159-218`

**Step 1: Remove autoActivate test suite**

Remove the entire `describe("autoActivate", ...)` block (lines 159-218).

**Step 2: Run tests to verify**

Run: `npm run test -- src/skills/__tests__/registry.test.ts`
Expected: All remaining tests pass

**Step 3: Commit**

```bash
git add src/skills/__tests__/registry.test.ts
git commit -m "test(skills): remove autoActivate tests"
```

---

### Task 5: Update Existing Skills - Remove Triggers

**Files:**
- Modify: `skills/nodejs/SKILL.md`
- Modify: `skills/react/SKILL.md`

**Step 1: Update nodejs/SKILL.md**

Remove the `triggers` section from frontmatter:

```yaml
# CHANGE FROM:
---
id: builtin:nodejs
name: Node.js Expert
description: Best practices for Node.js backend development
version: "1.0.0"
activation: auto
triggers:
  filePatterns:
    - "**/server/**"
    - "**/api/**"
    - "**/backend/**"
    - "**/*.server.ts"
    - "**/*.routes.ts"
  keywords:
    - "api"
    - "server"
    - "express"
    - "fastify"
    - "endpoint"
    - "middleware"
tags:
  - nodejs
  - backend
  - api
  - server
---

# TO:
---
id: builtin:nodejs
name: Node.js Expert
description: Best practices for Node.js backend development including Express, Fastify, API design, middleware, error handling, security, and testing. Auto-activates when working on server-side code, APIs, or backend services.
version: "1.0.0"
activation: auto
tags:
  - nodejs
  - backend
  - api
  - server
---
```

Note: The description is enhanced to include keywords that help LLM decide when to activate.

**Step 2: Update react/SKILL.md**

First read the file to see its current triggers:

Run: `cat skills/react/SKILL.md | head -30`

Then update similarly - remove triggers, enhance description.

**Step 3: Verify skills load correctly**

Run: `npm run dev -- --help`
Expected: No errors

**Step 4: Commit**

```bash
git add skills/nodejs/SKILL.md skills/react/SKILL.md
git commit -m "refactor(skills): remove triggers from nodejs and react skills

- Enhance descriptions to include keywords for LLM matching
- LLM will decide activation based on description relevance"
```

---

### Task 6: Add Skills Description List to System Prompt

**Files:**
- Modify: `src/prompts/sections/skills.ts`
- Modify: `src/prompts/types.ts`
- Modify: `src/agent.ts`

**Step 1: Update PromptContext interface**

In `src/prompts/types.ts`, add a new field for available skills:

```typescript
// Add to PromptContext interface:
  /** List of available skills with descriptions (for LLM to decide activation) */
  availableSkills?: string
```

**Step 2: Update skillsSection to show available skills**

In `src/prompts/sections/skills.ts`:

```typescript
import type { PromptSection, PromptContext } from "../types.js"

/**
 * Skills Section
 *
 * Renders:
 * 1. Available skills list (always shown when skills are loaded)
 * 2. Active skills content (shown when skills are activated)
 */
export const skillsSection: PromptSection = {
  name: "skills",

  enabled: (ctx: PromptContext) => {
    // Show when there are available skills OR active skills
    return !!ctx.availableSkills || (!!ctx.skills && ctx.skills.length > 0)
  },

  render: (ctx: PromptContext) => {
    const parts: string[] = []

    // Show available skills for LLM to decide activation
    if (ctx.availableSkills) {
      parts.push(`# Available Skills

The following skills are available. Use \`activate_skill\` tool to activate relevant skills based on the task.

${ctx.availableSkills}
`)
    }

    // Show active skills content
    if (ctx.skills && ctx.skills.length > 0) {
      parts.push(`# Active Skills

${ctx.skills}
`)
    }

    return parts.join("\n---\n\n")
  },
}
```

**Step 3: Add method to generate available skills list**

In `src/skills/registry.ts`, add a new method:

```typescript
/**
 * 获取可用 skills 的描述列表（供 LLM 参考决定激活哪些）
 */
getAvailableSkillsDescription(): string {
  const skills = this.getAll()

  if (skills.length === 0) {
    return ""
  }

  const lines: string[] = []

  for (const skill of skills) {
    const status = skill.isActive ? " [ACTIVE]" : ""
    const activation = skill.metadata.activation === "always" ? " (always-on)" : ""
    lines.push(`- **${skill.metadata.id}**: ${skill.metadata.description}${status}${activation}`)
  }

  return lines.join("\n")
}
```

**Step 4: Update Agent to provide available skills in context**

In `src/agent.ts`, in the `getPromptContext()` method:

```typescript
// Add availableSkills to the return object:
    availableSkills: this.skillRegistry.getAvailableSkillsDescription(),
```

**Step 5: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add src/prompts/types.ts src/prompts/sections/skills.ts src/skills/registry.ts src/agent.ts
git commit -m "feat(skills): add available skills list to system prompt

- Add getAvailableSkillsDescription() to registry
- Show available skills in prompt for LLM to decide activation
- Update skillsSection to render both available and active skills"
```

---

### Task 7: Update Index Exports

**Files:**
- Modify: `src/skills/index.ts`

**Step 1: Update module documentation**

Update the comment in `src/skills/index.ts` to reflect the simplified approach:

```typescript
// CHANGE FROM:
/**
 * Skills System
 *
 * 基于 claude-code、gemini-cli、kimi-cli 调研结果的共识设计：
 *
 * Core Concepts:
 * - Skill: Markdown-based capability definition
 * - SKILL.md: YAML frontmatter + markdown body
 * - Auto-discovery: Scan skills/ directories
 * - Progressive disclosure: metadata → body → resources
 * - Dynamic activation: auto/manual/always policies
 *
 * Usage:
 * ```typescript
 * import { getSkillRegistry, SkillLoader } from './skills/index.js'
 *
 * // 加载所有 skills
 * const registry = getSkillRegistry()
 * await registry.discoverAndLoad()
 *
 * // 手动激活
 * registry.activate('my-skill')
 *
 * // 自动激活（基于上下文）
 * registry.autoActivate({
 *   cwd: process.cwd(),
 *   currentFile: 'src/App.tsx',
 *   userInput: 'help me debug this'
 * })
 *
 * // 获取 prompt 注入
 * const injection = registry.getActivePromptInjection()
 * ```
 */

// TO:
/**
 * Skills System
 *
 * 基于 claude-code、gemini-cli、kimi-cli 调研结果的共识设计：
 *
 * Core Concepts:
 * - Skill: Markdown-based capability definition
 * - SKILL.md: YAML frontmatter + markdown body
 * - Auto-discovery: Scan skills/ directories
 * - Progressive disclosure: metadata → body → resources
 * - LLM-driven activation: LLM reads descriptions and decides when to activate
 *
 * Usage:
 * ```typescript
 * import { getSkillRegistry, SkillLoader } from './skills/index.js'
 *
 * // 加载所有 skills
 * const registry = getSkillRegistry()
 * await registry.discoverAndLoad()
 *
 * // 获取可用 skills 列表（注入到 prompt）
 * const availableSkills = registry.getAvailableSkillsDescription()
 *
 * // 激活 skill（通过 activate_skill 工具调用）
 * registry.activate('my-skill')
 *
 * // 获取已激活 skills 的 prompt 注入
 * const injection = registry.getActivePromptInjection()
 * ```
 */
```

**Step 2: Commit**

```bash
git add src/skills/index.ts
git commit -m "docs(skills): update module documentation for LLM-driven activation"
```

---

### Task 8: Update Template Skill

**Files:**
- Modify: `skills/_template/SKILL.md`

**Step 1: Update template to reflect new approach**

Read current template and update comments to remove triggers references:

```yaml
---
# Skill Metadata
id: "example:template"
name: "Template Skill"
description: "A clear description that helps LLM understand when to activate this skill. Include relevant keywords and use cases in the description."
version: "1.0.0"
author: "Your Name"
activation: "manual"  # auto | manual | always
tags:
  - example
  - template
---

# Template Skill

Brief introduction to what this skill does.

## When to Use

Describe scenarios where this skill should be activated.

## Guidelines

Actual skill content goes here.
```

**Step 2: Commit**

```bash
git add skills/_template/SKILL.md
git commit -m "docs(skills): update template to reflect LLM-driven activation"
```

---

### Task 9: Run Full Test Suite

**Files:**
- None (verification only)

**Step 1: Run all tests**

Run: `npm run test`
Expected: All tests pass

**Step 2: Build project**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Manual smoke test**

Run: `npm run dev`
Then use `/skills` command to list skills and verify they load correctly.

**Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(skills): final cleanup after simplification"
```

---

## File Change Summary

| File | Action | Lines Changed |
|------|--------|---------------|
| `src/skills/types.ts` | Modify | ~10 lines |
| `src/skills/registry.ts` | Modify | ~80 lines removed |
| `src/skills/loader.ts` | Modify | ~5 lines removed |
| `src/skills/__tests__/registry.test.ts` | Modify | ~60 lines removed |
| `src/skills/index.ts` | Modify | Documentation |
| `src/prompts/types.ts` | Modify | +1 field |
| `src/prompts/sections/skills.ts` | Modify | ~15 lines |
| `src/agent.ts` | Modify | +1 line |
| `skills/nodejs/SKILL.md` | Modify | Remove triggers |
| `skills/react/SKILL.md` | Modify | Remove triggers |
| `skills/_template/SKILL.md` | Modify | Update template |

---

## Benefits

1. **Simpler code**: Remove ~150 lines of complex rule-matching logic
2. **More accurate**: LLM understands context better than simple pattern matching
3. **Industry standard**: Matches Claude Code and gemini-cli approach
4. **Easier maintenance**: Only need to maintain good descriptions, not trigger rules
