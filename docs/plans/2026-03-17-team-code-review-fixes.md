# Team 功能代码审查问题修复计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 Team 功能代码审查发现的 14 个问题，分三批次完成

**Architecture:** 分批次修复（Critical → High → Medium），每批完成后验证构建和测试

**Tech Stack:** TypeScript, Zod, Vitest

---

## Batch 1: Critical（2 个问题）

### Task 1: AgentLLMClient 复用主项目 LLMClient

**Files:**
- Modify: `src/teams/client/llm-client.ts`
- Modify: `src/teams/manager.ts`

**Step 1: 修改 AgentLLMClient 构造函数**

将硬编码的 `createAnthropic` 改为接收外部 LLMClient 实例：

```typescript
// src/teams/client/llm-client.ts
import { LLMClient } from "../../llm.js"

export class AgentLLMClient {
  private llmClient: LLMClient
  private timeout: number
  private temperature: number
  private costController?: CostController
  private blackboard?: SharedBlackboard

  constructor(llmClient: LLMClient, options?: { timeout?: number; temperature?: number }) {
    this.llmClient = llmClient
    this.timeout = options?.timeout || 120000
    this.temperature = options?.temperature ?? 0.2
  }

  // ... 其他方法使用 this.llmClient.chat() 或 this.llmClient.chatStream()
}
```

**Step 2: 修改 TeamManager**

```typescript
// src/teams/manager.ts
import { LLMClient, createLLMClient } from "../../llm.js"

export class TeamManager {
  private config: TeamConfig
  private objective: string
  private llmClient: LLMClient
  private agentLLMClient: AgentLLMClient

  constructor(options: TeamManagerOptions) {
    // 创建主项目 LLMClient（支持多 provider）
    this.llmClient = createLLMClient({
      model: options.model,
      baseURL: options.baseURL,
      // ... 其他配置
    })

    // 传递给 AgentLLMClient
    this.agentLLMClient = new AgentLLMClient(this.llmClient, {
      timeout: options.timeout,
    })
  }
}
```

**Step 3: 运行测试验证**

Run: `npm run build && npm run test`
Expected: PASS

---

### Task 2: WorkerReviewerRunner 空指针风险修复

**Files:**
- Modify: `src/teams/modes/worker-reviewer.ts`

**Step 1: 添加 null 检查**

```typescript
// src/teams/modes/worker-reviewer.ts:92-103

// Max iterations reached without approval
this.state.status = "failed"

if (!currentArtifact) {
  return {
    status: "failed",
    output: createEmptyWorkArtifact(contract.taskId),
    error: `Max iterations (${this.config.maxIterations}) reached without producing any artifact`,
    stats: {
      durationMs: Date.now() - startTime,
      tokensUsed: this.state.tokensUsed,
      iterations: this.config.maxIterations,
    },
  }
}

return {
  status: "failed",
  output: currentArtifact,
  error: `Max iterations (${this.config.maxIterations}) reached without approval`,
  stats: {
    durationMs: Date.now() - startTime,
    tokensUsed: this.state.tokensUsed,
    iterations: this.config.maxIterations,
  },
}
```

**Step 2: 运行测试验证**

Run: `npm run build && npm run test`
Expected: PASS

---

## Batch 2: High（4 个问题）

### Task 3: 统一重复的类型定义

**Files:**
- Modify: `src/teams/core/types.ts` (添加类型)
- Modify: `src/teams/client/llm-client.ts` (删除重复定义，改为 import)
- Modify: `src/teams/modes/worker-reviewer.ts` (删除重复定义，改为 import)

**Step 1: 在 core/types.ts 添加类型**

```typescript
// src/teams/core/types.ts

export interface WorkerOutput {
  summary: string
  changedFiles: string[]
  patchRef: string
  testResults: Array<{ command: string; passed: boolean; output?: string }>
  risks: string[]
  assumptions: string[]
}

export interface ReviewerOutput {
  status: "approved" | "changes_requested"
  severity: "P0" | "P1" | "P2" | "P3"
  mustFix: string[]
  suggestions: string[]
  reviewNotes?: string
}
```

**Step 2: 修改其他文件使用 import**

**Step 3: 运行测试验证**

Run: `npm run build && npm run test`
Expected: PASS

---

### Task 4: JSON 解析使用 Zod Schema 验证

**Files:**
- Modify: `src/teams/client/llm-client.ts`

**Step 1: 使用 Zod schema 验证**

```typescript
import { WorkArtifactSchema, ReviewArtifactSchema } from "../core/contracts.js"

private parseWorkerOutput(content: string): WorkerOutput {
  try {
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/)
    const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : content
    const parsed = JSON.parse(jsonStr.trim())

    // 使用 Zod schema 验证
    const result = WorkArtifactSchema.safeParse({
      taskId: "temp",  // 将由调用方填充
      ...parsed,
    })

    if (result.success) {
      return {
        summary: result.data.summary,
        changedFiles: result.data.changedFiles,
        patchRef: result.data.patchRef,
        testResults: result.data.testResults.map(t => ({
          command: t.command,
          passed: t.passed,
          output: t.outputRef,
        })),
        risks: result.data.risks,
        assumptions: result.data.assumptions,
      }
    }

    // 验证失败，使用 fallback
    return this.createFallbackWorkerOutput(parsed, result.error)
  } catch (error) {
    return this.createErrorWorkerOutput(error, content)
  }
}
```

