import type { PromptSection } from '../types.js'

/**
 * 环境上下文 Section
 * 提供工作目录、平台、日期等环境信息
 */
export const environmentSection: PromptSection = {
  name: "environment",

  render: (ctx) => `<environment>
Working directory: ${ctx.cwd}
Platform: ${ctx.platform}
Model: ${ctx.model}
Today's date: ${ctx.date.toISOString().split('T')[0]}
</environment>`
}
