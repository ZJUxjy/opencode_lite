# Agent Teams 设计文档

## 概述

Agent Teams 是一个多 Agent 协作开发系统，允许多个 Agent 以明确角色和协议协同完成复杂任务。

### 设计目标

1. 提高质量：通过评审闭环降低回归风险。
2. 提升效率：通过并行与分工缩短交付时间。
3. 强化决策：关键点采用多方案评估而非单点判断。
4. 成本可控：提供预算、并发、熔断三层控制。

### 核心原则

1. 先协议后并行：先定义产物契约和边界，再启动多 Agent。
2. 可回滚：每个阶段都可中止和回退。
3. 可观测：必须有进度、成本、质量三类指标。
4. 默认保守：MVP 仅启用低风险模式。

---

## 协作模式总览

| 模式 | Agent 数 | 相对成本 | 适用场景 | 推荐度 |
|------|----------|----------|----------|--------|
| Worker-Reviewer | 2 | 2x | 日常开发、质量门禁 | ⭐⭐⭐⭐⭐ |
| Planner-Executor-Reviewer | 3 | 2.5-3x | 需求不清晰、易返工任务 | ⭐⭐⭐⭐ |
| Leader-Workers (collaborative) | 3-5 | 3-5x | 多模块并行开发 | ⭐⭐⭐⭐ |
| Leader-Workers (competitive) | 3-5 | 3-5x | 关键方案对比 | ⭐⭐⭐ |
| Hotfix Guardrail | 2 | 1.5-2x | 线上故障、紧急修复 | ⭐⭐⭐⭐ |
| Council | 3-5 | 4-6x | 架构决策、技术选型 | ⭐⭐ |

默认仅开放：`worker-reviewer`、`planner-executor-reviewer`、`hotfix-guardrail`。

---

## 模式定义与状态机

```typescript
// src/teams/types.ts

export type TeamMode =
  | "worker-reviewer"
  | "planner-executor-reviewer"
  | "leader-workers"
  | "hotfix-guardrail"
  | "council"

export type LeaderWorkersStrategy = "collaborative" | "competitive"

export type AgentRole =
  | "worker"
  | "reviewer"
  | "planner"
  | "executor"
  | "leader"
  | "member"
  | "speaker"
  | "fixer"
  | "safety-reviewer"

export type TeamStatus =
  | "initializing"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "cancelled"

export interface TeamConfig {
  mode: TeamMode
  strategy?: LeaderWorkersStrategy // 仅 mode=leader-workers 时有效
  agents: TeamAgentConfig[]

  maxIterations: number
  timeoutMs: number

  budget?: {
    maxTokens: number
    maxCostUsd?: number
    maxParallelAgents?: number
  }

  qualityGate: {
    testsMustPass: boolean
    noP0Issues: boolean
    minCoverage?: number
    requiredChecks?: string[]
  }

  circuitBreaker: {
    maxConsecutiveFailures: number
    maxNoProgressRounds: number
    cooldownMs: number
  }

  conflictResolution: "auto" | "manual"
}

export interface TeamAgentConfig {
  role: AgentRole
  model: string
  skills?: string[]
  systemPrompt?: string
}
```

### 状态机（补充）

```text
initializing --start--> running
running --success--> completed
running --error--> failed
running --timeout--> timeout
running --cancel--> cancelled
```

---

## 产物契约（必须实现）

并行模式必须统一产物结构，避免“能生成但不能集成”。

```typescript
// src/teams/contracts.ts

export interface TaskContract {
  taskId: string
  objective: string
  fileScope: string[]          // 允许修改的文件范围
  apiContracts?: string[]      // API/schema 约束
  acceptanceChecks: string[]   // 必须执行的命令，例如 npm test
}

export interface WorkArtifact {
  taskId: string
  summary: string
  changedFiles: string[]
  patchRef: string             // patch 或 commit 引用
  testResults: Array<{ command: string; passed: boolean; outputRef?: string }>
  risks: string[]
  assumptions: string[]
}

export interface ReviewArtifact {
  status: "approved" | "changes_requested"
  severity: "P0" | "P1" | "P2" | "P3"
  mustFix: string[]
  suggestions: string[]
}
```

