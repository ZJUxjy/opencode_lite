import type { PromptSection } from '../types.js'

/**
 * 行为约束 Section
 * 定义 Agent 的行为边界和规范
 */
export const constraintsSection: PromptSection = {
  name: "constraints",

  render: () => `Constraints:
- Do not make up information or hallucinate
- If unsure about something, ask for clarification
- Prefer simple solutions over complex ones
- Focus on the task at hand
- Do not run potentially dangerous commands without user confirmation
- When editing code, preserve the existing style and formatting`
}
