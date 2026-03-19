# Git-like Context Management System

**Date:** 2026-03-19
**Status:** Design Proposal
**Inspired by:** The observation that conversation context can be versioned like code

---

## 核心思路

当前的上下文压缩策略是一次性的：到达 92% 阈值时，把中间的消息压缩成一段摘要，然后丢弃原始内容。这类似于 `git squash`，但不可逆。

用户提出的想法：像 git 管理代码那样管理上下文——

| git 概念 | 上下文对应概念 |
|---------|-------------|
| Commit | 一段对话的快照（含 LLM 生成的摘要） |
| Parent | 上一个快照（形成链式历史） |
| Branch | 不同的对话探索方向 |
| HEAD | 当前激活的上下文位置 |
| Checkout | 恢复到某个历史快照 |
| Log | 查看对话历史快照列表 |
| Diff | 对比两个快照之间的变化 |

**关键改进点：**
- 压缩不再是丢弃，而是"提交存档"——全量保留，按需恢复
- 上下文有历史版本，可以回溯
- 允许从任意历史节点分叉，探索不同解法
- 重建上下文时：近期段落保留全文，历史段落用摘要替代（节省 token）

---

## 数据结构设计

### ContextCommit（核心：类比 git commit object）

```typescript
interface ContextCommit {
  hash: string           // SHA-256(sessionId + timestamp + messages摘要)，唯一标识
  parentHash: string | null  // 父提交的 hash，null 表示初始提交
  sessionId: string      // 所属会话
  summary: string        // LLM 生成的本段对话摘要（100-300 字）
  messages: Message[]    // 本段的完整消息（持久化，可按需加载）
  tokenCount: number     // 本段 token 数
  messageRange: {        // 对应数据库中的消息 ID 范围
    startId: number
    endId: number
  }
  metadata: {
    taskContext: string  // 这段对话在做什么任务（LLM 提取）
    toolsUsed: string[]  // 用到的工具列表
    filesModified: string[]  // 操作过的文件列表
    keyDecisions: string[]   // 关键决策点
  }
  createdAt: number
}
```

### ContextBranch（类比 git ref/branch）

```typescript
interface ContextBranch {
  name: string          // 分支名，如 "main", "explore-auth-fix"
  sessionId: string
  headHash: string      // 当前 HEAD 指向的 commit hash
  description: string   // 该分支的目的描述
  createdAt: number
  updatedAt: number
}
```

### WorkingContext（类比 git working tree + index）

```typescript
interface WorkingContext {
  sessionId: string
  branch: string        // 当前所在分支
  headHash: string      // 当前 HEAD
  uncommitted: Message[]  // 还没提交的最新消息（活跃窗口）
  reconstructed: Message[]  // 重建后传给 LLM 的完整上下文
  // reconstructed = [历史摘要消息...] + [uncommitted]
}
```

---

## 存储层设计（SQLite 扩展）

在现有 `~/.lite-opencode/history.db` 中新增表：

```sql
-- 上下文快照
CREATE TABLE context_commits (
  hash TEXT PRIMARY KEY,
  parent_hash TEXT,
  session_id TEXT NOT NULL,
  branch_name TEXT NOT NULL DEFAULT 'main',
  summary TEXT NOT NULL,
  messages TEXT NOT NULL,       -- JSON: Message[]（完整消息）
  metadata TEXT NOT NULL,       -- JSON: commit metadata
  token_count INTEGER NOT NULL,
  message_range_start INTEGER,  -- 引用 messages 表的 id
  message_range_end INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (parent_hash) REFERENCES context_commits(hash)
);

-- 分支引用
CREATE TABLE context_branches (
  name TEXT NOT NULL,
  session_id TEXT NOT NULL,
  head_hash TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (name, session_id),
  FOREIGN KEY (head_hash) REFERENCES context_commits(hash)
);

-- 索引优化
CREATE INDEX idx_commits_session ON context_commits(session_id, created_at);
CREATE INDEX idx_commits_parent ON context_commits(parent_hash);
```