### Agent 通信协议（补充）

```typescript
export type AgentMessage =
  | { type: "task-assign"; task: TaskContract }
  | { type: "task-result"; artifact: WorkArtifact }
  | { type: "review-request"; artifact: WorkArtifact }
  | { type: "review-result"; review: ReviewArtifact }
  | { type: "conflict-detected"; files: string[] }
```

---

## 各模式流程

## 1. Worker-Reviewer（MVP）

适用场景：常规开发、需要稳定质量门禁。

流程：Worker 实现 -> Reviewer 审核 -> 未通过则回修 -> 通过后统一验收。

终止条件：

1. `qualityGate` 满足且 Reviewer 批准。
2. 迭代超限、预算超限、超时触发失败。
3. 连续无进展轮次超过阈值，触发熔断。

## 2. Planner-Executor-Reviewer（新增）

适用场景：需求模糊、变更范围不清晰、容易返工。

角色：

1. Planner：澄清需求、输出 `TaskContract`。
2. Executor：按契约实现并提交 `WorkArtifact`。
3. Reviewer：按契约验收，阻断越界改动与遗漏测试。

收益：把“返工”前移到规划阶段，降低总 token 消耗。

## 3. Leader-Workers

### collaborative

Leader 先拆 DAG，再按 `fileScope` 分区给 Worker 并行执行，最后集成。

### competitive

多个 Worker 对同一任务出方案，Leader 按统一标准选择或合并。

评估标准（示例权重）：

1. 代码质量 30%
2. 测试与可验证性 25%
3. 性能 20%
4. 可维护性 15%
5. 需求符合度 10%

## 4. Hotfix Guardrail（新增）

适用场景：线上紧急故障。

角色：

1. Fixer：最小修复。
2. Safety Reviewer：高风险项检查（安全、数据一致性、回滚路径）。

强制规则：

1. 只允许最小文件范围。
2. 必须产出回滚步骤。
3. 禁止顺手重构。

## 5. Council

用于架构决策，不直接改代码。输出为“决策记录 + 执行建议”，再交给执行型模式落地。

---

## 模式准入矩阵（新增）

| 模式 | 允许并行改同文件 | 必须 Reviewer | 可跳过测试 | 适用环境 |
|------|------------------|---------------|------------|----------|
| worker-reviewer | 否 | 是 | 否 | 默认开发 |
| planner-executor-reviewer | 否 | 是 | 否 | 需求不清晰 |
| leader-workers (collaborative) | 否（默认文件分区） | Leader 集成验收 | 否 | 多模块并行 |
| leader-workers (competitive) | 是（方案分支隔离） | Leader 对比验收 | 否 | 方案评估 |
| hotfix-guardrail | 否 | 是（safety reviewer） | 否 | 线上紧急修复 |
| council | 不适用（不改代码） | 不适用 | 是（仅决策） | 架构与选型 |

---

## 风险优先级（补充）

1. 高：Agent 实例复用策略未定（成本、稳定性和隔离直接受影响）。
2. 中：SharedBlackboard 潜在瓶颈、CheckpointStore 合并策略、并发冲突治理。
3. 中：MCP 与 Teams 关系边界不清（连接管理、预算归属、权限边界）。
4. 低：状态机图细化、错误传播一致性、模型选择指南。

---

## 架构设计（MVP）

```text
TeamManager
  -> ModeRunner (worker-reviewer / ...)
  -> SharedBlackboard
  -> CostController
  -> ProgressTracker
  -> CheckpointStore
```

### SharedBlackboard

职责：共享状态、事件通知、只存结构化摘要，不存大体积原文。

### CheckpointStore（优化）

不保存全量文件快照，采用“基线 + 增量 patch”。

```typescript
export interface Checkpoint {
  id: string
  timestamp: number
  description: string
  baseRef: string                    // git commit / tree hash
  patchRefs: string[]                // 增量补丁
  artifactRefs: string[]             // Work/Review 产物引用
  blackboardSnapshotRef: string      // 序列化摘要引用
}
```

