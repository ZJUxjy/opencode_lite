import type { PromptSection, PromptContext } from "../types.js"

/**
 * Skills Section
 *
 * 渲染已激活的 skills 内容
 * 只有在有激活的 skills 时才显示
 */
export const skillsSection: PromptSection = {
  name: "skills",

  enabled: (ctx: PromptContext) => {
    // 只有当有激活的 skills 时才启用
    return !!ctx.skills && ctx.skills.length > 0
  },

  render: (ctx: PromptContext) => {
    if (!ctx.skills) {
      return ""
    }

    return ctx.skills
  },
}
