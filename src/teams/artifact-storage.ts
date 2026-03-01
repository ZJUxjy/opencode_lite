/**
 * Artifact Storage - 产物文件系统存储
 *
 * 将 Agent 产物写入文件系统，避免"电话游戏"问题。
 * 遵循 agent-teams-supplement.md 原则 2: Subagent Output to Filesystem
 */

import * as fs from "fs"
import * as path from "path"
import * as crypto from "crypto"
import type { WorkArtifact, ReviewArtifact } from "./contracts.js"

/**
 * 产物格式类型
 */
export type ArtifactFormat = "markdown" | "json" | "patch" | "code"

/**
 * 文件系统产物
 */
export interface FilesystemArtifact {
  /** 产物 ID */
  id: string
  /** 输出路径 (相对) */
  outputPath: string
  /** 格式 */
  format: ArtifactFormat
  /** 自描述元数据 */
  metadata: {
    createdAt: number
    agentId: string
    agentRole: string
    taskId: string
    checksum: string
  }
  /** 产物内容 */
  content: string
}

/**
 * 产物存储配置
 */
export interface ArtifactStorageConfig {
  /** 是否启用 */
  enabled: boolean
  /** 输出目录 (相对于工作目录) */
  outputDir: string
  /** 保留天数 */
  retainDays: number
  /** 工作目录 */
  cwd: string
}

/**
 * 默认配置
 */
export const DEFAULT_ARTIFACT_STORAGE_CONFIG: ArtifactStorageConfig = {
  enabled: true,
  outputDir: ".agent-teams/artifacts",
  retainDays: 7,
  cwd: process.cwd(),
}

/**
 * 产物存储器
 *
 * 负责将 Agent 产物持久化到文件系统
 */
export class ArtifactStorage {
  private config: ArtifactStorageConfig
  private initialized: boolean = false

  constructor(config: Partial<ArtifactStorageConfig> = {}) {
    this.config = { ...DEFAULT_ARTIFACT_STORAGE_CONFIG, ...config }
  }

  /**
   * 初始化存储目录
   */
  private ensureInitialized(): void {
    if (this.initialized) return

    const outputDir = path.resolve(this.config.cwd, this.config.outputDir)

    // 创建目录结构
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    this.initialized = true
  }

