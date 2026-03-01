# Agent Teams 补充设计文档

## 概述

本文档基于两篇多 Agent 实践文章的深度分析，为 Agent Teams 系统提供补充设计建议：

1. **Anthropic: Building an effective AI agent for multi-agent research** - 学术研究视角的工程最佳实践
2. **胡渊鸣: 给10个 Claude Code 打工是怎样一种体验** - 工业实战视角的 Vibe Coding 经验

---

## 核心发现总结

### Anthropic 研究的关键数据

| 指标 | 数值 | 启示 |
|------|------|------|
| 单 Agent vs 多 Agent 性能提升 | **+90.2%** | 多 Agent 系统价值明确 |
| Token 消耗 vs 普通聊天 | **15x** | 成本是核心挑战 |
| 并行执行加速比 | **90%** | 并行是效率关键 |
| 性能方差解释度 (Token 用量) | **80%** | Token 预算是核心预测指标 |

### 胡渊鸣实战的关键数据

| 指标 | 数值 | 启示 |
|------|------|------|
| 5 个 Claude Code 并行产出 | **1 commit/min** | 并行化收益显著 |
| Vibe Coding 交互方式 | **语音 + 非交互模式** | 自然语言编程是趋势 |
| 隔离策略 | **Git Worktree + 容器** | 隔离是并行安全基础 |

---

## 补充设计原则

### 原则 1: Context, Not Control (上下文而非控制)

**来源**: 胡渊鸣的管理哲学

**原设计问题**:
- 过度依赖精确的 TaskContract 边界
- Leader 对 Worker 的微观管理

**补充设计**:
```typescript
// 新增: 宽松上下文契约
interface ContextContract {
  // 目标而非步骤
  objective: string
  // 背景知识而非指令
  context: {
    background: string
    constraints: string[]
    references: string[]  // 文件路径、文档链接
  }
  // 边界而非范围
  boundaries: {
    mustNot: string[]     // 禁止事项
    shouldConsider: string[]  // 建议考虑
  }
  // 输出期望而非格式
  expectedOutcome: {
    intent: string
    validationHint: string
  }
}
```

**实施建议**:
- 减少 `acceptanceChecks` 的强制执行
- 增加 Agent 自主判断空间
- 用 PROGRESS.md 代替详细指令

### 原则 2: Subagent Output to Filesystem (产物落地文件系统)

**来源**: Anthropic 的 "避免电话游戏" 原则

**原设计问题**:
- 子 Agent 产物通过内存传递
- 信息在传递中失真

**补充设计**:
```typescript
// 新增: 文件系统产物规范
interface FilesystemArtifact {
  // 产物必须写入文件
  outputPath: string
  // 格式要求
  format: "markdown" | "json" | "patch" | "code"
  // 自描述元数据
  metadata: {
    createdAt: number
    agentId: string
    taskId: string
    checksum: string
  }
}

// 产物目录结构
const ARTIFACT_DIR = ".agent-teams/artifacts/"
// .agent-teams/artifacts/
// ├── task-001/
// │   ├── worker-output.md
// │   ├── reviewer-feedback.md
// │   └── metadata.json
// └── task-002/
//     └── ...
```

**实施建议**:
- 所有子 Agent 产物必须写入 `.agent-teams/artifacts/`
- 后续 Agent 读取文件而非接收内存数据
- 支持断点续传和外部审计

### 原则 3: LLM-as-Judge Evaluation (LLM 评估)

**来源**: Anthropic 的评估方法

**原设计问题**:
- Reviewer 评估缺乏标准化 rubric
- 评估结果不可复现

**补充设计**:
```typescript
// 新增: 评估 Rubric
interface EvaluationRubric {
  dimensions: Array<{
    name: string           // 如 "代码质量"
    weight: number         // 权重 0-1
    scale: 1-5             // 评分等级
    criteria: string[]     // 每个等级的标准
    examples: string[]     // 示例
  }>
  overallThreshold: number // 通过阈值
}

// 评估结果
interface JudgementResult {
  scores: Array<{
    dimension: string
    score: number
    reasoning: string
  }>
  overallScore: number
  passed: boolean
  improvementSuggestions: string[]
}
```

