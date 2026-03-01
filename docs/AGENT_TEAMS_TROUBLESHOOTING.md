# Agent Teams 故障排查指南

本文档帮助您诊断和解决 Agent Teams 使用中的常见问题。

## 目录

- [常见问题](#常见问题)
- [故障演练场景](#故障演练场景)
- [性能优化](#性能优化)
- [调试技巧](#调试技巧)

## 常见问题

### 1. Team 模式无法启动

**症状**：
```
Error: Unknown team mode "xxx"
```

**原因**：
- 使用了不支持的模式名称
- 拼写错误

**解决方案**：
```bash
# 检查支持的 mode
lite-opencode --help

# 正确的 mode 名称
lite-opencode --team worker-reviewer          # ✅
lite-opencode --team planner-executor-reviewer # ✅
lite-opencode --team leader-workers            # ✅
lite-opencode --team hotfix-guardrail          # ✅
lite-opencode --team council                   # ✅
```

### 2. 预算超限

**症状**：
```
Budget exceeded: 200000 tokens used, limit: 200000
Team execution failed: budget_exceeded
```

**解决方案**：

```bash
# 1. 增加预算
lite-opencode --team worker-reviewer --max-tokens 500000

# 2. 缩小任务范围
lite-opencode --team worker-reviewer --scope "src/small-module/"

# 3. 减少迭代次数
lite-opencode --team worker-reviewer --iterations 2

# 4. 使用更小的模型
# 在 settings.json 中配置
{
  "teams": {
    "worker-reviewer": {
      "agents": [
        { "role": "worker", "model": "claude-haiku-4" },  # 更便宜的模型
        { "role": "reviewer", "model": "claude-sonnet-4" }
      ]
    }
  }
}
```

### 3. 超时

**症状**：
```
Team execution timeout after 300000ms
```

**解决方案**：

```bash
# 增加超时时间
lite-opencode --team worker-reviewer --team-timeout 600000  # 10分钟

# 或者减少任务复杂度
lite-opencode --team worker-reviewer --scope "src/single-file.ts"
```

### 4. 质量门禁未通过

**症状**：
```
Quality gate not met: tests failed
```

**解决方案**：

```bash
# 1. 检查测试命令是否正确
# 在 TaskContract 中确认 acceptanceChecks

# 2. 放宽质量要求（不推荐用于生产）
# 在 settings.json 中配置
{
  "teams": {
    "default": {
      "qualityGate": {
        "testsMustPass": false,  # 警告：不推荐
        "noP0Issues": true
      }
    }
  }
}

# 3. 增加迭代次数让 Reviewer 修复问题
lite-opencode --team worker-reviewer --iterations 5
```

### 5. 冲突检测

**症状**：
```
Conflict detected: file1.ts, file2.ts
Parallel execution blocked
```

**解决方案**：

```bash
# 1. 使用文件分区避免冲突
lite-opencode --team leader-workers --scope "src/module1/,src/module2/"

# 2. 切换到非并行模式
lite-opencode --team worker-reviewer

# 3. 手动解决冲突后重试
```

### 6. 熔断器触发

**症状**：
```
Circuit breaker opened: max consecutive failures (3) reached
```

**原因**：
- 连续多次工具调用失败
- 模型 API 异常
- 环境配置问题

**解决方案**：

```bash
# 1. 等待冷却时间（默认 60 秒）
sleep 60

# 2. 减少连续失败阈值
{
  "teams": {
    "default": {
      "circuitBreaker": {
        "maxConsecutiveFailures": 5,  # 放宽阈值
        "cooldownMs": 30000           # 减少冷却时间
      }
    }
  }
}

# 3. 检查 API 密钥和网络连接
echo $ANTHROPIC_API_KEY
```

### 7. 降级到单 Agent

**症状**：
```
Team execution failed, falling back to single agent mode
executionMode: "fallback-single-agent"
```

**原因**：
- Team 模式失败/超时
- 预算超限
- 熔断器打开

**解决方案**：

```bash
# 这是自动降级，任务会继续执行
# 完成后可以查看失败原因并调整参数重试

# 查看 Team 运行记录
lite-opencode --list-sessions

# 分析问题后调整参数
lite-opencode --team worker-reviewer --iterations 5 --max-tokens 300000
```

### 8. 检查点恢复失败

**症状**：
```
Failed to restore checkpoint: checkpoint-xxx not found
```

**解决方案**：

```bash
# 1. 检查检查点目录
ls ~/.lite-opencode/checkpoints/

# 2. 查看 Team 运行记录中的检查点索引
# 使用 TeamRunStore API 查询

# 3. 如果没有可用检查点，重新开始
lite-opencode --team worker-reviewer
```

### 9. PROGRESS.md 未更新

**症状**：
- 任务进行中但 PROGRESS.md 未生成
- 进度信息过时

**原因**：
- 未启用进度持久化
- 文件权限问题
- 保存间隔过长

**解决方案**：

```bash
# 1. 确认配置已启用
# settings.json:
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

# 2. 检查文件权限
ls -la PROGRESS.md

# 3. 缩短保存间隔
# saveIntervalMs: 10000  # 10秒
```

### 10. Git Worktree 创建失败

**症状**：
```
Failed to create worktree: path already exists
```

**原因**：
- 之前的工作目录未清理
- 分支名冲突

**解决方案**：

```bash
# 1. 手动清理工作目录
rm -rf .worktrees/worker-*

# 2. 或配置自动清理
# settings.json:
{
  "teams": {
    "default": {
      "worktreeIsolation": {
        "autoCleanup": true,
        "maxAgeMs": 3600000
      }
    }
  }
}

# 3. 检查 Git 状态
git status
git worktree list
```

### 11. LLM-as-Judge 评估失败

**症状**：
```
LLM Judge evaluation failed: API error
```

**原因**：
- API 密钥无效
- 模型不可用
- 评估内容过长

**解决方案**：

```bash
# 1. 检查 API 密钥
echo $ANTHROPIC_API_KEY

# 2. 使用本地评估回退
# 在配置中启用 fallback
{
  "teams": {
    "default": {
      "llmJudge": {
        "enabled": true,
        "fallbackToHeuristics": true
      }
    }
  }
}

# 3. 简化评估内容
# 只评估关键文件而非整个代码库
```

### 12. 非交互模式输出不完整

**症状**：
- JSON 输出格式错误
- 输出被截断

**原因**：
- 缓冲区限制
- 进程提前退出

**解决方案**：

```bash
# 1. 重定向到文件
lite-opencode \
  --team worker-reviewer \
  --objective "任务" \
  --non-interactive \
  --output-format json > result.json

# 2. 检查退出码
if [ $? -eq 0 ]; then
  echo "成功"
else
  echo "失败"
fi

# 3. 使用文本格式避免 JSON 解析问题
lite-opencode \
  --team worker-reviewer \
  --objective "任务" \
  --non-interactive \
  --output-format text
```

### 13. Ralph Loop 任务卡住

**症状**：
- TASKS.md 中的任务未执行
- 任务循环无法退出

**原因**：
- 任务格式错误
- 状态转换失败

**解决方案**：

```bash
# 1. 检查 TASKS.md 格式
# 必须包含 ACTIVE/PENDING/COMPLETED 三个区块

# 2. 手动重置任务状态
# 编辑 TASKS.md，将卡住的任务移回 ACTIVE

# 3. 添加任务超时
{
  "teams": {
    "default": {
      "ralphLoop": {
        "taskTimeoutMs": 300000,
        "maxRetries": 3
      }
    }
  }
}
```

### 14. 思考预算耗尽

**症状**：
```
Thinking budget exceeded for task
```

**解决方案**：

```bash
# 1. 增加思考预算
{
  "teams": {
    "default": {
      "thinkingBudget": {
        "maxThinkingTokens": 8000
      }
    }
  }
}

# 2. 简化任务分解
# 将复杂任务拆分为多个小任务

# 3. 禁用思考预算（不推荐）
{
  "teams": {
    "default": {
      "thinkingBudget": {
        "enabled": false
      }
    }
  }
}
```

## 故障演练场景

### 场景 1：预算超限降级

**演练目标**：验证 Team 失败时能否正确降级到单 Agent。

**步骤**：

```bash
# 1. 设置非常低的预算
lite-opencode --team worker-reviewer \
  --objective "实现复杂功能" \
  --max-tokens 10000 \
  --iterations 1

# 2. 观察降级过程
# 预期输出：
# - Team 因预算超限失败
# - 自动切换到单 Agent 模式
# - 任务继续执行

# 3. 验证结果
# 检查输出中是否有 executionMode: "fallback-single-agent"
```

### 场景 2：熔断器触发

**演练目标**：验证连续失败时熔断器是否正确打开。

**步骤**：

```bash
# 1. 配置较低的熔断阈值
# settings.json:
{
  "teams": {
    "default": {
      "circuitBreaker": {
        "maxConsecutiveFailures": 2,
        "cooldownMs": 10000
      }
    }
  }
}

# 2. 执行可能导致失败的任务
lite-opencode --team worker-reviewer \
  --objective "访问不存在的文件" \
  --scope "non-existent-file.ts"

# 3. 观察熔断器行为
# 预期输出：
# - 连续 2 次失败后熔断器打开
# - 任务中止或降级

# 4. 等待冷却后重试
sleep 10
lite-opencode --team worker-reviewer \
  --objective "修复后的任务"
```

### 场景 3：冲突解决

**演练目标**：验证 Leader-Workers 模式下的冲突检测和解决。

**步骤**：

```bash
# 1. 创建两个 Worker 会修改同一文件的任务
lite-opencode --team leader-workers \
  --team-strategy collaborative \
  --team-workers 2 \
  --objective "修改同一个文件的不同部分" \
  --scope "src/conflict-test.ts"

# 2. 观察冲突检测
# 预期输出：
# - ConflictDetector 检测到文件冲突
# - 冲突事件记录到 Blackboard

# 3. 验证解决策略
# 检查是否自动合并或转人工仲裁
```

### 场景 4：检查点恢复

**演练目标**：验证检查点创建和恢复功能。

**步骤**：

```bash
# 1. 启动一个长任务
lite-opencode --team worker-reviewer \
  --objective "实现多个功能" \
  --iterations 5 \
  --team-timeout 600000

# 2. 在运行过程中检查检查点创建
# 检查 ~/.lite-opencode/checkpoints/ 目录

# 3. 模拟中断（Ctrl+C）

# 4. 从检查点恢复
# 这需要集成到 TeamManager 中实现
```

### 场景 5：实例复用

**演练目标**：验证 Agent Pool 的实例复用策略。

**步骤**：

```typescript
// 测试代码
import { createAgentPool } from "./teams/agent-pool.js"

const pool = createAgentPool({
  maxInstances: 3,
  maxUseCount: 5,
})

// 1. 获取实例
const instance1 = pool.acquire({ role: "worker", model: "claude-sonnet-4" })
console.log("Instance 1:", instance1.id)

// 2. 释放并重新获取
pool.release(instance1.id)
const instance2 = pool.acquire({ role: "worker", model: "claude-sonnet-4" })
console.log("Instance 2:", instance2.id) // 应该与 instance1 相同

// 3. 验证使用次数增加
console.log("Use count:", instance2.useCount) // 应该是 2

// 4. 超过使用次数后应该创建新实例
for (let i = 0; i < 6; i++) {
  const inst = pool.acquire({ role: "worker", model: "claude-sonnet-4" })
  pool.release(inst.id)
}

const instance3 = pool.acquire({ role: "worker", model: "claude-sonnet-4" })
console.log("Instance 3:", instance3.id) // 应该是新实例
```

### 场景 6：Git Worktree 隔离

**演练目标**：验证 Worktree 隔离是否正确工作。

**步骤**：

```bash
# 1. 创建测试分支
git checkout -b worktree-test

# 2. 使用 Leader-Workers 模式
lite-opencode --team leader-workers \
  --team-strategy collaborative \
  --team-workers 2 \
  --objective "并行修改两个文件" \
  --scope "src/file1.ts,src/file2.ts"

# 3. 验证 Worktree 创建
ls -la .worktrees/
# 预期：worker-1, worker-2 目录

# 4. 验证隔离性
# 每个 Worker 应该在独立分支上工作
git worktree list

# 5. 验证合并
# 检查主分支是否包含两个 Worker 的修改
git log --oneline main
```

### 场景 7：LLM-as-Judge 评估

**演练目标**：验证 LLM-as-Judge 评估准确性。

**步骤**：

```typescript
import { createLLMJudge, DEFAULT_CODE_QUALITY_RUBRIC } from "./teams/llm-judge.js"

const judge = createLLMJudge({
  model: "claude-sonnet-4",
  rubric: DEFAULT_CODE_QUALITY_RUBRIC,
})

// 1. 评估优质代码
const goodCode = `
function add(a: number, b: number): number {
  return a + b
}
`
const result1 = await judge.evaluate({
  task: "实现加法函数",
  solution: goodCode,
})
console.log("优质代码评分:", result1.score) // 应该较高 (>80)

// 2. 评估问题代码
const badCode = `
function add(a, b) {
  return a + b  // 缺少类型，无错误处理
}
`
const result2 = await judge.evaluate({
  task: "实现加法函数",
  solution: badCode,
})
console.log("问题代码评分:", result2.score) // 应该较低 (<60)

// 3. 验证维度评分
console.log("各维度评分:", result2.dimensionScores)
```

### 场景 8：PROGRESS.md 恢复

**演练目标**：验证从 PROGRESS.md 恢复执行。

**步骤**：

```bash
# 1. 启用进度持久化
# settings.json:
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

# 2. 启动长任务
lite-opencode --team worker-reviewer \
  --objective "实现多个功能" \
  --iterations 5

# 3. 观察 PROGRESS.md 生成
cat PROGRESS.md

# 4. 模拟中断（Ctrl+C）

# 5. 检查 PROGRESS.md 内容
# 应该包含当前迭代和已完成任务

# 6. 重新启动（会自动恢复）
lite-opencode --team worker-reviewer \
  --objective "继续实现功能" \
  --iterations 5
```

### 场景 9：非交互模式 CI 集成

**演练目标**：验证非交互模式在 CI 中的使用。

**步骤**：

```bash
# 1. 创建测试脚本
#!/bin/bash
set -e

result=$(lite-opencode \
  --team worker-reviewer \
  --objective "检查代码风格" \
  --scope "src/" \
  --non-interactive \
  --output-format json \
  --max-tokens 50000)

# 2. 解析结果
success=$(echo $result | jq -r '.success')
toolCalls=$(echo $result | jq -r '.toolCalls')

if [ "$success" != "true" ]; then
  echo "检查失败"
  exit 1
fi

echo "检查通过，工具调用次数: $toolCalls"
```

### 场景 10：思考预算控制

**演练目标**：验证思考预算是否正确限制。

**步骤**：

```typescript
import { createThinkingBudgetManager } from "./teams/thinking-budget.js"

const thinking = createThinkingBudgetManager({
  maxThinkingTokens: 1000, // 设置较低预算以便测试
  outputThinkingProcess: true,
})

// 1. 分配预算
const budget = thinking.allocateBudget("test-task", {
  complexity: "high",
})
console.log("预算:", budget.allocatedTokens) // 应该 <= 1000

// 2. 记录使用
thinking.recordUsage("test-task", 800)
console.log("剩余:", thinking.getRemainingBudget("test-task")) // 200

// 3. 检查预算状态
console.log("是否超支:", thinking.isOverBudget("test-task")) // false

// 4. 超支测试
thinking.recordUsage("test-task", 300) // 总计 1100，超过 1000
console.log("是否超支:", thinking.isOverBudget("test-task")) // true
```

## 性能优化

### 1. Token 使用优化

**问题**：Token 消耗过高

**优化策略**：

```bash
# 1. 使用更小的模型处理简单任务
{
  "teams": {
    "worker-reviewer": {
      "agents": [
        { "role": "worker", "model": "claude-haiku-4" },
        { "role": "reviewer", "model": "claude-sonnet-4" }
      ]
    }
  }
}

# 2. 限制文件范围
lite-opencode --team worker-reviewer --scope "src/specific-file.ts"

# 3. 减少迭代次数
lite-opencode --team worker-reviewer --iterations 2
```

### 2. 执行时间优化

**问题**：执行时间过长

**优化策略**：

```bash
# 1. 使用并行模式
lite-opencode --team leader-workers --team-workers 4

# 2. 增加并行 Agent 限制
{
  "teams": {
    "default": {
      "budget": {
        "maxParallelAgents": 4
      }
    }
  }
}

# 3. 减少超时（快速失败）
lite-opencode --team worker-reviewer --team-timeout 180000
```

### 3. 内存优化

**问题**：内存占用过高

**优化策略**：

```bash
# 1. 限制实例数量
{
  "agentPool": {
    "maxInstances": 5,
    "maxLifetimeMs": 600000
  }
}

# 2. 定期清理
# 在代码中定期调用 pool.cleanup()

# 3. 使用短生命周期实例
lite-opencode --team planner-executor-reviewer  # Planner 使用短生命周期
```

### 4. Git Worktree 优化

**问题**：Worktree 创建/清理开销大

**优化策略**：

```bash
# 1. 复用 Worktree
{
  "teams": {
    "default": {
      "worktreeIsolation": {
        "reuseWorktrees": true,
        "maxWorktrees": 5
      }
    }
  }
}

# 2. 延迟清理
{
  "teams": {
    "default": {
      "worktreeIsolation": {
        "autoCleanup": false  # 手动清理
      }
    }
  }
}

# 3. 使用内存文件系统（Linux）
mount -t tmpfs -o size=500M tmpfs .worktrees/
```

### 5. LLM-as-Judge 优化

**问题**：评估耗时过长

**优化策略**：

```bash
# 1. 使用轻量级模型
{
  "teams": {
    "default": {
      "llmJudge": {
        "model": "claude-haiku-4"  # 更快的模型
      }
    }
  }
}

# 2. 限制评估内容长度
{
  "teams": {
    "default": {
      "llmJudge": {
        "maxContentLength": 10000
      }
    }
  }
}

# 3. 异步评估
# 评估与其他任务并行执行
```

## 调试技巧

### 1. 启用详细日志

```bash
# 设置环境变量
DEBUG=agent-teams lite-opencode --team worker-reviewer

# 或者使用 verbose 模式（如支持）
lite-opencode --team worker-reviewer --verbose
```

### 2. 查看 Team 运行记录

```bash
# 列出所有会话
lite-opencode --list-sessions

# 查看 Team 运行统计
# 使用 TeamRunStore API
```

### 3. 检查检查点

```bash
# 检查点目录
ls -la ~/.lite-opencode/checkpoints/

# 查看检查点内容
cat ~/.lite-opencode/checkpoints/checkpoint-team-xxx.json | jq .
```

### 4. 监控 Blackboard

```typescript
// 在代码中监控 Blackboard
blackboard.on("artifact", (artifact) => {
  console.log("New artifact:", artifact.taskId)
})

blackboard.on("conflict", (conflict) => {
  console.log("Conflict detected:", conflict.files)
})
```

### 5. 成本分析

```typescript
// 使用 TeamRunStore 分析成本
const stats = teamRunStore.getSessionStats(sessionId)
console.log("Total runs:", stats.totalRuns)
console.log("Total cost:", stats.totalCostUsd)
console.log("Total tokens:", stats.totalTokens)
```

### 6. 实例池监控

```typescript
// 监控 Agent Pool
const stats = agentPool.getStats()
console.log("Total instances:", stats.totalInstances)
console.log("Idle instances:", stats.idleInstances)
console.log("Busy instances:", stats.busyInstances)
console.log("Token usage:", stats.totalTokensUsed)
```

### 7. Git Worktree 监控

```bash
# 查看所有 Worktree
git worktree list

# 查看 Worktree 状态
ls -la .worktrees/

# 清理无用 Worktree
git worktree prune
```

### 8. LLM-as-Judge 调试

```typescript
// 启用详细日志
const judge = createLLMJudge({
  model: "claude-sonnet-4",
  verbose: true, // 输出评估过程
})

// 查看详细评分
const result = await judge.evaluate({
  task: "实现功能",
  solution: code,
})
console.log("详细评分:", JSON.stringify(result, null, 2))
```

### 9. 基线测试调试

```bash
# 运行单个样本调试
npm run test:benchmark -- --grep "single sample"

# 查看详细输出
DEBUG=benchmark npm run test:benchmark

# 生成详细报告
npm run test:benchmark -- --reporter verbose
```

### 10. PROGRESS.md 调试

```bash
# 查看进度文件
cat PROGRESS.md

# 检查文件更新时间
ls -la PROGRESS.md

# 手动触发保存（通过代码）
progressPersistence.save()
```

## 报告问题

如果以上方法无法解决问题，请收集以下信息并提交 Issue：

1. **命令行参数**：使用的完整命令
2. **配置文件**：settings.json 相关部分
3. **日志输出**：错误信息和堆栈跟踪
4. **环境信息**：
   - Node.js 版本
   - 操作系统
   - lite-opencode 版本
5. **复现步骤**：如何稳定复现问题

## 参考

- [Agent Teams 用户指南](./AGENT_TEAMS_GUIDE.md)
- [Agent Teams 设计文档](./agent-teams.md)
