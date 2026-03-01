# Agent Teams 分支差异分析报告

## 执行摘要

**分析日期**: 2026-03-01
**分析目标**: codex, kimi, minimax 三个分支
**推荐策略**: 三分支合并，取各家之长

---

## 1. 分支概览

### 1.1 代码规模对比

| 指标 | codex | kimi | minimax |
|------|-------|------|---------|
| **源代码行数** | 2,986 | 7,785 | 7,001 |
| **测试代码行数** | 1,104 | 3,746 | 883 |
| **测试/代码比** | 37% | 48% | 13% |
| **测试文件数** | 17 | 12 | 5 |
| **TODO 数量** | 0 | 0 | 2 |

### 1.2 开发阶段对比

| 分支 | 阶段 | 最新提交 |
|------|------|---------|
| **codex** | Phase 1-3 | feat: implement phase 1-3 foundation |
| **kimi** | Phase 4 | feat: Agent Teams Phase 4 - P0 Supplement |
| **minimax** | P2 Features | feat: implement P2 Agent Teams features |

---

## 2. 功能矩阵

### 2.1 核心功能对比

| 功能 | codex | kimi | minimax | 推荐 |
|------|:-----:|:----:|:-------:|------|
| **基础架构** |
| types.ts | ✅ | ✅ | ✅ | 合并 |
| contracts.ts | ✅ | ✅ | ✅ | 合并 |
| index.ts | ✅ | ✅ | ✅ | 合并 |
| **协作模式** |
| council.ts | ✅ | ✅ | ✅ | kimi (最完整) |
| leader-workers.ts | ✅ | ✅ | ✅ | kimi (最完整) |
| planner-executor-reviewer.ts | ✅ | ✅ | ✅ | kimi (最完整) |
| worker-reviewer.ts | ✅ | ✅ | ✅ | kimi (最完整) |
| hotfix-guardrail.ts | ✅ | ✅ | ✅ | kimi (最完整) |
| **存储系统** |
| blackboard.ts | ✅ | ✅ | ✅ | kimi |
| checkpoint-store.ts | ✅ | ❌ | ✅ | codex (有 rollback) |
| artifact-store.ts | ✅ | ✅ | ✅ | kimi |
| team-run-store.ts | ✅ | ✅ | ✅ | 相同 |
| **任务管理** |
| task-dag.ts | ✅ | ✅ | ✅ | kimi |
| progress-tracker.ts | ✅ | ✅ | ✅ | kimi |
| cost-controller.ts | ✅ | ✅ | ✅ | 相同 |
| conflict-detector.ts | ✅ | ✅ | ✅ | kimi |
| fallback.ts | ✅ | ✅ | ✅ | kimi |

### 2.2 独有功能对比

| 功能 | codex | kimi | minimax | 价值 | 推荐 |
|------|:-----:|:----:|:-------:|------|------|
| **codex 独有** |
| ralph-loop.ts | ✅ | ❌ | ❌ | 高 | ⭐⭐⭐ |
| drill.ts | ✅ | ❌ | ❌ | 高 | ⭐⭐⭐ |
| evaluator.ts | ✅ | ❌ | ❌ | 中 | ⭐⭐ |
| **kimi 独有** |
| llm-client.ts | ❌ | ✅ | ❌ | 极高 | ⭐⭐⭐⭐⭐ |
| agent-pool.ts | ❌ | ✅ | ✅ | 极高 | ⭐⭐⭐⭐⭐ |
| team-manager.ts | ❌ | ✅ | ❌ | 极高 | ⭐⭐⭐⭐⭐ |
| checkpoint.ts | ❌ | ✅ | ❌ | 高 | ⭐⭐⭐ |
| **minimax 独有** |
| worktree-isolation.ts | ❌ | ❌ | ✅ | 极高 | ⭐⭐⭐⭐⭐ |
| evaluation.ts | ❌ | ❌ | ✅ | 中 | ⭐⭐ |
| progress-store.ts | ❌ | ❌ | ✅ | 中 | ⭐⭐ |

---

## 3. 代码质量评估

### 3.1 测试覆盖分析

**codex** (17 测试文件, 1,104 行)
```
最佳测试:
- manager.test.ts (249行) ★★★★★
- integration.test.ts (123行) ★★★★★
- checkpoint-store.test.ts (110行) ★★★★
- leader-workers.test.ts (97行) ★★★★
- council.test.ts (74行) ★★★★
```

**kimi** (12 测试文件, 3,746 行)
```
最佳测试:
- conflict-detector.test.ts (497行) ★★★★★
- team-run-store.test.ts (451行) ★★★★★
- task-dag.test.ts (437行) ★★★★★
- checkpoint.test.ts (381行) ★★★★★
- fallback.test.ts (337行) ★★★★★
```