**默认 Rubric 示例**:
```yaml
dimensions:
  - name: "正确性"
    weight: 0.35
    scale: 1-5
    criteria:
      5: "完全正确，无需修改"
      4: "基本正确，有小问题"
      3: "部分正确，需要调整"
      2: "有重大错误"
      1: "完全错误"
  - name: "完整性"
    weight: 0.25
    # ...
  - name: "可维护性"
    weight: 0.20
    # ...
  - name: "性能"
    weight: 0.20
    # ...
overallThreshold: 3.5
```

### 原则 4: Extended Thinking as Scratchpad (扩展思考作为草稿)

**来源**: Anthropic 的 "thinking budget" 机制

**原设计问题**:
- Agent 直接输出结果，缺乏思考过程
- 复杂问题分解不足

**补充设计**:
```typescript
// 新增: 思考预算配置
interface ThinkingBudget {
  enabled: boolean
  maxThinkingTokens: number  // 思考阶段最大 token
  outputThinkingProcess: boolean  // 是否输出思考过程
}

// 在 TeamConfig 中增加
interface TeamConfig {
  // ...existing fields
  thinkingBudget?: ThinkingBudget
}

// 思考产物
interface ThinkingArtifact {
  taskId: string
  thinkingProcess: string  // 思考过程
  analysisSteps: string[]  // 分析步骤
  considerations: string[] // 考虑因素
  conclusion: string       // 结论
}
```

**实施建议**:
- Planner/Leader 角色启用扩展思考
- Worker 角色可禁用以节省成本
- 思考过程写入 `.agent-teams/thinking/` 目录

### 原则 5: Parallel Execution First (并行优先)

**来源**: 两篇文章都强调并行的重要性

**原设计问题**:
- Council 模式成员串行发言
- Leader-Workers 并行度受限于 `maxParallelAgents`

**补充设计**:
```typescript
// 新增: 并行策略配置
interface ParallelStrategy {
  // 并行模式
  mode: "sequential" | "parallel" | "adaptive"

  // 自适应参数
  adaptive?: {
    minParallelism: number   // 最小并行度
    maxParallelism: number   // 最大并行度
    scaleUpThreshold: number // 扩展阈值 (任务数/Agent数)
    scaleDownOnFailure: boolean
  }

  // 隔离策略
  isolation: "shared-context" | "isolated-context" | "worktree"
}
```

**Council 模式改进**:
```typescript
// 原设计: 串行
for (const member of members) {
  const opinion = await member.run(prompt)  // 串行
}

// 改进: 并行
const opinions = await Promise.all(
  members.map(member => member.run(prompt))
)  // 并行
```

**Git Worktree 隔离**:
```typescript
// 新增: Worktree 隔离支持
interface WorktreeIsolation {
  enabled: boolean
  baseBranch: string
  worktreeDir: string
  cleanupOnComplete: boolean
}

// 为每个 competitive worker 创建隔离环境
async function createIsolatedWorker(index: number): Promise<Agent> {
  const worktree = await git(`worktree add .agent-teams/worker-${index} -b worker-${index}`)
  // 在隔离目录中创建 Agent
  return new Agent({ cwd: `.agent-teams/worker-${index}` })
}
```

### 原则 6: Baseline Testing Automation (基线测试自动化)

**来源**: Anthropic 的 "20 sample queries" 评估方法

**原设计问题**:
- Phase 1 验收标准缺乏自动化
- "10 个样本任务" 未定义具体内容

**补充设计**:
```typescript
// 新增: 基线测试套件
interface BaselineTestSuite {
  name: string
  samples: BaselineSample[]
  evaluationRubric: EvaluationRubric
}

interface BaselineSample {
  id: string
  category: "simple" | "medium" | "complex"
  task: string           // 任务描述
  expectedFiles: string[] // 预期修改的文件
  validationCommands: string[] // 验证命令
  timeBudget: number     // 时间预算 (秒)
  tokenBudget: number    // Token 预算
}

// 默认测试套件
const DEFAULT_TEST_SUITE: BaselineSample[] = [
  {
    id: "simple-001",
    category: "simple",
    task: "Add a hello world function to utils.ts",
    expectedFiles: ["src/utils.ts"],
    validationCommands: ["npm test -- --grep hello"],
    timeBudget: 300,
    tokenBudget: 50000
  },
  // ... 共 20 个样本
]
```

