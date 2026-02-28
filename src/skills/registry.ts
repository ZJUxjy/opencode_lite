/**
 * Skills System - Registry
 *
 * 负责：
 * - 管理所有已加载的 skills
 * - 处理 skill 激活/停用
 * - 自动激活逻辑（基于触发器）
 * - 生成 prompt 注入内容
 */

import type {
  Skill,
  SkillMetadata,
  SkillSummary,
  SkillContext,
  SkillRegistryEvents,
  SkillActivationResult,
  SkillDiscoveryConfig,
  SkillLoadOptions,
} from "./types.js"
import { SkillLoader } from "./loader.js"

/**
 * Skill 注册表
 */
export class SkillRegistry {
  private skills = new Map<string, Skill>()
  private loader = new SkillLoader()
  private events: SkillRegistryEvents = {}
  private discoveryConfig: SkillDiscoveryConfig

  constructor(
    discoveryConfig: Partial<SkillDiscoveryConfig> = {},
    events: SkillRegistryEvents = {}
  ) {
    this.discoveryConfig = {
      searchPaths: discoveryConfig.searchPaths ?? [
        "./skills",
        "~/.lite-opencode/skills",
      ],
      includeBuiltins: discoveryConfig.includeBuiltins ?? true,
      recursive: discoveryConfig.recursive ?? false,
    }
    this.events = events
  }

  /**
   * 发现并加载所有 skills
   */
  async discoverAndLoad(options: SkillLoadOptions = {}): Promise<Skill[]> {
    const skills = await this.loader.discover(this.discoveryConfig)

    for (const skill of skills) {
      try {
        this.register(skill)
      } catch (error) {
        this.events.onSkillError?.(
          skill.metadata.id,
          error instanceof Error ? error : new Error(String(error))
        )
      }
    }

    return skills
  }

  /**
   * 注册 skill
   */
  register(skill: Skill): void {
    // 检查 ID 冲突
    if (this.skills.has(skill.metadata.id)) {
      const existing = this.skills.get(skill.metadata.id)!
      // 如果路径相同，是重新加载
      if (existing.basePath === skill.basePath) {
        // 保留激活状态
        skill.isActive = existing.isActive
        skill.activatedAt = existing.activatedAt
      } else {
        throw new Error(
          `Skill ID conflict: ${skill.metadata.id} already registered from ${existing.basePath}`
        )
      }
    }

    this.skills.set(skill.metadata.id, skill)
    this.events.onSkillLoaded?.(skill)

    // 如果是 always 激活策略，自动激活
    if (skill.metadata.activation === "always") {
      this.activate(skill.metadata.id)
    }
  }

  /**
   * 获取 skill
   */
  get(id: string): Skill | undefined {
    return this.skills.get(id)
  }

  /**
   * 获取所有 skills
   */
  getAll(): Skill[] {
    return Array.from(this.skills.values())
  }

  /**
   * 获取所有 skill 摘要（用于列表显示）
   */
  getSummaries(): SkillSummary[] {
    return this.getAll().map((skill) => ({
      id: skill.metadata.id,
      name: skill.metadata.name,
      description: skill.metadata.description,
      version: skill.metadata.version,
      activation: skill.metadata.activation,
      isActive: skill.isActive,
    }))
  }

  /**
   * 获取已激活的 skills
   */
  getActive(): Skill[] {
    return this.getAll().filter((s) => s.isActive)
  }

  /**
   * 激活 skill
   */
  activate(id: string): SkillActivationResult {
    const skill = this.skills.get(id)

    if (!skill) {
      return { success: false, error: `Skill not found: ${id}` }
    }

    if (skill.isActive) {
      return {
        success: true,
        skill,
        promptInjection: this.generatePromptInjection(skill),
      }
    }

    // 检查依赖
    if (skill.metadata.dependencies) {
      for (const depId of skill.metadata.dependencies) {
        const dep = this.skills.get(depId)
        if (!dep) {
          return {
            success: false,
            error: `Missing dependency: ${depId}`,
          }
        }
        if (!dep.isActive) {
          // 自动激活依赖
          const depResult = this.activate(depId)
          if (!depResult.success) {
            return {
              success: false,
              error: `Failed to activate dependency ${depId}: ${depResult.error}`,
            }
          }
        }
      }
    }

    // 检查冲突
    if (skill.metadata.conflicts) {
      for (const conflictId of skill.metadata.conflicts) {
        const conflict = this.skills.get(conflictId)
        if (conflict?.isActive) {
          return {
            success: false,
            error: `Conflicts with active skill: ${conflictId}`,
          }
        }
      }
    }

    // 激活
    skill.isActive = true
    skill.activatedAt = Date.now()

    this.events.onSkillActivated?.(skill)

    return {
      success: true,
      skill,
      promptInjection: this.generatePromptInjection(skill),
    }
  }

