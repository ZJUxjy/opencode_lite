# Agent Teams 用户指南

Agent Teams 是一个多 Agent 协作开发系统，允许多个 Agent 以明确角色和协议协同完成复杂任务。

## 目录

- [快速开始](#快速开始)
- [协作模式](#协作模式)
- [高级功能](#高级功能)
  - [PROGRESS.md 持久化](#progressmd-持久化)
  - [松散上下文契约](#松散上下文契约)
  - [LLM-as-Judge 评估](#llm-as-judge-评估)
  - [检查点恢复](#检查点恢复)
  - [Git Worktree 隔离](#git-worktree-隔离)
  - [Ralph Loop 持续执行](#ralph-loop-持续执行)
  - [思考预算控制](#思考预算控制)
  - [非交互模式](#非交互模式)
  - [基线测试](#基线测试)
- [CLI 使用](#cli-使用)
- [配置说明](#配置说明)
- [最佳实践](#最佳实践)

## 快速开始

### 基础用法

```bash
# Worker-Reviewer 模式（默认推荐）
lite-opencode --team worker-reviewer --objective "实现用户登录功能" --scope "src/auth.ts,src/user.ts"

# Planner-Executor-Reviewer 模式（需求不清晰时使用）
lite-opencode --team planner-executor-reviewer --objective "重构数据库访问层"

# Leader-Workers 模式（多模块并行开发）
lite-opencode --team leader-workers --team-strategy collaborative --team-workers 3 --scope "src/modules/"

# Hotfix Guardrail 模式（紧急生产修复）
lite-opencode --team hotfix-guardrail --objective "修复生产环境内存泄漏" --scope "src/server.ts"

# Council 模式（架构决策）
lite-opencode --team council --objective "选择合适的数据库方案"
```

### 从配置启动

创建 `settings.json`：

```json
{
  "teams": {
    "default": {
      "maxIterations": 3,
      "timeoutMs": 300000,
      "budget": {
        "maxTokens": 200000
      },
      "qualityGate": {
        "testsMustPass": true,
        "noP0Issues": true
      }
    },
    "worker-reviewer": {
      "mode": "worker-reviewer",
      "agents": [
        { "role": "worker", "model": "claude-sonnet-4", "skills": ["nodejs", "react"] },
        { "role": "reviewer", "model": "claude-sonnet-4", "skills": ["code-review"] }
      ]
    }
  }
}
```

然后直接运行：

```bash
lite-opencode --team worker-reviewer --objective "实现功能"
```

## 协作模式

### 模式对比

| 模式 | Agent 数 | 相对成本 | 适用场景 | 推荐度 |
|------|----------|----------|----------|--------|
| Worker-Reviewer | 2 | 2x | 日常开发、质量门禁 | ⭐⭐⭐⭐⭐ |
| Planner-Executor-Reviewer | 3 | 2.5-3x | 需求不清晰、易返工任务 | ⭐⭐⭐⭐ |
| Leader-Workers (collaborative) | 3-5 | 3-5x | 多模块并行开发 | ⭐⭐⭐⭐ |
| Leader-Workers (competitive) | 3-5 | 3-5x | 关键方案对比 | ⭐⭐⭐ |
| Hotfix Guardrail | 2 | 1.5-2x | 线上故障、紧急修复 | ⭐⭐⭐⭐ |
| Council | 3-5 | 4-6x | 架构决策、技术选型 | ⭐⭐ |

### Worker-Reviewer（MVP）

**适用场景**：常规开发、需要稳定质量门禁。

**流程**：
1. Worker 实现代码
2. Reviewer 审核
3. 未通过则回修
4. 通过后统一验收

**示例**：

```bash
lite-opencode --team worker-reviewer \
  --objective "实现用户注册 API，包含邮箱验证和密码强度检查" \
  --scope "src/auth.ts,src/validation.ts" \
  --iterations 5
```

### Planner-Executor-Reviewer

**适用场景**：需求模糊、变更范围不清晰、容易返工。

**角色**：
- **Planner**：澄清需求、输出 TaskContract
- **Executor**：按契约实现并提交 WorkArtifact
- **Reviewer**：按契约验收，阻断越界改动与遗漏测试

**收益**：把"返工"前移到规划阶段，降低总 token 消耗。

**示例**：

```bash
lite-opencode --team planner-executor-reviewer \
  --objective "重构订单系统，需要支持多种支付方式" \
  --scope "src/order/"
```

### Leader-Workers

#### Collaborative 策略

Leader 先拆 DAG，再按 `fileScope` 分区给 Worker 并行执行，最后集成。

**示例**：

```bash
lite-opencode --team leader-workers \
  --team-strategy collaborative \
  --team-workers 4 \
  --objective "实现电商后台管理系统" \
  --scope "src/products,src/orders,src/users,src/analytics"
```

#### Competitive 策略

多个 Worker 对同一任务出方案，Leader 按统一标准选择或合并。

**评估标准**：
1. 代码质量 30%
2. 测试与可验证性 25%
3. 性能 20%
4. 可维护性 15%
5. 需求符合度 10%

**示例**：

```bash
lite-opencode --team leader-workers \
  --team-strategy competitive \
  --team-workers 3 \
  --objective "实现高性能缓存层" \
  --scope "src/cache.ts"
```

### Hotfix Guardrail

**适用场景**：线上紧急故障。

**强制规则**：
1. 只允许最小文件范围
2. 必须产出回滚步骤
3. 禁止顺手重构

**示例**：

```bash
lite-opencode --team hotfix-guardrail \
  --objective "修复生产环境 SQL 注入漏洞" \
  --scope "src/db/query.ts" \
  --max-tokens 50000
```

### Council

**适用场景**：架构决策、技术选型。

**特点**：不直接改代码，输出为"决策记录 + 执行建议"。

**示例**：

```bash
lite-opencode --team council \
  --objective "选择微服务架构还是单体架构" \
  --iterations 2
```

## 高级功能

### PROGRESS.md 持久化

自动将 Team 执行进度写入 `PROGRESS.md` 文件，支持中断后继续执行。

**特性**：
- 每个迭代完成后自动更新进度
- 记录当前阶段、已完成任务、下一步计划
- 支持从进度文件恢复执行

**配置**：

```json
{
  "teams": {
    "default": {
      "progressPersistence": {
        "enabled": true,
        "filePath": "PROGRESS.md",
        "autoSave": true,
        "saveIntervalMs": 30000
      }
    }
  }
}
```

**手动恢复**：

```typescript
import { createProgressPersistence } from "./teams/progress-persistence.js"

const persistence = createProgressPersistence({
  filePath: "PROGRESS.md",
})

const progress = persistence.load()
if (progress) {
  console.log(`恢复执行: 第 ${progress.currentIteration} 轮`)
  console.log(`已完成: ${progress.completedTasks.join(", ")}`)
}
```

### 松散上下文契约

支持 Loose Context Contract 模式，允许 Agent 在保持目标一致的前提下灵活执行。

**使用场景**：
- 探索性任务（不需要严格步骤）
- 研究型任务（结果导向）
- 创意型任务（过程不可预测）

**契约类型对比**：

| 特性 | Strict Contract | Loose Contract |
|------|-----------------|----------------|
| 步骤定义 | 必须 | 可选 |
| 边界约束 | 严格 | 宽松 |
| 验收标准 | 预定义 | 动态评估 |
| 适用场景 | 确定性任务 | 探索性任务 |

**示例**：

```typescript
import { createLooseContract, toStrictContract } from "./teams/contracts.js"

// 创建松散契约
const loose = createLooseContract({
  objective: "探索代码优化机会",
  boundaries: ["不修改 API 接口", "保持向后兼容"],
  expectedOutcome: "生成优化建议报告",
})

// 转换为严格契约（当需要时）
const strict = toStrictContract(loose, {
  steps: ["分析性能瓶颈", "提出优化方案", "验证改进效果"],
})
```

### LLM-as-Judge 评估

使用 LLM 作为评判者，对代码质量、方案优劣进行自动评估。

**评估维度**：
- **Correctness (35%)**: 功能正确性
- **Completeness (25%)**: 需求完整度
- **Maintainability (20%)**: 可维护性
- **Performance (20%)**: 性能表现

**使用示例**：

```typescript
import { createLLMJudge, DEFAULT_CODE_QUALITY_RUBRIC } from "./teams/llm-judge.js"

const judge = createLLMJudge({
  model: "claude-sonnet-4",
  apiKey: process.env.ANTHROPIC_API_KEY,
  rubric: DEFAULT_CODE_QUALITY_RUBRIC,
})

// 评估代码
const result = await judge.evaluate({
  task: "实现用户认证",
  solution: codeString,
  context: "Node.js + TypeScript",
})

console.log("总分:", result.score)
console.log("维度评分:", result.dimensionScores)
console.log("建议:", result.feedback)
```

**Leader-Workers 竞争模式集成**：

```bash
lite-opencode --team leader-workers \
  --team-strategy competitive \
  --team-workers 3 \
  --objective "实现高性能缓存" \
  --scope "src/cache.ts"
```

Leader 会自动使用 LLM-as-Judge 评估各 Worker 方案并选择最优。

### 检查点恢复

支持从任意检查点恢复 Team 执行，应对中断和失败场景。

**恢复策略**：

1. **restart-task**: 重新执行当前任务（推荐）
2. **continue-iteration**: 从当前迭代继续（风险较高）
3. **skip-completed**: 跳过已完成任务（快速恢复）

**使用示例**：

```typescript
import { createCheckpointResumer } from "./teams/checkpoint-resume.js"

const resumer = createCheckpointResumer({
  strategy: "restart-task",
  allowPartialResults: true,
})

// 从检查点恢复
const resumed = await resumer.resume(checkpointId, {
  teamManager,
  onProgress: (phase) => console.log(`恢复阶段: ${phase}`),
})

if (resumed.success) {
  console.log(`成功恢复，继续第 ${resumed.iteration} 轮`)
}
```

**CLI 恢复**：

```bash
# 列出可用检查点
lite-opencode --list-checkpoints

# 从检查点恢复（未来版本支持）
lite-opencode --resume-checkpoint checkpoint-xxx
```

### Git Worktree 隔离

为并行 Agent 创建独立的 Git Worktree，实现完全隔离的执行环境。

**使用场景**：
- Leader-Workers 并行开发
- 多方案并行验证
- 实验性功能开发

**示例**：

```typescript
import { createWorktreeIsolationManager } from "./teams/worktree-isolation.js"

const isolation = createWorktreeIsolationManager({
  baseDir: ".worktrees",
  autoCleanup: true,
})

// 为 Worker 创建隔离环境
const worktree = await isolation.createWorktree({
  name: "worker-1",
  baseBranch: "main",
})

console.log("工作目录:", worktree.path)
console.log("分支:", worktree.branch)

// Worker 在隔离环境中执行
// ...

// 合并结果
await isolation.mergeWorktree(worktree.id, {
  targetBranch: "main",
  strategy: "merge",
})
```

**Leader-Workers 自动隔离**：

```bash
lite-opencode --team leader-workers \
  --team-strategy collaborative \
  --team-workers 4 \
  --objective "并行开发多个模块" \
  --scope "src/module1,src/module2,src/module3,src/module4"
```

Leader 会自动为每个 Worker 创建独立 Worktree。

### Ralph Loop 持续执行

从 `TASKS.md` 读取任务队列，持续执行直到完成所有任务。

**TASKS.md 格式**：

```markdown
# Task Queue

## ACTIVE
- [ ] 实现用户认证 API
- [ ] 编写单元测试
- [ ] 更新 API 文档

## PENDING
- [ ] 集成第三方登录
- [ ] 添加权限管理

## COMPLETED
- [x] 项目初始化
- [x] 数据库设计
```

**使用示例**：

```typescript
import { createRalphLoop } from "./teams/ralph-loop.js"

const ralph = createRalphLoop({
  taskFile: "TASKS.md",
  teamConfig: {
    mode: "worker-reviewer",
    maxIterations: 3,
  },
})

// 持续执行
await ralph.run({
  onTaskStart: (task) => console.log(`开始: ${task.title}`),
  onTaskComplete: (task, result) => console.log(`完成: ${task.title}`),
  onTaskFailed: (task, error) => console.log(`失败: ${task.title}`),
})
```

**适用场景**：
- 批量任务处理
- 长期运行项目
- 自动化工作流

### 思考预算控制

为复杂任务配置思考预算，控制 LLM 推理令牌使用量。

**配置**：

```json
{
  "teams": {
    "default": {
      "thinkingBudget": {
        "enabled": true,
        "maxThinkingTokens": 4000,
        "outputThinkingProcess": true
      }
    }
  }
}
```

**使用示例**：

```typescript
import { createThinkingBudgetManager } from "./teams/thinking-budget.js"

const thinking = createThinkingBudgetManager({
  maxThinkingTokens: 4000,
  outputThinkingProcess: true,
})

// 分配思考预算
const budget = thinking.allocateBudget("complex-task", {
  complexity: "high",
  estimatedSteps: 5,
})

console.log("思考预算:", budget.allocatedTokens)
console.log("输出预算:", budget.outputTokens)

// 记录实际使用
thinking.recordUsage("complex-task", 3500)

// 检查是否超支
if (thinking.isOverBudget("complex-task")) {
  console.log("思考预算已用完，需要简化任务")
}
```

**适用场景**：
- 复杂算法设计
- 架构决策
- 调试难题

### 非交互模式

支持 CI/CD 集成，无需人工干预自动运行。

**使用示例**：

```bash
# 文本输出（默认）
lite-opencode \
  --team worker-reviewer \
  --objective "修复 bug" \
  --scope "src/buggy.ts" \
  --non-interactive

# JSON 输出（便于解析）
lite-opencode \
  --team worker-reviewer \
  --objective "实现功能" \
  --scope "src/feature.ts" \
  --non-interactive \
  --output-format json
```

**JSON 输出格式**：

```json
{
  "success": true,
  "output": "实现完成",
  "teamResult": {
    "mode": "worker-reviewer",
    "iterations": 2,
    "status": "completed"
  },
  "duration": 45000,
  "toolCalls": 15,
  "tokensUsed": {
    "input": 5000,
    "output": 3000
  }
}
```

**GitHub Actions 集成**：

```yaml
name: AI Code Review
on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run Agent Team
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          lite-opencode \
            --team hotfix-guardrail \
            --objective "检查安全问题" \
            --scope "src/" \
            --non-interactive \
            --output-format json \
            > result.json
      - name: Check Result
        run: |
          success=$(cat result.json | jq -r '.success')
          if [ "$success" != "true" ]; then
            echo "检查失败"
            exit 1
          fi
```

### 基线测试

评估 Team 模式相对于单 Agent 的效果，量化多 Agent 协作的收益。

**测试套件**：
- **20 个样本**：6 简单 + 7 中等 + 7 复杂
- **多维度评估**：时间、成本、质量、成功率

**使用示例**：

```typescript
import { createBaselineRunner, DEFAULT_TEST_SUITE, formatBaselineReport } from "./teams/benchmark.js"

const runner = createBaselineRunner({
  model: "claude-sonnet-4",
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// 运行基线对比
const report = await runner.runBaselineComparison(
  DEFAULT_TEST_SUITE,
  ["worker-reviewer", "planner-executor-reviewer"]
)

// 输出报告
console.log(formatBaselineReport(report))
```

**示例输出**：

```markdown
# Agent Teams Baseline Report

## Summary
- Total Samples: 20
- Modes Tested: worker-reviewer, planner-executor-reviewer

## Results

### worker-reviewer
- Avg Time Reduction: 15.3%
- Avg Cost Increase: 85.2%
- Avg Quality Improvement: 22.1%
- Cost Effective: ✅

### planner-executor-reviewer
- Avg Time Reduction: 8.7%
- Avg Cost Increase: 120.5%
- Avg Quality Improvement: 28.4%
- Cost Effective: ✅
```

**自定义测试套件**：

```typescript
const customSuite = {
  name: "My Test Suite",
  samples: [
    {
      id: "test-001",
      category: "simple",
      task: "实现一个加法函数",
      expectedFiles: ["src/math.ts"],
      validationCommands: ["npm test"],
      timeBudget: 60000,
      tokenBudget: 10000,
    },
  ],
}

const report = await runner.runBaselineComparison(customSuite, ["worker-reviewer"])
```

## CLI 使用

### 基本参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--team <mode>` | 选择团队模式 | - |
| `--team-strategy <strategy>` | Leader-workers 策略 | collaborative |
| `--team-workers <n>` | Worker 数量 | 2 |
| `--objective <text>` | 任务目标描述 | - |
| `--scope <files>` | 文件范围（逗号分隔） | - |
| `--iterations <n>` | 最大迭代次数 | 3 |
| `--team-timeout <ms>` | 超时时间（毫秒） | 300000 |
| `--max-tokens <n>` | Token 预算 | 200000 |
| `--non-interactive` | 非交互模式（CI/CD） | - |
| `--output-format <format>` | 输出格式（text/json） | text |

### 完整示例

```bash
lite-opencode \
  --team leader-workers \
  --team-strategy collaborative \
  --team-workers 4 \
  --objective "实现用户认证系统，支持 OAuth2 和 JWT" \
  --scope "src/auth/,src/middleware/" \
  --iterations 5 \
  --team-timeout 600000 \
  --max-tokens 300000
```

### 会话管理

```bash
# 列出所有会话
lite-opencode --list-sessions

# 恢复最近会话
lite-opencode --resume

# 恢复特定会话
lite-opencode --resume session-xxx-xxx

# 继续当前目录的最后会话
lite-opencode --continue
```

## 配置说明

### settings.json 完整示例

```json
{
  "env": {
    "ANTHROPIC_API_KEY": "your-api-key",
    "ANTHROPIC_MODEL": "claude-sonnet-4-20250514"
  },
  "timeout": 120000,
  "mcp": {
    "servers": [
      {
        "name": "filesystem",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"]
      }
    ]
  },
  "teams": {
    "default": {
      "maxIterations": 3,
      "timeoutMs": 300000,
      "budget": {
        "maxTokens": 200000,
        "maxCostUsd": 1.0,
        "maxParallelAgents": 3
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
      },
      "progressPersistence": {
        "enabled": true,
        "filePath": "PROGRESS.md",
        "autoSave": true,
        "saveIntervalMs": 30000
      },
      "thinkingBudget": {
        "enabled": true,
        "maxThinkingTokens": 4000,
        "outputThinkingProcess": false
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
        { "role": "planner", "model": "claude-opus-4" },
        { "role": "executor", "model": "claude-sonnet-4" },
        { "role": "reviewer", "model": "claude-sonnet-4", "skills": ["code-review"] }
      ]
    },
    "leader-workers-collab": {
      "mode": "leader-workers",
      "strategy": "collaborative",
      "agents": [
        { "role": "leader", "model": "claude-opus-4" },
        { "role": "worker", "model": "claude-haiku-4" },
        { "role": "worker", "model": "claude-haiku-4" },
        { "role": "worker", "model": "claude-haiku-4" }
      ]
    },
    "hotfix-guardrail": {
      "mode": "hotfix-guardrail",
      "maxIterations": 2,
      "timeoutMs": 300000,
      "budget": {
        "maxTokens": 100000
      },
      "agents": [
        { "role": "fixer", "model": "claude-sonnet-4" },
        { "role": "safety-reviewer", "model": "claude-sonnet-4", "skills": ["security"] }
      ]
    },
    "council": {
      "mode": "council",
      "maxIterations": 2,
      "agents": [
        { "role": "speaker", "model": "claude-opus-4" },
        { "role": "member", "model": "claude-sonnet-4" },
        { "role": "member", "model": "claude-sonnet-4" }
      ]
    }
  }
}
```

### 配置优先级

配置优先级从高到低：

1. CLI 参数（如 `--iterations 5`）
2. settings.json 中的具名配置（如 `teams.worker-reviewer`）
3. settings.json 中的 default 配置（如 `teams.default`）
4. 内置默认值

## 最佳实践

### 1. 选择合适的模式

- **常规开发**：使用 `worker-reviewer`
- **需求不明确**：使用 `planner-executor-reviewer`
- **多模块并行**：使用 `leader-workers --strategy collaborative`
- **方案对比**：使用 `leader-workers --strategy competitive`
- **线上紧急**：使用 `hotfix-guardrail`
- **架构决策**：使用 `council`

### 2. 设置合理的预算

```bash
# 小任务
lite-opencode --team worker-reviewer --max-tokens 50000

# 中等任务
lite-opencode --team worker-reviewer --max-tokens 200000

# 大任务
lite-opencode --team leader-workers --max-tokens 500000
```

### 3. 明确文件范围

使用 `--scope` 明确限制修改范围，避免不必要的改动：

```bash
# 好的做法
lite-opencode --team worker-reviewer --scope "src/auth.ts,src/user.ts"

# 避免过于宽泛
# lite-opencode --team worker-reviewer --scope "src/"
```

### 4. 迭代次数设置

- 简单任务：2-3 次迭代
- 中等任务：3-5 次迭代
- 复杂任务：5-8 次迭代

超过 8 次迭代通常意味着任务分解不够，建议拆分为多个小任务。

### 5. 成本优化

- 使用 `claude-haiku-4` 作为 Worker 模型降低成本
- 复用长期实例（Worker/Reviewer）
- 合理设置 `maxTokens` 预算上限
- 对于探索性任务使用单次迭代

### 6. 质量保证

- 始终启用 `testsMustPass`
- 关键路径使用 `noP0Issues`
- 设置合理的代码覆盖率要求（`minCoverage`）
- 定期查看 Reviewer 的反馈，优化提示词

### 7. 使用 PROGRESS.md 跟踪长任务

对于需要多轮迭代的复杂任务，启用 PROGRESS.md 持久化：

```json
{
  "teams": {
    "default": {
      "progressPersistence": {
        "enabled": true,
        "filePath": "PROGRESS.md"
      }
    }
  }
}
```

### 8. 为探索性任务使用松散契约

当需求不明确时，使用松散上下文契约：

```bash
lite-opencode --team planner-executor-reviewer \
  --objective "探索代码优化机会" \
  --scope "src/"
```

### 9. CI/CD 集成使用非交互模式

```bash
lite-opencode \
  --team hotfix-guardrail \
  --objective "安全检查" \
  --scope "src/" \
  --non-interactive \
  --output-format json \
  --max-tokens 50000 \
  --iterations 2
```

### 10. 定期运行基线测试

评估 Team 模式效果，优化配置：

```bash
# 运行基线测试（需在代码中实现）
npm run test:baseline

# 分析结果，调整配置
# 如果时间减少 < 10% 但成本增加 > 100%，考虑使用单 Agent
```

## TUI 状态指示

运行时状态栏会显示当前 Team 模式：

```
▌Context: 45% (45K / 100K) | claude-sonnet-4 | 👥 worker-reviewer
▌Context: 60% (60K / 100K) | claude-sonnet-4 | 👥 leader-workers(collaborative)
```

## 故障排查

遇到问题请参考 [AGENT_TEAMS_TROUBLESHOOTING.md](./AGENT_TEAMS_TROUBLESHOOTING.md)

## 参考

- [Agent Teams 设计文档](./agent-teams.md)
- [API 参考](./API.md) (如存在)