**Step 2: 运行测试验证**

Run: `npm run build && npm run test`
Expected: PASS

---

### Task 5: LLM 调用添加重试机制

**Files:**
- Modify: `src/teams/client/llm-client.ts`

**Step 1: 添加重试逻辑**

```typescript
private async callLLMWithRetry(
  prompt: string,
  model: string,
  maxRetries: number = 3
): Promise<{ content: string; usage?: { inputTokens: number; outputTokens: number } }> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await this.callLLM(prompt, model)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // 不重试的错误类型（如超时、认证失败）
      if (this.isNonRetryableError(error)) {
        throw error
      }

      // 指数退避等待
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000 // 1s, 2s, 4s
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError
}

private isNonRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes("401") || message.includes("403") || message.includes("timed out")
}
```

**Step 2: 修改 executeWorker 和 executeReviewer 使用 callLLMWithRetry**

**Step 3: 运行测试验证**

Run: `npm run build && npm run test`
Expected: PASS

---

### Task 6: 成本追踪完善

**Files:**
- Modify: `src/teams/client/llm-client.ts`
- Modify: `src/teams/modes/worker-reviewer.ts`
- Modify: `src/teams/core/types.ts`

**Step 1: 添加 token 回调类型**

```typescript
// src/teams/core/types.ts
export interface TokenUsageCallback {
  (usage: { inputTokens: number; outputTokens: number }): void
}
```

**Step 2: AgentLLMClient 支持回调**

```typescript
// src/teams/client/llm-client.ts
export interface AgentLLMConfig {
  onTokenUsage?: TokenUsageCallback
  // ... 其他配置
}

// 在 executeWorker 和 executeReviewer 中调用回调
if (this.config.onTokenUsage && result.usage) {
  this.config.onTokenUsage(result.usage)
}
```

**Step 3: WorkerReviewerRunner 接收回调**

```typescript
// 在 runner 中累积 token 使用
this.state.tokensUsed = { input: 0, output: 0 }

// 传递回调给 AgentLLMClient
const client = new AgentLLMClient(llmClient, {
  onTokenUsage: (usage) => {
    this.state.tokensUsed.input += usage.inputTokens
    this.state.tokensUsed.output += usage.outputTokens
  }
})
```

**Step 4: 运行测试验证**

Run: `npm run build && npm run test`
Expected: PASS

---

## Batch 3: Medium（4 个问题）

### Task 7: TeamManager 添加 dispose 方法

**Files:**
- Modify: `src/teams/manager.ts`

**Step 1: 添加 dispose 方法**

```typescript
export class TeamManager {
  // ... 现有代码

  /**
   * 清理资源
   */
  async dispose(): Promise<void> {
    // 清理 LLM client 资源
    if (this.llmClient) {
      this.llmClient.abort()
    }
  }
}
```

**Step 2: 运行测试验证**

Run: `npm run build && npm run test`
Expected: PASS

---

### Task 8: WorktreeIsolation 事务性创建

**Files:**
- Modify: `src/teams/isolation/worktree-isolation.ts`

**Step 1: 添加事务性创建**

```typescript
async createWorkerWorktrees(count: number): Promise<WorktreeHandle[]> {
  const handles: WorktreeHandle[] = []

  try {
    for (let i = 0; i < count; i++) {
      const workerId = `worker-${i}`
      const handle = await this.createWorkerWorktree(workerId)
      handles.push(handle)
    }
    return handles
  } catch (error) {
    // 回滚已创建的 worktrees
    await Promise.all(
      handles.map(handle => handle.cleanup().catch(() => {}))
    )
    throw error
  }
}
```

**Step 2: 运行测试验证**

Run: `npm run build && npm run test`
Expected: PASS

---

### Task 9: Manager 使用可配置默认模型

**Files:**
- Modify: `src/teams/manager.ts`

**Step 1: 使用 provider registry 获取默认模型**

```typescript
import { getBuiltinProvider, BUILTIN_PROVIDERS } from "../../providers/registry.js"

constructor(options: TeamManagerOptions) {
  // 使用 provider registry 的默认模型
  const defaultProvider = getBuiltinProvider("anthropic")
  const defaultModel = defaultProvider?.defaultModel || "claude-sonnet-4-6"

  this.llmClient = createLLMClient({
    model: options.model || process.env.ANTHROPIC_MODEL || defaultModel,
    // ...
  })
}
```

**Step 2: 运行测试验证**

Run: `npm run build && npm run test`
Expected: PASS

---

### Task 10: 统一错误处理

**Files:**
- Modify: `src/teams/client/llm-client.ts`
- Modify: `src/teams/isolation/worktree-isolation.ts`

**Step 1: 使用 getErrorMessage 工具函数**

```typescript
import { getErrorMessage } from "../../utils/error.js"

// 替换所有 String(error) 为 getErrorMessage(error)
// 替换所有 error.message 为 getErrorMessage(error)
```

**Step 2: 运行测试验证**

Run: `npm run build && npm run test`
Expected: PASS

---

## 验证清单

每批次完成后：
- [ ] `npm run build` 成功
- [ ] `npm run test` 通过（忽略 keyring 相关测试）
- [ ] 代码审查确认修改正确

最终验证：
- [ ] 所有 14 个问题已修复
- [ ] 无新增 TypeScript 错误
- [ ] 测试覆盖率不降低
