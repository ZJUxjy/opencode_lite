/**
 * Skills System - Types
 *
 * 基于调研 claude-code、gemini-cli、kimi-cli 的共识设计：
 * - Markdown + YAML Frontmatter 格式
 * - Auto-discovery 从 skills/ 目录
 * - Progressive disclosure 渐进式加载
 * - Dynamic activation 动态激活
 */

/**
 * Skill 元数据（YAML Frontmatter）
 */
export interface SkillMetadata {
  /** Skill 唯一标识符 */
  id: string
  /** 显示名称 */
  name: string
  /** 简短描述（用于技能列表） */
  description: string
  /** 版本号 */
  version: string
  /** 作者 */
  author?: string
  /** 标签/分类 */
  tags?: string[]
  /**
   * 激活策略
   * - auto: 可被 LLM 自动激活（基于 description 匹配）
   * - manual: 仅通过 /skill 命令或 activate_skill 工具激活
   * - always: 加载时自动激活
   */
  activation: "auto" | "manual" | "always"
  /**
   * 依赖的其他 skills
   */
  dependencies?: string[]
  /**
   * 冲突的 skills
   */
  conflicts?: string[]
}

/**
 * Skill 资源（附加文件）
 */
export interface SkillResource {
  /** 资源路径（相对于 skill 目录） */
  path: string
  /** 资源内容 */
  content: string
  /** 资源类型 */
  type: "template" | "example" | "doc" | "schema"
}

/**
 * 完整的 Skill 定义
 */
export interface Skill {
  /** 元数据 */
  metadata: SkillMetadata
  /** Skill 正文内容（Markdown） */
  content: string
  /**
   * 资源文件
   * 懒加载：只在需要时读取
   */
  resources?: SkillResource[]
  /**
   * 资源路径列表（用于延迟加载）
   */
  resourcePaths?: string[]
  /**
   * Skill 目录路径
   */
  basePath: string
  /**
   * 是否已激活
   */
  isActive: boolean
  /**
   * 激活时间
   */
  activatedAt?: number
}

/**
 * 简化的 Skill 信息（用于列表显示）
 */
export interface SkillSummary {
  id: string
  name: string
  description: string
  version: string
  activation: SkillMetadata["activation"]
  isActive: boolean
}

/**
 * Skill 发现配置
 */
export interface SkillDiscoveryConfig {
  /**
   * Skill 搜索路径
   * 默认: ["./skills", "~/.lite-opencode/skills"]
   */
  searchPaths: string[]
  /**
   * 是否包含内置 skills
   */
  includeBuiltins: boolean
  /**
   * 是否递归搜索子目录
   */
  recursive: boolean
}

/**
 * Skill 激活上下文
 */
export interface SkillContext {
  /** 当前工作目录 */
  cwd: string
  /** 当前文件路径（如果有） */
  currentFile?: string
  /** 用户输入 */
  userInput?: string
  /** 已激活的 skills */
  activeSkills: string[]
}

/**
 * Skill 注册表事件
 */
export interface SkillRegistryEvents {
  onSkillLoaded?: (skill: Skill) => void
  onSkillActivated?: (skill: Skill) => void
  onSkillDeactivated?: (skillId: string) => void
  onSkillReloaded?: (skill: Skill) => void
  onSkillError?: (skillId: string, error: Error) => void
}

/**
 * Skill 加载选项
 */
export interface SkillLoadOptions {
  /**
   * 是否加载资源
   */
  loadResources?: boolean
  /**
   * 验证 metadata
   */
  validate?: boolean
}

/**
 * Skill 激活结果
 */
export interface SkillActivationResult {
  success: boolean
  skill?: Skill
  error?: string
  /**
   * 激活后应注入到 prompt 的内容
   */
  promptInjection?: string
}

/**
 * 内置 Skill ID
 */
export enum BuiltInSkillId {
  /** Git 操作 */
  GIT = "builtin:git",
  /** 代码审查 */
  CODE_REVIEW = "builtin:code-review",
  /** 测试驱动开发 */
  TDD = "builtin:tdd",
  /** 文档编写 */
  DOCUMENTATION = "builtin:documentation",
  /** 调试 */
  DEBUGGING = "builtin:debugging",
  /** 重构 */
  REFACTORING = "builtin:refactoring",
}
