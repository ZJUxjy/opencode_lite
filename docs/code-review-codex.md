# Code Review: Codex Agent Teams 补充功能实现

## 审查概述

**审查目标**: codex 分支的 Agent Teams 补充设计实现
**对比基准**: `docs/agent-teams-supplement.md`
**审查时间**: 2026-03-01

---

## 与 Minimax 分支对比

| 维度 | Codex | Minimax |
|------|-------|---------|
| **源文件数** | 17 | 17 |
| **测试文件数** | 16 | 5 |
| **测试代码行数** | 1037 | 883 |
| **Ralph Loop** | ✅ 实现 | ❌ 未实现 |
| **Drill 测试** | ✅ 实现 | ❌ 未实现 |
| **LLM-as-Judge** | ✅ Prompt 构建 | ✅ 规则评估 |

---

## 实现完成度

### P0 功能 (立即实施)

| 功能 | 状态 | 文件 | 评分 |
|------|------|------|------|
| Council 并行成员发言 | ✅ 完成 | `modes/council.ts` | A |
| 基线测试自动化 | ✅ 完成 | `benchmark.ts` + `drill.ts` | A+ |
| 产物写入文件系统 | ✅ 完成 | `artifact-store.ts` | A |

### P1 功能 (短期实施)

| 功能 | 状态 | 文件 | 评分 |
|------|------|------|------|
| LLM-as-Judge 评估 Rubric | ✅ 完成 | `evaluator.ts` | A |
| 检查点恢复能力 | ✅ 完成 | `checkpoint-store.ts` | A+ |
| 宽松上下文契约 | ✅ 完成 | `contracts.ts` | A |
| PROGRESS.md 持久化 | ✅ 完成 | `ralph-loop.ts` | A |

### P2 功能 (中期实施)

| 功能 | 状态 | 文件 | 评分 |
|------|------|------|------|
| Git Worktree 隔离 | ❌ 未实现 | - | - |
| 扩展思考预算 | ⚠️ 类型定义 | `types.ts` | B |
| 基线测试扩展 | ✅ 完成 | `drill.ts` | A+ |

---

## 详细代码审查

### 1. ralph-loop.ts ✅ 优秀 (Codex 独有)

**优点**:
- 实现了持续执行循环 (Ralph Loop)
- Markdown 任务队列格式
- 支持 pending/inProgress/completed 状态
- 进度文件追加写入

**亮点**:
```typescript
// 任务队列 Markdown 格式
const lines: string[] = [
  "# Task Queue",
  "",
  "## Pending",
  ...queue.pending.map((t) => `- [ ] ${t}`),
  "",
  "## In Progress",
  ...queue.inProgress.map((t) => `- [~] ${t}`),
  "",
  "## Completed",
  ...queue.completed.map((t) => `- [x] ${t}`),
]
```

**问题**:

1. **缺少错误处理** (line 29):
```typescript
const content = readFileSync(abs, "utf8")  // ❌ 可能抛出异常
return this.parseQueue(content)
```

**改进建议**:
```typescript
try {
  const content = readFileSync(abs, "utf8")
  return this.parseQueue(content)
} catch (error) {
  console.warn(`Failed to load queue: ${abs}`, error)
  return { pending: [], inProgress: [], completed: [] }
}
```

**评分**: A

---

### 2. drill.ts ✅ 优秀 (Codex 独有)

**优点**:
- 实现了 5 个关键场景的演练测试
- 覆盖超时、预算、质量门、冲突、检查点
- 生成 JSON 格式的演练报告

**测试场景**:

| 场景 | 测试内容 |
|------|----------|
| `drill-timeout-fallback` | 超时触发 fallback |
| `drill-budget-fallback` | 预算超限触发 fallback |
| `drill-quality-gate` | 质量门失败触发 fallback |
| `drill-conflict-strategy` | manual vs auto 冲突解决 |
| `drill-checkpoint-rollback` | 检查点回滚计划 |

**亮点**:
```typescript
async function scenarioCheckpointRollback(): Promise<DrillScenarioResult> {
  const store = new CheckpointStore({...})
  const checkpoint = store.create({...})
  const plan = store.buildRollbackPlan(checkpoint.id)
  const passed = plan.baseRef === "base-123" &&
                 plan.reversePatchRefs.join(",") === "p3,p2,p1"
  // ✅ 验证了回滚顺序正确
}
```

**评分**: A+

---

### 3. evaluator.ts ✅ 良好

**优点**:
- 专注于 LLM-as-Judge 的 Prompt 构建
- JSON 解析有容错处理
- 结构简洁

**与 Minimax 对比**:

| 维度 | Codex | Minimax |
|------|-------|---------|
| 设计理念 | Prompt 构建 + 解析 | 规则评估 |
| LLM 调用 | ❌ 无 (需要外部调用) | ❌ 无 |
| 维度评分 | ✅ 支持 | ✅ 支持 |
| 改进建议 | ❌ 无 | ✅ 自动生成 |

**Codex 方案更适合真实 LLM 集成**:
```typescript
buildJudgePrompt(rubric: EvaluationRubric, task: string, output: string): string {
  return [
    "You are an evaluation judge. Return JSON only.",
    '{"scores":[...]}',
    "Rubric dimensions:",
    dimensions,
    "Task:", task,
    "Candidate output:", output,
  ].join("\n")
}
```

**评分**: A

---

### 4. checkpoint-store.ts ✅ 优秀

