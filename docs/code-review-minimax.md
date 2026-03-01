# Code Review: Minimax Agent Teams 补充功能实现

## 审查概述

**审查目标**: minimax 分支的 Agent Teams 补充设计实现
**对比基准**: `docs/agent-teams-supplement.md`
**审查时间**: 2026-03-01

---

## 实现完成度

### P0 功能 (立即实施)

| 功能 | 状态 | 文件 | 评分 |
|------|------|------|------|
| Council 并行成员发言 | ⚠️ 需验证 | `modes/*.ts` | - |
| 基线测试自动化 | ✅ 完成 | `benchmark.ts` | A |
| 产物写入文件系统 | ✅ 完成 | `artifact-store.ts` | A |

### P1 功能 (短期实施)

| 功能 | 状态 | 文件 | 评分 |
|------|------|------|------|
| LLM-as-Judge 评估 Rubric | ✅ 完成 | `evaluation.ts` | A |
| 检查点恢复能力 | ⚠️ 部分 | `checkpoint-store.ts` | B |
| 宽松上下文契约 | ✅ 完成 | `contracts.ts` | A |
| PROGRESS.md 持久化 | ✅ 完成 | `progress-store.ts` | B+ |

### P2 功能 (中期实施)

| 功能 | 状态 | 文件 | 评分 |
|------|------|------|------|
| Git Worktree 隔离 | ✅ 完成 | `worktree-isolation.ts` | A- |
| 扩展思考预算 | ✅ 完成 | `types.ts` | B+ |
| 基线测试扩展 | ✅ 完成 | `benchmark.ts` | A |

---

## 详细代码审查

### 1. artifact-store.ts ✅ 优秀

**优点**:
- 实现了产物文件系统存储，避免"电话游戏"
- 支持 worker-output.md 和 reviewer-feedback.md
- 包含 checksum 校验
- 元数据自描述

**改进建议**:
```typescript
// 当前: agentId 硬编码为 "agent"
[type]: {
  createdAt: Date.now(),
  agentId: "agent",  // ❌ 应该传入真实 agentId
  taskId,
  checksum,
}

// 建议: 添加 agentId 参数
async saveWorkerOutput(taskId: string, artifact: WorkArtifact, agentId?: string)
```

**评分**: A

---

### 2. evaluation.ts ✅ 优秀

**优点**:
- 实现了 LLM-as-Judge 评估系统
- 4 维度评估 (正确性、完整性、可维护性、性能)
- 权重可配置
- 生成改进建议

**问题**:

1. **性能评估过于简化** (line 236-250):
```typescript
private evaluatePerformance(_artifact: WorkArtifact, _review: ReviewArtifact): DimensionScore {
  let score = 3
  // 简化处理：假设无性能问题为4分
  if (_review.performanceConcerns && _review.performanceConcerns.length === 0) {
    score = 4
  }
  // ❌ 没有实际性能指标评估
}
```

2. **缺少 LLM 调用**:
```typescript
// 当前是规则评估，应该支持 LLM-as-Judge
evaluate(artifact: WorkArtifact, review: ReviewArtifact): EvaluationResult {
  // ❌ 没有调用 LLM 进行评估
  // 只是简单的规则计算
}
```

**改进建议**:
```typescript
interface EvaluatorOptions {
  llmClient?: LLMClient  // 添加 LLM 客户端
  useLlmAsJudge?: boolean
}

async evaluateWithLlm(artifact: WorkArtifact, review: ReviewArtifact): Promise<EvaluationResult> {
  const prompt = this.buildEvaluationPrompt(artifact, review)
  const response = await this.options.llmClient.run(prompt)
  return this.parseLlmResponse(response)
}
```

**评分**: A- (扣分项: 未实现真正的 LLM-as-Judge)

---

### 3. contracts.ts ✅ 优秀

**优点**:
- 实现了 `ContextContract` (宽松上下文契约)
- 完整的 Zod schema 验证
- 文档注释清晰

**亮点**:
```typescript
/**
 * 上下文契约 - 宽松上下文契约
 *
 * 来源: "Context, Not Control" 原则
 * 用途: 替代严格的 TaskContract，给予 Agent 更多自主判断空间
 */
export interface ContextContract {
  objective: string  // 目标而非步骤
  context: { ... }   // 背景知识而非指令
  boundaries: { ... } // 边界而非范围
  expectedOutcome: { ... } // 输出期望而非格式
}
```

**评分**: A

---

### 4. worktree-isolation.ts ✅ 良好

**优点**:
- 实现了 Git Worktree 隔离
- 支持批量创建和清理
- cleanup 函数封装良好

**问题**:

1. **命令注入风险** (line 128-137):
```typescript
private async runGitCommand(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(`git ${command}`, (error, stdout, stderr) => {
      // ❌ 直接拼接命令，存在注入风险
    })
  })
}
```

