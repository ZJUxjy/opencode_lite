# Plan Mode 增量编辑计划文件设计

## 背景

当前 Plan Mode 下，Agent 只能使用只读工具（read, glob, grep, 安全 bash 命令）。如果需要修改计划文件，必须退出 Plan Mode 或使用其他方式。

**问题**：
1. Agent 无法在 Plan Mode 下增量更新计划文件
2. 非计划文件的编辑会弹出审批请求，干扰用户体验

## 目标

1. 允许 Agent 在 Plan Mode 下使用 `edit` 和 `write` 工具编辑计划文件
2. 非计划文件的编辑操作直接阻止，而非弹出审批请求

## 设计

### 核心逻辑

```
Plan Mode 下的 edit/write 行为：
┌─────────────────────────────────────────────────────┐
│  目标路径 == 计划文件?  →  allow（允许编辑）         │
│  目标路径 != 计划文件?  →  deny（直接阻止，不弹窗）  │
└─────────────────────────────────────────────────────┘
```

### 改动点

#### 1. PolicyEngine 添加计划文件路径支持

**文件**: `src/policy.ts`

```typescript
class PolicyEngine {
  private planFilePath: string | null = null

  setPlanFilePath(path: string | null): void {
    this.planFilePath = path
  }

  private checkPlanMode(toolName: string, args: Record<string, unknown>): PolicyResult | null {
    // 新增：对 edit/write 工具的特殊处理
    if (toolName === 'edit' || toolName === 'write') {
      if (this.planFilePath && args.path) {
        const targetPath = resolve(String(args.path))
        if (targetPath === resolve(this.planFilePath)) {
          return {
            decision: 'allow',
            reason: 'Plan Mode: 允许编辑计划文件',
          }
        }
      }
      // 非计划文件直接拒绝，不弹窗
      return {
        decision: 'deny',
        reason: 'Plan Mode 下只能编辑计划文件',
      }
    }

    // ... 现有逻辑
  }
}
```

#### 2. enter-plan-mode 设置路径

**文件**: `src/tools/enter-plan-mode.ts`

```typescript
execute: async (_params, ctx) => {
  const { planFilePath } = enterPlanModeCurrent()
  ctx.setPlanMode?.(true)
  ctx.setPlanFilePath?.(planFilePath)  // 新增
  // ...
}
```

#### 3. exit-plan-mode 清除路径

**文件**: `src/tools/exit-plan-mode.ts`

```typescript
execute: async (_params, ctx) => {
  // ...
  ctx.setPlanMode?.(false)
  ctx.setPlanFilePath?.(null)  // 新增
  // ...
}
```

### 数据流

```
enter_plan_mode
      ↓
PlanModeManager.enter() → planFilePath
      ↓
ctx.setPlanFilePath(planFilePath)
      ↓
PolicyEngine.planFilePath = planFilePath
      ↓
Agent 调用 edit/write
      ↓
PolicyEngine.checkPlanMode() 检查路径
      ↓
├── path == planFilePath → allow
└── path != planFilePath → deny
```

## 修改文件清单

| 文件 | 修改类型 | 说明 |
|------|---------|------|
| `src/policy.ts` | 修改 | 添加 planFilePath 属性和 setPlanFilePath 方法，修改 checkPlanMode 逻辑 |
| `src/tools/enter-plan-mode.ts` | 修改 | 进入时设置计划文件路径 |
| `src/tools/exit-plan-mode.ts` | 修改 | 退出时清除计划文件路径 |
| `src/agent.ts` | 修改 | 添加 setPlanFilePath 到 context |

## 验证方法

1. 进入 Plan Mode
2. 尝试 `edit` 计划文件 → 应成功
3. 尝试 `write` 计划文件 → 应成功
4. 尝试 `edit` 非计划文件 → 应直接拒绝，不弹窗
5. 尝试 `write` 非计划文件 → 应直接拒绝，不弹窗
6. 退出 Plan Mode 后，所有编辑操作恢复正常审批流程