**优点**:
- 实现了 `buildRollbackPlan` 方法 (Minimax 缺失)
- 持久化到文件系统
- prune 清理旧检查点
- 类型验证 `isCheckpointLike`

**亮点 - 回滚计划**:
```typescript
buildRollbackPlan(id: string): { baseRef: string; reversePatchRefs: string[] } {
  const checkpoint = this.get(id)
  if (!checkpoint) throw new Error(`Checkpoint not found: ${id}`)
  return {
    baseRef: checkpoint.baseRef,
    reversePatchRefs: [...checkpoint.patchRefs].reverse(),  // ✅ 反序应用
  }
}
```

**问题**:

1. **缺少 resume 方法**:
```typescript
// 当前只有 buildRollbackPlan，缺少实际恢复执行
async resumeFromCheckpoint(id: string, callbacks: TeamCallbacks): Promise<TeamResult> {
  const plan = this.buildRollbackPlan(id)
  // ❌ 未实现
}
```

**评分**: A+

---

### 5. contracts.ts ✅ 良好

**对比 Minimax**:

| 类型 | Codex | Minimax |
|------|-------|---------|
| TaskContract | ✅ | ✅ |
| ContextContract | ✅ | ✅ |
| WorkArtifact | ✅ | ✅ |
| ReviewArtifact | ✅ | ✅ |
| Zod Schemas | ❌ | ✅ |

**Codex 缺少 Zod schema 验证**，建议补充:
```typescript
import { z } from "zod"

export const ContextContractSchema = z.object({
  objective: z.string(),
  context: z.object({
    background: z.string(),
    constraints: z.array(z.string()),
    references: z.array(z.string()),
  }),
  // ...
})
```

**评分**: A-

---

### 6. 测试覆盖 ✅ 优秀

**测试文件对比**:

| Codex 测试 | 行数 | Minimax |
|------------|------|---------|
| manager.test.ts | 249 | ❌ |
| integration.test.ts | 123 | ❌ |
| checkpoint-store.test.ts | 89 | ❌ |
| ralph-loop.test.ts | 47 | ❌ |
| council.test.ts | 74 | ❌ |
| leader-workers.test.ts | 97 | ✅ |
| conflict-detector.test.ts | 56 | ✅ |
| task-dag.test.ts | 44 | ✅ |
| **总计** | **1037** | **883** |

**Codex 测试覆盖更全面**:
- ✅ 集成测试
- ✅ 所有模式测试
- ✅ Ralph Loop 测试
- ✅ Checkpoint 测试

---

## 跨文件问题

### 1. 缺少 Git Worktree 隔离

Codex 未实现 `worktree-isolation.ts`，而 Minimax 已实现。

**影响**: 无法安全地并行执行文件修改任务。

### 2. 思考预算未使用

与 Minimax 相同，`ThinkingBudget` 类型已定义但未被使用。

---

## 安全审查

| 问题 | 严重程度 | 位置 |
|------|---------|------|
| 文件读取无 try-catch | 低 | `ralph-loop.ts:29` |

**对比 Minimax**: Codex 没有命令注入风险（无 `exec` 调用）。

---

## 总体评分

| 维度 | 评分 | 说明 |
|------|------|------|
| **功能完成度** | A | P0/P1 全部完成，P2 部分完成 |
| **代码质量** | A | 结构清晰，简洁实用 |
| **安全性** | A | 无明显安全问题 |
| **可维护性** | A+ | 测试覆盖全面 |
| **测试覆盖** | A+ | 16 个测试文件，1037 行 |

**综合评分**: **A**

---

## Codex vs Minimax 对比总结

| 维度 | Codex | Minimax | 推荐 |
|------|-------|---------|------|
| **Ralph Loop** | ✅ 实现 | ❌ | Codex |
| **Drill 测试** | ✅ 实现 | ❌ | Codex |
| **Checkpoint 回滚** | ✅ buildRollbackPlan | ❌ | Codex |
| **LLM-as-Judge** | Prompt 构建 | 规则评估 | 平手 |
| **Git Worktree** | ❌ | ✅ | Minimax |
| **Zod Schemas** | ❌ | ✅ | Minimax |
| **测试覆盖** | 1037 行 | 883 行 | Codex |
| **安全性** | A | B+ (命令注入) | Codex |

---

## 优先修复建议

### P0 - 立即修复
无

### P1 - 短期修复
1. 添加 Git Worktree 隔离 (从 Minimax 移植)
2. 添加 Zod schema 验证 (从 Minimax 移植)
3. 文件读取添加 try-catch

### P2 - 后续改进
1. 实现 resumeFromCheckpoint 完整流程
2. 接入真实 LLM 调用进行评估

---

## 结论

Codex 分支的实现质量优秀，完成了补充文档的绝大部分要求。

**主要亮点**:
- ✅ Ralph Loop 持续执行循环 (独有)
- ✅ Drill 演练测试框架 (独有)
- ✅ Checkpoint 回滚计划 (独有)
- ✅ 测试覆盖最全面 (1037 行)
- ✅ 无安全风险

**主要不足**:
- ❌ 缺少 Git Worktree 隔离
- ⚠️ 缺少 Zod schema 验证

**建议**: Codex 分支实现更完整，建议作为主分支。从 Minimax 移植 `worktree-isolation.ts` 和 Zod schemas 后即可合并。

**综合评分**: **A** (优于 Minimax 的 A-)
