/**
 * Artifact Store - 产物文件系统存储
 *
 * 避免"电话游戏"，所有子 Agent 产物必须写入文件系统。
 * 支持断点续传和外部审计。
 */

import * as fs from "fs"
import * as path from "path"
import { createHash } from "crypto"

// ============================================================================
// Types
// ============================================================================

export type ArtifactFormat = "markdown" | "json" | "patch" | "code"

export interface ArtifactMetadata {
  /** 创建时间 */
  createdAt: number
  /** 创建者 Agent ID */
  agentId: string
  /** 关联任务 ID */
  taskId: string
  /** 内容校验和 */
  checksum: string
  /** 内容大小（字节） */
  size: number
  /** 格式类型 */
  format: ArtifactFormat
  /** 自定义标签 */
  tags?: string[]
}

export interface FilesystemArtifact {
  /** 产物 ID */
  id: string
  /** 产物名称 */
  name: string
  /** 输出路径（相对 artifacts 目录） */
  outputPath: string
  /** 格式类型 */
  format: ArtifactFormat
  /** 元数据 */
  metadata: ArtifactMetadata
  /** 内容（仅在创建时需要，存储后从文件读取） */
  content?: string
}

export interface ArtifactStoreConfig {
  /** 产物输出目录 */
  outputDir: string
  /** 保留天数 */
  retainDays: number
  /** 最大产物数 */
  maxArtifacts: number
  /** 自动清理 */
  autoCleanup: boolean
}

export interface ArtifactQuery {
  taskId?: string
  agentId?: string
  format?: ArtifactFormat
  tags?: string[]
  since?: number
  until?: number
}

/** 存储产物时的输入参数 */
export interface StoreArtifactInput {
  name: string
  outputPath: string
  format: ArtifactFormat
  content: string
  metadata: {
    agentId: string
    taskId: string
    tags?: string[]
  }
}

// ============================================================================
// Artifact Store
// ============================================================================

export class ArtifactStore {
  private config: ArtifactStoreConfig

  constructor(config: Partial<ArtifactStoreConfig> = {}) {
    this.config = {
      outputDir: ".agent-teams/artifacts",
      retainDays: 7,
      maxArtifacts: 100,
      autoCleanup: true,
      ...config,
    }

    // Ensure output directory exists
    this.ensureDirectory()
  }

