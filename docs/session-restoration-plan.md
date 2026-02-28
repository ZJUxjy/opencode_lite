# Session Restoration 功能实现计划

> **状态**: ✅ 已完成（2026-02-28）

## 1. 已实现功能总结

### 1.1 核心功能

| 功能模块 | 状态 | 说明 |
|---------|------|------|
| Session 元数据存储 | ✅ | SQLite `sessions` 表 |
| CLI 恢复参数 | ✅ | `-r/--resume`, `-c/--continue`, `--list-sessions` |
| 交互式会话选择器 | ✅ | `/sessions` slash 命令 + Ink UI |
| 历史消息加载 | ✅ | 恢复会话时自动加载历史 |
| Input History | ✅ | Session 独立 + 持久化 |

### 1.2 数据库 Schema

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  cwd TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  message_count INTEGER DEFAULT 0,
  is_archived INTEGER DEFAULT 0,
  input_history TEXT DEFAULT '[]'  -- JSON 格式
);
```

### 1.3 CLI 接口

```bash
# 列出所有会话
lite-opencode --list-sessions

# 继续上一个会话
lite-opencode --continue
lite-opencode -c

# 恢复特定会话
lite-opencode --resume <session-id>
lite-opencode -r <session-id>

# 恢复最新会话
lite-opencode --resume
lite-opencode -r
```

### 1.4 交互式命令

```bash
# 在会话中显示会话列表
/sessions
/resume
```

### 1.5 Input History

- 每个 Session 独立的输入历史
- 持久化到数据库
- 上下键 (↑/↓) 导航
- 最多 50 条记录

---

## 2. 技术实现

### 2.1 项目结构

```
src/
├── session/
│   ├── types.ts          # Session, DBSession 类型
│   ├── store.ts          # SessionStore 类
│   └── index.ts          # 模块导出
├── components/
│   └── SessionList.tsx   # 会话选择器组件
├── hooks/
│   └── useCommandInput.ts # Input History 实现
└── ...
```

### 2.2 关键类和方法

**SessionStore**:
```typescript
class SessionStore {
  create(params: CreateSessionParams): Session
  get(id: string): Session | null
  update(id: string, updates: UpdateSessionParams): void
  list(options?: ListSessionsOptions): Session[]
  getLastSession(cwd: string): Session | null
  getLatestSession(): Session | null
  updateInputHistory(id: string, history: string[]): void
}
```

**useCommandInput Hook**:
```typescript
interface UseCommandInputProps {
  initialHistory?: string[]
  onHistoryChange?: (history: string[]) => void
}
```

### 2.3 数据流

**Session 创建**:
```
CLI 启动 → resolveSession() → SessionStore.create() → SQLite
```

**历史消息恢复**:
```
App 挂载 → useEffect() → agent.getHistory() → setMessages()
```

**Input History 保存**:
```
用户提交 → handleSubmit() → setInputHistory() → onHistoryChange() →
SessionStore.updateInputHistory() → SQLite
```

---

## 3. 设计决策

### 3.1 为什么 Session 独立？

- **上下文隔离**: Session A 讨论 React，Session B 讨论 API，历史不应该混合
- **隐私**: 不同项目的历史不应该互相可见
- **性能**: 历史记录较少，导航更快

### 3.2 为什么不持久化到文件？

- **一致性**: 已有 SQLite 存储，不需要引入新的存储机制
- **事务**: 数据库支持原子操作
- **查询**: 支持按目录、时间等条件查询

### 3.3 为什么用动态 import？

初期使用 `require()` 导致 ESM 运行时错误，后改为静态 import:
```typescript
// ❌ 错误
const { SessionStore } = require("./session/index.js")

// ✅ 正确
import { SessionStore } from "./session/index.js"
```

---

## 4. 测试结果

| 测试项 | 状态 | 说明 |
|--------|------|------|
| npm run build | ✅ | TypeScript 编译通过 |
| npm run dev | ✅ | ESM 运行正常 |
| 数据库 Schema | ✅ | sessions 表 + input_history 列 |
| 自动迁移 | ✅ | ALTER TABLE + try/catch |
| CLI 参数 | ✅ | -r, -c, --list-sessions |
| 会话恢复 | ✅ | 历史消息正确加载 |
| Input History | ✅ | Session 独立 + 持久化 |

---

## 5. 使用示例

### 场景 1: 日常工作流

```bash
# 开始工作
$ lite-opencode
❯ 帮我修复登录 bug
... 工作 ...
❯ /exit

# 第二天继续
$ lite-opencode --continue
📂 Resumed session: 帮我修复登录 bug
Session ID: session-abc123... (12 messages)
❯ [按 ↑ 恢复历史输入]
```

### 场景 2: 多项目切换

```bash
# 项目 A
$ cd ~/projects/frontend
$ lite-opencode -r
# Input history: ["修复 React 组件", "优化渲染性能"]

# 项目 B
$ cd ~/projects/backend
$ lite-opencode -r
# Input history: ["设计 API 接口", "添加数据库迁移"]
```

---

## 6. 未来扩展（可选）

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 会话归档 | P2 | 归档不常用会话 |
| 会话搜索 | P2 | 按标题/内容搜索 |
| Fork 会话 | P3 | 类似 opencode 的 fork 功能 |
| AI 会话摘要 | P3 | 自动生成会话描述 |
| 导出 Markdown | P3 | 导出会话为文档 |

---

## 7. 相关文档

- [开发计划](./development-plan.md) - 整体路线图
- [react-development-plan.md](./react-development-plan.md) - ReAct 系统
- [hook-system-design.md](./hook-system-design.md) - Hook 系统设计

---

*最后更新: 2026-02-28*
