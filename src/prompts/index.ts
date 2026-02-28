import type { PromptContext, PromptSection } from './types.js'
import { identitySection } from './sections/identity.js'
import { environmentSection } from './sections/environment.js'
import { toolsSection } from './sections/tools.js'
import { constraintsSection } from './sections/constraints.js'
import { reactSection } from './sections/react.js'
import { objectivesSection } from './sections/objectives.js'
import { memorySection } from './sections/memory.js'
import { errorHandlingSection } from './sections/errorHandling.js'
import { workflowSection } from './sections/workflow.js'
import { planModeSection } from './sections/plan.js'

export type { PromptContext, PromptSection, ToolDefinition } from './types.js'
export { substitute } from './utils.js'
export { reactSection } from './sections/react.js'

// 导出所有 section 供外部使用
export { identitySection } from './sections/identity.js'
export { environmentSection } from './sections/environment.js'
export { toolsSection } from './sections/tools.js'
export { constraintsSection } from './sections/constraints.js'
export { objectivesSection } from './sections/objectives.js'
export { memorySection } from './sections/memory.js'
export { errorHandlingSection } from './sections/errorHandling.js'
export { workflowSection } from './sections/workflow.js'
export { planModeSection } from './sections/plan.js'

/**
 * PromptProvider - 模块化 Prompt 生成器
 *
 * 负责组装各个 prompt sections 成完整的 system prompt
 *
 * Phase 4 增强：
 * - 扩展到 9 个 section
 * - 支持更丰富的上下文指导
 */
export class PromptProvider {
  private sections: PromptSection[]

  constructor() {
    // 注册默认的 prompt sections（按顺序）
    // 参考 kilocode 的 4 层结构: soul -> provider -> env -> instruction
    this.sections = [
      // 身份层 (soul)
      identitySection,

      // 目标层 (objectives)
      objectivesSection,

      // 环境层 (env)
      environmentSection,

      // 工具层 (tools)
      toolsSection,

      // 工作流程层 (workflow)
      workflowSection,

      // 记忆管理层 (memory)
      memorySection,

      // 错误处理层 (error handling)
      errorHandlingSection,

      // 约束层 (constraints)
      constraintsSection,

      // Plan Mode 层 (条件渲染，仅 Plan Mode 启用时)
      planModeSection,

      // ReAct 格式层 (条件渲染，仅 CoT 模式)
      reactSection,
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