---

## 核心算法

### 1. 自动提交（替代当前压缩机制）

**触发条件改为分级：**
- 70% 满：提示用户可以手动提交（可配置）
- 80% 满：自动"软提交"——生成摘要并提交当前段，但保留全文在 uncommitted
- 92% 满：强制提交，清空 uncommitted，仅保留摘要在活跃上下文

```typescript
class ContextCommitter {
  async autoCommit(
    sessionId: string,
    messages: Message[],
    level: "soft" | "hard"
  ): Promise<ContextCommit> {

    // 1. 找到合适的切分点（自然边界）
    const splitPoint = this.findNaturalBoundary(messages)
    const toCommit = messages.slice(0, splitPoint)
    const remaining = messages.slice(splitPoint)

    // 2. 用 LLM 生成摘要
    const summary = await this.generateCommitSummary(toCommit)

    // 3. 提取元数据
    const metadata = await this.extractMetadata(toCommit)

    // 4. 计算 hash
    const hash = this.computeHash(sessionId, toCommit, summary)

    // 5. 找到当前 HEAD
    const branch = await this.branchStore.get(sessionId, "main")

    // 6. 写入数据库
    const commit: ContextCommit = {
      hash,
      parentHash: branch?.headHash ?? null,
      sessionId,
      summary,
      messages: toCommit,  // 完整保存
      metadata,
      tokenCount: estimateTokens(toCommit),
      createdAt: Date.now()
    }
    await this.commitStore.save(commit)

    // 7. 更新分支 HEAD
    await this.branchStore.updateHead(sessionId, "main", hash)

    return commit
  }

  // 寻找自然切分点：任务完成标志、话题转换处
  private findNaturalBoundary(messages: Message[]): number {
    // 优先在以下位置切分：
    // - 工具调用完成后的 assistant 消息
    // - "任务完成"类关键词出现处
    // - 用户发起新话题处
    // 默认：前 2/3 消息
    return Math.floor(messages.length * 0.67)
  }
}
```

### 2. 上下文重建（核心：分层压缩）

从历史提交链重建传给 LLM 的上下文，越旧越压缩：

```typescript
class ContextReconstructor {
  async reconstruct(
    sessionId: string,
    fromHash: string,
    uncommitted: Message[]
  ): Promise<Message[]> {

    // 1. 加载提交链（从 HEAD 向前追溯）
    const chain = await this.loadCommitChain(fromHash)

    // 2. 分层重建
    // 最旧的提交：只用一句话摘要
    // 中间的提交：用完整摘要（100-300字）
    // 最近的提交：用完整消息
    // uncommitted：直接使用

    const reconstructed: Message[] = []

    for (let i = 0; i < chain.length; i++) {
      const commit = chain[i]
      const age = chain.length - 1 - i  // 0=最新, n=最旧

      if (age > 5) {
        // 很旧：单行摘要
        reconstructed.push({
          role: "user",
          content: `[历史上下文-${commit.hash.slice(0,7)}] ${commit.metadata.taskContext}`
        })
      } else if (age > 2) {
        // 较旧：完整摘要
        reconstructed.push({
          role: "user",
          content: `[上下文摘要-${commit.hash.slice(0,7)}]\n${commit.summary}`
        })
      } else {
        // 近期：展开完整消息
        reconstructed.push(...commit.messages)
      }
    }

    // 加上未提交的新消息
    reconstructed.push(...uncommitted)

    return reconstructed
  }
}
```

### 3. 恢复到历史快照

```typescript
class ContextCheckout {
  async checkout(sessionId: string, hash: string): Promise<WorkingContext> {
    const commit = await this.commitStore.get(hash)
    if (!commit) throw new Error(`Commit ${hash} not found`)

    // 更新分支 HEAD（创建 detached HEAD 状态或新分支）
    await this.branchStore.updateHead(sessionId, "main", hash)

    // 重建上下文
    const reconstructed = await this.reconstructor.reconstruct(
      sessionId, hash, []
    )

    return {
      sessionId,
      branch: "main",
      headHash: hash,
      uncommitted: [],
      reconstructed
    }
  }
}
```