  /**
   * 停用 skill
   */
  deactivate(id: string): boolean {
    const skill = this.skills.get(id)

    if (!skill || !skill.isActive) {
      return false
    }

    // 检查是否有其他激活的 skill 依赖于此
    const dependents = this.getAll().filter(
      (s) =>
        s.isActive &&
        s.metadata.dependencies?.includes(id)
    )

    if (dependents.length > 0) {
      console.warn(
        `Cannot deactivate ${id}: required by ${dependents.map((d) => d.metadata.id).join(", ")}`
      )
      return false
    }

    skill.isActive = false
    skill.activatedAt = undefined

    this.events.onSkillDeactivated?.(id)

    return true
  }

  /**
   * 自动激活（基于上下文）
   */
  autoActivate(context: SkillContext): SkillActivationResult[] {
    const results: SkillActivationResult[] = []

    for (const skill of this.getAll()) {
      // 跳过已激活的
      if (skill.isActive) continue

      // 跳过手动激活的
      if (skill.metadata.activation === "manual") continue

      // 检查触发条件
      if (this.shouldAutoActivate(skill, context)) {
        const result = this.activate(skill.metadata.id)
        results.push(result)
      }
    }

    return results
  }

  /**
   * 检查是否应该自动激活
   */
  private shouldAutoActivate(skill: Skill, context: SkillContext): boolean {
    const triggers = skill.metadata.triggers

    if (!triggers) {
      // 没有触发条件时，auto 模式等同于 manual
      return false
    }

    // 检查文件模式
    if (triggers.filePatterns && context.currentFile) {
      for (const pattern of triggers.filePatterns) {
        if (this.matchGlob(context.currentFile, pattern)) {
          return true
        }
      }
    }

    // 检查关键词
    if (triggers.keywords && context.userInput) {
      const input = context.userInput.toLowerCase()
      for (const keyword of triggers.keywords) {
        if (input.includes(keyword.toLowerCase())) {
          return true
        }
      }
    }

    return false
  }

  /**
   * 简单的 glob 匹配
   */
  private matchGlob(path: string, pattern: string): boolean {
    // 转换为正则表达式
    const regex = new RegExp(
      "^" +
        pattern
          .replace(/\*\*/g, "{{GLOBSTAR}}")
          .replace(/\*/g, "[^/]*")
          .replace(/\?/g, ".")
          .replace(/\{\{GLOBSTAR\}\}/g, ".*") +
        "$"
    )

    return regex.test(path)
  }

  /**
   * 生成 prompt 注入内容
   */
  private generatePromptInjection(skill: Skill): string {
    const sections: string[] = []

    // 标题和描述
    sections.push(`# ${skill.metadata.name}`)
    sections.push(``)
    sections.push(skill.metadata.description)
    sections.push(``)

    // 正文内容
    if (skill.content) {
      sections.push(skill.content)
      sections.push(``)
    }

    // 资源引用（只引用，不展开内容）
    if (skill.resourcePaths && skill.resourcePaths.length > 0) {
      sections.push(`## Resources`)
      sections.push(``)
      for (const path of skill.resourcePaths) {
        sections.push(`- ${path}`)
      }
      sections.push(``)
    }

    return sections.join("\n")
  }

  /**
   * 获取所有激活 skills 的 prompt 注入
   */
  getActivePromptInjection(): string {
    const activeSkills = this.getActive()

    if (activeSkills.length === 0) {
      return ""
    }

    const sections: string[] = []
    sections.push(`# Active Skills`)
    sections.push(``)

    for (const skill of activeSkills) {
      sections.push(this.generatePromptInjection(skill))
      sections.push(`---`)
      sections.push(``)
    }

    return sections.join("\n")
  }

  /**
   * 重新加载 skill
   */
  async reload(id: string): Promise<SkillActivationResult> {
    const skill = this.skills.get(id)

    if (!skill) {
      return { success: false, error: `Skill not found: ${id}` }
    }

    const wasActive = skill.isActive

    try {
      const newSkill = await this.loader.reload(skill)

      // 保留激活状态
      if (wasActive) {
        newSkill.isActive = true
        newSkill.activatedAt = skill.activatedAt
      }

      this.skills.set(id, newSkill)
      this.events.onSkillLoaded?.(newSkill)

      return {
        success: true,
        skill: newSkill,
        promptInjection: wasActive ? this.generatePromptInjection(newSkill) : undefined,
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to reload: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  /**
   * 卸载 skill
   */
  unload(id: string): boolean {
    const skill = this.skills.get(id)

    if (!skill) {
      return false
    }

    if (skill.isActive) {
      this.deactivate(id)
    }

    return this.skills.delete(id)
  }

  /**
   * 清除所有 skills
   */
  clear(): void {
    this.skills.clear()
  }
}

/**
 * 全局 SkillRegistry 实例
 */
let globalSkillRegistry: SkillRegistry | null = null

export function getSkillRegistry(
  config?: Partial<SkillDiscoveryConfig>,
  events?: SkillRegistryEvents
): SkillRegistry {
  if (!globalSkillRegistry) {
    globalSkillRegistry = new SkillRegistry(config, events)
  }
  return globalSkillRegistry
}

/**
 * 重置全局实例（用于测试）
 */
export function resetSkillRegistry(): void {
  globalSkillRegistry = null
}