**自动化评估脚本**:
```typescript
// src/teams/benchmark.ts (新增)
export async function runBaselineComparison(
  suite: BaselineTestSuite,
  modes: TeamMode[]
): Promise<BaselineReport> {
  const results: BaselineReport = {
    timestamp: Date.now(),
    comparisons: []
  }

  for (const sample of suite.samples) {
    for (const mode of modes) {
      const singleAgentResult = await runSingleAgent(sample)
      const teamResult = await runTeam(mode, sample)

      results.comparisons.push({
        sampleId: sample.id,
        mode,
        singleAgent: singleAgentResult,
        team: teamResult,
        improvement: calculateImprovement(singleAgentResult, teamResult)
      })
    }
  }

  return results
}
```

### 原则 7: Checkpoint Resume (检查点恢复)

**来源**: Anthropic 的 "subagent resume" 能力

**原设计问题**:
- CheckpointStore 只存储，不支持恢复
- 失败后需从头开始

**补充设计**:
```typescript
// 新增: 恢复能力
interface CheckpointResume {
  // 恢复点
  checkpointId: string

  // 恢复策略
  strategy: "restart-task" | "continue-iteration" | "skip-completed"

  // 上下文注入
  contextInjection: {
    includePreviousThinking: boolean
    includePreviousArtifacts: boolean
    maxContextTokens: number
  }
}

// TeamManager 新增方法
class TeamManager {
  async resumeFromCheckpoint(
    checkpointId: string,
    strategy: CheckpointResume["strategy"]
  ): Promise<TeamResult> {
    const checkpoint = await this.checkpointStore.load(checkpointId)

    // 重建上下文
    const context = await this.buildResumeContext(checkpoint)

    // 跳过已完成的任务
    const pendingTasks = checkpoint.tasks.filter(t => t.status !== "completed")

    // 继续执行
    return this.executeWithResume(pendingTasks, context)
  }
}
```

### 原则 8: Ralph Loop (持续执行循环)

**来源**: 胡渊鸣的 Ralph 自动化循环

**原设计问题**:
- Team 执行完一轮就停止
- 缺乏持续任务队列

**补充设计**:
```typescript
// 新增: 持续执行模式
interface RalphLoopConfig {
  enabled: boolean
  taskSource: "file" | "git-issues" | "stdin" | "api"
  taskFilePath: string  // 如 TASKS.md

  // 循环控制
  maxIterations: number
  cooldownMs: number    // 任务间隔

  // 状态持久化
  persistProgress: boolean
  progressFile: string  // 如 PROGRESS.md
}

// TASKS.md 格式
/**
# Task Queue

## Pending
- [ ] Add user authentication
- [ ] Implement rate limiting

## In Progress
- [~] Database optimization (worker-001)

## Completed
- [x] Setup project structure
*/

// TeamManager 新增方法
class TeamManager {
  async runRalphLoop(config: RalphLoopConfig): Promise<void> {
    while (true) {
      const task = await this.getNextTask(config)
      if (!task) break

      await this.executeTask(task)
      await this.updateProgress(config)

      if (config.cooldownMs > 0) {
        await sleep(config.cooldownMs)
      }
    }
  }
}
```

---

## 优先级改进路线图

### P0 - 立即实施 (1 周)

| 改进项 | 工作量 | 影响 |
|--------|--------|------|
| Council 并行成员发言 | 2h | 90% 速度提升 |
| 基线测试自动化 (10 样本) | 4h | 评估可复现 |
| 产物写入文件系统 | 3h | 避免"电话游戏" |

### P1 - 短期实施 (2 周)

