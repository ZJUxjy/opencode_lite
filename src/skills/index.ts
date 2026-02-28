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
 * - Dynamic activation: auto/manual/always policies
 *
 * Usage:
 * ```typescript
 * import { getSkillRegistry, SkillLoader } from './skills/index.js'
 *
 * // 加载所有 skills
 * const registry = getSkillRegistry()
 * await registry.discoverAndLoad()
 *
 * // 手动激活
 * registry.activate('my-skill')
 *
 * // 自动激活（基于上下文）
 * registry.autoActivate({
 *   cwd: process.cwd(),
 *   currentFile: 'src/App.tsx',
 *   userInput: 'help me debug this'
 * })
 *
 * // 获取 prompt 注入
 * const injection = registry.getActivePromptInjection()
 * ```
 */

export * from "./types.js"
export * from "./loader.js"
export * from "./registry.js"
