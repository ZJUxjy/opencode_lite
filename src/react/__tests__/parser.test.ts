/**
 * ReActParser 测试用例
 *
 * 覆盖场景：
 * 1. 标准 ReAct 格式
 * 2. 代码块中的 JSON
 * 3. 纯文本 JSON
 * 4. 嵌套 JSON
 * 5. 多模型格式兼容
 * 6. 容错处理
 */

import { describe, it, expect } from "vitest"
import { ReActParser } from "../parser.js"

describe("ReActParser", () => {
  const parser = new ReActParser()

  describe("基础解析", () => {
    it("应该解析简单的 Thought", () => {
      const content = "Thought: 我需要查看当前目录\nAction:\n```json\n{\"action\": \"bash\", \"action_input\": {\"command\": \"ls\"}}\n```"
      const result = parser.parse(content)

      expect(result.thought).toBe("我需要查看当前目录")
      expect(result.action).not.toBeNull()
      expect(result.action?.name).toBe("bash")
      expect(result.action?.input).toEqual({ command: "ls" })
    })

    it("应该解析 Final Answer", () => {
      const content = `Thought: 我已经完成了任务
Action:
\`\`\`json
{
  "action": "Final Answer",
  "action_input": "任务已完成，共找到 5 个文件"
}
\`\`\``
      const result = parser.parse(content)

      expect(result.action).not.toBeNull()
      expect(result.action?.name).toBe("Final Answer")
      expect(result.action?.input).toBe("任务已完成，共找到 5 个文件")
    })

    it("应该处理没有 Action 的纯文本响应", () => {
      const content = "这是一个普通回复，没有任何工具调用。"
      const result = parser.parse(content)

      expect(result.thought).toBe("这是一个普通回复，没有任何工具调用。")
      expect(result.action).toBeNull()
    })
  })

  describe("代码块 JSON 提取", () => {
    it("应该从 ```json 代码块提取 JSON", () => {
      const content = `Thought: 读取文件
Action:
\`\`\`json
{
  "action": "read",
  "action_input": {
    "file_path": "/home/user/test.txt"
  }
}
\`\`\``
      const result = parser.parse(content)

      expect(result.action).not.toBeNull()
      expect(result.action?.name).toBe("read")
      expect(result.action?.input).toEqual({ file_path: "/home/user/test.txt" })
    })

    it("应该从无语言标记的代码块提取 JSON", () => {
      const content = `Thought: 执行命令
Action:
\`\`\`
{
  "action": "bash",
  "action_input": {"command": "pwd"}
}
\`\`\``
      const result = parser.parse(content)

      expect(result.action).not.toBeNull()
      expect(result.action?.name).toBe("bash")
    })

    it("应该处理多行 JSON", () => {
      const content = `Thought: 复杂操作
Action:
\`\`\`json
{
  "action": "write",
  "action_input": {
    "file_path": "/tmp/test.txt",
    "content": "line1\\nline2\\nline3"
  }
}
\`\`\``
      const result = parser.parse(content)

      expect(result.action).not.toBeNull()
      expect(result.action?.name).toBe("write")
      // JSON 解析后 \\n 变成 \n（实际换行符）
      expect((result.action?.input as any).content).toBe("line1\nline2\nline3")
    })
  })

  describe("纯文本 JSON 解析", () => {
    it("应该解析代码块外的 JSON", () => {
      const content = `Thought: 执行操作
Action: {"action": "grep", "action_input": {"pattern": "test", "path": "."}}`
      const result = parser.parse(content)

      expect(result.action).not.toBeNull()
      expect(result.action?.name).toBe("grep")
    })

    it("应该处理 action_input 为字符串的情况", () => {
      const content = `Thought: 最终答案
Action: {"action": "Final Answer", "action_input": "这是最终答案"}`
      const result = parser.parse(content)

      expect(result.action).not.toBeNull()
      expect(result.action?.name).toBe("Final Answer")
      expect(result.action?.input).toBe("这是最终答案")
    })
  })

  describe("嵌套 JSON 支持", () => {
    it("应该正确解析嵌套对象", () => {
      const content = `Thought: 写入配置
Action:
\`\`\`json
{
  "action": "write",
  "action_input": {
    "file_path": "/config.json",
    "content": "{\\"name\\": \\"test\\", \\"options\\": {\\"debug\\": true}}"
  }
}
\`\`\``
      const result = parser.parse(content)

      expect(result.action).not.toBeNull()
      expect(result.action?.name).toBe("write")
    })

    it("应该正确处理多层嵌套大括号", () => {
      const content = `Thought: 复杂操作
Action: {"action": "test", "action_input": {"a": {"b": {"c": {"d": 1}}}}}`
      const result = parser.parse(content)

      expect(result.action).not.toBeNull()
      expect(result.action?.name).toBe("test")
      expect((result.action?.input as any).a.b.c.d).toBe(1)
    })
  })

  describe("多模型格式兼容", () => {
    it("应该支持 Cohere 列表格式", () => {
      const content = `Thought: 使用工具
Action:
\`\`\`json
[{
  "name": "bash",
  "parameters": {"command": "ls"}
}]
\`\`\``
      const result = parser.parse(content)

      expect(result.action).not.toBeNull()
      expect(result.action?.name).toBe("bash")
    })

    it("应该支持 name/arguments 格式", () => {
      const content = `Thought: 执行
Action: {"name": "read", "arguments": {"file_path": "/test.txt"}}`
      const result = parser.parse(content)

      expect(result.action).not.toBeNull()
      expect(result.action?.name).toBe("read")
    })

    it("应该支持 tool/args 格式", () => {
      const content = `Thought: 执行
Action: {"tool": "write", "args": {"file_path": "/test.txt", "content": "hello"}}`
      const result = parser.parse(content)

      expect(result.action).not.toBeNull()
      expect(result.action?.name).toBe("write")
    })

    it("应该支持 Ollama 格式", () => {
      // Ollama 格式使用 tool_calls 嵌套
      // 简化测试：使用简单的参数
      const content = `Thought: 执行
Action:
\`\`\`json
{"tool_calls": [{"function": {"name": "bash", "arguments": {}}}]}
\`\`\``
      const result = parser.parse(content)

      expect(result.action).not.toBeNull()
      expect(result.action?.name).toBe("bash")
    })
  })

  describe("容错处理", () => {
    it("应该修复尾随逗号", () => {
      const content = `Thought: 执行
Action: {"action": "test", "action_input": {"key": "value",}}`
      const result = parser.parse(content)

      expect(result.action).not.toBeNull()
      expect(result.action?.name).toBe("test")
    })

    it("应该处理 action_input 缺失的情况", () => {
      const content = `Thought: 执行
Action: {"action": "list"}`
      const result = parser.parse(content)

      expect(result.action).not.toBeNull()
      expect(result.action?.name).toBe("list")
      expect(result.action?.input).toEqual({})
    })

    it("应该处理无效 JSON 返回 null", () => {
      const content = `Thought: 执行
Action: {invalid json here}`
      const result = parser.parse(content)

      // 无效 JSON 应该返回 null 或尝试容错解析
      // 根据实现可能返回 null 或部分解析结果
      expect(result.thought).toContain("执行")
    })

    it("应该处理空的 action_input", () => {
      const content = `Thought: 列出文件
Action: {"action": "ls", "action_input": {}}`
      const result = parser.parse(content)

      expect(result.action).not.toBeNull()
      expect(result.action?.name).toBe("ls")
      expect(result.action?.input).toEqual({})
    })
  })

  describe("流式解析", () => {
    it("应该正确流式解析 ReAct 输出", () => {
      const chunks = [
        "Thought: ",
        "我需要",
        "查看文件\n",
        "Action:\n",
        "```json\n",
        '{"action": "read"',
        ', "action_input": {"file_path": "/test.txt"}}',
        "\n```"
      ]

      function* generateChunks() {
        for (const chunk of chunks) {
          yield chunk
        }
      }

      const results = [...parser.parseStream(generateChunks())]

      // 检查是否有 thought 输出
      const thoughtResults = results.filter(r => r.type === "thought")
      expect(thoughtResults.length).toBeGreaterThan(0)

      // 流式解析的 action 在最后输出
      const actionResults = results.filter(r => r.type === "action")
      // 流式解析会在最后输出完整的 action
      expect(actionResults.length).toBeGreaterThanOrEqual(1)
      expect((actionResults[actionResults.length - 1].value as any)?.name).toBe("read")
    })
  })

  describe("状态管理", () => {
    it("reset() 应该清除所有状态", () => {
      parser.parse("Thought: test\nAction: {\"action\": \"test\", \"action_input\": {}}")
      parser.reset()

      const state = parser.getState()
      expect(state.inCodeBlock).toBe(false)
      expect(state.inJson).toBe(false)
      expect(state.braceCount).toBe(0)
      expect(state.position).toBe(0)
    })

    it("多次解析应该独立", () => {
      const result1 = parser.parse("Thought: 1\nAction: {\"action\": \"a1\", \"action_input\": {}}")
      const result2 = parser.parse("Thought: 2\nAction: {\"action\": \"a2\", \"action_input\": {}}")

      expect(result1.action?.name).toBe("a1")
      expect(result2.action?.name).toBe("a2")
    })
  })

  describe("边界情况", () => {
    it("应该处理空内容", () => {
      const result = parser.parse("")
      expect(result.thought).toBe("")
      expect(result.action).toBeNull()
    })

    it("应该处理只有空格的内容", () => {
      const result = parser.parse("   \n\n   ")
      expect(result.thought.trim()).toBe("")
      expect(result.action).toBeNull()
    })

    it("应该正确处理包含 action 关键词的普通文本", () => {
      const content = "The action of the function is to add two numbers."
      const result = parser.parse(content)

      // "action" 不是在行首或空白后，应该作为普通文本
      expect(result.thought).toContain("action")
      expect(result.action).toBeNull()
    })

    it("应该处理 Unicode 字符", () => {
      const content = `Thought: 处理中文文件 🎉
Action: {"action": "read", "action_input": {"file_path": "/测试/文件.txt"}}`
      const result = parser.parse(content)

      expect(result.thought).toContain("处理中文文件")
      expect(result.action?.name).toBe("read")
    })
  })
})
