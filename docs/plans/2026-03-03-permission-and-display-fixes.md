# 权限系统和显示优化设计

## 概述

本文档描述了4个问题的解决方案设计，按优先级排序：
1. SQLite database is locked（问题5）
2. Always allow 不生效（问题2）
3. 显示性能和格式化（问题3+4）
4. Skill 工具默认权限（问题1）

---

## 问题 5: SQLite 锁问题修复

### 原因分析
- `MessageStore` 和 `SessionStore` 各自创建独立的数据库连接
- 没有设置 `busy_timeout` 和 WAL 模式
- 多个连接并发访问同一数据库时会发生锁冲突

### 解决方案
创建共享数据库管理器，使用单一连接 + WAL 模式。

### 改动文件
- `src/db.ts`（新文件）
- `src/store.ts`
- `src/session/store.ts`

### 设计详情

```typescript
// src/db.ts
import Database from "better-sqlite3"
import { mkdirSync } from "fs"
import { dirname } from "path"

export class DatabaseManager {
  private static instances: Map<string, DatabaseManager> = new Map()
  private db: Database.Database

  private constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    // 启用 WAL 模式，提高并发性能
    this.db.pragma('journal_mode = WAL')
    // 设置 busy_timeout 为 5 秒
    this.db.pragma('busy_timeout = 5000')
  }

  static getInstance(dbPath: string): DatabaseManager {
    if (!this.instances.has(dbPath)) {
      this.instances.set(dbPath, new DatabaseManager(dbPath))
    }
    return this.instances.get(dbPath)!
  }

  getDatabase(): Database.Database {
    return this.db
  }

  close(): void {
    this.db.close()
  }
}
```

---

## 问题 2: Always Allow 机制改进

### 原因分析
当前 `hashArgs()` 方法基于完整参数生成哈希，每次文件路径不同就会生成不同的哈希，导致 "always allow" 只对完全相同的参数生效。

### 解决方案
改为按**工具类型 + 工作目录**匹配，与 gemini-cli/opencode 的设计理念一致。

### 改动文件
- `src/policy.ts`
- `src/App.tsx`
- `src/agent.ts`（如果需要传递 cwd）

### 设计详情

```typescript
// policy.ts 修改

// 修改 learn 方法签名
learn(
  toolName: string,
  args: Record<string, unknown>,
  decision: PolicyDecision,
  always: boolean,
  cwd?: string  // 新增参数
): void {
  if (!this.config.enableLearning) return

  if (always) {
    // 按 toolName + cwd 存储规则
    const ruleKey = `${toolName}:${cwd || process.cwd()}`
    this.learnedRules.set(ruleKey, decision)
    this.saveLearnedRules()
  }
}

// 修改 check 方法
check(toolName: string, args: Record<string, unknown>, cwd?: string): PolicyResult {
  // ... 现有逻辑 ...

  // 3. 检查学习的规则（按工具名 + 工作目录）
  const ruleKey = `${toolName}:${cwd || process.cwd()}`
  const learnedDecision = this.learnedRules.get(ruleKey)
  if (learnedDecision) {
    return {
      decision: learnedDecision,
      reason: "根据您之前的选择（Always Allow）",
    }
  }

  // 4. 返回默认决策
  return {
    decision: this.config.defaultDecision,
    reason: "默认策略",
  }
}
```

---

## 问题 3+4: 显示性能和格式化

### 原因分析
1. `currentTool.args` 直接用 `JSON.stringify()` 显示，当内容很长时会显示大量内容
2. `\n`、`\t` 等转义字符作为文本显示，没有格式化

### 解决方案
创建格式化函数，限制显示长度并正确处理转义字符。

### 改动文件
- `src/utils/formatToolArgs.ts`（新文件）
- `src/App.tsx`

### 设计详情

```typescript
// src/utils/formatToolArgs.ts

interface FormatOptions {
  maxLength: number      // 单个字段最大长度，默认 100
  maxTotalLength: number // 总显示长度，默认 200
}

export function formatToolArgs(
  args: Record<string, unknown>,
  options: FormatOptions = { maxLength: 100, maxTotalLength: 200 }
): string {
  const entries = Object.entries(args)
  if (entries.length === 0) return ""

  const formatted: string[] = []
  let totalLength = 0

  for (const [key, value] of entries) {
    if (totalLength >= options.maxTotalLength) break

    let display: string
    if (typeof value === 'string') {
      // 处理转义字符：将 \\n 显示为换行预览，\\t 显示为缩进
      // 但由于终端限制，我们用符号表示
      display = value
        .replace(/\n/g, '↵\n')  // 显示换行符
        .replace(/\t/g, '→  ')   // 显示制表符

      // 截断过长内容
      if (display.length > options.maxLength) {
        display = display.slice(0, options.maxLength) + '…'
      }
    } else {
      display = JSON.stringify(value)
      if (display.length > options.maxLength) {
        display = display.slice(0, options.maxLength) + '…'
      }
    }

    const entry = `${key}: ${display}`
    if (totalLength + entry.length <= options.maxTotalLength) {
      formatted.push(entry)
      totalLength += entry.length + 2
    } else {
      break
    }
  }

  let result = formatted.join(', ')
  if (result.length > options.maxTotalLength) {
    result = result.slice(0, options.maxTotalLength - 1) + '…'
  }

  return result
}
```

---

## 问题 1: Skill 工具默认权限

### 原因分析
`policy.ts` 的默认规则中没有为 skill 相关工具设置 `allow` 决策。

### 解决方案
在默认规则中添加 skill 相关工具的允许规则。

### 改动文件
- `src/policy.ts`

### 设计详情

在 `initializeDefaultRules()` 中添加：

```typescript
// Skill 相关工具 - 默认允许
{
  tool: "list_skills",
  decision: "allow",
  description: "列出可用技能",
},
{
  tool: "activate_skill",
  decision: "allow",
  description: "激活技能",
},
{
  tool: "deactivate_skill",
  decision: "allow",
  description: "停用技能",
},
{
  tool: "show_skill",
  decision: "allow",
  description: "显示技能详情",
},
{
  tool: "get_active_skills_prompt",
  decision: "allow",
  description: "获取激活技能的提示",
},
```

---

## 实现顺序

1. **问题 5** - 创建 `src/db.ts`，修改 `store.ts` 和 `session/store.ts`
2. **问题 2** - 修改 `policy.ts`，更新 `App.tsx` 调用
3. **问题 3+4** - 创建 `formatToolArgs.ts`，修改 `App.tsx`
4. **问题 1** - 修改 `policy.ts` 添加默认规则