**minimax** (5 测试文件, 883 行)
```
最佳测试:
- progress-tracker.test.ts (214行) ★★★
- fallback.test.ts (198行) ★★★
- task-dag.test.ts (173行) ★★★
- conflict-detector.test.ts (159行) ★★★
- cost-controller.test.ts (139行) ★★★
```

**结论**: kimi 测试覆盖最全面，codex 次之，minimax 需要补充测试

### 3.2 代码风格对比

| 维度 | codex | kimi | minimax |
|------|-------|------|---------|
| 注释质量 | ★★★★ | ★★★★★ | ★★★★ |
| 类型安全 | ★★★★ | ★★★★★ | ★★★★ |
| 错误处理 | ★★★★ | ★★★★★ | ★★★ |
| 文档字符串 | ★★★★ | ★★★★★ | ★★★ |

### 3.3 安全性评估

| 问题 | codex | kimi | minimax |
|------|-------|------|---------|
| 命令注入 | ✅ 安全 | ✅ 安全 | ✅ 安全 (已用 execFile) |
| 路径遍历 | ⚠️ 需检查 | ✅ 有验证 | ⚠️ 需检查 |
| 资源泄漏 | ✅ 有 cleanup | ✅ 有 cleanup | ✅ 有 cleanup |

---

## 4. 功能完整性评估

### 4.1 补充文档 P0 功能

| 功能 | codex | kimi | minimax |
|------|:-----:|:----:|:-------:|
| Council 并行发言 | ✅ | ✅ | ✅ |
| 基线测试自动化 | ✅ drill.ts | ⚠️ benchmark.ts | ⚠️ benchmark.ts |
| 产物写入文件系统 | ✅ | ✅ | ✅ |

### 4.2 补充文档 P1 功能

| 功能 | codex | kimi | minimax |
|------|:-----:|:----:|:-------:|
| LLM-as-Judge | ✅ evaluator.ts | ❌ | ✅ evaluation.ts |
| 检查点恢复 | ✅ rollback | ✅ checkpoint.ts | ⚠️ 仅存储 |
| 宽松上下文契约 | ✅ | ✅ | ✅ |
| PROGRESS.md | ✅ ralph-loop | ❌ | ✅ progress-store |

### 4.3 补充文档 P2 功能

| 功能 | codex | kimi | minimax |
|------|:-----:|:----:|:-------:|
| Git Worktree 隔离 | ❌ | ❌ | ✅ |
| Ralph Loop 持续执行 | ✅ | ❌ | ❌ |
| 扩展思考预算 | ⚠️ 类型 | ⚠️ 类型 | ⚠️ 类型 |
| AgentPool 实例复用 | ❌ | ✅ | ✅ |

---

## 5. 合并策略

### 5.1 推荐合并顺序

```
Step 1: kimi → main    (基础架构最完整，7785行代码)
Step 2: minimax → main  (添加 worktree-isolation.ts)
Step 3: codex → main    (添加 ralph-loop.ts, drill.ts, evaluator.ts)
```

### 5.2 冲突预测

