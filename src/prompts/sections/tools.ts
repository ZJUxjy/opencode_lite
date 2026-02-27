import type { PromptSection } from '../types.js'

/**
 * 工具使用指南 Section
 * 列出可用工具和使用规范
 */
export const toolsSection: PromptSection = {
  name: "tools",

  render: (ctx) => {
    // 生成工具列表（每个工具只取描述的第一行）
    const toolList = ctx.tools
      .map(t => `- ${t.name}: ${t.description.split('\n')[0]}`)
      .join('\n')

    return `Available tools:
${toolList}

Tool usage guidelines:
- Use tools to read, write, edit files and execute commands
- Call multiple tools in parallel when operations are independent
- Always use absolute paths when provided
- If a tool call fails, analyze the error and try a different approach
- After making file changes, verify the results with read tools`
  }
}