---

## 分支系统

支持从任意提交分叉，创建独立探索分支：

```
main:    A --- B --- C --- D (HEAD)
                      \
explore:               E --- F (HEAD)
```

**使用场景：**
- 主线：`main` 分支，正常对话流
- 探索：`/context branch explore-auth "探索认证问题的另一种解法"`
- 合并：把 explore 分支的结论带回 main

```typescript
// 创建分支
async createBranch(sessionId: string, name: string, fromHash: string): Promise<void>

// 切换分支（恢复该分支的 HEAD 状态）
async switchBranch(sessionId: string, name: string): Promise<WorkingContext>

// 合并分支（将另一分支的摘要注入当前上下文）
async mergeBranch(
  sessionId: string,
  sourceBranch: string
): Promise<Message>  // 返回合并摘要消息
```

---

## 实现计划（分阶段）

### Phase 1：基础提交与日志（2-3天）

**目标：** 能保存和查看上下文历史，不改变现有压缩行为

**新文件：**
```
src/context/
├── types.ts          # ContextCommit, ContextBranch, WorkingContext
├── store.ts          # SQLite CRUD for commits and branches
├── committer.ts      # LLM-powered commit generation
├── reconstructor.ts  # Context chain reconstruction
└── index.ts          # Public API
```

**改动现有文件：**
- `src/compression.ts`：在调用现有压缩逻辑前，先调用 `committer.commit()`
- `src/store.ts`：新增 `schema` 迁移，创建 `context_commits` 和 `context_branches` 表

**新增 slash 命令：**
```
/context log           # 显示提交历史（类似 git log）
/context show <hash>   # 显示某个提交的摘要
/context status        # 显示当前位置和未提交消息数
```

**验收标准：**
- 每次压缩触发时，自动生成并保存 commit
- `/context log` 显示 commit 列表和摘要
- 数据库中正确保存完整消息和 hash

---

### Phase 2：恢复与 Checkout（2-3天）

**目标：** 能从历史快照重建上下文，实现真正的"时间旅行"

**新增功能：**
- `ContextReconstructor`：分层重建算法
- `ContextCheckout`：切换到历史提交

**新增 slash 命令：**
```
/context restore <hash>   # 恢复到某个历史快照
/context restore --dry-run <hash>  # 预览恢复后的上下文（不实际切换）
```

**改动 `src/agent.ts`：**
- 支持从 `WorkingContext.reconstructed` 初始化消息列表
- 恢复后，新消息追加到 uncommitted，直到下次提交

**验收标准：**
- 恢复后，LLM 收到的上下文正确包含历史摘要 + 近期全文
- token 使用量符合预期（历史摘要比全文小）

---

### Phase 3：智能分段（1-2天）

**目标：** 提高摘要质量，在自然边界切分

**改进点：**
- 检测任务完成标志（工具调用完成、用户说"谢谢"、助手说"完成"等）
- 检测话题切换（新的文件名出现、完全不同的工具序列）
- 可配置的分段策略

**新增配置项（settings.json）：**
```json
{
  "contextManagement": {
    "autoCommitThreshold": 0.80,
    "forceCommitThreshold": 0.92,
    "segmentStrategy": "natural",   // "natural" | "fixed" | "manual"
    "summaryDetail": "medium",      // "brief" | "medium" | "detailed"
    "keepFullCommits": 3            // 最近 N 个提交保留全文
  }
}
```

---

### Phase 4：分支系统（3-4天）

**目标：** 支持多分支对话，像 git 一样探索不同路径

**新增功能：**
- `BranchManager`：创建、切换、合并分支
- 分支间的 merge（将一个分支的摘要注入另一个分支）

**新增 slash 命令：**
```
/context branch <name>           # 从当前位置创建新分支
/context branch <name> <hash>    # 从指定 commit 创建分支
/context switch <branch>         # 切换分支
/context branches                # 列出所有分支
/context merge <branch>          # 合并分支摘要
```

