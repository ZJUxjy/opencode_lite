# Dify Agent 架构深度解析

> 本文档深入分析 Dify 项目的三大架构亮点：FC + CoT 双策略支持、流式 ReAct 输出解析器、完整的思考过程持久化

---

## 目录

1. [概述](#概述)
2. [FC + CoT 双策略支持](#1-fc--cot-双策略支持)
3. [流式 ReAct 输出解析器](#2-流式-react-输出解析器)
4. [完整的思考过程持久化](#3-完整的思考过程持久化)
5. [架构优势总结](#架构优势总结)

---

## 概述

**Dify** 是一个开源的 LLM 应用开发平台，其 Agent 模块实现了两种主要的策略：

| 策略 | 全称 | 适用场景 |
|------|------|----------|
| **FC** | Function Calling | 支持原生工具调用的现代 LLM（GPT-4, Claude 等）|
| **CoT** | Chain-of-Thought | 不支持工具调用的传统 LLM |

```
┌─────────────────────────────────────────────────────────┐
│                    Agent Chat App                       │
└─────────────────────────┬───────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              │   策略选择 (Strategy)  │
              └───────────┬───────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│ FC Agent      │ │ CoT Chat      │ │ CoT Completion│
│ Runner        │ │ Agent Runner  │ │ Agent Runner  │
└───────────────┘ └───────────────┘ └───────────────┘
        │                 │                 │
        └─────────────────┼─────────────────┘
                          ▼
              ┌───────────────────────┐
              │   Base Agent Runner   │
              │   (公共基类)           │
              └───────────────────────┘
```

---

## 1. FC + CoT 双策略支持

### 1.1 Function Calling (FC) 策略

**核心文件**: `/home/xu/code/agent/dify/api/core/agent/fc_agent_runner.py`

FC 策略依赖 LLM 的**原生函数调用能力**，工具通过 `tools` 参数直接传递给模型。

#### 核心循环逻辑

```python
class FunctionCallAgentRunner(BaseAgentRunner):
    def run(self, message: Message, query: str, **kwargs: Any) -> Generator:
        # 初始化循环状态
        iteration_step = 1
        max_iteration_steps = min(app_config.agent.max_iteration, 99) + 1
        function_call_state = True

        while function_call_state and iteration_step <= max_iteration_steps:
            function_call_state = False

            # 最后一轮迭代时移除所有工具（强制结束）
            if iteration_step == max_iteration_steps:
                prompt_messages_tools = []

            # 1. 调用 LLM（直接传递工具定义）
            chunks = model_instance.invoke_llm(
                prompt_messages=prompt_messages,
                tools=prompt_messages_tools,  # ← FC 策略的关键
                stream=self.stream_tool_call,
            )

            # 2. 检查并提取工具调用
            for chunk in chunks:
                if self.check_tool_calls(chunk):
                    function_call_state = True
                    tool_calls.extend(self.extract_tool_calls(chunk))

            # 3. 执行工具
            for tool_call_id, tool_call_name, tool_call_args in tool_calls:
                result = ToolEngine.agent_invoke(
                    tool=tool_instance,
                    tool_parameters=tool_call_args,
                )
                tool_responses.append(result)

            # 4. 将工具结果添加到消息历史
            for tool_response in tool_responses:
                self._current_thoughts.append(
                    ToolPromptMessage(
                        content=tool_response["tool_response"],
                        tool_call_id=tool_response["tool_call_id"],
                    )
                )

            iteration_step += 1
```

#### FC 策略特点

| 特点 | 说明 |
|------|------|
| 原生支持 | 依赖模型内置的函数调用能力 |
| 无需模板 | 不需要特殊的 Prompt 模板 |
| 结构化输出 | 工具调用以结构化对象返回 |
| 流式支持 | 支持 `stream_tool_call` 模式 |

---

### 1.2 Chain-of-Thought (CoT) 策略

**核心文件**:
- `/home/xu/code/agent/dify/api/core/agent/cot_agent_runner.py` (基类)
- `/home/xu/code/agent/dify/api/core/agent/cot_chat_agent_runner.py` (Chat 模式)
- `/home/xu/code/agent/dify/api/core/agent/cot_completion_agent_runner.py` (Completion 模式)

CoT 策略使用 **ReAct (Reasoning + Acting)** 模式，通过提示词模板指导模型输出特定格式。

#### ReAct Prompt 模板

```python
ENGLISH_REACT_CHAT_PROMPT_TEMPLATES = """Respond to the human as helpfully and accurately as possible.

{{instruction}}

You have access to the following tools:

{{tools}}

Use a json blob to specify a tool by providing an action key (tool name) and an action_input key (tool input).
Valid "action" values: "Final Answer" or {{tool_names}}

Provide only ONE action per $JSON_BLOB, as shown:

```
{
  "action": $TOOL_NAME,
  "action_input": $ACTION_INPUT
}
```

Follow this format:

Question: input question to answer
Thought: consider previous and subsequent steps
Action:
```
$JSON_BLOB
```
Observation: action result
... (repeat Thought/Action/Observation N times)
Thought: I know what to respond
Action:
```
{
  "action": "Final Answer",
  "action_input": "Final response to human"
}
```

Begin! Reminder to ALWAYS respond with a valid json blob of a single action.
{{historic_messages}}
Question: {{query}}
{{agent_scratchpad}}
Thought:"""
```

#### 核心循环逻辑

```python
class CotAgentRunner(BaseAgentRunner):
    def run(self, message: Message, query: str, inputs: Mapping[str, str]) -> Generator:
        iteration_step = 1
        max_iteration_steps = min(app_config.agent.max_iteration, 99) + 1
        function_call_state = True

        while function_call_state and iteration_step <= max_iteration_steps:
            function_call_state = False

            # 1. 组织 Prompt 消息（包含 ReAct 模板）
            prompt_messages = self._organize_prompt_messages()

            # 2. 调用 LLM（不传递 tools，使用 stop 词）
            chunks = model_instance.invoke_llm(
                prompt_messages=prompt_messages,
                tools=[],  # ← CoT 策略不传递工具
                stop=["Observation:"],  # ← 使用停止词
                stream=True,
            )

            # 3. 使用 ReAct 解析器解析流式输出
            react_chunks = CotAgentOutputParser.handle_react_stream_output(chunks, usage_dict)

            scratchpad = AgentScratchpadUnit(thought="", action=None, observation=None)

            # 4. 解析 Thought/Action
            for chunk in react_chunks:
                if isinstance(chunk, AgentScratchpadUnit.Action):
                    scratchpad.action = chunk
                else:
                    scratchpad.thought += chunk

            # 5. 检查是否为最终答案
            if scratchpad.action.action_name.lower() == "final answer":
                final_answer = scratchpad.action.action_input
                break
            else:
                # 6. 执行工具
                tool_response = self._handle_invoke_action(
                    action=scratchpad.action,
                    tool_instances=tool_instances,
                )
                scratchpad.observation = tool_response
                function_call_state = True

            iteration_step += 1
```

#### CoT 策略特点

| 特点 | 说明 |
|------|------|
| ReAct 模式 | Thought → Action → Observation 循环 |
| Prompt 模板 | 需要特定的模板指导输出格式 |
| 停止词 | 使用 "Observation:" 作为停止词 |
| 文本解析 | 从文本中解析工具调用 |

---

### 1.3 策略选择机制

**核心文件**: `/home/xu/code/agent/dify/api/core/app/apps/agent_chat/app_runner.py`

```python
# 1. 获取模型特性
llm_model = cast(LargeLanguageModel, model_instance.model_type_instance)
model_schema = llm_model.get_model_schema(model_instance.model, model_instance.credentials)

# 2. 如果模型支持工具调用，强制使用 FC 策略
if {ModelFeature.MULTI_TOOL_CALL, ModelFeature.TOOL_CALL}.intersection(
    model_schema.features or []
):
    agent_entity.strategy = AgentEntity.Strategy.FUNCTION_CALLING

# 3. 根据策略选择 Runner
if agent_entity.strategy == AgentEntity.Strategy.CHAIN_OF_THOUGHT:
    # 检查 LLM 模式
    if model_schema.model_properties.get(ModelPropertyKey.MODE) == LLMMode.CHAT:
        runner_cls = CotChatAgentRunner
    elif model_schema.model_properties.get(ModelPropertyKey.MODE) == LLMMode.COMPLETION:
        runner_cls = CotCompletionAgentRunner
elif agent_entity.strategy == AgentEntity.Strategy.FUNCTION_CALLING:
    runner_cls = FunctionCallAgentRunner
```

#### 策略选择流程图

```
                    ┌─────────────────┐
                    │   配置/模型信息  │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  模型支持工具调用? │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
        ┌──────────┐                  ┌──────────┐
        │   Yes    │                  │    No    │
        └────┬─────┘                  └────┬─────┘
             │                             │
             ▼                             ▼
    ┌─────────────────┐          ┌─────────────────┐
    │ FC Agent Runner │          │ 用户指定策略?    │
    └─────────────────┘          └────────┬────────┘
                                          │
                          ┌───────────────┴───────────────┐
                          │                               │
                          ▼                               ▼
                    ┌──────────┐                    ┌──────────┐
                    │ function_call│                │ cot/react │
                    └────┬─────┘                    └────┬─────┘
                         │                               │
                         ▼                               ▼
                ┌─────────────────┐            ┌─────────────────┐
                │ FC Agent Runner │            │ CoT Agent Runner│
                └─────────────────┘            └─────────────────┘
```

#### 策略选择规则

| 条件 | 选择策略 | 说明 |
|------|----------|------|
| 模型支持 `MULTI_TOOL_CALL` 或 `TOOL_CALL` | FC | 优先使用原生函数调用 |
| 配置指定 `function_call` | FC | 用户显式配置 |
| 配置指定 `cot` 或 `react` | CoT | 用户显式配置 |
| 旧配置 + OpenAI 模型 | FC | 向后兼容 |
| 旧配置 + 其他模型 | CoT | 向后兼容 |

---

### 1.4 两种策略对比

| 特性 | FC 策略 | CoT 策略 |
|------|---------|----------|
| 依赖 | LLM 原生工具调用 | Prompt 模板 |
| 输出格式 | 结构化对象 | 文本 + JSON |
| 停止机制 | 无需 | "Observation:" 停止词 |
| 兼容性 | 仅支持工具调用的模型 | 所有模型 |
| 可控性 | 较低 | 较高 |
| 调试难度 | 较低 | 较高 |

---

## 2. 流式 ReAct 输出解析器

### 2.1 核心文件

| 文件 | 路径 |
|------|------|
| 主解析器 | `/home/xu/code/agent/dify/api/core/agent/output_parser/cot_output_parser.py` |
| 测试文件 | `/home/xu/code/agent/dify/api/tests/unit_tests/core/agent/output_parser/test_cot_output_parser.py` |

### 2.2 解析器签名

```python
class CotAgentOutputParser:
    @classmethod
    def handle_react_stream_output(
        cls,
        llm_response: Generator[LLMResultChunk, None, None],
        usage_dict: dict
    ) -> Generator[Union[str, AgentScratchpadUnit.Action], None, None]:
        """
        从 LLM 流式输出中解析 Thought/Action/Observation

        返回:
            - str: 普通文本内容
            - AgentScratchpadUnit.Action: 解析出的 Action 对象
        """
```

### 2.3 状态跟踪机制

解析器使用 **5 组核心状态变量** 进行流式解析：

```python
# ═══════════════════════════════════════════════════════
# 1. 代码块解析状态
# ═══════════════════════════════════════════════════════
code_block_cache = ""           # 代码块缓存
code_block_delimiter_count = 0  # 反引号计数（检测 ```）
in_code_block = False           # 是否在代码块中

# ═══════════════════════════════════════════════════════
# 2. JSON 解析状态
# ═══════════════════════════════════════════════════════
json_cache = ""                 # JSON 缓存
json_quote_count = 0            # 大括号计数（支持嵌套 JSON）
in_json = False                 # 是否在 JSON 中
got_json = False                # 是否获取完整 JSON

# ═══════════════════════════════════════════════════════
# 3. Action 关键词匹配状态
# ═══════════════════════════════════════════════════════
action_cache = ""               # Action 关键词缓存
action_idx = 0                  # Action 匹配位置索引
action_str = "action:"          # 目标关键词

# ═══════════════════════════════════════════════════════
# 4. Thought 关键词匹配状态
# ═══════════════════════════════════════════════════════
thought_cache = ""              # Thought 关键词缓存
thought_idx = 0                 # Thought 匹配位置索引
thought_str = "thought:"        # 目标关键词

# ═══════════════════════════════════════════════════════
# 5. 边界检测
# ═══════════════════════════════════════════════════════
last_character = ""             # 上一个字符（判断关键词边界）
```

### 2.4 解析流程图

```
┌─────────────────────────────────────────────────────────────┐
│              流式字符输入 (Generator[LLMResultChunk])        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │   检测反引号 ` (代码块边界)   │
        └──────────────┬───────────────┘
                       │
         ┌─────────────┴─────────────┐
         │                           │
         ▼                           ▼
   ┌─────────────┐           ┌─────────────┐
   │ in_code_block│           │outside_code │
   │   = True     │           │   block     │
   └──────┬──────┘           └──────┬──────┘
          │                         │
          ▼                         ▼
   ┌─────────────┐           ┌─────────────┐
   │ 提取代码块  │           │ 关键词匹配  │
   │内 JSON 数据 │           │Action/Thought│
   └──────┬──────┘           └──────┬──────┘
          │                         │
          ▼                         ▼
   ┌─────────────┐           ┌─────────────┐
   │ JSON 解析   │           │ 普通 JSON   │
   │parse_action │           │  检测 {}    │
   └──────┬──────┘           └──────┬──────┘
          │                         │
          └─────────────┬───────────┘
                        ▼
                ┌───────────────┐
                │   Yield 结果   │
                │   str 或 Action │
                └───────────────┘
```

### 2.5 关键词匹配逻辑

支持**大小写不敏感**的 "Action:" 和 "Thought:" 检测，且必须在**行首或空白符后**：

```python
# 确保关键词在行首或前面是空白符
if delta.lower() == action_str[action_idx] and action_idx == 0:
    if last_character not in {"\n", " ", ""}:
        # 不是关键词开头，当作普通字符输出
        yield_delta = True
    else:
        # 开始匹配关键词
        action_cache += delta
        action_idx += 1
elif delta.lower() == action_str[action_idx]:
    # 继续匹配
    action_cache += delta
    action_idx += 1

    # 完整匹配
    if action_idx == len(action_str):
        action_cache = ""
        action_idx = 0
```

### 2.6 JSON 提取逻辑

#### 从代码块提取 JSON

```python
def extra_json_from_code_block(code_block) -> list[Union[list, dict]]:
    """
    从 ```json...``` 或 ```...``` 中提取 JSON
    """
    # 正则匹配代码块中的 JSON
    blocks = re.findall(
        r"```[json]*\s*([\[{].*[]}])\s*```",
        code_block,
        re.DOTALL | re.IGNORECASE
    )
    if not blocks:
        return []

    try:
        json_blocks = []
        for block in blocks:
            # 移除语言标识符（如 "json\n"）
            json_text = re.sub(r"^[a-zA-Z]+\n", "", block.strip(), flags=re.MULTILINE)
            json_blocks.append(json.loads(json_text, strict=False))
        return json_blocks
    except:
        return []
```

#### 从纯文本提取 JSON（支持嵌套）

```python
# 检测大括号开始
if delta == "{":
    json_quote_count += 1
    in_json = True
    json_cache += delta

# 检测大括号结束（支持嵌套）
elif delta == "}":
    json_cache += delta
    if json_quote_count > 0:
        json_quote_count -= 1
        if json_quote_count == 0:  # 完整 JSON
            in_json = False
            got_json = True
```

### 2.7 Action 解析函数

```python
def parse_action(action) -> Union[str, AgentScratchpadUnit.Action]:
    """
    将 JSON 解析为 Action 对象
    """
    action_name = None
    action_input = None

    # 字符串先解析为 dict
    if isinstance(action, str):
        try:
            action = json.loads(action, strict=False)
        except json.JSONDecodeError:
            return action or ""

    # Cohere 特殊处理：总是返回列表
    if isinstance(action, list) and len(action) == 1:
        action = action[0]

    # 提取 action_name 和 action_input
    for key, value in action.items():
        if "input" in key.lower():
            action_input = value
        else:
            action_name = value

    if action_name is not None and action_input is not None:
        return AgentScratchpadUnit.Action(
            action_name=action_name,
            action_input=action_input,
        )
    else:
        return json.dumps(action)
```

### 2.8 测试用例

```python
# 测试用例 1: 代码块包裹的 JSON
{
    "input": 'Thought: abc\nAction: ```{"action": "Final Answer", "action_input": "```echarts\n {}\n```"}```',
    "action": {"action": "Final Answer", "action_input": "```echarts\n {}\n```"},
    "output": 'Thought: abc\n {"action": "Final Answer", "action_input": "```echarts\\n {}\\n```"}',
}

# 测试用例 2: 纯文本 JSON
{
    "input": 'Thought: abc\nAction: {"action": "Final Answer", "action_input": "test"}',
    "action": {"action": "Final Answer", "action_input": "test"},
    "output": 'Thought: abc\n {"action": "Final Answer", "action_input": "test"}',
}

# 测试用例 3: 列表格式（Cohere 兼容）
{
    "input": 'Thought: abc\nAction: ```[{"action": "Final Answer", "action_input": "test"}]```',
    "action": {"action": "Final Answer", "action_input": "test"},
    "output": 'Thought: abc\n {"action": "Final Answer", "action_input": "test"}',
}
```

---

## 3. 完整的思考过程持久化

### 3.1 数据库表结构

**核心文件**: `/home/xu/code/agent/dify/api/models/model.py`

```python
class MessageAgentThought(TypeBase):
    """
    存储 Agent 的思考过程

    每个 Thought → Action → Observation 循环存储为一条记录
    """
    __tablename__ = "message_agent_thoughts"

    # ═══════════════════════════════════════════════════════
    # 基础字段
    # ═══════════════════════════════════════════════════════
    id: Mapped[str]                    # 主键 UUID
    message_id: Mapped[str]            # 关联的 Message ID
    position: Mapped[int]              # 在消息中的位置（从 1 开始）
    message_chain_id: Mapped[str | None]  # 链 ID（用于分组）

    # ═══════════════════════════════════════════════════════
    # 思考过程核心字段
    # ═══════════════════════════════════════════════════════
    thought: Mapped[str | None]        # LLM 的思考内容 (Thought)
    tool: Mapped[str | None]           # 工具名称 (多个用 ; 分隔)
    tool_input: Mapped[str | None]     # 工具输入参数 (JSON)
    observation: Mapped[str | None]    # 工具执行结果 (Observation)

    # ═══════════════════════════════════════════════════════
    # 元数据字段
    # ═══════════════════════════════════════════════════════
    tool_labels_str: Mapped[str]       # 工具标签 (JSON)
    tool_meta_str: Mapped[str]         # 工具元数据 (JSON)
    tool_process_data: Mapped[str | None]  # 工具处理数据
    message_files: Mapped[str | None]  # 关联文件列表 (JSON)

    # ═══════════════════════════════════════════════════════
    # 消息内容
    # ═══════════════════════════════════════════════════════
    message: Mapped[str | None]        # 用户消息
    answer: Mapped[str | None]         # 最终回答

    # ═══════════════════════════════════════════════════════
    # Token 使用和计费
    # ═══════════════════════════════════════════════════════
    message_token: Mapped[int | None]      # 输入 token 数
    answer_token: Mapped[int | None]       # 输出 token 数
    tokens: Mapped[int | None]             # 总 token 数
    message_unit_price: Mapped[Decimal | None]  # 输入单价
    answer_unit_price: Mapped[Decimal | None]   # 输出单价
    total_price: Mapped[Decimal | None]    # 总费用
    currency: Mapped[str | None]           # 货币单位

    # 其他
    latency: Mapped[float | None]      # 延迟（秒）
    created_at: Mapped[datetime]       # 创建时间
```

### 3.2 数据关系

```
┌─────────────────────┐
│      Message        │
│  (用户/助手消息)     │
└──────────┬──────────┘
           │ 1:N
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│              MessageAgentThought                        │
│  ┌─────────────────────────────────────────────────┐   │
│  │ position=1                                       │   │
│  │ thought: "我需要搜索天气信息..."                  │   │
│  │ tool: "weather_search"                           │   │
│  │ tool_input: {"city": "北京"}                     │   │
│  │ observation: "北京今天晴，25°C..."               │   │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │ position=2                                       │   │
│  │ thought: "现在我有天气信息了..."                  │   │
│  │ tool: None (Final Answer)                        │   │
│  │ answer: "北京今天天气晴朗，温度25°C..."          │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 3.3 创建和保存 Agent Thought

```python
# 创建 Agent Thought
def create_agent_thought(
    self, message_id: str, message: str, tool_name: str, tool_input: str
) -> str:
    thought = MessageAgentThought(
        message_id=message_id,
        thought="",
        tool=tool_name,
        tool_input=tool_input,
        observation="",
        position=self.agent_thought_count + 1,
        # ... 其他字段
    )
    db.session.add(thought)
    db.session.commit()
    return str(thought.id)


# 保存 Agent Thought（流式更新）
def save_agent_thought(
    self,
    agent_thought_id: str,
    tool_name: str | None,
    tool_input: Union[str, dict, None],
    thought: str | None,
    observation: Union[str, dict, None],
    llm_usage: LLMUsage | None = None,
):
    agent_thought = db.session.scalar(
        select(MessageAgentThought).where(MessageAgentThought.id == agent_thought_id)
    )

    # 追加 thought
    if thought:
        existing_thought = agent_thought.thought or ""
        agent_thought.thought = f"{existing_thought}{thought}"

    # 更新工具信息
    if tool_name:
        agent_thought.tool = tool_name
    if tool_input:
        agent_thought.tool_input = json.dumps(tool_input)
    if observation:
        agent_thought.observation = json.dumps(observation)

    # 更新 token 使用
    if llm_usage:
        agent_thought.message_token = llm_usage.prompt_tokens
        agent_thought.answer_token = llm_usage.completion_tokens
        agent_thought.tokens = llm_usage.total_tokens
        agent_thought.total_price = llm_usage.total_price

    db.session.commit()
```

### 3.4 历史恢复机制

```python
def organize_agent_history(self, prompt_messages: list[PromptMessage]) -> list[PromptMessage]:
    """
    从数据库恢复思考过程，构建 LLM 可用的消息历史
    """
    result: list[PromptMessage] = []

    # 获取历史消息
    messages = db.session.query(Message).filter(
        Message.conversation_id == self.message.conversation_id
    ).order_by(Message.created_at).all()

    for message in messages:
        # 添加用户消息
        result.append(self.organize_agent_user_prompt(message))

        # 恢复 Agent Thoughts
        agent_thoughts: list[MessageAgentThought] = message.agent_thoughts

        for agent_thought in agent_thoughts:
            tool_names = agent_thought.tool.split(";") if agent_thought.tool else []
            tool_calls = []
            tool_responses = []

            # 解析工具输入
            tool_inputs = json.loads(agent_thought.tool_input) if agent_thought.tool_input else {}

            # 解析观察结果
            tool_outputs = json.loads(agent_thought.observation) if agent_thought.observation else {}

            # 为每个工具创建 ToolCall 和 ToolResponse
            for tool in tool_names:
                tool_call_id = str(uuid.uuid4())

                # 创建 ToolCall
                tool_calls.append(
                    AssistantPromptMessage.ToolCall(
                        id=tool_call_id,
                        type="function",
                        function=AssistantPromptMessage.ToolCall.ToolCallFunction(
                            name=tool,
                            arguments=json.dumps(tool_inputs.get(tool, {})),
                        ),
                    )
                )

                # 创建 ToolResponse
                tool_responses.append(
                    ToolPromptMessage(
                        content=tool_outputs.get(tool, agent_thought.observation),
                        name=tool,
                        tool_call_id=tool_call_id,
                    )
                )

            # 添加 Assistant 消息 (带 tool calls) + Tool 消息
            result.extend([
                AssistantPromptMessage(
                    content=agent_thought.thought,
                    tool_calls=tool_calls,
                ),
                *tool_responses,
            ])

    return result
```

### 3.5 前端数据结构

```typescript
// TypeScript 类型定义
export type ThoughtItem = {
  id: string
  tool: string                    // 工具名称（多个用分号分隔）
  thought: string                 // 思考内容
  tool_input: string              // 工具输入 (JSON)
  tool_labels?: { [key: string]: TypeWithI18N }  // 工具标签
  message_id: string              // 关联消息 ID
  conversation_id: string         // 会话 ID
  observation: string             // 观察结果
  position: number                // 位置
  files?: string[]                // 关联文件
  message_files?: FileEntity[]    // 文件实体
}
```

### 3.6 前端展示组件

```tsx
const AgentContent: FC<AgentContentProps> = ({ item, responding, content }) => {
  const { annotation, agent_thoughts } = item

  return (
    <div data-testid="agent-content-container">
      {content ? (
        <Markdown content={content} />
      ) : agent_thoughts?.map((thought, index) => (
        <div key={index} className="px-2 py-1">
          {/* 显示思考内容 */}
          {thought.thought && (
            <Markdown content={thought.thought} />
          )}
          {/* 显示工具调用 */}
          {!!thought.tool && (
            <Thought
              thought={thought}
              isFinished={!!thought.observation || !responding}
            />
          )}
        </div>
      ))}
    </div>
  )
}
```

---

## 架构优势总结

### FC + CoT 双策略

| 优势 | 说明 |
|------|------|
| **自动选择** | 基于模型能力自动选择最优策略 |
| **统一接口** | 两种策略继承自同一基类 |
| **灵活配置** | 支持用户手动覆盖默认策略 |
| **向后兼容** | 支持旧配置格式的自动迁移 |
| **模式适配** | CoT 支持 Chat 和 Completion 两种模式 |

### 流式 ReAct 解析器

| 优势 | 说明 |
|------|------|
| **流式处理** | 逐字符解析，支持增量输出 |
| **多格式支持** | 支持代码块内、纯文本两种 JSON 模式 |
| **嵌套 JSON** | 大括号计数器支持任意嵌套 |
| **关键词检测** | 大小写不敏感，行首边界检测 |
| **多模型兼容** | 处理 Cohere 列表格式等特殊输出 |
| **容错处理** | JSON 解析失败时返回原始文本 |

### 思考过程持久化

| 优势 | 说明 |
|------|------|
| **分离存储** | 每个思考步骤单独存储，便于追溯 |
| **字段复用** | thought/tool/observation 完整记录 |
| **历史恢复** | 支持从数据库恢复完整思考链 |
| **流式更新** | 支持分阶段保存各字段 |
| **多工具支持** | 分号分隔 + JSON 对象 |
| **Token 计费** | 详细记录每个步骤的用量和费用 |

---

## 关键文件索引

| 功能 | 文件路径 |
|------|----------|
| FC Agent Runner | `/home/xu/code/agent/dify/api/core/agent/fc_agent_runner.py` |
| CoT Agent Runner | `/home/xu/code/agent/dify/api/core/agent/cot_agent_runner.py` |
| CoT Chat Runner | `/home/xu/code/agent/dify/api/core/agent/cot_chat_agent_runner.py` |
| CoT Completion Runner | `/home/xu/code/agent/dify/api/core/agent/cot_completion_agent_runner.py` |
| ReAct 输出解析器 | `/home/xu/code/agent/dify/api/core/agent/output_parser/cot_output_parser.py` |
| Agent 实体定义 | `/home/xu/code/agent/dify/api/core/agent/entities.py` |
| Base Agent Runner | `/home/xu/code/agent/dify/api/core/agent/base_agent_runner.py` |
| 数据模型 | `/home/xu/code/agent/dify/api/models/model.py` |
| 策略选择 | `/home/xu/code/agent/dify/api/core/app/apps/agent_chat/app_runner.py` |
| Prompt 模板 | `/home/xu/code/agent/dify/api/core/agent/prompt/template.py` |

---

*文档生成时间: 2026-02-28*
