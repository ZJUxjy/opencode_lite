import * as fs from "fs/promises"
import * as path from "path"
import * as crypto from "crypto"
import type { WorkArtifact, ReviewArtifact } from "./contracts.js"

// ============================================================================
// ArtifactStore - 产物文件系统存储
// ============================================================================

/**
 * ArtifactStore - 将Agent产物写入文件系统
 *
 * 职责：
 * - 所有子Agent产物必须写入文件
 * - 后续Agent读取文件而非接收内存数据
 * - 支持断点续传和外部审计
 */
export class ArtifactStore {
  private baseDir: string
  private enabled: boolean

  constructor(options: ArtifactStoreOptions = {}) {
    this.baseDir = options.baseDir || ".agent-teams/artifacts"
    this.enabled = options.enabled ?? true
  }

  /**
   * 保存Worker产出
   */
  async saveWorkerOutput(taskId: string, artifact: WorkArtifact): Promise<ArtifactFile> {
    if (!this.enabled) {
      return this.createPlaceholder(taskId, "worker-output")
    }

    const taskDir = this.getTaskDir(taskId)
    await fs.mkdir(taskDir, { recursive: true })

    // 写入输出文件
    const outputPath = path.join(taskDir, "worker-output.md")
    const content = this.formatWorkerOutput(artifact)
    await fs.writeFile(outputPath, content, "utf-8")

    // 写入元数据
    const metadata = await this.saveMetadata(taskId, "worker-output", artifact)

    return {
      path: outputPath,
      checksum: this.calculateChecksum(content),
      metadataPath: metadata.path,
    }
  }

  /**
   * 保存Reviewer反馈
   */
  async saveReviewFeedback(taskId: string, review: ReviewArtifact): Promise<ArtifactFile> {
    if (!this.enabled) {
      return this.createPlaceholder(taskId, "reviewer-feedback")
    }

    const taskDir = this.getTaskDir(taskId)
    await fs.mkdir(taskDir, { recursive: true })

    const outputPath = path.join(taskDir, "reviewer-feedback.md")
    const content = this.formatReviewFeedback(review)
    await fs.writeFile(outputPath, content, "utf-8")

    const metadata = await this.saveMetadata(taskId, "reviewer-feedback", review)

    return {
      path: outputPath,
      checksum: this.calculateChecksum(content),
      metadataPath: metadata.path,
    }
  }

  /**
   * 读取Worker输出
   */
  async readWorkerOutput(taskId: string): Promise<string | null> {
    const outputPath = path.join(this.getTaskDir(taskId), "worker-output.md")
    try {
      return await fs.readFile(outputPath, "utf-8")
    } catch {
      return null
    }
  }

  /**
   * 读取Reviewer反馈
   */
  async readReviewFeedback(taskId: string): Promise<string | null> {
    const outputPath = path.join(this.getTaskDir(taskId), "reviewer-feedback.md")
    try {
      return await fs.readFile(outputPath, "utf-8")
    } catch {
      return null
    }
  }

  /**
   * 获取任务的全部产物
   */
  async getTaskArtifacts(taskId: string): Promise<TaskArtifacts> {
    const taskDir = this.getTaskDir(taskId)

    return {
      workerOutput: await this.readWorkerOutput(taskId),
      reviewFeedback: await this.readReviewFeedback(taskId),
      metadata: await this.loadMetadata(taskId),
    }
  }

  /**
   * 清理任务产物
   */
  async cleanupTask(taskId: string): Promise<void> {
    const taskDir = this.getTaskDir(taskId)
    try {
      await fs.rm(taskDir, { recursive: true })
    } catch {
      // 忽略错误
    }
  }

  /**
   * 获取任务目录
   */
  private getTaskDir(taskId: string): string {
    return path.join(this.baseDir, taskId)
  }

  /**
   * 格式化Worker输出
   */
  private formatWorkerOutput(artifact: WorkArtifact): string {
    const lines: string[] = []

    lines.push(`# Worker Output: ${artifact.taskId}`)
    lines.push("")
    lines.push(`## Summary`)
    lines.push(artifact.summary)
    lines.push("")

    lines.push(`## Changed Files`)
    for (const file of artifact.changedFiles) {
      lines.push(`- ${file}`)
    }
    lines.push("")

    lines.push(`## Test Results`)
    for (const result of artifact.testResults) {
      const status = result.passed ? "✅" : "❌"
      lines.push(`- ${status} ${result.command}`)
    }
    lines.push("")

    if (artifact.risks.length > 0) {
      lines.push(`## Risks`)
      for (const risk of artifact.risks) {
        lines.push(`- ${risk}`)
      }
      lines.push("")
    }

    if (artifact.assumptions.length > 0) {
      lines.push(`## Assumptions`)
      for (const assumption of artifact.assumptions) {
        lines.push(`- ${assumption}`)
      }
    }

    return lines.join("\n")
  }

  /**
   * 格式化Review反馈
   */
  private formatReviewFeedback(review: ReviewArtifact): string {
    const lines: string[] = []

    lines.push(`# Review Feedback: ${review.status}`)
    lines.push("")
    lines.push(`**Severity**: ${review.severity}`)
    lines.push("")

    if (review.mustFix.length > 0) {
      lines.push("## Must Fix")
      for (const issue of review.mustFix) {
        lines.push(`- ${issue}`)
      }
      lines.push("")
    }

    if (review.suggestions.length > 0) {
      lines.push("## Suggestions")
      for (const suggestion of review.suggestions) {
        lines.push(`- ${suggestion}`)
      }
    }

    if (review.securityIssues && review.securityIssues.length > 0) {
      lines.push("## Security Issues")
      for (const issue of review.securityIssues) {
        lines.push(`- ${issue}`)
      }
    }

    return lines.join("\n")
  }

  /**
   * 保存元数据
   */
  private async saveMetadata(
    taskId: string,
    type: string,
    data: unknown
  ): Promise<{ path: string }> {
    const taskDir = this.getTaskDir(taskId)
    const metadataPath = path.join(taskDir, "metadata.json")

    const existing = await this.loadMetadata(taskId)

    // 计算checksum
    const content = JSON.stringify(data)
    const checksum = this.calculateChecksum(content)

    const metadata: Record<string, unknown> = {
      ...existing,
      [type]: {
        createdAt: Date.now(),
        agentId: "agent",
        taskId,
        checksum,
      },
      updatedAt: Date.now(),
    }

    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2))

    return { path: metadataPath }
  }

  /**
   * 加载元数据
   */
  private async loadMetadata(taskId: string): Promise<Record<string, unknown>> {
    const metadataPath = path.join(this.getTaskDir(taskId), "metadata.json")
    try {
      const content = await fs.readFile(metadataPath, "utf-8")
      return JSON.parse(content)
    } catch {
      return {}
    }
  }

  /**
   * 计算Checksum
   */
  private calculateChecksum(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16)
  }

  /**
   * 创建占位符
   */
  private createPlaceholder(taskId: string, type: string): ArtifactFile {
    return {
      path: `${taskId}/${type}`,
      checksum: "",
      metadataPath: "",
    }
  }
}

// ============================================================================
// 类型定义
// ============================================================================

export interface ArtifactStoreOptions {
  baseDir?: string
  enabled?: boolean
}

export interface ArtifactFile {
  path: string
  checksum: string
  metadataPath: string
}

export interface TaskArtifacts {
  workerOutput: string | null
  reviewFeedback: string | null
  metadata: Record<string, unknown>
}