---

### Phase 5：UI 集成与可视化（2-3天）

**目标：** 直观展示上下文历史

**TUI 改进：**
- 状态栏显示当前 branch 和 HEAD（如 `[main @ a3f7b2c]`）
- `/context log` 输出美观的 ASCII 树形图

```
* a3f7b2c (HEAD, main) 实现了认证模块，修改了 auth.ts
* 7d3f1a9 分析了 bug 原因，查看了 3 个文件
* 2c8e4d1 初始化会话
```

- `/context graph` 显示分支拓扑：

```
* e5f2a1c (explore) 尝试了 JWT 方案
| * a3f7b2c (HEAD, main) 使用 session 方案完成认证
|/
* 7d3f1a9 分析了 bug 原因
```

---

## API 设计（供外部调用）

```typescript
// 主入口
class ContextManager {
  // 提交
  commit(sessionId: string, messages: Message[], message?: string): Promise<ContextCommit>
  autoCommit(sessionId: string, messages: Message[]): Promise<ContextCommit | null>

  // 查询
  log(sessionId: string, options?: { limit?: number; branch?: string }): Promise<ContextCommit[]>
  show(hash: string): Promise<ContextCommit>
  status(sessionId: string): Promise<ContextStatus>

  // 恢复
  restore(sessionId: string, hash: string): Promise<WorkingContext>
  preview(sessionId: string, hash: string): Promise<{ tokenCount: number; summary: string }>

  // 分支
  branch(sessionId: string, name: string, fromHash?: string): Promise<ContextBranch>
  switch(sessionId: string, branchName: string): Promise<WorkingContext>
  merge(sessionId: string, sourceBranch: string): Promise<Message>
  branches(sessionId: string): Promise<ContextBranch[]>
}
```

---

## 与现有系统的对比

| 特性 | 现有系统 | 新系统 |
|-----|---------|-------|
| 压缩后能恢复 | ❌ 不可逆 | ✅ 可随时恢复 |
| 历史查看 | ❌ 无 | ✅ `/context log` |
| 分支探索 | ❌ 无 | ✅ 完整分支系统 |
| 摘要质量 | 段落摘要 | 结构化元数据 + 摘要 |
| token 效率 | 固定策略 | 分层：越旧越压缩 |
| 存储开销 | 仅摘要 | 全量保存（可配置清理策略） |
| 实现复杂度 | 低 | 中高 |

---

## 存储开销估算

每个 commit 存储：
- 完整消息：平均 20KB/commit（中等密度对话）
- 摘要元数据：约 2KB
- 保留 30 个 commit = ~660KB/session

**清理策略（可选）：**
```json
{
  "contextManagement": {
    "maxCommitsPerSession": 50,
    "autoCleanup": true,
    "cleanupStrategy": "lru"  // 删除最旧的 commit 的完整消息，只保留摘要
  }
}
```

---

## 实现优先级建议

| 优先级 | Phase | 理由 |
|--------|-------|------|
| P0 | Phase 1（提交+日志） | 基础能力，向后兼容，验证思路 |
| P1 | Phase 2（恢复） | 核心价值主张 |
| P2 | Phase 3（智能分段） | 提升体验质量 |
| P3 | Phase 4（分支） | 高级功能，需求明确后再做 |
| P4 | Phase 5（可视化） | 锦上添花 |

**最小可行版本（MVP）= Phase 1 + Phase 2**，大约 4-6 天工作量，即可验证核心价值。

---

## 潜在风险

1. **存储增长**：完整消息保存比只保留摘要占用更多空间 → 清理策略缓解
2. **重建 token 超限**：分层重建可能仍超过模型 token 限制 → 动态调整每层保留量
3. **摘要质量**：LLM 摘要不稳定 → 加入结构化元数据（工具列表、文件列表）作为保底
4. **分支合并复杂度**：对话分支合并比代码合并更模糊 → Phase 4 简化为"注入摘要"而非真正合并