  /**
   * 存储产物到文件系统
   */
  async store(artifact: StoreArtifactInput): Promise<FilesystemArtifact> {
    const timestamp = Date.now()
    const id = `artifact-${timestamp}-${Math.random().toString(36).slice(2, 9)}`

    // Calculate checksum
    const checksum = createHash("sha256").update(artifact.content).digest("hex")

    // Build full path
    const relativePath = artifact.outputPath.startsWith("/")
      ? artifact.outputPath.slice(1)
      : artifact.outputPath
    const fullPath = path.join(this.config.outputDir, relativePath)

    // Ensure parent directory exists
    const parentDir = path.dirname(fullPath)
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true })
    }

    // Write content to file
    await fs.promises.writeFile(fullPath, artifact.content, "utf-8")

    // Build metadata
    const metadata: ArtifactMetadata = {
      createdAt: timestamp,
      agentId: artifact.metadata.agentId || "unknown",
      taskId: artifact.metadata.taskId || "unknown",
      checksum,
      size: Buffer.byteLength(artifact.content, "utf-8"),
      format: artifact.format,
      tags: artifact.metadata.tags,
    }

    // Write metadata file
    const metadataPath = `${fullPath}.meta.json`
    await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf-8")

    const storedArtifact: FilesystemArtifact = {
      id,
      name: artifact.name,
      outputPath: relativePath,
      format: artifact.format,
      metadata,
    }

    // Auto cleanup if enabled
    if (this.config.autoCleanup) {
      await this.cleanup()
    }

    return storedArtifact
  }

  /**
   * 读取产物内容
   */
  async read(outputPath: string): Promise<{ content: string; metadata: ArtifactMetadata }> {
    const fullPath = path.join(this.config.outputDir, outputPath)
    const metadataPath = `${fullPath}.meta.json`

    // Check if files exist
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Artifact not found: ${outputPath}`)
    }

    // Read content
    const content = await fs.promises.readFile(fullPath, "utf-8")

    // Read metadata
    let metadata: ArtifactMetadata
    if (fs.existsSync(metadataPath)) {
      const metaContent = await fs.promises.readFile(metadataPath, "utf-8")
      metadata = JSON.parse(metaContent)
    } else {
      throw new Error(`Artifact metadata not found: ${outputPath}`)
    }

    // Verify checksum
    const checksum = createHash("sha256").update(content).digest("hex")
    if (checksum !== metadata.checksum) {
      throw new Error(`Artifact checksum mismatch: ${outputPath}`)
    }

    return { content, metadata }
  }

  /**
   * 查询产物
   */
  async query(query: ArtifactQuery = {}): Promise<FilesystemArtifact[]> {
    const results: FilesystemArtifact[] = []

    const scanDirectory = async (dir: string, relativeDir: string = ""): Promise<void> => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        const relativePath = path.join(relativeDir, entry.name)

        if (entry.isDirectory()) {
          await scanDirectory(fullPath, relativePath)
        } else if (entry.name.endsWith(".meta.json")) {
          // This is a metadata file
          const artifactPath = relativePath.slice(0, -10) // Remove .meta.json
          const metadataPath = fullPath

          try {
            const metaContent = await fs.promises.readFile(metadataPath, "utf-8")
            const metadata: ArtifactMetadata = JSON.parse(metaContent)

            // Apply filters
            if (query.taskId && metadata.taskId !== query.taskId) continue
            if (query.agentId && metadata.agentId !== query.agentId) continue
            if (query.format && metadata.format !== query.format) continue
            if (query.tags && !query.tags.some(tag => metadata.tags?.includes(tag))) continue
            if (query.since && metadata.createdAt < query.since) continue
            if (query.until && metadata.createdAt > query.until) continue

            results.push({
              id: `artifact-${metadata.createdAt}`,
              name: path.basename(artifactPath),
              outputPath: artifactPath,
              format: metadata.format,
              metadata,
            })
          } catch {
            // Skip invalid metadata files
            continue
          }
        }
      }
    }

    if (fs.existsSync(this.config.outputDir)) {
      await scanDirectory(this.config.outputDir)
    }

    // Sort by createdAt desc
    results.sort((a, b) => b.metadata.createdAt - a.metadata.createdAt)

    return results
  }

  /**
   * 获取任务的产物列表
   */
  async getTaskArtifacts(taskId: string): Promise<FilesystemArtifact[]> {
    return this.query({ taskId })
  }

  /**
   * 获取 Agent 的产物列表
   */
  async getAgentArtifacts(agentId: string): Promise<FilesystemArtifact[]> {
    return this.query({ agentId })
  }

  /**
   * 删除产物
   */
  async delete(outputPath: string): Promise<boolean> {
    const fullPath = path.join(this.config.outputDir, outputPath)
    const metadataPath = `${fullPath}.meta.json`

    const artifactExists = fs.existsSync(fullPath)
    const metadataExists = fs.existsSync(metadataPath)

    // If neither file exists, return false
    if (!artifactExists && !metadataExists) {
      return false
    }

    try {
      if (artifactExists) {
        await fs.promises.unlink(fullPath)
      }
      if (metadataExists) {
        await fs.promises.unlink(metadataPath)
      }
      return true
    } catch {
      return false
    }
  }

  /**
   * 清理过期产物
   */
  async cleanup(): Promise<number> {
    const now = Date.now()
    const cutoffTime = now - this.config.retainDays * 24 * 60 * 60 * 1000
    let deletedCount = 0

    const cleanupDirectory = async (dir: string): Promise<void> => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)

        if (entry.isDirectory()) {
          await cleanupDirectory(fullPath)
          // Remove empty directories
          const remaining = await fs.promises.readdir(fullPath)
          if (remaining.length === 0) {
            await fs.promises.rmdir(fullPath)
          }
        } else if (entry.name.endsWith(".meta.json")) {
          try {
            const metaContent = await fs.promises.readFile(fullPath, "utf-8")
            const metadata: ArtifactMetadata = JSON.parse(metaContent)

            if (metadata.createdAt < cutoffTime) {
              // Delete metadata file
              await fs.promises.unlink(fullPath)
              // Delete artifact file
              const artifactPath = fullPath.slice(0, -10)
              if (fs.existsSync(artifactPath)) {
                await fs.promises.unlink(artifactPath)
              }
              deletedCount++
            }
          } catch {
            // Skip invalid files
          }
        }
      }
    }

    if (fs.existsSync(this.config.outputDir)) {
      await cleanupDirectory(this.config.outputDir)
    }

    return deletedCount
  }

  /**
   * 获取存储统计
   */
  async getStats(): Promise<{
    totalArtifacts: number
    totalSize: number
    oldestArtifact: number
    newestArtifact: number
    formats: Record<ArtifactFormat, number>
  }> {
    const stats = {
      totalArtifacts: 0,
      totalSize: 0,
      oldestArtifact: Date.now(),
      newestArtifact: 0,
      formats: {} as Record<ArtifactFormat, number>,
    }

    const artifacts = await this.query()

    for (const artifact of artifacts) {
      stats.totalArtifacts++
      stats.totalSize += artifact.metadata.size
      stats.oldestArtifact = Math.min(stats.oldestArtifact, artifact.metadata.createdAt)
      stats.newestArtifact = Math.max(stats.newestArtifact, artifact.metadata.createdAt)

      const format = artifact.metadata.format
      stats.formats[format] = (stats.formats[format] || 0) + 1
    }

    return stats
  }

  /**
   * 获取输出目录路径
   */
  getOutputDir(): string {
    return this.config.outputDir
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private ensureDirectory(): void {
    if (!fs.existsSync(this.config.outputDir)) {
      fs.mkdirSync(this.config.outputDir, { recursive: true })
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createArtifactStore(config?: Partial<ArtifactStoreConfig>): ArtifactStore {
  return new ArtifactStore(config)
}
