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
