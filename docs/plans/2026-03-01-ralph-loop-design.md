# Ralph Loop 设计文档

**日期**: 2026-03-01
**目标**: 实现 Ralph Loop 任务队列持续执行循环

## 1. 功能概述

Ralph Loop 是**任务队列持续执行循环**，从 TASKS.md 读取任务队列，调用 Agent Teams 执行任务，支持无人值守运行。

## 2. 核心组件

```
src/teams/ralph-loop.ts
├── RalphLoop           - 主类
├── TASKS.md Parser    - 解析任务队列
├── TaskQueue          - 任务状态管理
└── ProgressTracker    - 进度追踪
```

## 3. TASKS.md 格式

```markdown
# Task Queue

## Pending
- [ ] Add user authentication
- [ ] Implement rate limiting

## In Progress
- [~] Database optimization (worker-001)

## Completed
- [x] Setup project structure
```

### 任务状态标记

- `[ ]` - Pending（待执行）
- `[~]` - In Progress（执行中）
- `[x]` - Completed（已完成）
- `[-]` - Failed（失败）

## 4. 执行流程

```
1. 加载 TASKS.md
2. 解析任务队列，提取 Pending 任务
3. 对每个任务:
   a. 更新任务状态为 In Progress
   b. 调用 TeamManager 执行
   c. 检查 Agent 响应关键词
   d. 失败? → 重试 → 通知主Agent评估
   e. 更新任务状态 (Completed/Failed)
   f. 更新 PROGRESS.md
   g. 任务间隔 cooldown
4. 生成 JSON 结果
5. 输出到控制台
```

## 5. 配置接口

```typescript
interface RalphLoopConfig {
  // 文件路径
  taskFilePath: string       // TASKS.md 路径 (默认: TASKS.md)
  progressFilePath: string   // PROGRESS.md 路径 (默认: PROGRESS.md)

  // 执行配置
  teamMode: "worker-reviewer" | "leader-workers"
  teamConfig?: TeamConfig    // TeamManager 配置

  // 循环控制
  maxRetries: number         // 失败重试次数 (默认: 1)
  cooldownMs: number        // 任务间隔 (默认: 0)
  maxIterations?: number     // 最大迭代次数 (可选)

  // 通知
  notifyOnFailure: boolean   // 失败时通知主Agent (默认: true)
}
```

## 6. 完成判断

### 6.1 Agent 响应关键词

检查 Agent 响应是否包含完成关键词:
- "task completed"
- "task done"
- "completed successfully"
- "all done"

### 6.2 PROGRESS.md 更新

每次任务完成后更新 PROGRESS.md:
```markdown
## Tasks

| Status | Task | Worker | Time |
|--------|------|--------|------|
| ✅ | Add user authentication | worker-001 | 10:30 |
| 🔄 | Implement rate limiting | - | - |
```

## 7. 失败处理

```
任务执行失败
    ↓
重试一次 (maxRetries: 1)
    ↓
仍然失败?
    ↓ Yes
通知主Agent评估
    ↓
主Agent判断: 继续/等待指示
    ↓
继续下一个任务 / 暂停等待
```

## 8. 输出格式

### 8.1 控制台输出

```
[ Ralph Loop Started ]
Task: Add user authentication
[1/5] Executing...
✓ Completed in 30s
---
Task: Implement rate limiting
[2/5] Executing...
✗ Failed: timeout
Retrying...
✓ Completed in 25s
---
[ Ralph Loop Complete ]
Total: 5 | Completed: 4 | Failed: 1
Results saved to ralph-loop-result.json
```

### 8.2 JSON 输出 (ralph-loop-result.json)

```typescript
interface RalphLoopResult {
  timestamp: string
  totalTasks: number
  completedTasks: number
  failedTasks: number
  duration: number
  results: TaskResult[]
}

interface TaskResult {
  taskName: string
  status: "completed" | "failed" | "skipped"
  workerId?: string
  duration: number
  error?: string
  attempts: number
}
```

### 8.3 PROGRESS.md 更新

每次任务完成后更新 PROGRESS.md，标记任务状态。

## 9. 与 TeamManager 集成

RalphLoop 独立于 TeamManager，但可以调用 TeamManager:

```typescript
class RalphLoop {
  private teamManager?: TeamManager

  async executeTask(task: Task): Promise<TaskResult> {
    if (!this.teamManager) {
      // 使用独立执行逻辑
    }
    return await this.teamManager.run(task.objective, task.contract)
  }
}
```

## 10. CLI 集成

```bash
# 基本用法
node dist/index.js --team-ralph

# 指定任务文件
node dist/index.js --team-ralph --team-ralph-task-file ./TASKS.md

# 指定团队模式
node dist/index.js --team-ralph --team worker-reviewer

# 指定进度文件
node dist/index.js --team-ralph --team-ralph-progress ./PROGRESS.md
```

## 11. 依赖

- `src/teams/types.ts` - TeamConfig, TeamMode
- `src/teams/progress-store.ts` - ProgressStore (可选复用)
- `src/teams/contracts.ts` - TaskContract

## 12. 风险与限制

1. **Agent 响应检测**: 依赖关键词匹配，可能有误判
2. **长时间运行**: 需要考虑内存泄漏和上下文膨胀
3. **并发控制**: 不支持并行多个 Ralph Loop 实例
