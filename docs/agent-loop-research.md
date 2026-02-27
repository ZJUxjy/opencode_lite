# Agent 运行循环调研报告

> 调研对象：kimi-cli、kilocode、gemini-cli
> 调研目的：了解业界成熟的 Agent 运行循环实现方式，为 Lite-OpenCode 的 ReAct 系统提供参考

---

## 目录

1. [概述](#1-概述)
2. [Kimi-CLI 实现](#2-kimi-cli-实现)
3. [Kilocode 实现](#3-kilocode-实现)
4. [Gemini-CLI 实现](#4-gemini-cli-实现)
5. [对比分析](#5-对比分析)
6. [最佳实践总结](#6-最佳实践总结)
7. [ReAct 系统设计建议](#7-react-系统设计建议)

---

## 1. 概述

### 1.1 什么是 Agent 运行循环

Agent 运行循环是 AI Agent 的核心机制，遵循 **ReAct 模式**（Reasoning + Acting）：

```
┌─────────────────────────────────────────┐
│            Agent Loop                    │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────┐                            │
│  │ 用户输入 │                            │
│  └────┬────┘                            │
│       │                                 │
│       ▼                                 │
│  ┌─────────┐                            │
│  │ 调用 LLM │◄─────────────┐            │
│  └────┬────┘              │            │
│       │                   │            │
│       ▼                   │            │
│  ┌─────────┐              │            │
│  │有工具调用?│              │            │
│  └────┬────┘              │            │
│       │                   │            │
│   是  │     否            │            │
│       ▼       ┌───────────┘            │
│  ┌─────────┐  │                        │
│  │ 执行工具 │  │                        │
│  └────┬────┘  │                        │
│       │       │                        │
│       ▼       │                        │
│  ┌─────────┐  │                        │
│  │收集结果  │──┘                        │
│  └─────────┘                            │
│                                         │
└─────────────────────────────────────────┘
```

### 1.2 调研对象简介

| 项目 | 语言 | 特点 |
|------|------|------|
| **Kimi-CLI** | Python | 月之暗面官方 CLI，支持 Time Travel、实时指令注入 |
| **Kilocode** | TypeScript | 基于 Vercel AI SDK，强类型、插件系统完善 |
| **Gemini-CLI** | TypeScript | Google 官方 CLI，三层循环检测、模块化 Prompt、策略引擎 |

---

## 2. Kimi-CLI 实现

### 2.1 架构概览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Kimi-CLI 架构                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐         │
│   │   CLI   │────▶│  Wire   │◀────│  Soul   │────▶│ Toolset │         │
│   │  / Web  │     │ Protocol│     │  Agent  │     │  Tools  │         │
│   └─────────┘     └─────────┘     └─────────┘     └─────────┘         │
│        │               │               │               │               │
│        └───────────────┴───────────────┴───────────────┘               │
│                              │                                          │
│                        ┌─────▼─────┐                                    │
│                        │  Context  │  ← Checkpoint + Revert             │
│                        │  (File)   │                                    │
│                        └───────────┘                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

**核心组件**：
- **Soul**：Agent 逻辑核心，负责决策和执行
- **Wire**：SPMC（单生产者多消费者）通信协议
- **Toolset**：工具注册和执行管理
- **Context**：消息历史和状态持久化

### 2.2 主循环实现

**文件**：`/home/xjingyao/code/kimi-cli/src/kimi_cli/soul/kimisoul.py`

```python
async def _agent_loop(self) -> TurnOutcome:
    # 1. 清理过期的 steer 消息
    while not self._steer_queue.empty():
        self._steer_queue.get_nowait()

    # 2. 等待 MCP 工具加载完成
    if isinstance(self._agent.toolset, KimiToolset):
        await self._agent.toolset.wait_for_mcp_tools()

    step_no = 0
    while True:
        step_no += 1

        # 3. 检查最大步数限制
        if step_no > self._loop_control.max_steps_per_turn:
            raise MaxStepsReached(self._loop_control.max_steps_per_turn)

        # 4. 发送步骤开始事件
        wire_send(StepBegin(n=step_no))

        try:
            # 5. 上下文压缩检查
            reserved = self._loop_control.reserved_context_size
            if self._context.token_count + reserved >= self._runtime.llm.max_context_size:
                await self.compact_context()

            # 6. 保存检查点
            await self._checkpoint()

            # 7. 执行单步
            step_outcome = await self._step()

        except BackToTheFuture as e:
            # 8. Time Travel：回滚到指定检查点
            await self._context.revert_to(e.checkpoint_id)
            await self._checkpoint()
            await self._context.append_message(e.messages)
            continue

        # 9. 处理步进结果
        if step_outcome is not None:
            has_steers = await self._consume_pending_steers()

            # 无工具调用且没有新指令，结束
            if step_outcome.stop_reason == "no_tool_calls" and not has_steers:
                return TurnOutcome(
                    assistant_message=step_outcome.assistant_message
                )

            # 有新指令注入，继续循环
            if has_steers:
                continue
```

### 2.3 单步执行

```python
async def _step(self) -> StepOutcome | None:
    chat_provider = self._runtime.llm.chat_provider

    @tenacity.retry(
        retry=retry_if_exception(self._is_retryable_error),
        wait=wait_exponential_jitter(initial=0.3, max=5, jitter=0.5),
        stop=stop_after_attempt(self._loop_control.max_retries_per_step),
    )
    async def _kosong_step_with_retry() -> StepResult:
        return await self._run_with_connection_recovery(
            "step",
            _run_step_once,
            chat_provider=chat_provider,
        )

    result = await _kosong_step_with_retry()

    # 发送 token 使用状态
    wire_send(StatusUpdate(token_usage=result.usage, message_id=result.id))

    # 等待所有工具执行完成
    results = await result.tool_results()

    # 更新上下文（使用 shield 防止中断）
    await asyncio.shield(self._grow_context(result, results))

    # 检查工具是否被拒绝
    rejected = any(isinstance(r.return_value, ToolRejectedError) for r in results)
    if rejected:
        return StepOutcome(stop_reason="tool_rejected", ...)

    # 有工具调用则返回 None，继续循环
    if result.tool_calls:
        return None

    return StepOutcome(stop_reason="no_tool_calls", ...)
```

### 2.4 工具执行

**文件**：`/home/xjingyao/code/kimi-cli/src/kimi_cli/soul/toolset.py`

```python
class KimiToolset:
    def handle(self, tool_call: ToolCall) -> HandleResult:
        token = current_tool_call.set(tool_call)
        try:
            # 1. 检查工具是否存在
            if tool_call.function.name not in self._tool_dict:
                return ToolResult(
                    tool_call_id=tool_call.id,
                    return_value=ToolNotFoundError(tool_call.function.name),
                )

            tool = self._tool_dict[tool_call.function.name]

            # 2. 解析参数
            try:
                arguments: JsonType = json.loads(tool_call.function.arguments or "{}")
            except json.JSONDecodeError as e:
                return ToolResult(
                    tool_call_id=tool_call.id,
                    return_value=ToolParseError(str(e))
                )

            # 3. 异步执行工具
            async def _call():
                try:
                    ret = await tool.call(arguments)
                    return ToolResult(tool_call_id=tool_call.id, return_value=ret)
                except Exception as e:
                    return ToolResult(
                        tool_call_id=tool_call.id,
                        return_value=ToolRuntimeError(str(e))
                    )

            return asyncio.create_task(_call())
        finally:
            current_tool_call.reset(token)
```

### 2.5 Wire 协议

Wire 是一个 SPMC（单生产者多消费者）通道：

```python
class Wire:
    def __init__(self, *, file_backend: WireFile | None = None):
        self._raw_queue = WireMessageQueue()
        self._merged_queue = WireMessageQueue()
        self._soul_side = WireSoulSide(self._raw_queue, self._merged_queue)

class WireSoulSide:
    def send(self, msg: WireMessage) -> None:
        # 发送原始消息
        self._raw_queue.publish_nowait(msg)

        # 合并消息（用于流式输出优化）
        match msg:
            case MergeableMixin():
                if self._merge_buffer is None:
                    self._merge_buffer = copy.deepcopy(msg)
                elif self._merge_buffer.merge_in_place(msg):
                    pass  # 合并成功
                else:
                    self.flush()
                    self._merge_buffer = copy.deepcopy(msg)
```

### 2.6 特色功能

#### 2.6.1 Time Travel（时间旅行）

通过 `BackToTheFuture` 异常实现回滚：

```python
class BackToTheFuture(Exception):
    def __init__(self, checkpoint_id: int, messages: Sequence[Message]):
        self.checkpoint_id = checkpoint_id
        self.messages = messages

# 使用方式
if dmail := self._denwa_renji.fetch_pending_dmail():
    raise BackToTheFuture(dmail.checkpoint_id, [...])
```

#### 2.6.2 实时指令注入（Steer）

在 Agent 运行过程中注入用户指令：

```python
async def _inject_steer(self, content: str | list[ContentPart]) -> None:
    steer_id = f"steer_{uuid4().hex[:8]}"
    await self._context.append_message([
        Message(role="assistant", content=[], tool_calls=[...]),
        Message(role="tool", content=[
            system(f"The user has sent a real-time instruction: {content}")
        ])
    ])
```

#### 2.6.3 Ralph Loop（自动迭代）

重复运行同一提示直到 Agent 决定停止：

```python
@staticmethod
def ralph_loop(user_message: Message, max_ralph_iterations: int) -> FlowRunner:
    total_runs = max_ralph_iterations + 1
    if max_ralph_iterations < 0:
        total_runs = 1000000000000000  # 实际上无限
```

---

## 3. Kilocode 实现

### 3.1 架构概览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Kilocode 架构                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐         │
│   │   TUI   │────▶│   Bus   │◀────│Processor│────▶│   LLM   │         │
│   │  / ACP  │     │ Events  │     │  Loop   │     │ Stream  │         │
│   └─────────┘     └─────────┘     └─────────┘     └─────────┘         │
│        │               │               │               │               │
│        │         ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐         │
│        │         │  Message  │   │  Session  │   │   Tools   │         │
│        │         │  (Zod)    │   │ (SQLite)  │   │ Registry  │         │
│        │         └───────────┘   └───────────┘   └───────────┘         │
│        │                                                           │     │
│        │                     ┌───────────┐                          │     │
│        └────────────────────▶│  Plugin   │                          │     │
│                              │  System   │                          │     │
│                              └───────────┘                          │     │
└─────────────────────────────────────────────────────────────────────────┘
```

**核心组件**：
- **Processor**：处理 LLM 流式响应
- **Bus**：事件发布/订阅系统
- **Session**：会话状态管理（SQLite）
- **Plugin**：插件扩展系统

### 3.2 主循环实现

**文件**：`/home/xjingyao/code/kilocode/packages/opencode/src/session/prompt.ts`

```typescript
export const loop = fn(LoopInput, async (input) => {
  const { sessionID, resume_existing } = input

  let step = 0
  const session = await Session.get(sessionID)

  while (true) {
    // 1. 更新会话状态
    SessionStatus.set(sessionID, { type: "busy" })

    // 2. 检查中断信号
    if (abort.aborted) {
      closeReason = "interrupted"
      break
    }

    // 3. 获取消息历史
    let msgs = await MessageV2.filterCompacted(MessageV2.stream(sessionID))

    // 4. 检查是否应该结束
    if (lastAssistant?.finish &&
        !["tool-calls", "unknown"].includes(lastAssistant.finish) &&
        lastUser.id < lastAssistant.id) {
      log.info("exiting loop", { sessionID })
      break
    }

    step++

    // 5. 创建处理器
    const processor = SessionProcessor.create({
      assistantMessage,
      sessionID,
      model,
      abort,
    })

    // 6. 处理 LLM 流
    const result = await processor.process({
      messages: msgs,
      tools: toolsArray,
      system: systemPrompt,
    })

    // 7. 根据结果决定下一步
    if (result === "stop") break
    if (result === "compact") {
      await SessionCompaction.create({
        sessionID,
        agent: lastUser.agent,
        model: lastUser.model,
        auto: true,
      })
    }
    continue
  }
})
```

### 3.3 处理器实现

**文件**：`/home/xjingyao/code/kilocode/packages/opencode/src/session/processor.ts`

```typescript
export function create(input: {
  assistantMessage: MessageV2.Assistant
  sessionID: string
  model: Provider.Model
  abort: AbortSignal
}) {
  const toolcalls: Record<string, MessageV2.ToolPart> = {}
  let blocked = false

  return {
    async process(streamInput: LLM.StreamInput) {
      while (true) {  // 内层循环处理重试
        try {
          const stream = await LLM.stream(streamInput)

          for await (const value of stream.fullStream) {
            switch (value.type) {
              case "tool-call": { /* ... */ }
              case "tool-result": { /* ... */ }
              case "tool-error": { /* ... */ }
              case "text-start": { /* ... */ }
              case "text-delta": { /* ... */ }
              case "reasoning-start": { /* ... */ }
              case "reasoning-delta": { /* ... */ }
              case "finish-step": { /* ... */ }
            }
          }
        } catch (e) {
          // 检查是否可重试
          const retry = SessionRetry.retryable(error)
          if (retry !== undefined) {
            attempt++
            const delay = SessionRetry.delay(attempt, error)
            await SessionRetry.sleep(delay, input.abort)
            continue  // 重试
          }
          // 不可重试的错误
        }

        // 返回循环状态
        if (needsCompaction) return "compact"
        if (blocked) return "stop"
        if (input.assistantMessage.error) return "stop"
        return "continue"
      }
    }
  }
}
```

### 3.4 工具调用处理

```typescript
case "tool-call": {
  const match = toolcalls[value.toolCallId]
  if (match) {
    // 更新工具状态为 running
    const part = await Session.updatePart({
      ...match,
      tool: value.toolName,
      state: {
        status: "running",
        input: value.input,
        time: { start: Date.now() },
      },
      metadata: value.providerMetadata,
    })

    // 🚨 Doom Loop 检测
    const parts = await MessageV2.parts(input.assistantMessage.id)
    const lastThree = parts.slice(-DOOM_LOOP_THRESHOLD)  // 3

    if (lastThree.length === DOOM_LOOP_THRESHOLD &&
        lastThree.every(p =>
          p.type === "tool" &&
          p.tool === value.toolName &&
          p.state.status !== "pending" &&
          JSON.stringify(p.state.input) === JSON.stringify(value.input)
        )) {
      // 检测到死循环，请求用户确认
      await PermissionNext.ask({
        permission: "doom_loop",
        patterns: [value.toolName],
        sessionID: input.assistantMessage.sessionID,
        metadata: { tool: value.toolName, input: value.input },
        always: [value.toolName],
        ruleset: agent.permission,
      })
    }
  }
  break
}

case "tool-result": {
  const match = toolcalls[value.toolCallId]
  if (match && match.state.status === "running") {
    await Session.updatePart({
      ...match,
      state: {
        status: "completed",
        input: value.input ?? match.state.input,
        output: value.output.output,
        metadata: value.output.metadata,
        title: value.output.title,
        time: {
          start: match.state.time.start,
          end: Date.now(),
        },
        attachments: value.output.attachments,
      },
    })
    delete toolcalls[value.toolCallId]
  }
  break
}

case "tool-error": {
  const match = toolcalls[value.toolCallId]
  if (match && match.state.status === "running") {
    await Session.updatePart({
      ...match,
      state: {
        status: "error",
        input: value.input ?? match.state.input,
        error: (value.error as any).toString(),
        time: {
          start: match.state.time.start,
          end: Date.now(),
        },
      },
    })

    // 检查是否应该中断
    if (value.error instanceof PermissionNext.RejectedError ||
        value.error instanceof Question.RejectedError) {
      blocked = shouldBreak
    }
    delete toolcalls[value.toolCallId]
  }
  break
}
```

### 3.5 流式文本处理

```typescript
case "text-start": {
  currentText = {
    id: Identifier.ascending("part"),
    messageID: input.assistantMessage.id,
    sessionID: input.assistantMessage.sessionID,
    type: "text",
    text: "",
    time: { start: Date.now() },
    metadata: value.providerMetadata,
  }
  await Session.updatePart(currentText)
  break
}

case "text-delta": {
  if (currentText) {
    currentText.text += value.text
    if (value.providerMetadata) currentText.metadata = value.providerMetadata

    // 只发送增量
    await Session.updatePartDelta({
      sessionID: currentText.sessionID,
      messageID: currentText.messageID,
      partID: currentText.id,
      field: "text",
      delta: value.text,
    })
  }
  break
}

case "text-end": {
  if (currentText) {
    currentText.text = currentText.text.trimEnd()
    currentText.time = { start: Date.now(), end: Date.now() }
    await Session.updatePart(currentText)
  }
  currentText = undefined
  break
}
```

### 3.6 Reasoning（思考过程）支持

```typescript
case "reasoning-start": {
  if (value.id in reasoningMap) continue
  const reasoningPart = {
    id: Identifier.ascending("part"),
    messageID: input.assistantMessage.id,
    sessionID: input.assistantMessage.sessionID,
    type: "reasoning" as const,
    text: "",
    time: { start: Date.now() },
    metadata: value.providerMetadata,
  }
  reasoningMap[value.id] = reasoningPart
  await Session.updatePart(reasoningPart)
  break
}

case "reasoning-delta": {
  if (value.id in reasoningMap) {
    const part = reasoningMap[value.id]
    part.text += value.text
    if (value.providerMetadata) part.metadata = value.providerMetadata
    await Session.updatePartDelta({
      sessionID: part.sessionID,
      messageID: part.messageID,
      partID: part.id,
      field: "text",
      delta: value.text,
    })
  }
  break
}
```

### 3.7 事件 Bus 系统

**文件**：`/home/xjingyao/code/kilocode/packages/opencode/src/bus/index.ts`

```typescript
export namespace Bus {
  const state = Instance.state(() => {
    const subscriptions = new Map<any, Subscription[]>()
    return { subscriptions }
  })

  export async function publish<Definition extends BusEvent.Definition>(
    def: Definition,
    properties: z.output<Definition["properties"]>,
  ) {
    const payload = { type: def.type, properties }
    for (const key of [def.type, "*"]) {
      const match = state().subscriptions.get(key)
      for (const sub of match ?? []) {
        pending.push(sub(payload))
      }
    }
    return Promise.all(pending)
  }

  export function subscribe<Definition extends BusEvent.Definition>(
    def: Definition,
    callback: (event: any) => void,
  ) {
    const subscriptions = state().subscriptions
    let match = subscriptions.get(type) ?? []
    match.push(callback)
    subscriptions.set(type, match)

    // 返回取消订阅函数
    return () => {
      const match = subscriptions.get(type)
      if (!match) return
      const index = match.indexOf(callback)
      if (index !== -1) match.splice(index, 1)
    }
  }
}
```

### 3.8 重试机制

**文件**：`/home/xjingyao/code/kilocode/packages/opencode/src/session/retry.ts`

```typescript
const RETRY_INITIAL_DELAY = 1000
const RETRY_BACKOFF_FACTOR = 2
const RETRY_MAX_DELAY_NO_HEADERS = 30000

export function retryable(error: MessageV2.APIError): undefined | "retry" {
  // 429 Too Many Requests
  if (error.data?.statusCode === 429) return "retry"

  // 5xx Server Error
  if (error.data?.statusCode && error.data.statusCode >= 500) return "retry"

  // Connection errors
  if (error.message?.includes("ECONNRESET")) return "retry"
  if (error.message?.includes("ETIMEDOUT")) return "retry"

  return undefined
}

export function delay(attempt: number, error?: MessageV2.APIError) {
  // 优先使用服务器返回的 Retry-After 头
  if (error?.data?.responseHeaders) {
    const retryAfterMs = error.data.responseHeaders["retry-after-ms"]
    if (retryAfterMs) return Number.parseFloat(retryAfterMs)

    const retryAfter = error.data.responseHeaders["retry-after"]
    if (retryAfter) {
      return Number.parseFloat(retryAfter) * 1000
    }
  }

  // 指数退避
  return Math.min(
    RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1),
    RETRY_MAX_DELAY_NO_HEADERS
  )
}
```

### 3.9 Snapshot 追踪

追踪每一步的文件变更：

```typescript
case "start-step": {
  stepStart = performance.now()
  snapshot = await Snapshot.track()  // 记录当前文件状态
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: input.assistantMessage.id,
    sessionID: input.sessionID,
    snapshot,
    type: "step-start",
  })
  break
}

case "finish-step": {
  const patch = await Snapshot.patch(snapshot)  // 计算差异
  if (patch.files.length) {
    await Session.updatePart({
      type: "patch",
      hash: patch.hash,
      files: patch.files,  // 变更的文件列表
    })
  }
  break
}
```

---

## 4. Gemini-CLI 实现

### 4.1 架构概览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Gemini-CLI 架构                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐             │
│   │   CLI   │────▶│ Session │────▶│ Client  │────▶│   LLM   │             │
│   │   TUI   │     │ Manager │     │ (Turn)  │     │ Stream  │             │
│   └─────────┘     └─────────┘     └─────────┘     └─────────┘             │
│        │               │               │               │                   │
│        │         ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐             │
│        │         │  Policy   │   │ Scheduler │   │   Tools   │             │
│        │         │  Engine   │   │ (Queue)   │   │ Registry  │             │
│        │         └───────────┘   └───────────┘   └───────────┘             │
│        │                                   │                                 │
│        │                           ┌───────▼───────┐                        │
│        │                           │ LoopDetection │                        │
│        │                           │   Service     │                        │
│        │                           └───────────────┘                        │
│        │                                   │                                 │
│        │                           ┌───────▼───────┐                        │
│        └──────────────────────────▶│   Prompts     │                        │
│                                    │  (Modular)    │                        │
│                                    └───────────────┘                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

**核心组件**：
- **Client/Turn**：LLM 调用和流处理
- **Scheduler**：工具执行调度器（事件驱动）
- **Policy Engine**：权限决策引擎（ALLOW/DENY/ASK_USER）
- **LoopDetection**：三层循环检测服务
- **Prompts**：模块化 Prompt 组装系统

### 4.2 主循环实现

**核心文件**：`packages/core/src/core/client.ts` 和 `packages/sdk/src/session.ts`

```typescript
// 主循环结构 (session.ts)
async *sendMessageStream(
  request: PartListUnion,
  signal: AbortSignal,
  prompt_id: string,
  turns: number = MAX_TURNS,  // 100 turns max
): AsyncGenerator<ServerGeminiStreamEvent, Turn> {
  while (true) {
    // 1. 动态更新系统指令（支持函数式）
    if (typeof this.instructions === 'function') {
      const newInstructions = await this.instructions(context);
      this.config.setUserMemory(newInstructions);
      client.updateSystemInstruction();
    }

    // 2. 发送消息到 LLM
    const stream = client.sendMessageStream(request, abortSignal, sessionId);

    // 3. 收集工具调用
    const toolCallsToSchedule: ToolCallRequestInfo[] = [];
    for await (const event of stream) {
      yield event;
      if (event.type === GeminiEventType.ToolCallRequest) {
        toolCallsToSchedule.push(event.value);
      }
    }

    // 4. 无工具调用则结束
    if (toolCallsToSchedule.length === 0) {
      break;
    }

    // 5. 执行工具
    const completedCalls = await scheduleAgentTools(
      this.config,
      toolCallsToSchedule,
      { schedulerId: sessionId, toolRegistry: scopedRegistry, signal: abortSignal },
    );

    // 6. 准备下一轮的 function responses
    const functionResponses = completedCalls.flatMap(
      (call) => call.response.responseParts,
    );
    request = functionResponses as unknown as Parameters<GeminiClient['sendMessageStream']>[0];
  }
}
```

**循环保护机制**：
- `MAX_TURNS = 100` 硬性上限
- `maxSessionTurns` 可配置限制
- Grace period（宽限期）用于优雅终止

### 4.3 三层循环检测机制 🌟

**核心文件**：`packages/core/src/services/loopDetectionService.ts`

Gemini CLI 实现了业界最完善的循环检测系统：

```typescript
class LoopDetectionService {
  // 第一层：工具调用循环检测
  private checkToolCallLoop(toolCall: { name: string; args: object }): boolean {
    // 使用 SHA-256 哈希生成唯一标识
    const key = this.getToolCallKey(toolCall);

    if (this.lastToolCallKey === key) {
      this.toolCallRepetitionCount++;
    } else {
      this.lastToolCallKey = key;
      this.toolCallRepetitionCount = 1;
    }

    // 连续 5 次相同调用视为循环
    return this.toolCallRepetitionCount >= TOOL_CALL_LOOP_THRESHOLD;  // 5
  }

  // 第二层：内容重复检测（滑动窗口）
  private checkContentLoop(content: string): boolean {
    // 50字符滑动窗口
    // 基于哈希的高效比较
    // 跳过代码块避免误报
    const windowSize = 50;
    const chunks = this.splitIntoChunks(content, windowSize);
    const hashes = chunks.map(c => this.hash(c));

    // 检测连续重复的哈希值
    for (let i = 0; i < hashes.length - 2; i++) {
      if (hashes[i] === hashes[i + 1] && hashes[i] === hashes[i + 2]) {
        return true;
      }
    }
    return false;
  }

  // 第三层：LLM 辅助判断（30轮后触发）
  private async checkForLoopWithLLM(signal: AbortSignal): Promise<boolean> {
    // 只在对话超过 30 轮后触发
    if (this.turnCount < 30) return false;

    // 使用快速模型分析对话
    const result = await generateText({
      model: fastModel,
      messages: [{
        role: "user",
        content: `Analyze this conversation for signs of being stuck in a loop.
                  Look for: repetitive tool calls, circular reasoning, stuck state.

                  Conversation: ${this.getRecentHistory()}

                  Is this a loop? (confidence 0-1)`
      }],
    });

    // 双模型验证提高置信度
    const confidence = parseFloat(result.text);
    return confidence >= 0.9;  // 90% 置信度阈值
  }
}
```

**三层检测的设计智慧**：

| 层级 | 检测方式 | 触发条件 | 特点 |
|------|----------|----------|------|
| 第一层 | 工具调用哈希 | 实时检测 | 快速、确定性强 |
| 第二层 | 内容滑动窗口 | 实时检测 | 捕获重复文本输出 |
| 第三层 | LLM 分析 | 30轮后 | 处理复杂场景，成本高 |

### 4.4 模块化 Prompt 系统

**核心文件**：`packages/core/src/prompts/promptProvider.ts` 和 `snippets.ts`

```typescript
interface SystemPromptOptions {
  preamble?: PreambleOptions;              // 基本角色定义
  coreMandates?: CoreMandatesOptions;     // 核心指令
  subAgents?: SubAgentOptions[];          // 可用的子代理
  agentSkills?: AgentSkillOptions[];      // 动态加载的技能
  hookContext?: boolean;                   // Hook系统集成
  primaryWorkflows?: PrimaryWorkflowsOptions;   // 主要工作流
  planningWorkflow?: PlanningWorkflowOptions;   // 规划模式
  operationalGuidelines?: OperationalGuidelinesOptions; // 最佳实践
  sandbox?: SandboxMode;                   // 安全上下文
  gitRepo?: GitRepoOptions;               // Git集成
}

// Prompt 组装示例
function buildSystemPrompt(options: SystemPromptOptions): string {
  const sections: string[] = [];

  if (options.preamble) {
    sections.push(buildPreamble(options.preamble));
  }

  if (options.coreMandates) {
    sections.push(buildCoreMandates(options.coreMandates));
  }

  // 动态加载技能
  if (options.agentSkills) {
    for (const skill of options.agentSkills) {
      sections.push(loadSkillPrompt(skill));
    }
  }

  // 上下文优先级
  sections.push(buildContextPrecedence());

  return sections.join('\n\n');
}
```

**Prompt 模块说明**：

| 模块 | 用途 | 动态性 |
|------|------|--------|
| Preamble | AI 角色定义 | 静态 |
| Core Mandates | 核心行为指令 | 半静态 |
| Sub-Agents | 可调用的子代理列表 | 动态发现 |
| Agent Skills | 从 `.gemini/skills/` 加载 | 完全动态 |
| Operational Guidelines | 效率和最佳实践 | 静态 |
| Git Context | Git 仓库信息 | 动态检测 |

### 4.5 策略引擎与权限控制

**工具生命周期状态**：

```typescript
enum CoreToolCallStatus {
  Validating,          // 初始验证
  AwaitingApproval,    // 等待用户确认
  Scheduled,           // 准备执行
  Executing,           // 执行中
  Success,             // 成功完成
  Error,               // 失败
  Cancelled,           // 用户取消
}
```

**三级权限决策**：

```typescript
type PolicyDecision = 'ALLOW' | 'DENY' | 'ASK_USER';

class PolicyEngine {
  // 检查工具调用权限
  checkPermission(tool: string, args: object): PolicyDecision {
    // 1. 检查硬编码规则
    const hardCoded = this.hardCodedRules.get(tool);
    if (hardCoded) return hardCoded;

    // 2. 检查用户学习的规则
    const learned = this.learnedRules.get(this.hashRule(tool, args));
    if (learned) return learned;

    // 3. 默认询问用户
    return 'ASK_USER';
  }

  // 从用户决策中学习
  learnFromDecision(tool: string, args: object, userDecision: boolean): void {
    const key = this.hashRule(tool, args);
    this.learnedRules.set(key, userDecision ? 'ALLOW' : 'DENY');
    this.saveRules();
  }
}
```

### 4.6 工具执行调度器

**核心文件**：`packages/core/src/scheduler/scheduler.ts`

```typescript
class Scheduler {
  private async _processQueue(signal: AbortSignal): Promise<void> {
    while (this.state.queueLength > 0 || this.state.isActive) {
      const shouldContinue = await this._processNextItem(signal);
      if (!shouldContinue) break;
    }
  }

  private async _processNextItem(signal: AbortSignal): Promise<boolean> {
    const item = this.state.queue.pop();
    if (!item) return false;

    // 1. 策略检查
    const decision = this.policyEngine.checkPermission(item.tool, item.args);

    switch (decision) {
      case 'DENY':
        item.reject(new PermissionDeniedError());
        return true;

      case 'ASK_USER':
        const userChoice = await this.askUserConfirmation(item);
        if (!userChoice.approved) {
          item.reject(new UserRejectedError());
          return true;
        }
        // 用户选择"总是允许"时学习
        if (userChoice.always) {
          this.policyEngine.learnFromDecision(item.tool, item.args, true);
        }
        break;

      case 'ALLOW':
        // 直接执行
        break;
    }

    // 2. 执行工具
    try {
      item.state = CoreToolCallStatus.Executing;
      const result = await this.toolRegistry.execute(item.tool, item.args);
      item.resolve(result);
    } catch (error) {
      item.reject(error);
    }

    return true;
  }
}
```

### 4.7 上下文管理

| 服务 | 功能 | 触发条件 |
|------|------|----------|
| ChatCompressionService | 压缩旧对话 | 接近 token 限制时 |
| ToolOutputMaskingService | 屏蔽冗长输出 | 工具输出超过阈值时 |
| NextSpeakerChecker | 判断是否继续 | 模型返回不明确时 |

**NextSpeakerChecker 示例**：

```typescript
export async function checkNextSpeaker(
  chat: GeminiChat,
  baseLlmClient: BaseLlmClient,
  abortSignal: AbortSignal,
): Promise<NextSpeakerResponse | null> {
  // 使用 LLM 判断模型是否应该继续
  const result = await generateText({
    model: fastModel,
    messages: [{
      role: "user",
      content: `Analyze the last assistant response.
                Should the assistant continue?
                - explicit_next_action: if there's a clear next step
                - question_to_user: if waiting for user input
                - waiting: if the response is complete`
    }],
  });

  return parseNextSpeakerResponse(result.text);
}
```

### 4.8 子代理架构

**核心文件**：`packages/core/src/agents/local-executor.ts`

```typescript
export class LocalAgentExecutor<TOutput extends z.ZodTypeAny> {
  readonly definition: LocalAgentDefinition<TOutput>;

  async run(
    inputs: AgentInputs,
    signal: AbortSignal,
  ): Promise<OutputObject<z.infer<TOutput>>> {
    // 1. 创建隔离的工具注册表
    const scopedRegistry = new ToolRegistry();
    this.registerTools(scopedRegistry);

    // 2. 必须包含 complete_task 工具
    scopedRegistry.registerTool({
      name: 'complete_task',
      description: 'Call when the task is complete',
      parameters: z.object({
        output: this.definition.outputSchema,
      }),
      execute: (args) => {
        this.result = args.output;
      },
    });

    // 3. 运行子代理循环
    let turns = 0;
    while (turns < this.definition.maxTurns) {
      turns++;

      const stream = this.client.sendMessageStream(
        this.buildMessages(),
        signal,
        `subagent_${turns}`,
        1,  // 单轮
      );

      for await (const event of stream) {
        // 处理事件
      }

      if (this.result) break;
    }

    return this.result;
  }
}
```

---

## 5. 对比分析

### 5.1 循环结构对比

| 特性 | Kimi-CLI | Kilocode | Gemini-CLI |
|------|----------|----------|------------|
| **循环模式** | `while True` + 异常控制 | `while(true)` + break 条件 | `while(true)` + yield 流 |
| **结束条件** | `stop_reason == "no_tool_calls"` | `finish` 字段检测 | 无工具调用时 break |
| **最大步数** | `max_steps_per_turn` 配置 | 动态检测 | `MAX_TURNS = 100` |
| **语言** | Python (asyncio) | TypeScript | TypeScript |

### 5.2 工具处理对比

| 特性 | Kimi-CLI | Kilocode | Gemini-CLI |
|------|----------|----------|------------|
| **工具执行** | `KimiToolset.handle()` | AI SDK 内置 | Scheduler 调度器 |
| **权限控制** | `ApprovalRequest` 异步等待 | `PermissionNext.ask()` | 三级策略引擎 |
| **Doom Loop 检测** | ❌ | ✅ 自动检测 | ✅ 三层检测 |
| **并行执行** | ✅ `asyncio.create_task` | ✅ AI SDK 自动 | ✅ 队列调度 |
| **策略学习** | ❌ | ❌ | ✅ 从决策学习 |

### 5.3 消息管理对比

| 特性 | Kimi-CLI | Kilocode | Gemini-CLI |
|------|----------|----------|------------|
| **存储** | 文件 + 内存 | SQLite 数据库 | 内存 + 可选持久化 |
| **类型系统** | Python dataclass | Zod 强类型 | Zod 强类型 |
| **事件通信** | Wire Protocol | Bus 事件系统 | AsyncGenerator 流 |
| **压缩策略** | 手动触发 | 自动压缩 | 自动压缩 + 屏蔽 |

### 5.4 流式处理对比

| 特性 | Kimi-CLI | Kilocode | Gemini-CLI |
|------|----------|----------|------------|
| **底层 SDK** | 自研 kosong | Vercel AI SDK | Google GenAI SDK |
| **Delta 合并** | `MergeableMixin` | 直接 publish | 直接 yield |
| **Reasoning** | ❌ | ✅ 支持 | ✅ 支持 |

### 5.5 特色功能对比

| 功能 | Kimi-CLI | Kilocode | Gemini-CLI |
|------|----------|----------|------------|
| **Time Travel** | ✅ `BackToTheFuture` | ❌ | ❌ |
| **实时指令注入** | ✅ `Steer` | ❌ | ❌ |
| **Doom Loop 检测** | ❌ | ✅ 单层 | ✅ 三层 |
| **Snapshot 追踪** | ❌ | ✅ | ❌ |
| **插件系统** | ❌ | ✅ 完整 API | ✅ Skills 系统 |
| **模块化 Prompt** | ❌ | ❌ | ✅ 可组合 |
| **策略学习** | ❌ | ❌ | ✅ 从决策学习 |
| **子代理** | ❌ | ❌ | ✅ LocalAgentExecutor |
| **LLM 辅助判断** | ❌ | ❌ | ✅ NextSpeaker + Loop |

---

## 6. 最佳实践总结

### 5.1 循环控制

```typescript
// ✅ 推荐：双层循环结构
while (true) {  // 外层：主循环
  while (true) {  // 内层：重试循环
    try {
      const result = await llm.stream(...)
      // 处理结果
      break  // 成功则跳出内层
    } catch (error) {
      if (!isRetryable(error)) break
      await sleep(calculateDelay(attempt++))
    }
  }

  if (shouldExit) break
}
```

### 5.2 Doom Loop 检测

```typescript
// ✅ 检测连续 3 次相同工具调用
const DOOM_LOOP_THRESHOLD = 3
const lastThree = parts.slice(-DOOM_LOOP_THRESHOLD)

if (lastThree.length === DOOM_LOOP_THRESHOLD &&
    lastThree.every(p =>
      p.type === "tool" &&
      p.tool === currentTool &&
      JSON.stringify(p.input) === JSON.stringify(currentInput)
    )) {
  // 检测到死循环
  await askUserConfirmation()
}
```

### 5.3 中断保护

```python
# ✅ 使用 shield 保护关键操作
await asyncio.shield(self._grow_context(result, results))

# ✅ 可取消的 sleep
await SessionRetry.sleep(delay, abort_signal)
```

### 5.4 重试策略

```typescript
// ✅ 指数退避 + 抖动
const delay = (attempt: number) => {
  const base = INITIAL_DELAY * Math.pow(BACKOFF_FACTOR, attempt - 1)
  const jitter = Math.random() * 0.5 * base  // 50% 抖动
  return Math.min(base + jitter, MAX_DELAY)
}
```

### 5.5 事件驱动

```typescript
// ✅ 使用事件总线解耦
Bus.publish(MessageV2.Event.PartUpdated, { part })
Bus.subscribe(MessageV2.Event.PartDelta, (event) => {
  // 处理增量更新
})
```

---

## 7. ReAct 系统设计建议

基于对三个项目的调研，为 Lite-OpenCode 的 ReAct 系统提出以下设计建议。

### 7.1 核心架构设计

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Lite-OpenCode ReAct 系统架构                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                         Agent Loop                                   │  │
│   │  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐      │  │
│   │  │  Input   │───▶│   LLM    │───▶│  Parser  │───▶│ Executor │      │  │
│   │  │ Handler  │    │  Stream  │    │          │    │          │      │  │
│   │  └──────────┘    └──────────┘    └──────────┘    └──────────┘      │  │
│   │       ▲                                                │            │  │
│   │       └────────────────────────────────────────────────┘            │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│                    ┌───────────────┼───────────────┐                       │
│                    ▼               ▼               ▼                       │
│            ┌────────────┐  ┌────────────┐  ┌────────────┐                  │
│            │   Loop     │  │  Context   │  │   Policy   │                  │
│            │ Detection  │  │  Manager   │  │   Engine   │                  │
│            └────────────┘  └────────────┘  └────────────┘                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 优先级排序

| 改进点 | 参考 | 优先级 | 复杂度 | 说明 |
|--------|------|--------|--------|------|
| **三层循环检测** | Gemini-CLI | 🔴 P0 | 中 | 防止模型陷入死循环，最关键 |
| **Reasoning 支持** | Kilocode | 🔴 P0 | 低 | MiniMax/DeepSeek 等模型需要 |
| **策略引擎** | Gemini-CLI | 🔴 P0 | 中 | ALLOW/DENY/ASK_USER 三级权限 |
| **模块化 Prompt** | Gemini-CLI | 🟡 P1 | 中 | 可组合的 Prompt 片段 |
| **重试机制** | Kilocode | 🟡 P1 | 低 | 指数退避 + 可重试错误检测 |
| **消息强类型** | Kilocode Zod | 🟡 P1 | 低 | 提高代码健壮性 |
| **事件 Bus** | Kilocode | 🟢 P2 | 中 | 解耦 UI 和 Agent |
| **Snapshot 追踪** | Kilocode | 🟢 P2 | 高 | 文件变更追踪 |
| **子代理系统** | Gemini-CLI | 🟢 P3 | 高 | 可选的高级功能 |

### 7.3 Phase 1: 核心稳定性 (建议优先实现)

#### 7.3.1 三层循环检测

```typescript
// src/loopDetection.ts
export class LoopDetectionService {
  private lastToolCallKey: string | null = null;
  private toolCallRepetitionCount = 0;
  private contentWindow: string[] = [];
  private turnCount = 0;

  // 第一层：工具调用检测
  checkToolCallLoop(toolCall: { name: string; args: object }): boolean {
    const key = this.hashToolCall(toolCall);
    if (this.lastToolCallKey === key) {
      this.toolCallRepetitionCount++;
      return this.toolCallRepetitionCount >= 5;
    }
    this.lastToolCallKey = key;
    this.toolCallRepetitionCount = 1;
    return false;
  }

  // 第二层：内容重复检测
  checkContentLoop(content: string): boolean {
    const chunks = this.splitIntoChunks(content, 50);
    this.contentWindow = [...this.contentWindow.slice(-10), ...chunks];

    // 检测连续重复
    for (let i = 0; i < this.contentWindow.length - 2; i++) {
      if (this.contentWindow[i] === this.contentWindow[i + 1] &&
          this.contentWindow[i] === this.contentWindow[i + 2]) {
        return true;
      }
    }
    return false;
  }

  // 第三层：LLM 辅助判断（可选，延后实现）
  async checkWithLLM(history: Message[]): Promise<boolean> {
    // 30轮后才触发
    if (this.turnCount < 30) return false;
    // ... LLM 分析逻辑
  }

  private hashToolCall(toolCall: { name: string; args: object }): string {
    return `${toolCall.name}:${JSON.stringify(toolCall.args)}`;
  }
}
```

#### 7.3.2 Reasoning 支持

```typescript
// 扩展消息类型
interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  reasoning?: string;  // 新增：思考过程
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

// 流处理中添加 reasoning 支持
case "reasoning-delta": {
  if (currentReasoning) {
    currentReasoning.text += value.text;
    // 通知 UI 更新
    this.events.onReasoningDelta?.(value.text);
  }
  break;
}
```

#### 7.3.3 策略引擎

```typescript
// src/policy.ts
export type PolicyDecision = 'allow' | 'deny' | 'ask';

export interface PolicyRule {
  tool: string;
  pattern?: RegExp;  // 参数匹配模式
  decision: PolicyDecision;
}

export class PolicyEngine {
  private rules: PolicyRule[] = [];
  private learnedRules: Map<string, PolicyDecision> = new Map();

  checkPermission(tool: string, args: Record<string, unknown>): PolicyDecision {
    // 1. 检查硬编码规则
    for (const rule of this.rules) {
      if (rule.tool === tool || rule.tool === '*') {
        if (!rule.pattern || rule.pattern.test(JSON.stringify(args))) {
          return rule.decision;
        }
      }
    }

    // 2. 检查学习到的规则
    const key = `${tool}:${this.hashArgs(args)}`;
    const learned = this.learnedRules.get(key);
    if (learned) return learned;

    // 3. 默认询问
    return 'ask';
  }

  learn(tool: string, args: Record<string, unknown>, decision: PolicyDecision): void {
    const key = `${tool}:${this.hashArgs(args)}`;
    this.learnedRules.set(key, decision);
    this.saveLearnedRules();
  }
}
```

### 7.4 Phase 2: 架构优化

#### 7.4.1 模块化 Prompt 系统

```typescript
// src/prompts/index.ts
export interface PromptSection {
  name: string;
  content: string | (() => string | Promise<string>);
  priority: number;  // 越小越靠前
}

export class PromptBuilder {
  private sections: PromptSection[] = [];

  addSection(section: PromptSection): this {
    this.sections.push(section);
    return this;
  }

  async build(): Promise<string> {
    const sorted = this.sections.sort((a, b) => a.priority - b.priority);
    const contents = await Promise.all(
      sorted.map(async (s) => {
        const content = typeof s.content === 'function' ? await s.content() : s.content;
        return `## ${s.name}\n\n${content}`;
      })
    );
    return contents.join('\n\n---\n\n');
  }
}

// 使用示例
const prompt = new PromptBuilder()
  .addSection({ name: 'Role', content: rolePrompt, priority: 0 })
  .addSection({ name: 'Guidelines', content: guidelinesPrompt, priority: 10 })
  .addSection({ name: 'Tools', content: () => generateToolDocs(), priority: 20 })
  .build();
```

#### 7.4.2 重试机制

```typescript
// src/retry.ts
export interface RetryConfig {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffFactor: number;
}

export function isRetryable(error: Error): boolean {
  // 429 Too Many Requests
  if (error.message.includes('429')) return true;
  // 5xx Server Error
  if (error.message.match(/5\d{2}/)) return true;
  // Connection errors
  if (error.message.includes('ECONNRESET')) return true;
  if (error.message.includes('ETIMEDOUT')) return true;
  return false;
}

export function calculateDelay(attempt: number, config: RetryConfig): number {
  const baseDelay = config.initialDelay * Math.pow(config.backoffFactor, attempt - 1);
  const jitter = Math.random() * 0.3 * baseDelay;  // 30% 抖动
  return Math.min(baseDelay + jitter, config.maxDelay);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      if (attempt >= config.maxAttempts || !isRetryable(error)) {
        throw error;
      }
      await sleep(calculateDelay(attempt, config));
    }
  }
}
```

### 7.5 建议的实现顺序

```
Week 1: 核心稳定性
├── Day 1-2: LoopDetectionService 实现
│   ├── 第一层：工具调用检测
│   ├── 第二层：内容重复检测
│   └── 集成到 Agent 循环
├── Day 3: Reasoning 支持
│   ├── 扩展消息类型
│   └── 流处理支持
└── Day 4-5: PolicyEngine 实现
    ├── 规则定义
    ├── 权限检查
    └── 决策学习

Week 2: 架构优化
├── Day 1-2: 模块化 Prompt
│   ├── PromptBuilder 类
│   └── 默认 Prompt 片段
├── Day 3: 重试机制
│   └── withRetry 包装器
└── Day 4-5: 测试和文档
    ├── 单元测试
    └── 使用文档
```

### 7.6 关键设计决策

| 决策点 | 建议方案 | 理由 |
|--------|----------|------|
| 循环检测层数 | 3层 | 平衡效果和复杂度 |
| 第三层LLM触发 | 30轮后 | 避免频繁调用增加成本 |
| 策略默认行为 | ask | 安全优先 |
| Prompt存储 | 代码内 + 可选外部文件 | 灵活性 |
| 重试最大次数 | 5次 | 参考 Kilocode |

---

## 附录：关键文件路径

### Kimi-CLI

| 文件 | 用途 |
|------|------|
| `src/kimi_cli/soul/kimisoul.py` | 主 Agent 循环 |
| `src/kimi_cli/soul/toolset.py` | 工具注册执行 |
| `src/kimi_cli/soul/context.py` | 上下文管理 |
| `src/kimi_cli/wire/__init__.py` | Wire 协议 |

### Kilocode

| 文件 | 用途 |
|------|------|
| `packages/opencode/src/session/prompt.ts` | 主循环 |
| `packages/opencode/src/session/processor.ts` | 流处理 |
| `packages/opencode/src/session/llm.ts` | LLM 调用 |
| `packages/opencode/src/session/retry.ts` | 重试逻辑 |
| `packages/opencode/src/bus/index.ts` | 事件系统 |
| `packages/opencode/src/session/message-v2.ts` | 消息类型 |

### Gemini-CLI

| 文件 | 用途 |
|------|------|
| `packages/core/src/core/client.ts` | 主 Agent 循环 |
| `packages/sdk/src/session.ts` | Session 和循环控制 |
| `packages/core/src/services/loopDetectionService.ts` | 三层循环检测 |
| `packages/core/src/prompts/promptProvider.ts` | Prompt 组装 |
| `packages/core/src/prompts/snippets.ts` | Prompt 片段 |
| `packages/core/src/tools/tool-registry.ts` | 工具注册 |
| `packages/core/src/scheduler/scheduler.ts` | 工具执行调度 |
| `packages/core/src/agents/local-executor.ts` | 子代理执行器 |
