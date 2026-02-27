/**
 * ReAct 格式说明 Section
 *
 * 用于 CoT 模式，指导 LLM 输出 ReAct 格式
 */

import type { PromptSection } from "../types.js"

/**
 * ReAct 格式说明 Section
 *
 * 告诉 LLM 如何输出 Thought/Action 格式
 */
export const reactSection: PromptSection = {
  name: "react",

  /**
   * 条件渲染：仅在 CoT 模式时启用
   * 这个判断需要从 context 中获取策略信息
   */
  enabled: (ctx) => {
    // 如果 context 中有 strategy 字段且为 cot，则启用
    if ((ctx as any).strategy === "cot") {
      return true
    }
    // 默认不启用（FC 模式不需要此 Section）
    return false
  },

  render: (ctx) => {
    const tools = ctx.tools || []
    const toolNames = tools.map((t) => t.name).join(", ")

    return `## Response Format (ReAct)

You must respond in the following ReAct (Reasoning + Acting) format:

\`\`\`
Thought: Think about what to do next, consider previous steps and current state
Action:
\`\`\`json
{
  "action": "tool_name",
  "action_input": { "param": "value" }
}
\`\`\`
\`\`\`

When you have the final answer for the user:

\`\`\`
Thought: I now know the final answer
Action:
\`\`\`json
{
  "action": "Final Answer",
  "action_input": "Your final response to the user"
}
\`\`\`
\`\`\`

Valid action values: "Final Answer" or ${toolNames}

IMPORTANT:
- Always use exactly ONE action per response
- Always use valid JSON format for the action
- Think step by step before each action
- Use "Final Answer" when you have completed the task`
  },
}