最小规范：

1. patch 格式：统一 `git diff --binary`。
2. 合并策略：默认三方合并，失败转人工仲裁。
3. 回滚策略：按 `baseRef + patchRefs` 顺序反向应用。

保留策略：

1. 保留最近 N 个完整检查点。
2. 中间检查点仅保留 patch。
3. 超预算时清理低优先级检查点。

---

## 成本与熔断控制

### 成本控制

不再使用固定 50/50 输入输出估算。改为按调用实测 usage 聚合：

1. 每次模型调用记录 `inputTokens/outputTokens/model`。
2. 按动态价格表计算成本（可热更新）。
3. 预算触达时降级策略：降低并发 -> 切小模型 -> 停止新增任务。

```typescript
export interface PricingTable {
  [model: string]: { inputPer1M: number; outputPer1M: number; updatedAt: number }
}
```

### 熔断与无进展检测

触发任一条件即中止：

1. 连续调用失败超过阈值。
2. 连续 N 轮无有效变更（无 patch、无测试进展、无问题关闭）。
3. 预算超限或超时。

无进展判定（默认）：

1. 连续 2 轮 `changedFiles = 0`。
2. 连续 2 轮 `mustFix` 问题数未下降。
3. 连续 2 轮关键检查命令无新增通过项。

---

## 并发冲突治理

优先级顺序：

1. 文件分区（首选）。
2. 乐观并发 + 三方合并检测。
3. 自动合并失败转人工仲裁。

冲突事件必须入黑板并形成可审计记录。

---

## 与现有系统整合边界（新增）

1. SkillRegistry：直接复用，不引入 teams 私有技能系统。
2. SessionStore：记录 team run 元数据、消息轨迹、检查点索引。
3. MCP：连接由主 Agent 管理；子 Agent 仅通过受控工具调用，不独立持有连接。
4. PolicyEngine：权限判定统一走现有策略引擎，teams 只追加角色上下文。

---

## Agent 实例复用策略（新增）

默认策略：

1. Worker/Reviewer 复用长期实例（保留上下文，降低冷启动成本）。
2. Leader/Planner 可短会话实例（降低上下文污染）。
3. competitive 模式每个方案使用隔离实例，禁止共享可变内存。

切换条件：

1. 上下文压缩后仍超阈值 -> 轮换新实例。
2. 连续工具异常超过阈值 -> 销毁并重建实例。
3. 预算紧张 -> 优先复用低成本实例。

---

## 降级与回退路径（新增）

Team 模式必须支持无缝降级到单 Agent，避免任务中断。

触发条件（任一满足）：

1. Team 状态进入 `failed` / `timeout`。
2. 熔断器打开且冷却后仍无法恢复。
3. 预算触达硬上限。

降级流程：

1. 生成 `TeamFailureReport`（失败原因、已完成产物、未完成任务）。
2. 将最新 `TaskContract + WorkArtifact + ReviewArtifact` 汇总为单 Agent 输入上下文。
3. 自动切换到单 Agent 执行器继续任务（保留原会话 ID 与历史记录）。
4. 在结果中标记 `executionMode: "fallback-single-agent"`。

```typescript
export interface TeamFailureReport {
  teamId: string
  reason: "failed" | "timeout" | "budget_exceeded" | "circuit_open"
  completedTasks: string[]
  pendingTasks: string[]
  recoveryPrompt: string
}
```

---

## 实现计划

### Phase 1（2 周）

目标：仅落地 `worker-reviewer`，验证核心假设（质量提升是否显著且成本可控）。

1. `src/teams/types.ts`
2. `src/teams/contracts.ts`
3. `src/teams/blackboard.ts`
4. `src/teams/cost-controller.ts`
5. `src/teams/progress-tracker.ts`
6. `src/teams/modes/worker-reviewer.ts`
7. `src/teams/fallback.ts`（Team -> 单 Agent 降级执行）
8. `/team` 命令与基础 TUI 状态
9. 基线指标采集脚本（单 Agent vs Team 对照）