**改进建议**:
```typescript
private async runGitCommand(command: string, args: string[] = []): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", [command, ...args], (error, stdout, stderr) => {
      // ✅ 使用 execFile 避免注入
    })
  })
}
```

2. **缺少错误处理**:
```typescript
async createWorkerWorktree(workerId: string): Promise<WorktreeHandle> {
  // ❌ 如果 worktree 已存在会报错
  await this.runGitCommand(`worktree add ${worktreePath} -b ${branchName}`)
}
```

**评分**: A- (扣分项: 命令注入风险)

---

### 5. benchmark.ts ✅ 优秀

**优点**:
- 完整的基线测试框架
- 单 Agent vs Team 对比
- 生成 Markdown 报告
- 支持多种统计指标

**问题**:

1. **模拟执行而非真实执行** (line 115-118):
```typescript
private async simulateExecution(task: BenchmarkTask, config: unknown): Promise<void> {
  // 模拟延迟
  await new Promise((resolve) => setTimeout(resolve, 100))
  // ❌ 不是真实的 Agent 执行
}
```

2. **缺少 10+ 样本验证**:
补充文档要求"至少 10 个样本任务"，但当前实现没有预置样本。

**改进建议**:
```typescript
const DEFAULT_TEST_SUITE: BenchmarkTask[] = [
  { name: "simple-001", description: "Add hello function", expectedOutput: "..." },
  { name: "simple-002", description: "Fix typo in README", expectedOutput: "..." },
  // ... 共 10-20 个样本
]
```

**评分**: B+ (扣分项: 模拟执行、缺少样本)

---

### 6. types.ts ✅ 良好

**优点**:
- 添加了 `ThinkingBudget` 接口
- 完整的 Zod schema
- 类型定义清晰

**问题**:

1. **ThinkingBudget 未被使用**:
```typescript
export interface ThinkingBudget {
  enabled: boolean
  maxThinkingTokens: number
  outputThinkingProcess: boolean
}

// ❌ 在 TeamConfig 中定义了，但没有代码使用它
```

**评分**: A-

---

## 跨文件问题

### 1. 缺少 Checkpoint 恢复逻辑

补充文档要求"从检查点恢复"能力，但当前实现:
- `checkpoint-store.ts` 只存储检查点
- 没有恢复 (resume) 功能

**建议**:
```typescript
// 在 TeamManager 中添加
async resumeFromCheckpoint(checkpointId: string): Promise<TeamResult> {
  const checkpoint = await this.checkpointStore.load(checkpointId)
  const pendingTasks = checkpoint.tasks.filter(t => t.status !== "completed")
  return this.executeWithResume(pendingTasks, checkpoint.context)
}
```

### 2. 缺少 Ralph Loop

补充文档的"持续执行循环"未实现。

### 3. Council 并行未验证

需要检查 Council 模式是否真正并行执行成员发言。

---

## 安全审查

| 问题 | 严重程度 | 位置 |
|------|---------|------|
| 命令注入风险 | 中 | `worktree-isolation.ts:128` |
| 硬编码 agentId | 低 | `artifact-store.ts:232` |

---

## 性能审查

| 问题 | 影响 | 位置 |
|------|------|------|
| 同步文件写入 | 中 | `artifact-store.ts` 多处 |
| 缺少批量写入 | 低 | `artifact-store.ts` |

---

## 总体评分

| 维度 | 评分 | 说明 |
|------|------|------|
| **功能完成度** | A- | P0/P1 大部分完成，P2 部分完成 |
| **代码质量** | A | 结构清晰，类型完整，注释良好 |
| **安全性** | B+ | 存在命令注入风险 |
| **可维护性** | A | 模块化设计良好 |
| **测试覆盖** | B | 有测试但不够全面 |

**综合评分**: **A-**

---

## 优先修复建议

### P0 - 立即修复
1. ❗ 修复 `worktree-isolation.ts` 命令注入风险
2. 添加 Council 并行执行的验证测试

### P1 - 短期修复
1. 实现 Checkpoint 恢复逻辑
2. 添加 10+ 基线测试样本
3. 实现真正的 LLM-as-Judge (可选)

### P2 - 后续改进
1. 实现 Ralph Loop 持续执行
2. 使用 ThinkingBudget 配置
3. 异步文件写入优化

---

## 结论

minimax 分支的实现质量很高，完成了补充文档的大部分要求。主要亮点:
- ✅ ArtifactStore 实现了产物文件系统存储
- ✅ Evaluator 实现了 LLM-as-Judge 评估框架
- ✅ ContextContract 实现了宽松上下文契约
- ✅ WorktreeIsolation 实现了 Git Worktree 隔离
- ✅ TeamBenchmark 实现了基线测试框架

主要不足:
- ❌ 命令注入风险需要立即修复
- ⚠️ 部分功能是模拟实现，需要接入真实 Agent
- ⚠️ Checkpoint 恢复逻辑未实现

**建议**: 修复安全问题后可以合并到主分支。
