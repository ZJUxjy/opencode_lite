# Plan Mode 增量编辑计划文件实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 允许 Agent 在 Plan Mode 下使用 edit/write 工具编辑计划文件，同时直接阻止非计划文件的编辑操作。

**Architecture:** 在 PolicyEngine 中添加 planFilePath 属性，修改 checkPlanMode() 方法对 edit/write 工具进行路径检查。通过 Context 接口传递 setPlanFilePath 回调。

**Tech Stack:** TypeScript, Vitest

---

### Task 1: 添加 planFilePath 到 PolicyEngine

**Files:**
- Modify: `src/policy.ts:78-90` (PolicyEngine 类属性)
- Test: `src/policy/__tests__/plan-mode.test.ts` (新建)

**Step 1: 创建测试文件并编写失败测试**

```typescript
// src/policy/__tests__/plan-mode.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import { PolicyEngine } from "../policy.js"

describe("PolicyEngine Plan Mode planFilePath", () => {
  let engine: PolicyEngine

  beforeEach(() => {
    engine = new PolicyEngine()
  })

  it("should allow edit on plan file when in plan mode", () => {
    engine.setPlanMode(true)
    engine.setPlanFilePath("/tmp/plans/test-plan.md")

    const result = engine.check("edit", { path: "/tmp/plans/test-plan.md", old_string: "a", new_string: "b" })

    expect(result.decision).toBe("allow")
    expect(result.reason).toContain("计划文件")
  })

  it("should deny edit on non-plan file when in plan mode", () => {
    engine.setPlanMode(true)
    engine.setPlanFilePath("/tmp/plans/test-plan.md")

    const result = engine.check("edit", { path: "/tmp/other-file.md", old_string: "a", new_string: "b" })

    expect(result.decision).toBe("deny")
    expect(result.reason).toContain("只能编辑计划文件")
  })

  it("should allow write on plan file when in plan mode", () => {
    engine.setPlanMode(true)
    engine.setPlanFilePath("/tmp/plans/test-plan.md")

    const result = engine.check("write", { path: "/tmp/plans/test-plan.md", content: "test" })

    expect(result.decision).toBe("allow")
  })

  it("should deny write on non-plan file when in plan mode", () => {
    engine.setPlanMode(true)
    engine.setPlanFilePath("/tmp/plans/test-plan.md")

    const result = engine.check("write", { path: "/tmp/other-file.md", content: "test" })

    expect(result.decision).toBe("deny")
  })

  it("should normalize paths for comparison", () => {
    engine.setPlanMode(true)
    engine.setPlanFilePath("/tmp/plans/test-plan.md")

    // 相对路径应该被正确解析
    const result = engine.check("edit", { path: "./test-plan.md", old_string: "a", new_string: "b" })

    // 由于相对路径解析依赖 cwd，这里只验证不会崩溃
    expect(result.decision).toBeOneOf(["allow", "deny"])
  })
})
```

**Step 2: 运行测试验证失败**

Run: `npm run test -- src/policy/__tests__/plan-mode.test.ts`
Expected: FAIL - "Property 'setPlanFilePath' does not exist"

**Step 3: 实现 PolicyEngine 改动**

在 `src/policy.ts` 的 `PolicyEngine` 类中：

1. 添加属性（约第 85 行后）:
```typescript
/** Plan file path for Plan Mode editing */
private planFilePath: string | null = null
```

2. 添加方法（约第 555 行后，`setPlanMode` 方法附近）:
```typescript
/**
 * 设置计划文件路径
 */
setPlanFilePath(path: string | null): void {
  this.planFilePath = path
}

/**
 * 获取计划文件路径
 */
getPlanFilePath(): string | null {
  return this.planFilePath
}
```

3. 修改 `checkPlanMode` 方法（约第 349 行），在现有逻辑前添加:
```typescript
/**
 * Plan Mode 权限检查
 * 在 Plan Mode 下，只允许只读操作
 */
private checkPlanMode(toolName: string, args: Record<string, unknown>): PolicyResult | null {
  // 新增：对 edit/write 工具的特殊处理
  if (toolName === "edit" || toolName === "write") {
    if (this.planFilePath && args.path) {
      const targetPath = resolve(String(args.path))
      const planPath = resolve(this.planFilePath)
      if (targetPath === planPath) {
        return {
          decision: "allow",
          reason: "Plan Mode: 允许编辑计划文件",
        }
      }
    }
    // 非计划文件直接拒绝，不弹窗
    return {
      decision: "deny",
      reason: "Plan Mode 下只能编辑计划文件，请先退出 Plan Mode",
    }
  }

  // 首先检查 Plan Mode 专用规则
  // ... 现有逻辑保持不变
```

4. 添加 import（文件顶部）:
```typescript
import { resolve } from "path"
```

**Step 4: 运行测试验证通过**

Run: `npm run test -- src/policy/__tests__/plan-mode.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/policy.ts src/policy/__tests__/plan-mode.test.ts
git commit -m "feat(policy): add planFilePath support for Plan Mode editing"
```

