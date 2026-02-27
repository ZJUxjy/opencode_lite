import type { PromptContext, PromptSection } from './types.js'
import { identitySection } from './sections/identity.js'
import { environmentSection } from './sections/environment.js'
import { toolsSection } from './sections/tools.js'
import { constraintsSection } from './sections/constraints.js'

export type { PromptContext, PromptSection, ToolDefinition } from './types.js'
export { substitute } from './utils.js'

/**
 * PromptProvider - 模块化 Prompt 生成器
 *
 * 负责组装各个 prompt sections 成完整的 system prompt
 */
export class PromptProvider {
  private sections: PromptSection[]

  constructor() {
    // 注册默认的 prompt sections（按顺序）
    this.sections = [
      identitySection,
      environmentSection,
      toolsSection,
      constraintsSection,
    ]
  }

  /**
   * 生成完整的 system prompt
   *
   * @param ctx - Prompt 上下文，包含模型、工作目录、工具等信息
   * @returns 组装好的 system prompt 字符串
   */
  getSystemPrompt(ctx: PromptContext): string {
    const parts: string[] = []

    for (const section of this.sections) {
      // 检查 section 是否启用
      if (section.enabled && !section.enabled(ctx)) {
        continue
      }

      const content = section.render(ctx)
      if (content) {
        parts.push(content)
      }
    }

    // 用双换行连接各个 section
    return parts.join('\n\n')
  }

  /**
   * 获取上下文压缩 prompt
   * 用于让 LLM 生成对话摘要
   */
  getCompactionPrompt(): string {
    return `Please summarize the following conversation history concisely.
Keep key information, decisions, file changes, and context needed for continuing the conversation.
Focus on:
- User's original request and goals
- Key decisions made
- Files that were read, modified, or created
- Any errors encountered and how they were resolved
- Current state of the task`
  }

  /**
   * 添加自定义 section
   * 可用于扩展 prompt 系统
   */
  addSection(section: PromptSection, position?: number): void {
    if (position !== undefined) {
      this.sections.splice(position, 0, section)
    } else {
      this.sections.push(section)
    }
  }

  /**
   * 移除指定名称的 section
   */
  removeSection(name: string): boolean {
    const index = this.sections.findIndex(s => s.name === name)
    if (index !== -1) {
      this.sections.splice(index, 1)
      return true
    }
    return false
  }
}
