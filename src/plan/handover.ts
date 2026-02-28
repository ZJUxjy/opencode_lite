/**
 * Handover 生成器
 *
 * 生成计划交接摘要，用于传递给下一个会话
 * 包含：发现、相关文件、实现注意事项
 */

import type { Message } from "../types.js"

export interface HandoverData {
  discoveries: string
  relevantFiles: string
  implementationNotes: string
}

/**
 * Handover Prompt 模板
 * 用于让 AI 生成交接摘要
 */
export const HANDOVER_PROMPT = `You are summarizing a planning session to hand off to an implementation session.

The plan itself will be provided separately — do NOT repeat it. Instead, focus on information discovered during planning that would help the implementing agent but is NOT already in the plan text.

Produce a concise summary using this template:
---
## Discoveries

[Key findings from code exploration — architecture patterns, gotchas, edge cases, relevant existing code that the plan references but doesn't fully explain]

## Relevant Files

[Structured list of files/directories that were read or discussed, with brief notes on what's relevant in each]

## Implementation Notes

[Any important context: conventions to follow, potential pitfalls, dependencies between steps, things the implementing agent should watch out for]
---

If there is nothing useful to add beyond what the plan already says, respond with an empty string.
Keep the summary concise — focus on high-entropy information that would save the implementing agent time.`

/**
 * 从消息历史中提取 Handover 信息
 * 简化版：从 assistant 消息中提取探索结果
 */
export function extractHandoverFromMessages(messages: Message[]): Partial<HandoverData> {
  const handover: Partial<HandoverData> = {}

  // 收集所有 assistant 消息中的探索结果
  const assistantMessages = messages.filter(m => m.role === "assistant")

  // 提取发现的文件（从 toolResults 中）
  const discoveredFiles: string[] = []
  for (const msg of messages) {
    if (msg.toolResults) {
      for (const result of msg.toolResults) {
        // 尝试从结果中提取文件路径
        const fileMatch = result.content.match(/\/([\w\/\-\.]+\.(ts|js|tsx|jsx|json|md))/g)
        if (fileMatch) {
          discoveredFiles.push(...fileMatch)
        }
      }
    }
  }

  if (discoveredFiles.length > 0) {
    handover.relevantFiles = [...new Set(discoveredFiles)].slice(0, 10).join("\n")
  }

  // 提取实现注意事项（从 assistant 消息的最后几条）
  const recentMessages = assistantMessages.slice(-3)
  const notes: string[] = []

  for (const msg of recentMessages) {
    // 查找包含 "注意", "小心", "重要" 等的句子
    const importantLines = msg.content
      .split("\n")
      .filter(line =>
        /\b(注意|小心|重要|关键|务必|记得|不要忘了|关键点)\b/i.test(line) ||
        /\b(note|caution|important|key|critical|remember|watch out|be careful)\b/i.test(line)
      )
    notes.push(...importantLines)
  }

  if (notes.length > 0) {
    handover.implementationNotes = notes.slice(0, 5).join("\n")
  }

  return handover
}

/**
 * 生成 Handover 文本
 */
export function formatHandover(data: Partial<HandoverData>): string {
  const sections: string[] = []

  if (data.discoveries) {
    sections.push(`## Discoveries\n\n${data.discoveries}`)
  }

  if (data.relevantFiles) {
    sections.push(`## Relevant Files\n\n${data.relevantFiles}`)
  }

  if (data.implementationNotes) {
    sections.push(`## Implementation Notes\n\n${data.implementationNotes}`)
  }

  if (sections.length === 0) {
    return ""
  }

  return `# Handover from Planning Session\n\n${sections.join("\n\n")}`
}

/**
 * 构建新会话的初始提示
 */
export function buildNewSessionPrompt(args: {
  planContent: string
  handover?: string
  todoList?: string
}): string {
  const { planContent, handover, todoList } = args

  const sections: string[] = [
    "Implement the following plan:\n",
    "## Plan\n",
    planContent,
  ]

  if (handover && handover.trim()) {
    sections.push("\n## Handover from Planning Session\n")
    sections.push(handover.trim())
  }

  if (todoList && todoList.trim()) {
    sections.push("\n## Todo List\n")
    sections.push(todoList.trim())
  }

  return sections.join("\n")
}

/**
 * 构建继续当前会话的提示
 */
export function buildContinueSessionPrompt(planContent: string): string {
  return `Continue with the implementation of this plan:\n\n${planContent}\n\nYou can now start implementing the planned changes.`
}