| 文件 | 冲突风险 | 原因 |
|------|:--------:|------|
| types.ts | 高 | 三分支都有修改 |
| contracts.ts | 中 | kimi 和 minimax 有差异 |
| manager.ts | 高 | codex 和 kimi 实现不同 |
| blackboard.ts | 低 | 基本相同 |
| modes/*.ts | 中 | 实现细节不同 |

### 5.3 合并后文件结构

```
src/teams/
├── core/                        # 新目录：核心抽象
│   ├── types.ts                 # 合并三分支
│   ├── contracts.ts             # 合并三分支
│   └── index.ts
├── client/                      # 新目录：LLM 客户端 (来自 kimi)
│   ├── llm-client.ts            # kimi 独有
│   └── agent-pool.ts            # kimi/minimax
├── storage/                     # 新目录：存储系统
│   ├── blackboard.ts
│   ├── checkpoint-store.ts      # codex + kimi checkpoint.ts 合并
│   ├── artifact-store.ts
│   └── team-run-store.ts
├── execution/                   # 新目录：执行引擎
│   ├── task-dag.ts
│   ├── progress-tracker.ts
│   ├── cost-controller.ts
│   ├── conflict-detector.ts
│   └── fallback.ts
├── isolation/                   # 新目录：隔离机制 (来自 minimax)
│   └── worktree-isolation.ts    # minimax 独有
├── evaluation/                  # 新目录：评估系统
│   ├── evaluator.ts             # codex
│   ├── evaluation.ts            # minimax (合并到 evaluator.ts)
│   └── benchmark.ts
├── loop/                        # 新目录：循环执行 (来自 codex)
│   └── ralph-loop.ts            # codex 独有
├── testing/                     # 新目录：测试工具 (来自 codex)
│   └── drill.ts                 # codex 独有
├── modes/                       # 协作模式
│   ├── council.ts               # kimi 版本
│   ├── leader-workers.ts        # kimi 版本
│   ├── planner-executor-reviewer.ts
│   ├── worker-reviewer.ts
│   └── hotfix-guardrail.ts
├── manager.ts                   # kimi 版本
└── index.ts
```

---

## 6. 优先修复建议

### 6.1 合并前必须修复

| 问题 | 分支 | 严重程度 | 修复建议 |
|------|------|:--------:|----------|
| 测试不足 | minimax | 高 | 从 kimi 移植测试 |
| types.ts 冲突 | 全部 | 高 | 统一类型定义 |

### 6.2 合并后立即实施

| 任务 | 优先级 | 工作量 |
|------|:------:|:------:|
| 统一 types.ts | P0 | 2h |
| 补充 minimax 测试 | P0 | 4h |
| 合并 evaluator.ts + evaluation.ts | P1 | 2h |
| 合并 checkpoint-store.ts + checkpoint.ts | P1 | 2h |
| 集成测试验证 | P1 | 3h |

---

## 7. 功能扩展路线图

### 7.1 稳定性优先 (1-2 周)

| 任务 | 描述 | 来源 |
|------|------|------|
| 统一 AgentPool | 合并 kimi/minimax 实现 | 合并 |
| 完善 Checkpoint | 添加 rollback 功能 | codex |
| 补充测试 | 移植 kimi 测试到合并后代码 | kimi |
| 错误处理 | 统一错误处理策略 | 新增 |

### 7.2 功能扩展 (2-4 周)

| 任务 | 描述 | 来源 |
|------|------|------|
| CLI 集成 | 添加 --team 命令 | kimi |
| 配置文件 | teams.config.json 支持 | 新增 |
| 非交互模式 | CI/CD 集成支持 | 新增 |
| Drill 自动化 | 集成到 CI | codex |

### 7.3 性能优化 (4-6 周)

| 任务 | 描述 | 来源 |
|------|------|------|
| 并行执行优化 | Promise.all 改进 | 新增 |
| Token 预算 | 思考预算实现 | 补充文档 |
| 缓存层 | 结果缓存 | 新增 |
| 基线测试扩展 | 20 样本 | 补充文档 |

---

## 8. 结论

### 8.1 推荐方案

**合并策略**: 三分支合并，以 kimi 为基础

**原因**:
1. kimi 代码量最大 (7,785行)，功能最完整
2. kimi 测试覆盖最好 (3,746行，48%)
3. kimi 有独特的 LLM 集成 (llm-client.ts, agent-pool.ts)
4. codex 有独特的测试工具 (drill.ts, ralph-loop.ts)
5. minimax 有独特的隔离机制 (worktree-isolation.ts)

### 8.2 预期收益

| 指标 | 合并前 (kimi) | 合并后 | 提升 |
|------|:-------------:|:------:|:----:|
| 源代码行数 | 7,785 | ~9,000 | +16% |
| 测试代码行数 | 3,746 | ~4,500 | +20% |
| 功能完整度 | 80% | 95% | +15% |
| 独有功能 | 4 | 10 | +150% |

### 8.3 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|:----:|:----:|----------|
| 合并冲突 | 高 | 中 | 手动解决，保留最优实现 |
| 测试失败 | 中 | 中 | 先运行三分支测试，再合并 |
| 功能回归 | 低 | 高 | 完整集成测试 |

---

## 附录 A: 文件清单

### A.1 最终文件列表 (合并后)

```
src/teams/
├── core/
│   ├── types.ts
│   ├── contracts.ts
│   └── index.ts
├── client/
│   ├── llm-client.ts (kimi)
│   └── agent-pool.ts (kimi/minimax)
├── storage/
│   ├── blackboard.ts
│   ├── checkpoint-store.ts (codex + kimi)
│   ├── artifact-store.ts
│   └── team-run-store.ts
├── execution/
│   ├── task-dag.ts
│   ├── progress-tracker.ts
│   ├── cost-controller.ts
│   ├── conflict-detector.ts
│   └── fallback.ts
├── isolation/
│   └── worktree-isolation.ts (minimax)
├── evaluation/
│   ├── evaluator.ts (codex + minimax)
│   └── benchmark.ts
├── loop/
│   └── ralph-loop.ts (codex)
├── testing/
│   └── drill.ts (codex)
├── modes/
│   ├── council.ts
│   ├── leader-workers.ts
│   ├── planner-executor-reviewer.ts
│   ├── worker-reviewer.ts
│   └── hotfix-guardrail.ts
├── manager.ts (kimi)
└── index.ts
```

### A.2 来源标记

- `(kimi)` - 来自 kimi 分支
- `(codex)` - 来自 codex 分支
- `(minimax)` - 来自 minimax 分支
- `(kimi/minimax)` - 两分支都有，选最优
- `(codex + kimi)` - 合并两分支实现
- `(codex + minimax)` - 合并两分支实现
- 无标记 - 三分支相同

---

**报告生成时间**: 2026-03-01
**分析工具**: Claude Code with brainstorming skill
