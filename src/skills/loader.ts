/**
 * Skills System - Loader
 *
 * 负责加载和解析 SKILL.md 文件
 */

import { readFile, readdir, stat, access } from "fs/promises"
import { join, dirname, basename, extname } from "path"
import type {
  Skill,
  SkillMetadata,
  SkillResource,
  SkillLoadOptions,
  SkillDiscoveryConfig,
} from "./types.js"

/**
 * 解析 YAML Frontmatter
 * 简单实现，支持基本类型
 */
function parseFrontmatter(content: string): {
  metadata: Record<string, unknown>
  body: string
} {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/
  const match = content.match(frontmatterRegex)

  if (!match) {
    return { metadata: {}, body: content }
  }

  const yamlContent = match[1]
  const body = match[2]
  const metadata: Record<string, unknown> = {}

  // 简单 YAML 解析（支持基本格式）
  const lines = yamlContent.split("\n")
  let currentKey: string | null = null
  let currentArray: unknown[] | null = null

  for (const line of lines) {
    const trimmed = line.trim()

    // 跳过空行和注释
    if (!trimmed || trimmed.startsWith("#")) continue

    // 数组元素
    if (trimmed.startsWith("- ")) {
      if (currentArray !== null) {
        currentArray.push(parseYamlValue(trimmed.slice(2)))
      }
      continue
    }

    // 键值对
    const colonIndex = trimmed.indexOf(":")
    if (colonIndex > 0) {
      currentKey = trimmed.slice(0, colonIndex).trim()
      const value = trimmed.slice(colonIndex + 1).trim()

      if (value === "") {
        // 可能是数组开始
        currentArray = []
        metadata[currentKey] = currentArray
      } else {
        metadata[currentKey] = parseYamlValue(value)
        currentArray = null
      }
    }
  }

  return { metadata, body }
}

/**
 * 解析 YAML 值
 */
function parseYamlValue(value: string): unknown {
  const trimmed = value.trim()

  // 布尔值
  if (trimmed === "true") return true
  if (trimmed === "false") return false

  // null
  if (trimmed === "null" || trimmed === "~") return null

  // 数字
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10)
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed)

  // 字符串（去除引号）
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

/**
 * 验证 Skill 元数据
 */
function validateMetadata(metadata: Record<string, unknown>): SkillMetadata {
  const required = ["id", "name", "description", "version", "activation"]

  for (const field of required) {
    if (!(field in metadata)) {
      throw new Error(`Missing required field: ${field}`)
    }
  }

  const activation = metadata.activation as string
  if (!["auto", "manual", "always"].includes(activation)) {
    throw new Error(`Invalid activation value: ${activation}`)
  }

  return {
    id: metadata.id as string,
    name: metadata.name as string,
    description: metadata.description as string,
    version: metadata.version as string,
    author: metadata.author as string | undefined,
    tags: (metadata.tags as string[]) ?? [],
    activation: activation as "auto" | "manual" | "always",
    triggers: metadata.triggers as
      | { filePatterns?: string[]; keywords?: string[] }
      | undefined,
    dependencies: (metadata.dependencies as string[]) ?? [],
    conflicts: (metadata.conflicts as string[]) ?? [],
  }
}

/**
 * 检查路径是否存在
 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
  }

/**
 * 展开路径中的 ~
 */
function expandHome(filepath: string): string {
  if (filepath.startsWith("~/")) {
    return join(process.env.HOME || "/", filepath.slice(2))
  }
  return filepath
}

/**
 * Skill Loader 类
 */
export class SkillLoader {
  /**
   * 从文件路径加载 Skill
   */
  async loadFromFile(
    filePath: string,
    options: SkillLoadOptions = {}
  ): Promise<Skill> {
    const { loadResources = false, validate = true } = options

    const content = await readFile(filePath, "utf-8")
    const { metadata, body } = parseFrontmatter(content)

    const skillMetadata = validate
      ? validateMetadata(metadata)
      : (metadata as unknown as SkillMetadata)

    const basePath = dirname(filePath)
    const skill: Skill = {
      metadata: skillMetadata,
      content: body.trim(),
      basePath,
      isActive: false,
      resourcePaths: [],
    }

    // 扫描资源文件
    await this.scanResources(skill)

    // 如果需要，加载资源内容
    if (loadResources) {
      await this.loadResources(skill)
    }

    return skill
  }

