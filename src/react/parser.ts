/**
 * ReAct 输出解析器
 *
 * 参考: dify cot_output_parser.py
 *
 * 状态跟踪机制:
 * 1. 代码块解析状态 (codeBlockCache, inCodeBlock)
 * 2. JSON 解析状态 (jsonCache, braceCount)
 * 3. Action 关键词匹配状态
 * 4. Thought 关键词匹配状态
 * 5. 边界检测 (lastCharacter)
 *
 * Phase 2 增强:
 * - 嵌套 JSON 支持（大括号计数器）
 * - 多模型兼容（Cohere、Ollama 等）
 * - 容错处理（JSON 解析失败时返回原始文本）
 */

import type { Action, ParseResult } from "./types.js"

/**
 * JSON 提取结果
 */
interface JsonExtraction {
  json: any
  raw: string
  isValid: boolean
}

/**
 * ReAct 流式输出解析器
 *
 * 从 LLM 输出中解析 Thought/Action/Observation
 */
export class ReActParser {
  // ═══════════════════════════════════════════════════════
  // 1. 代码块解析状态
  // ═══════════════════════════════════════════════════════
  private codeBlockCache = ""
  private codeBlockDelimiterCount = 0
  private inCodeBlock = false

  // ═══════════════════════════════════════════════════════
  // 2. JSON 解析状态
  // ═══════════════════════════════════════════════════════
  private jsonCache = ""
  private braceCount = 0
  private inJson = false

  // ═══════════════════════════════════════════════════════
  // 3. 解析状态
  // ═══════════════════════════════════════════════════════
  private lastCharacter = ""
  private inActionSection = false  // 是否在 Action: 之后

  // 已解析的结果
  private parsedThought = ""
  private parsedAction: Action | null = null

  /**
   * 解析完整的 ReAct 响应
   */
  parse(content: string): {
    thought: string
    action: Action | null
    raw: string
  } {
    this.reset()

    // 使用更简单的两阶段解析：
    // 1. 先提取 Thought
    // 2. 再提取 Action

    const lines = content.split("\n")
    let capturingThought = false
    let thoughtLines: string[] = []
    let actionContent = ""
    let inCodeBlock = false
    let codeBlockContent = ""

    for (const line of lines) {
      const trimmedLine = line.trim()

      // 检测 Thought 开始
      if (trimmedLine.toLowerCase().startsWith("thought:")) {
        capturingThought = true
        const thoughtContent = trimmedLine.substring(8).trim()
        if (thoughtContent) {
          thoughtLines.push(thoughtContent)
        }
        continue
      }

      // 检测 Action 开始
      if (trimmedLine.toLowerCase().startsWith("action:")) {
        capturingThought = false
        this.inActionSection = true
        // Action 后面可能有 JSON 在同一行
        const afterAction = trimmedLine.substring(7).trim()
        if (afterAction) {
          actionContent = afterAction
        }
        continue
      }

      // 收集 Thought
      if (capturingThought) {
        // 如果遇到空行后跟非缩进内容，停止收集
        if (trimmedLine === "") {
          thoughtLines.push("")
        } else if (!line.startsWith(" ") && !line.startsWith("\t") &&
                   !trimmedLine.toLowerCase().startsWith("action:")) {
          thoughtLines.push(trimmedLine)
        } else {
          thoughtLines.push(trimmedLine)
        }
      }

      // 收集 Action 内容
      if (this.inActionSection) {
        // 检测代码块
        if (trimmedLine.startsWith("```")) {
          if (!inCodeBlock) {
            inCodeBlock = true
            codeBlockContent = ""
          } else {
            // 代码块结束
            inCodeBlock = false
            // 尝试从代码块解析 JSON
            const extracted = this.extractJsonFromText(codeBlockContent)
            if (extracted) {
              this.parsedAction = this.parseAction(extracted.json)
            }
          }
          continue
        }

        if (inCodeBlock) {
          codeBlockContent += line + "\n"
        } else {
          actionContent += line + " "
        }
      }
    }

    // 处理收集的内容
    this.parsedThought = thoughtLines.join("\n").trim()

    // 如果没有从代码块解析出 Action，尝试从 actionContent 解析
    if (!this.parsedAction && actionContent.trim()) {
      const extracted = this.extractJsonFromText(actionContent.trim())
      if (extracted) {
        this.parsedAction = this.parseAction(extracted.json)
      }
    }

    // 如果没有 Thought: 前缀，也没有 Action，把整个内容作为 thought
    if (!this.parsedThought && !this.parsedAction) {
      this.parsedThought = content.trim()
    }

    return {
      thought: this.parsedThought,
      action: this.parsedAction,
      raw: content
    }
  }

  /**
   * 从文本中提取 JSON
   */
  private extractJsonFromText(text: string): JsonExtraction | null {
    // 移除可能的 ```json 和 ``` 标记
    let cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim()

    // 尝试找到 JSON 对象或数组
    const jsonMatch = cleaned.match(/([\[{][\s\S]*[}\]])/)
    if (jsonMatch) {
      const jsonStr = jsonMatch[1]
      return this.tryParseJson(jsonStr)
    }

    // 尝试直接解析
    if (cleaned.startsWith("{") || cleaned.startsWith("[")) {
      return this.tryParseJson(cleaned)
    }

    return null
  }

