import { z } from "zod"
import type { Tool } from "../types.js"
import { getSkillRegistry } from "../skills/index.js"

/**
 * 列出可用 Skills
 */
export const listSkillsTool: Tool = {
  name: "list_skills",
  description: `List all available skills in the system.

Skills are capabilities that can be dynamically activated to enhance the agent's behavior for specific tasks.

Shows:
- Skill ID (use this to activate)
- Name and description
- Activation mode (auto/manual/always)
- Current status (active/inactive)`,

  parameters: z.object({
    active_only: z
      .boolean()
      .optional()
      .describe("Only show currently active skills"),
  }),

  execute: async (params) => {
    const registry = getSkillRegistry()
    const summaries = registry.getSummaries()

    const filtered = params.active_only
      ? summaries.filter((s) => s.isActive)
      : summaries

    if (filtered.length === 0) {
      return params.active_only
        ? "No active skills. Use activate_skill to enable skills."
        : "No skills found. Skills should be placed in ./skills or ~/.lite-opencode/skills directories."
    }

    const lines: string[] = []
    lines.push(`# Available Skills (${filtered.length})`)
    lines.push(``)

    for (const skill of filtered) {
      const status = skill.isActive ? "🟢" : "⚪"
      const activation = `[${skill.activation}]`
      lines.push(`${status} **${skill.id}** ${activation}`)
      lines.push(`   ${skill.name}`)
      lines.push(`   ${skill.description}`)
      lines.push(``)
    }

    if (!params.active_only) {
      lines.push(`---`)
      lines.push(`To activate a skill: activate_skill id="skill-id"`)
    }

    return lines.join("\n")
  },
}

/**
 * 激活 Skill
 */
export const activateSkillTool: Tool = {
  name: "activate_skill",
  description: `Activate a skill to enhance the agent's capabilities.

Skills provide specialized knowledge and behavior for specific tasks like:
- Code review and best practices
- Testing strategies (TDD)
- Documentation writing
- Debugging techniques
- Framework-specific guidance (React, Node.js, etc.)

Once activated, the skill's instructions will be included in the system prompt.

Some skills auto-activate based on file patterns or keywords.
Others need manual activation with this tool.`,

  parameters: z.object({
    id: z.string().describe("The skill ID to activate (from list_skills)"),
  }),

  execute: async (params) => {
    const registry = getSkillRegistry()
    const result = registry.activate(params.id)

    if (!result.success) {
      return `Failed to activate skill: ${result.error}`
    }

    const skill = result.skill!
    const lines: string[] = []

    lines.push(`✅ Activated skill: ${skill.metadata.name}`)
    lines.push(``)
    lines.push(`Description: ${skill.metadata.description}`)
    lines.push(`Version: ${skill.metadata.version}`)

    if (skill.metadata.dependencies?.length) {
      lines.push(`Dependencies: ${skill.metadata.dependencies.join(", ")}`)
    }

    if (skill.resourcePaths?.length) {
      lines.push(`Resources: ${skill.resourcePaths.length} files`)
    }

    lines.push(``)
    lines.push(`The skill is now active and its guidance will be applied.`,)

    return lines.join("\n")
  },
}

/**
 * 停用 Skill
 */
export const deactivateSkillTool: Tool = {
  name: "deactivate_skill",
  description: `Deactivate a previously activated skill.

Use this when you no longer need a skill's specialized guidance,
or when you want to switch to a different approach.`,

  parameters: z.object({
    id: z.string().describe("The skill ID to deactivate"),
  }),

  execute: async (params) => {
    const registry = getSkillRegistry()
    const success = registry.deactivate(params.id)

    if (!success) {
      const skill = registry.get(params.id)
      if (!skill) {
        return `Skill not found: ${params.id}`
      }
      return `Skill ${params.id} is not currently active, or cannot be deactivated (has dependents)`
    }

    return `Deactivated skill: ${params.id}`
  },
}

/**
 * 显示 Skill 详情
 */
export const showSkillTool: Tool = {
  name: "show_skill",
  description: `Show detailed information about a specific skill.

Displays the full skill definition including:
- Metadata (name, version, author, tags)
- Complete content/instructions
- Available resources
- Dependencies and conflicts`,

  parameters: z.object({
    id: z.string().describe("The skill ID to show"),
    include_resources: z
      .boolean()
      .optional()
      .describe("Also load and display resource file contents"),
  }),

  execute: async (params) => {
    const registry = getSkillRegistry()
    const skill = registry.get(params.id)

    if (!skill) {
      return `Skill not found: ${params.id}`
    }

    const lines: string[] = []

    // Header
    lines.push(`# ${skill.metadata.name}`)
    lines.push(``)

    // Metadata
    lines.push(`## Metadata`)
    lines.push(``)
    lines.push(`- **ID**: ${skill.metadata.id}`)
    lines.push(`- **Version**: ${skill.metadata.version}`)
    lines.push(`- **Activation**: ${skill.metadata.activation}`)
    lines.push(`- **Status**: ${skill.isActive ? "🟢 Active" : "⚪ Inactive"}`)

    if (skill.metadata.author) {
      lines.push(`- **Author**: ${skill.metadata.author}`)
    }

    if (skill.metadata.tags?.length) {
      lines.push(`- **Tags**: ${skill.metadata.tags.join(", ")}`)
    }

    lines.push(``)

    // Description
    lines.push(`## Description`)
    lines.push(``)
    lines.push(skill.metadata.description)
    lines.push(``)

    // Dependencies
    if (skill.metadata.dependencies?.length) {
      lines.push(`## Dependencies`)
      lines.push(``)
      for (const dep of skill.metadata.dependencies) {
        const depSkill = registry.get(dep)
        const status = depSkill?.isActive ? "✅" : "⬜"
        lines.push(`${status} ${dep}`)
      }
      lines.push(``)
    }

    // Conflicts
    if (skill.metadata.conflicts?.length) {
      lines.push(`## Conflicts`)
      lines.push(``)
      for (const conflict of skill.metadata.conflicts) {
        lines.push(`- ${conflict}`)
      }
      lines.push(``)
    }

    // Content
    if (skill.content) {
      lines.push(`## Content`)
      lines.push(``)
      lines.push(skill.content)
      lines.push(``)
    }

    // Resources
    if (skill.resourcePaths?.length) {
      lines.push(`## Resources (${skill.resourcePaths.length})`)
      lines.push(``)

      for (const path of skill.resourcePaths) {
        lines.push(`- ${path}`)
      }

      // Load resource contents if requested
      if (params.include_resources) {
        const loader = registry["loader"]
        lines.push(``)

        for (const path of skill.resourcePaths) {
          const resource = await loader.loadResource(skill, path)
          if (resource) {
            lines.push(`### ${path}`)
            lines.push(``)
            lines.push("```")
            lines.push(resource.content)
            lines.push("```")
            lines.push(``)
          }
        }
      } else {
        lines.push(``)
        lines.push(`Use show_skill id="${params.id}" include_resources=true to view resource contents.`)
      }

      lines.push(``)
    }

    return lines.join("\n")
  },
}

/**
 * 获取当前激活 Skills 的 Prompt 注入
 */
export const getActiveSkillsPromptTool: Tool = {
  name: "get_active_skills_prompt",
  description: `Get the combined prompt injection from all active skills.

This shows what content is currently being added to the system prompt
from activated skills. Useful for debugging skill behavior.`,

  parameters: z.object({}),

  execute: async () => {
    const registry = getSkillRegistry()
    const injection = registry.getActivePromptInjection()

    if (!injection) {
      return "No skills are currently active."
    }

    return injection
  },
}
