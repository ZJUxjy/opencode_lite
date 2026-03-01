# Agent Teams 用户指南

Agent Teams 是一个多 Agent 协作开发系统，允许多个 Agent 以明确角色和协议协同完成复杂任务。

## 目录

- [快速开始](#快速开始)
- [协作模式](#协作模式)
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