  /**
   * 从目录加载 Skill
   * 查找 SKILL.md 或 skill.md
   */
  async loadFromDirectory(
    dirPath: string,
    options: SkillLoadOptions = {}
  ): Promise<Skill | null> {
    const candidates = ["SKILL.md", "skill.md", "Skill.md"]

    for (const candidate of candidates) {
      const filePath = join(dirPath, candidate)
      if (await pathExists(filePath)) {
        return this.loadFromFile(filePath, options)
      }
    }

    return null
  }

  /**
   * 发现所有 Skills
   */
  async discover(config: SkillDiscoveryConfig): Promise<Skill[]> {
    const skills: Skill[] = []
    const processedDirs = new Set<string>()

    for (const searchPath of config.searchPaths) {
      const expandedPath = expandHome(searchPath)

      if (!(await pathExists(expandedPath))) {
        continue
      }

      const entries = await readdir(expandedPath, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = join(expandedPath, entry.name)

        if (entry.isDirectory()) {
          // 避免重复处理
          if (processedDirs.has(fullPath)) continue
          processedDirs.add(fullPath)

          try {
            const skill = await this.loadFromDirectory(fullPath)
            if (skill) {
              skills.push(skill)
            } else if (config.recursive) {
              // 递归搜索子目录
              const nestedSkills = await this.discover({
                ...config,
                searchPaths: [fullPath],
              })
              skills.push(...nestedSkills)
            }
          } catch (error) {
            // 记录错误但继续处理其他 skills
            console.warn(`Failed to load skill from ${fullPath}:`, error)
          }
        } else if (
          entry.isFile() &&
          (entry.name === "SKILL.md" || entry.name === "skill.md")
        ) {
          try {
            const skill = await this.loadFromFile(fullPath)
            skills.push(skill)
          } catch (error) {
            console.warn(`Failed to load skill from ${fullPath}:`, error)
          }
        }
      }
    }

    return skills
  }

  /**
   * 扫描资源文件
   */
  private async scanResources(skill: Skill): Promise<void> {
    const resourcesDir = join(skill.basePath, "resources")

    if (!(await pathExists(resourcesDir))) {
      return
    }

    try {
      const entries = await readdir(resourcesDir, { recursive: true })

      for (const entry of entries) {
        const fullPath = join(resourcesDir, entry)
        const stats = await stat(fullPath)

        if (stats.isFile()) {
          skill.resourcePaths?.push(entry)
        }
      }
    } catch {
      // 忽略资源扫描错误
    }
  }

  /**
   * 加载资源内容
   */
  async loadResources(skill: Skill): Promise<SkillResource[]> {
    if (!skill.resourcePaths || skill.resourcePaths.length === 0) {
      return []
    }

    const resourcesDir = join(skill.basePath, "resources")
    const resources: SkillResource[] = []

    for (const resourcePath of skill.resourcePaths) {
      try {
        const fullPath = join(resourcesDir, resourcePath)
        const content = await readFile(fullPath, "utf-8")

        // 根据扩展名推断类型
        const ext = extname(resourcePath).toLowerCase()
        let type: SkillResource["type"] = "doc"

        if (ext === ".template" || resourcePath.includes("template")) {
          type = "template"
        } else if (ext === ".example" || resourcePath.includes("example")) {
          type = "example"
        } else if (ext === ".json" || ext === ".yaml" || ext === ".yml") {
          type = "schema"
        }

        resources.push({ path: resourcePath, content, type })
      } catch (error) {
        console.warn(`Failed to load resource ${resourcePath}:`, error)
      }
    }

    skill.resources = resources
    return resources
  }

  /**
   * 获取单个资源内容（延迟加载）
   */
  async loadResource(
    skill: Skill,
    resourcePath: string
  ): Promise<SkillResource | null> {
    const resourcesDir = join(skill.basePath, "resources")
    const fullPath = join(resourcesDir, resourcePath)

    try {
      const content = await readFile(fullPath, "utf-8")

      const ext = extname(resourcePath).toLowerCase()
      let type: SkillResource["type"] = "doc"

      if (ext === ".template" || resourcePath.includes("template")) {
        type = "template"
      } else if (ext === ".example" || resourcePath.includes("example")) {
        type = "example"
      } else if (ext === ".json" || ext === ".yaml" || ext === ".yml") {
        type = "schema"
      }

      return { path: resourcePath, content, type }
    } catch (error) {
      console.warn(`Failed to load resource ${resourcePath}:`, error)
      return null
    }
  }

  /**
   * 重新加载 Skill
   */
  async reload(skill: Skill): Promise<Skill> {
    const filePath = join(skill.basePath, "SKILL.md")
    return this.loadFromFile(filePath, { loadResources: !!skill.resources })
  }
}