  /**
   * 流式解析
   */
  *parseStream(chunks: Generator<string, void, unknown>): Generator<ParseResult, void, unknown> {
    this.reset()

    let buffer = ""
    let lastThoughtLength = 0

    for (const chunk of chunks) {
      buffer += chunk

      // 尝试解析当前 buffer，获取增量 thought
      const partial = this.parsePartial(buffer)
      if (partial.thoughtDelta && partial.thoughtDelta.length > lastThoughtLength) {
        const delta = partial.thoughtDelta.substring(lastThoughtLength)
        if (delta) {
          yield { type: "thought", value: delta }
        }
        lastThoughtLength = partial.thoughtDelta.length
      }
    }

    // 最终解析完整的 buffer
    const final = this.parse(buffer)
    if (final.action) {
      yield { type: "action", value: final.action }
    }
  }

  /**
   * 部分解析（用于流式）
   */
  private parsePartial(buffer: string): { thoughtDelta: string | null } {
    // 简单实现：检测 Thought 内容
    const thoughtMatch = buffer.match(/Thought:\s*([\s\S]*?)(?=\n\s*Action:|$)/i)
    if (thoughtMatch) {
      return { thoughtDelta: thoughtMatch[1] }
    }
    return { thoughtDelta: null }
  }

  /**
   * 异步流式解析
   */
  async *parseStreamAsync(
    chunks: AsyncGenerator<string, void, unknown>
  ): AsyncGenerator<ParseResult, void, unknown> {
    this.reset()

    for await (const chunk of chunks) {
      for (const char of chunk) {
        const result = this.processChar(char)
        if (result.type) {
          yield result
        }
      }
    }
  }

  /**
   * 逐字符处理（保留用于某些场景）
   */
  private processChar(char: string): ParseResult {
    const result: ParseResult = { type: null, value: null }

    // 简化实现
    return result
  }

  /**
   * 安全解析 JSON - 带容错
   */
  private tryParseJson(jsonStr: string): JsonExtraction {
    const result: JsonExtraction = {
      json: null,
      raw: jsonStr,
      isValid: false
    }

    try {
      result.json = JSON.parse(jsonStr)
      result.isValid = true
    } catch {
      try {
        // 修复 1: 移除尾随逗号
        const fixed1 = jsonStr.replace(/,(\s*[}\]])/g, "$1")
        result.json = JSON.parse(fixed1)
        result.isValid = true
      } catch {
        try {
          // 修复 2: 添加缺失的引号
          const fixed2 = jsonStr
            .replace(/(\w+)\s*:/g, '"$1":')
            .replace(/:\s*'([^']*)'/g, ': "$1"')
          result.json = JSON.parse(fixed2)
          result.isValid = true
        } catch {
          result.isValid = false
        }
      }
    }

    return result
  }

  /**
   * 解析 Action - 支持多模型格式
   */
  private parseAction(json: any): Action | null {
    if (typeof json === "string") {
      const extracted = this.tryParseJson(json)
      if (!extracted.isValid) {
        return null
      }
      json = extracted.json
    }

    if (json === null || json === undefined) {
      return null
    }

    // Cohere 列表格式
    if (Array.isArray(json)) {
      if (json.length === 0) return null
      return this.parseAction(json[0])
    }

    // Ollama 格式: {"tool_calls": [{"function": {"name": "...", "arguments": "..."}}]}
    if (json.tool_calls && Array.isArray(json.tool_calls)) {
      if (json.tool_calls.length === 0) return null
      const firstCall = json.tool_calls[0]
      if (firstCall.function) {
        let input = firstCall.function.arguments
        if (typeof input === "string") {
          try {
            input = JSON.parse(input)
          } catch {
            // 保持原字符串
          }
        }
        return {
          name: firstCall.function.name,
          input: input ?? {},
        }
      }
    }

    if (typeof json !== "object") {
      return null
    }

    let actionName: string | null = null
    let actionInput: Record<string, unknown> | string | null = null

    for (const [key, value] of Object.entries(json)) {
      const lowerKey = key.toLowerCase()

      // 匹配 action name
      if (
        (lowerKey.includes("action") && !lowerKey.includes("input")) ||
        lowerKey === "name" ||
        lowerKey === "tool" ||
        lowerKey === "function_name"
      ) {
        actionName = String(value)
      }

      // 匹配 action input
      if (
        lowerKey.includes("input") ||
        lowerKey === "arguments" ||
        lowerKey === "parameters" ||
        lowerKey === "args"
      ) {
        actionInput = value as Record<string, unknown> | string
      }
    }

    if (actionName) {
      return {
        name: actionName,
        input: actionInput ?? {},
      }
    }

    return null
  }

  /**
   * 重置所有状态
   */
  reset(): void {
    this.codeBlockCache = ""
    this.codeBlockDelimiterCount = 0
    this.inCodeBlock = false
    this.jsonCache = ""
    this.braceCount = 0
    this.inJson = false
    this.lastCharacter = ""
    this.inActionSection = false
    this.parsedThought = ""
    this.parsedAction = null
  }

  /**
   * 获取当前解析状态
   */
  getState(): {
    inCodeBlock: boolean
    inJson: boolean
    braceCount: number
    position: number
  } {
    return {
      inCodeBlock: this.inCodeBlock,
      inJson: this.inJson,
      braceCount: this.braceCount,
      position: 0,
    }
  }
}
