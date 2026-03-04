/**
 * Skills System - Registry
 *
 * 负责：
 * - 管理所有已加载的 skills
 * - 处理 skill 激活/停用
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
import { SkillWatcher } from "./watcher.js"

/**
 * Skill 注册表
 */
export class SkillRegistry {
  private skills = new Map<string, Skill>()
  private loader = new SkillLoader()
  private events: SkillRegistryEvents = {}
  private discoveryConfig: SkillDiscoveryConfig
  private watcher?: SkillWatcher

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
   * Enable hot reload watching
   */
  enableHotReload(): void {
    if (this.watcher) return

    this.watcher = new SkillWatcher({
      paths: this.discoveryConfig.searchPaths,
      debounceMs: 300,
      recursive: true,
    })

    // Handle skill changes
    this.watcher.on("skill-changed", async (skillId, path) => {
      console.log(`[Skills] Detected change in ${skillId}, reloading...`)
      await this.handleSkillChange(skillId, path)
    })

    this.watcher.on("skill-added", async (path) => {
      console.log(`[Skills] New skill detected at ${path}, loading...`)
      await this.handleSkillAdded(path)
    })

    this.watcher.on("error", (error) => {
      console.error("[Skills] Watcher error:", error)
    })

    this.watcher.start()
  }

  /**
   * Disable hot reload watching
   */
  disableHotReload(): void {
    this.watcher?.stop()
    this.watcher = undefined
  }

  /**
   * Handle skill file change
   */
  private async handleSkillChange(skillId: string, path: string): Promise<void> {
    // Check if it's an existing skill
    const existingSkill = this.skills.get(skillId)

    if (existingSkill) {
      try {
        const result = await this.reload(skillId)
        if (result.success) {
          this.events.onSkillReloaded?.(result.skill!)
        } else {
          this.events.onSkillError?.(skillId, new Error(result.error))
        }
      } catch (error) {
        this.events.onSkillError?.(
          skillId,
          error instanceof Error ? error : new Error(String(error))
        )
      }
    }
  }

  /**
   * Handle new skill detected
   */
  private async handleSkillAdded(path: string): Promise<void> {
    try {
      const skill = await this.loader.loadFromDirectory(path)
      if (skill) {
        this.register(skill)
      }
    } catch (error) {
      console.error(`[Skills] Failed to load new skill from ${path}:`, error)
    }
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
   * 获取可用 skills 的描述列表（供 LLM 参考决定激活哪些）
   */
  getAvailableSkillsDescription(): string {
    const skills = this.getAll()

    if (skills.length === 0) {
      return ""
    }

    const lines: string[] = []

    for (const skill of skills) {
      const status = skill.isActive ? " [ACTIVE]" : ""
      const activation = skill.metadata.activation === "always" ? " (always-on)" : ""
      lines.push(`- **${skill.metadata.id}**: ${skill.metadata.description}${status}${activation}`)
    }

    return lines.join("\n")
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