Phase 1 暂不实现：`planner-executor-reviewer`、`leader-workers`、`hotfix-guardrail`、`council`。

### Phase 1 验收标准（硬性）

1. 同一任务集上，Team 与单 Agent 都可完成端到端执行。
2. Team 失败可自动降级到单 Agent，且不中断会话。
3. 输出基线报告，至少包含：
  - 成本：`inputTokens/outputTokens/estimatedCost`
  - 质量：`P0-P3 问题数`、`测试通过率`、`mustFix 关闭率`
  - 效率：总耗时、迭代轮次
4. 至少 10 个样本任务，给出均值和 P50/P90。
5. 若 Team 模式质量无提升且成本显著上升（默认阈值 > 1.8x），Phase 2 暂缓。

### Phase 2（2 周）

目标：在 Phase 1 指标达标后，落地 `planner-executor-reviewer` 与 `leader-workers`。

1. `src/teams/task-dag.ts`
2. `src/teams/modes/leader-workers.ts`
3. `src/teams/conflict-detector.ts`
4. `src/teams/modes/planner-executor-reviewer.ts`
5. 集成测试与性能优化

### Phase 3（1-2 周）

目标：`hotfix-guardrail` + `council` + 检查点系统。

1. `src/teams/modes/hotfix-guardrail.ts`
2. `src/teams/modes/council.ts`
3. `src/teams/checkpoint-store.ts`
4. 完整文档与故障演练

---

## 配置示例（修正版）

```json
{
  "teams": {
    "default": {
      "maxIterations": 3,
      "timeoutMs": 1800000,
      "budget": {
        "maxTokens": 200000,
        "maxCostUsd": 1.0,
        "maxParallelAgents": 2
      },
      "qualityGate": {
        "testsMustPass": true,
        "noP0Issues": true,
        "minCoverage": 70
      },
      "circuitBreaker": {
        "maxConsecutiveFailures": 3,
        "maxNoProgressRounds": 2,
        "cooldownMs": 60000
      }
    },
    "worker-reviewer": {
      "mode": "worker-reviewer",
      "agents": [
        { "role": "worker", "model": "claude-sonnet-4", "skills": ["nodejs", "react"] },
        { "role": "reviewer", "model": "claude-sonnet-4", "skills": ["code-review", "tdd"] }
      ]
    },
    "planner-executor-reviewer": {
      "mode": "planner-executor-reviewer",
      "agents": [
        { "role": "planner", "model": "claude-sonnet-4" },
        { "role": "executor", "model": "claude-haiku-4" },
        { "role": "reviewer", "model": "claude-sonnet-4", "skills": ["code-review"] }
      ]
    },
    "leader-workers-collab": {
      "mode": "leader-workers",
      "strategy": "collaborative",
      "agents": [
        { "role": "leader", "model": "claude-sonnet-4" },
        { "role": "worker", "model": "claude-haiku-4" },
        { "role": "worker", "model": "claude-haiku-4" }
      ]
    },
    "hotfix-guardrail": {
      "mode": "hotfix-guardrail",
      "agents": [
        { "role": "fixer", "model": "claude-sonnet-4" },
        { "role": "safety-reviewer", "model": "claude-sonnet-4", "skills": ["code-review"] }
      ]
    },
    "council": {
      "mode": "council",
      "agents": [
        { "role": "speaker", "model": "claude-opus-4" },
        { "role": "member", "model": "claude-sonnet-4" },
        { "role": "member", "model": "claude-sonnet-4" }
      ]
    }
  }
}
```

---

## CLI 示例

```bash
lite-opencode --team worker-reviewer
lite-opencode --team planner-executor-reviewer
lite-opencode --team leader-workers --strategy collaborative --workers 3
lite-opencode --team hotfix-guardrail
```

---

## 参考资料

- AutoGen: Multi-Agent Conversation Framework
- MetaGPT: Multi-Agent Framework
- CrewAI: Multi-Agent Orchestration
- Existing Subagent System: `docs/agent-architecture-research.md`
