/**
 * Skills System
 *
 * 基于 claude-code、gemini-cli、kimi-cli 调研结果的共识设计：
 *
 * Core Concepts:
 * - Skill: Markdown-based capability definition
 * - SKILL.md: YAML frontmatter + markdown body
 * - Auto-discovery: Scan skills/ directories
 * - Progressive disclosure: metadata → body → resources
 * - LLM-driven activation: LLM reads descriptions and decides when to activate
 *
 * Usage:
 * ```typescript
 * import { getSkillRegistry, SkillLoader } from './skills/index.js'
 *
 * // 加载所有 skills
 * const registry = getSkillRegistry()
 * await registry.discoverAndLoad()
 *
 * // 获取可用 skills 列表（注入到 prompt）
 * const availableSkills = registry.getAvailableSkillsDescription()
 *
 * // 激活 skill（通过 activate_skill 工具调用）
 * registry.activate('my-skill')
 *
 * // 获取已激活 skills 的 prompt 注入
 * const injection = registry.getActivePromptInjection()
 * ```
 */

export * from "./types.js"
export * from "./loader.js"
export * from "./registry.js"