  /**
   * 计算内容校验和
   */
  private calculateChecksum(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16)
  }

  /**
   * 生成产物 ID
   */
  private generateId(): string {
    return `artifact-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  }

  /**
   * 保存 Work 产物
   */
  saveWorkArtifact(
    taskId: string,
    agentId: string,
    agentRole: string,
    artifact: WorkArtifact
  ): FilesystemArtifact {
    this.ensureInitialized()

    const id = this.generateId()
    const taskDir = path.resolve(this.config.cwd, this.config.outputDir, taskId)

    // 创建任务目录
    if (!fs.existsSync(taskDir)) {
      fs.mkdirSync(taskDir, { recursive: true })
    }

    // 构建 markdown 内容
    const content = this.formatWorkArtifactMarkdown(artifact)
    const checksum = this.calculateChecksum(content)

    // 保存产物文件
    const outputPath = `${taskId}/worker-output.md`
    const fullPath = path.resolve(this.config.cwd, this.config.outputDir, outputPath)
    fs.writeFileSync(fullPath, content, "utf-8")

    // 保存元数据
    const metadata: FilesystemArtifact["metadata"] = {
      createdAt: Date.now(),
      agentId,
      agentRole,
      taskId,
      checksum,
    }
    const metadataPath = path.resolve(taskDir, "metadata.json")
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf-8")

    return {
      id,
      outputPath,
      format: "markdown",
      metadata,
      content,
    }
  }

  /**
   * 保存 Review 产物
   */
  saveReviewArtifact(
    taskId: string,
    reviewerId: string,
    review: ReviewArtifact
  ): FilesystemArtifact {
    this.ensureInitialized()

    const id = this.generateId()
    const taskDir = path.resolve(this.config.cwd, this.config.outputDir, taskId)

    if (!fs.existsSync(taskDir)) {
      fs.mkdirSync(taskDir, { recursive: true })
    }

    // 构建 markdown 内容
    const content = this.formatReviewArtifactMarkdown(review)
    const checksum = this.calculateChecksum(content)

    // 保存产物文件
    const outputPath = `${taskId}/reviewer-feedback.md`
    const fullPath = path.resolve(this.config.cwd, this.config.outputDir, outputPath)
    fs.writeFileSync(fullPath, content, "utf-8")

    const metadata: FilesystemArtifact["metadata"] = {
      createdAt: Date.now(),
      agentId: reviewerId,
    agentRole: "reviewer",
      taskId,
      checksum,
    }

    // 更新元数据文件
    const metadataPath = path.resolve(taskDir, "metadata.json")
    const existingMetadata = fs.existsSync(metadataPath)
      ? JSON.parse(fs.readFileSync(metadataPath, "utf-8"))
      : {}
    fs.writeFileSync(
      metadataPath,
      JSON.stringify({ ...existingMetadata, review: metadata }, null, 2),
      "utf-8"
    )

    return {
      id,
      outputPath,
      format: "markdown",
      metadata,
      content,
    }
  }

  /**
   * 保存通用产物
   */
  saveArtifact(
    taskId: string,
    agentId: string,
    agentRole: string,
    filename: string,
    content: string,
    format: ArtifactFormat = "markdown"
  ): FilesystemArtifact {
    this.ensureInitialized()

    const id = this.generateId()
    const taskDir = path.resolve(this.config.cwd, this.config.outputDir, taskId)

    if (!fs.existsSync(taskDir)) {
      fs.mkdirSync(taskDir, { recursive: true })
    }

    const checksum = this.calculateChecksum(content)
    const outputPath = `${taskId}/${filename}`

    // 保存文件
    const fullPath = path.resolve(this.config.cwd, this.config.outputDir, outputPath)
    fs.writeFileSync(fullPath, content, "utf-8")

    const metadata: FilesystemArtifact["metadata"] = {
      createdAt: Date.now(),
      agentId,
      agentRole,
      taskId,
      checksum,
    }

    // 更新元数据
    const metadataPath = path.resolve(taskDir, "metadata.json")
    const existingMetadata = fs.existsSync(metadataPath)
      ? JSON.parse(fs.readFileSync(metadataPath, "utf-8"))
      : { artifacts: [] }
    existingMetadata.artifacts = existingMetadata.artifacts || []
    existingMetadata.artifacts.push(metadata)
    fs.writeFileSync(metadataPath, JSON.stringify(existingMetadata, null, 2), "utf-8")

    return {
      id,
      outputPath,
      format,
      metadata,
      content,
    }
  }

  /**
   * 读取产物
   */
  readArtifact(taskId: string, filename: string): string | null {
    const fullPath = path.resolve(
      this.config.cwd,
      this.config.outputDir,
      taskId,
      filename
    )

    if (!fs.existsSync(fullPath)) {
      return null
    }

    return fs.readFileSync(fullPath, "utf-8")
  }

  /**
   * 列出任务的所有产物
   */
  listArtifacts(taskId: string): string[] {
    const taskDir = path.resolve(this.config.cwd, this.config.outputDir, taskId)

    if (!fs.existsSync(taskDir)) {
      return []
    }

    return fs.readdirSync(taskDir).filter(f => f !== "metadata.json")
  }

  /**
   * 清理过期产物
   */
  cleanupExpired(): number {
    this.ensureInitialized()

    const outputDir = path.resolve(this.config.cwd, this.config.outputDir)
    const cutoffTime = Date.now() - this.config.retainDays * 24 * 60 * 60 * 1000
    let cleaned = 0

    const taskDirs = fs.readdirSync(outputDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)

    for (const taskDir of taskDirs) {
      const metadataPath = path.resolve(outputDir, taskDir, "metadata.json")

      if (fs.existsSync(metadataPath)) {
        try {
          const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"))
          const createdAt = metadata.createdAt || metadata.review?.createdAt || 0

          if (createdAt < cutoffTime) {
            const taskPath = path.resolve(outputDir, taskDir)
            fs.rmSync(taskPath, { recursive: true, force: true })
            cleaned++
          }
        } catch {
          // 忽略解析错误
        }
      }
    }

    return cleaned
  }

  /**
   * 格式化 Work 产物为 Markdown
   */
  private formatWorkArtifactMarkdown(artifact: WorkArtifact): string {
    const lines = [
      `# Work Artifact`,
      ``,
      `## Summary`,
      artifact.summary,
      ``,
      `## Changed Files`,
      ...artifact.changedFiles.map(f => `- \`${f}\``),
      ``,
      `## Test Results`,
      artifact.testResults.length > 0
        ? artifact.testResults.map(t => `- ${t.command}: ${t.passed ? "✅ Passed" : "❌ Failed"}`).join("\n")
        : "_No tests run_",
      ``,
      `## Risks`,
      artifact.risks.length > 0
        ? artifact.risks.map(r => `- ${r}`).join("\n")
        : "_No risks identified_",
      ``,
      `## Assumptions`,
      artifact.assumptions.length > 0
        ? artifact.assumptions.map(a => `- ${a}`).join("\n")
        : "_No assumptions made_",
      ``,
      `---`,
      `_Task ID: ${artifact.taskId}_`,
      `_Agent: ${artifact.agentId} (${artifact.agentRole})_`,
      `_Created: ${new Date(artifact.createdAt).toISOString()}_`,
    ]

    return lines.join("\n")
  }

  /**
   * 格式化 Review 产物为 Markdown
   */
  private formatReviewArtifactMarkdown(review: ReviewArtifact): string {
    const lines = [
      `# Review Feedback`,
      ``,
      `## Status: ${review.status.toUpperCase()}`,
      review.severity ? `**Severity**: ${review.severity}` : "",
      ``,
    ]

    if (review.mustFix.length > 0) {
      lines.push(`## Must Fix`, "")
      review.mustFix.forEach((comment, i) => {
        lines.push(`### ${i + 1}. ${comment.category || "Other"}`)
        if (comment.file) {
          lines.push(`**File**: ${comment.file}${comment.line ? `:${comment.line}` : ""}`)
        }
        lines.push(`${comment.message}`, "")
      })
    }

    if (review.suggestions.length > 0) {
      lines.push(`## Suggestions`, "")
      review.suggestions.forEach((suggestion, i) => {
        lines.push(`${i + 1}. ${suggestion.message}`)
      })
      lines.push("")
    }

    lines.push(
      `---`,
      `_Work Artifact ID: ${review.workArtifactId}_`,
      `_Reviewer: ${review.reviewerId}_`,
      `_Created: ${new Date(review.createdAt).toISOString()}_`
    )

    return lines.join("\n")
  }

  /**
   * 获取产物目录路径
   */
  getArtifactDir(): string {
    return path.resolve(this.config.cwd, this.config.outputDir)
  }
}
