import type { PromptSection, PromptContext } from "../types.js"

/**
 * Skills Section
 *
 * Renders:
 * 1. Available skills list (always shown when skills are loaded)
 * 2. Active skills content (shown when skills are activated)
 */
export const skillsSection: PromptSection = {
  name: "skills",

  enabled: (ctx: PromptContext) => {
    // Show when there are available skills OR active skills
    return !!ctx.availableSkills || (!!ctx.skills && ctx.skills.length > 0)
  },

  render: (ctx: PromptContext) => {
    const parts: string[] = []

    // Show available skills for LLM to decide activation
    if (ctx.availableSkills) {
      parts.push(`# Available Skills

The following skills are available. Use \`activate_skill\` tool to activate relevant skills based on the task.

${ctx.availableSkills}
`)
    }

    // Show active skills content
    if (ctx.skills && ctx.skills.length > 0) {
      parts.push(`# Active Skills

${ctx.skills}
`)
    }

    return parts.join("\n---\n\n")
  },
}