| 改进项 | 工作量 | 影响 |
|--------|--------|------|
| LLM-as-Judge 评估 Rubric | 4h | 评估标准化 |
| 检查点恢复能力 | 6h | 容错性提升 |
| 宽松上下文契约 | 4h | Agent 自主性 |
| PROGRESS.md 持久化 | 2h | 任务追踪 |

### P2 - 中期实施 (4 周)

| 改进项 | 工作量 | 影响 |
|--------|--------|------|
| Git Worktree 隔离 | 8h | 并行安全性 |
| Ralph Loop 持续执行 | 6h | 自动化程度 |
| 扩展思考预算 | 4h | 复杂问题分解 |
| 非交互模式支持 | 4h | CI/CD 集成 |
| 基线测试扩展到 20 样本 | 4h | 评估准确性 |

---

## 新增配置项

```json
{
  "teams": {
    "default": {
      // ...existing config

      // 新增: 并行策略
      "parallelStrategy": {
        "mode": "adaptive",
        "adaptive": {
          "minParallelism": 2,
          "maxParallelism": 5,
          "scaleUpThreshold": 3
        },
        "isolation": "shared-context"
      },

      // 新增: 思考预算
      "thinkingBudget": {
        "enabled": true,
        "maxThinkingTokens": 10000,
        "outputThinkingProcess": true
      },

      // 新增: 产物存储
      "artifactStorage": {
        "enabled": true,
        "outputDir": ".agent-teams/artifacts",
        "retainDays": 7
      },

      // 新增: 检查点恢复
      "checkpointResume": {
        "enabled": true,
        "autoResumeOnFailure": true,
        "maxResumeAttempts": 3
      }
    },

    // 新增: Ralph Loop 配置
    "ralphLoop": {
      "enabled": false,
      "taskSource": "file",
      "taskFilePath": "TASKS.md",
      "progressFile": "PROGRESS.md",
      "cooldownMs": 5000
    },

    // 新增: 评估 Rubric
    "evaluationRubric": {
      "dimensions": [
        { "name": "正确性", "weight": 0.35 },
        { "name": "完整性", "weight": 0.25 },
        { "name": "可维护性", "weight": 0.20 },
        { "name": "性能", "weight": 0.20 }
      ],
      "overallThreshold": 3.5
    }
  }
}
```

---

## 新增 CLI 命令

```bash
# 基线测试
lite-opencode --team-benchmark --samples 20 --modes worker-reviewer,leader-workers

# 检查点恢复
lite-opencode --team-resume <checkpoint-id>

# Ralph Loop 模式
lite-opencode --team-ralph --task-file TASKS.md

# 非交互模式 (CI/CD)
lite-opencode --team worker-reviewer --non-interactive --output-format json

# 评估模式
lite-opencode --team-evaluate --rubric rubric.yaml --input .agent-teams/artifacts/
```

---

## 与现有实现的对齐检查

### kimi 分支
- ✅ `TeamRunStore` - 支持产物持久化
- ✅ `AgentPool` - 支持实例复用
- ⚠️ Council 模式需改为并行
- ❌ 缺少 LLM-as-Judge

### minimax 分支
- ✅ `benchmark.ts` - 基线测试框架
- ✅ Council 并行执行
- ⚠️ 检查点恢复需实现
- ❌ 缺少产物文件系统存储

### claude 分支
- ✅ `team-session-store.ts` - 会话管理
- ⚠️ 缺少并行优化
- ❌ 缺少基线测试

### codex 分支
- ✅ `benchmark.ts` - 基线测试框架
- ✅ `drill.ts` - 压力测试
- ⚠️ 缺少 `fallback.ts`
- ❌ Council 需改为并行

---

## 参考文档

1. Anthropic Engineering: [Building an effective AI agent for multi-agent research](https://www.anthropic.com/engineering/multi-agent-research-system)
2. 胡渊鸣: [给10个 Claude Code 打工是怎样一种体验](https://zhuanlan.zhihu.com/p/2007147036185744607)
3. 原始设计: `docs/agent-teams.md`