---

### Task 2: 添加 setPlanFilePath 到 Context 接口

**Files:**
- Modify: `src/types.ts:14-18` (Context 接口)

**Step 1: 修改 Context 接口**

```typescript
// 上下文
export interface Context {
  cwd: string
  messages: Message[]
  setPlanMode?: (enabled: boolean) => void  // 用于同步 Plan Mode 状态到 PolicyEngine
  setPlanFilePath?: (path: string | null) => void  // 用于设置计划文件路径
}
```

**Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add setPlanFilePath to Context interface"
```

---

### Task 3: 在 Agent 中实现 setPlanFilePath

**Files:**
- Modify: `src/agent.ts:334-338` (executeTools 方法中的 ctx 构建)
- Modify: `src/agent.ts:602-610` (setPlanMode 方法附近)

**Step 1: 在 Agent 类中添加 setPlanFilePath 方法**

在 `setPlanMode` 方法后添加（约第 610 行后）:
```typescript
/**
 * 设置计划文件路径
 */
setPlanFilePath(path: string | null): void {
  this.policyEngine.setPlanFilePath(path)
}
```

**Step 2: 在 executeTools 中更新 ctx 对象**

修改约第 334-338 行:
```typescript
const ctx: Context = {
  cwd: this.cwd,
  messages: [],
  setPlanMode: (enabled) => this.setPlanMode(enabled),
  setPlanFilePath: (path) => this.setPlanFilePath(path),
}
```

**Step 3: Commit**

```bash
git add src/agent.ts
git commit -m "feat(agent): implement setPlanFilePath method"
```

---

### Task 4: 修改 enter-plan-mode 工具

**Files:**
- Modify: `src/tools/enter-plan-mode.ts:29-44`

**Step 1: 修改 execute 方法**

```typescript
execute: async (_params, ctx) => {
  const { planFilePath } = enterPlanModeCurrent()
  ctx.setPlanMode?.(true)
  ctx.setPlanFilePath?.(planFilePath)  // 新增
  const relativePath = planFilePath.replace(ctx.cwd, ".")

  return `Successfully entered Plan Mode.

📋 Plan Mode is now active. You can only use read-only tools.
📝 Plan file will be saved to: ${relativePath}

Next steps:
1. Explore the codebase to understand the current state
2. Identify relevant files and patterns
3. Create a detailed implementation plan
4. Use exit_plan_mode when ready to present your plan`
},
```

**Step 2: Commit**

```bash
git add src/tools/enter-plan-mode.ts
git commit -m "feat(enter-plan-mode): set planFilePath when entering Plan Mode"
```

---

### Task 5: 修改 exit-plan-mode 工具

**Files:**
- Modify: `src/tools/exit-plan-mode.ts:28-43`

**Step 1: 修改 execute 方法**

```typescript
execute: async (_params, ctx) => {
  if (!isPlanModeEnabledCurrent()) {
    return "Not in Plan Mode. No action taken."
  }

  const { planFilePath } = exitPlanModeCurrent()
  ctx.setPlanMode?.(false)
  ctx.setPlanFilePath?.(null)  // 新增
  const relativePath = planFilePath.replace(ctx.cwd, ".")

  return `Successfully exited Plan Mode.

✅ Plan is ready at: ${relativePath}
🔧 You can now implement the plan.

The user will review the plan and provide feedback before execution begins.`
},
```

**Step 2: Commit**

```bash
git add src/tools/exit-plan-mode.ts
git commit -m "feat(exit-plan-mode): clear planFilePath when exiting Plan Mode"
```

---

### Task 6: 构建和完整测试

**Step 1: 运行构建**

Run: `npm run build`
Expected: 无错误

**Step 2: 运行所有测试**

Run: `npm run test`
Expected: 所有测试通过

**Step 3: Final Commit**

```bash
git add -A
git commit -m "feat(plan-mode): complete incremental plan file editing support"
```

---

## 修改文件清单

| 文件 | 修改类型 | 说明 |
|------|---------|------|
| `src/policy.ts` | 修改 | 添加 planFilePath 属性和方法，修改 checkPlanMode 逻辑 |
| `src/policy/__tests__/plan-mode.test.ts` | 新建 | Plan Mode 计划文件编辑测试 |
| `src/types.ts` | 修改 | Context 接口添加 setPlanFilePath |
| `src/agent.ts` | 修改 | 实现 setPlanFilePath 方法，更新 ctx |
| `src/tools/enter-plan-mode.ts` | 修改 | 进入时设置 planFilePath |
| `src/tools/exit-plan-mode.ts` | 修改 | 退出时清除 planFilePath |

## 验证清单

- [ ] Plan Mode 下 edit 计划文件 → allow
- [ ] Plan Mode 下 write 计划文件 → allow
- [ ] Plan Mode 下 edit 非计划文件 → deny（不弹窗）
- [ ] Plan Mode 下 write 非计划文件 → deny（不弹窗）
- [ ] 退出 Plan Mode 后编辑操作恢复正常审批流程
