# Agent Teams 完整实现设计文档

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal**: 完成 Agent Teams 的协作模式、CLI 集成和配置文件支持

**Architecture**: 渐进式实现，先建立 ModeRunner 抽象层和基础设施，再逐个实现具体模式

**Tech Stack:** TypeScript, Vitest, Zod, Commander, Vercel AI SDK

---

## 设计决策

### CLI 集成 (完整)
```bash
node dist/index.js --team leader-workers \
  --team-config ./teams.config.json \
  --team-objective "Add user authentication" \
  --team-budget 100000 \
  --team-timeout 300000
```

### 配置文件格式 (JSON)
```json
{
  "teams": {
    "default": {
      "mode": "leader-workers",
      "maxIterations": 10,
      "timeoutMs": 300000,
      "budget": { "maxTokens": 100000 },
      "qualityGate": { "requiredChecks": ["npm test"], "autoFixOnFail": false }
    }
  }
}
```

### 协作模式实现顺序
1. **ModeRunner 抽象层** - 定义统一接口
2. **worker-reviewer** - 最简单，验证框架
3. **leader-workers** - 最常用
4. **其他 3 个模式** - council, planner-executor-reviewer, hotfix-guardrail

### Agent 通信 (混合模式)
- 默认使用内置 `AgentLLMClient`
- 支持注入自定义回调覆盖

---

## Phase 1: 基础设施

### 1.1 ModeRunner 抽象接口

```typescript
// src/teams/modes/base.ts
export interface ModeRunner<TInput = unknown, TOutput = unknown> {
  readonly mode: TeamMode
  readonly config: TeamConfig

  execute(input: TInput): Promise<TeamResult<TOutput>>
  cancel(): void
  getState(): TeamState

  // 生命周期钩子
  onProgress?(callback: ProgressCallback): void
  onError?(callback: ErrorCallback): void
  onComplete?(callback: CompleteCallback): void
}

export interface TeamResult<T = unknown> {
  status: "completed" | "failed" | "cancelled" | "fallback"
  output: T
  stats: {
    durationMs: number
    tokensUsed: { input: number; output: number }
    iterations: number
  }
  fallbackUsed?: boolean
  error?: string
}
```

### 1.2 配置文件加载器

```typescript
// src/teams/config/loader.ts
export interface TeamsConfigFile {
  teams: {
    [profile: string]: TeamConfig
  }
}

export function loadTeamsConfig(path: string): TeamsConfigFile
export function resolveTeamConfig(profile: string, overrides: Partial<TeamConfig>): TeamConfig
```

### 1.3 CLI 参数解析

```typescript
// src/cli/team-options.ts
export interface TeamCLIOptions {
  team?: TeamMode
  teamConfig?: string
  teamObjective?: string
  teamBudget?: number
  teamTimeout?: number
  teamProfile?: string
}

export function parseTeamOptions(argv: string[]): TeamCLIOptions
```

---

## Phase 2: 核心模式

### 2.1 WorkerReviewerRunner

```typescript
// src/teams/modes/worker-reviewer.ts
export class WorkerReviewerRunner implements ModeRunner<string, WorkArtifact> {
  readonly mode = "worker-reviewer"

  constructor(
    config: TeamConfig,
    callbacks: {
      askWorker: (prompt: string, contract: TaskContract) => Promise<WorkerOutput>
      askReviewer: (artifact: WorkArtifact) => Promise<ReviewerOutput>
    }
  )

  async execute(objective: string): Promise<TeamResult<WorkArtifact>> {
    // 1. Worker 执行
    // 2. Reviewer 审查
    // 3. 循环直到 approved 或达到最大迭代
  }
}
```

### 2.2 LeaderWorkersRunner

```typescript
// src/teams/modes/leader-workers.ts
export class LeaderWorkersRunner implements ModeRunner<string, WorkArtifact> {
  readonly mode = "leader-workers"

  constructor(
    config: TeamConfig,
    callbacks: {
      askLeader: (prompt: string) => Promise<LeaderOutput>
      askWorker: (prompt: string, contract: TaskContract) => Promise<WorkerOutput>
      askReviewer?: (artifact: WorkArtifact) => Promise<ReviewerOutput>
    }
  )

  async execute(objective: string): Promise<TeamResult<WorkArtifact>> {
    // 1. Leader 分解任务
    // 2. Workers 并行执行
    // 3. Leader 集成结果
  }
}
```

---

## Phase 3: 完整功能

### 3.1 其他模式
- CouncilRunner
- PlannerExecutorReviewerRunner
- HotfixGuardrailRunner

### 3.2 CLI 集成

```typescript
// src/index.tsx (修改)
if (options.team) {
  const manager = new TeamManager({
    config: resolveTeamConfig(options.teamProfile || "default", {
      mode: options.team,
      budget: options.teamBudget ? { maxTokens: options.teamBudget } : undefined,
      timeoutMs: options.teamTimeout,
    }),
    objective: options.teamObjective,
  })

  const result = await manager.run()
  console.log(result.output)
}
```

### 3.3 Drill 测试验证

所有 5 个 drill 场景必须通过:
- timeout-fallback
- budget-fallback
- quality-gate
- conflict-resolution
- checkpoint-rollback

---

## 文件结构

```
src/teams/
├── modes/
│   ├── base.ts              # ModeRunner 抽象
│   ├── worker-reviewer.ts   # ✅ 实现
│   ├── leader-workers.ts    # ✅ 实现
│   ├── council.ts           # Phase 3
│   ├── planner-executor-reviewer.ts  # Phase 3
│   ├── hotfix-guardrail.ts  # Phase 3
│   └── index.ts             # 统一导出
├── config/
│   ├── loader.ts            # 配置加载
│   └── defaults.ts          # 默认配置
├── manager.ts               # TeamManager
└── index.ts                 # 统一导出

src/cli/
└── team-options.ts          # CLI 解析
```

---

## 验收标准

**必须通过**:
1. 所有单元测试通过
2. 5 个 Drill 场景全部通过
3. `--team leader-workers` 能用真实 LLM 完成 "Add hello function" 任务

---

## 时间估算

| Phase | 任务 | 估计时间 |
|-------|------|---------|
| 1 | 基础设施 | 2-3 小时 |
| 2 | 核心模式 | 3-4 小时 |
| 3 | 完整功能 | 2-3 小时 |

**总计**: 7-10 小时
