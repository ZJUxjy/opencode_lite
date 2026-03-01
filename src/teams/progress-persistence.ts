/**
 * Progress Persistence - PROGRESS.md Generation
 *
 * Generates PROGRESS.md files for human-readable team progress tracking.
 * Supports multiple output formats and auto-save functionality.
 */

import * as fs from "fs"
import * as path from "path"

// ============================================================================
// Types
// ============================================================================

export interface ProgressReport {
  teamId: string
  timestamp: number
  status: "in-progress" | "completed" | "failed" | "paused"
  currentPhase: string
  overallProgress: number // 0-100

  summary: {
    objective: string
    filesChanged: number
    iterationsCompleted: number
    totalIterations: number
  }

  current: {
    activeAgent: string
    role: string
    task: string
    startedAt: number
  }

  issues: {
    p0: string[]
    p1: string[]
    p2: string[]
    p3: string[]
  }

  timeline: Array<{
    time: number
    event: string
    agent?: string
    details?: string
  }>

  nextSteps: string[]
}

export interface ProgressPersistenceConfig {
  outputPath: string
  autoSaveInterval: number // milliseconds
  includeTimestamps: boolean
  format: "markdown" | "json" | "both"
}

// ============================================================================
// Progress Persistence
// ============================================================================

export class ProgressPersistence {
  private config: ProgressPersistenceConfig
  private lastSaveTime: number = 0

  constructor(config?: Partial<ProgressPersistenceConfig>) {
    this.config = {
      outputPath: path.join(process.cwd(), "PROGRESS.md"),
      autoSaveInterval: 60000, // 1 minute
      includeTimestamps: true,
      format: "markdown",
      ...config,
    }
  }

  /**
   * Save progress report to file(s)
   */
  async saveProgress(report: ProgressReport): Promise<void> {
    // Ensure parent directory exists
    const parentDir = path.dirname(this.config.outputPath)
    await fs.promises.mkdir(parentDir, { recursive: true })

    const format = this.config.format

    if (format === "markdown" || format === "both") {
      const markdownPath = this.getMarkdownPath()
      const markdownContent = this.formatAsMarkdown(report)
      await fs.promises.writeFile(markdownPath, markdownContent, "utf-8")
    }

    if (format === "json" || format === "both") {
      const jsonPath = this.getJsonPath()
      const jsonContent = JSON.stringify(report, null, 2)
      await fs.promises.writeFile(jsonPath, jsonContent, "utf-8")
    }

    this.lastSaveTime = Date.now()
  }

  /**
   * Check if auto-save should trigger
   */
  shouldAutoSave(): boolean {
    const now = Date.now()
    return now - this.lastSaveTime >= this.config.autoSaveInterval
  }

  /**
   * Get the markdown file path
   */
  private getMarkdownPath(): string {
    if (this.config.format === "markdown" || this.config.format === "both") {
      // If outputPath already ends with .md, use it directly
      if (this.config.outputPath.endsWith(".md")) {
        return this.config.outputPath
      }
      // Otherwise, append .md
      return `${this.config.outputPath}.md`
    }
    return this.config.outputPath.replace(/\.json$/, ".md")
  }

  /**
   * Get the JSON file path
   */
  private getJsonPath(): string {
    // If outputPath already ends with .json, use it directly
    if (this.config.outputPath.endsWith(".json")) {
      return this.config.outputPath
    }
    // If outputPath ends with .md, replace with .json
    if (this.config.outputPath.endsWith(".md")) {
      return this.config.outputPath.replace(/\.md$/, ".json")
    }
    // Otherwise, append .json
    return `${this.config.outputPath}.json`
  }

  /**
   * Format report as markdown
   */
  private formatAsMarkdown(report: ProgressReport): string {
    const lines: string[] = []

    // Title with objective
    lines.push(`# Progress Report: ${report.summary.objective}`)
    lines.push("")

    // Status with emoji
    const statusEmoji = this.getStatusEmoji(report.status)
    lines.push(`## Status: ${statusEmoji} ${this.capitalizeFirst(report.status)}`)
    lines.push("")

    // Progress bar
    const progressBar = this.renderProgressBar(report.overallProgress)
    lines.push(`**Progress:** ${progressBar} ${report.overallProgress}%`)
    lines.push("")

    // Summary section
    lines.push("## Summary")
    lines.push("")
    lines.push(`- **Objective:** ${report.summary.objective}`)
    lines.push(`- **Files Changed:** ${report.summary.filesChanged}`)
    lines.push(`- **Iterations:** ${report.summary.iterationsCompleted} / ${report.summary.totalIterations}`)
    lines.push(`- **Current Phase:** ${report.currentPhase}`)
    if (this.config.includeTimestamps) {
      lines.push(`- **Last Updated:** ${new Date(report.timestamp).toISOString()}`)
    }
    lines.push("")

    // Current Activity section
    lines.push("## Current Activity")
    lines.push("")
    lines.push(`- **Active Agent:** ${report.current.activeAgent}`)
    lines.push(`- **Role:** ${report.current.role}`)
    lines.push(`- **Task:** ${report.current.task}`)
    if (this.config.includeTimestamps) {
      lines.push(`- **Started At:** ${new Date(report.current.startedAt).toISOString()}`)
    }
    lines.push("")

    // Active Issues section (P0/P1 only if present)
    const hasCriticalIssues = report.issues.p0.length > 0 || report.issues.p1.length > 0
    if (hasCriticalIssues) {
      lines.push("## Active Issues")
      lines.push("")

      if (report.issues.p0.length > 0) {
        lines.push("### P0 (Critical)")
        lines.push("")
        for (const issue of report.issues.p0) {
          lines.push(`- [ ] ${issue}`)
        }
        lines.push("")
      }

      if (report.issues.p1.length > 0) {
        lines.push("### P1 (High)")
        lines.push("")
        for (const issue of report.issues.p1) {
          lines.push(`- [ ] ${issue}`)
        }
        lines.push("")
      }
    }

    // Timeline section
    lines.push("## Timeline")
    lines.push("")
    for (const event of report.timeline) {
      const timeStr = this.config.includeTimestamps
        ? new Date(event.time).toISOString()
        : new Date(event.time).toLocaleTimeString()
      const agentStr = event.agent ? ` [${event.agent}]` : ""
      const detailsStr = event.details ? ` - ${event.details}` : ""
      lines.push(`- **${timeStr}**${agentStr}: ${event.event}${detailsStr}`)
    }
    lines.push("")

    // Next Steps section
    lines.push("## Next Steps")
    lines.push("")
    for (const step of report.nextSteps) {
      lines.push(`- [ ] ${step}`)
    }
    lines.push("")

    // Footer
    lines.push("---")
    lines.push(`*Generated by Agent Teams - Team ID: ${report.teamId}*`)

    return lines.join("\n")
  }

  /**
   * Get status emoji
   */
  private getStatusEmoji(status: ProgressReport["status"]): string {
    switch (status) {
      case "in-progress":
        return "🔄"
      case "completed":
        return "✅"
      case "failed":
        return "❌"
      case "paused":
        return "⏸️"
      default:
        return "⏳"
    }
  }

  /**
   * Capitalize first letter
   */
  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }

  /**
   * Render progress bar
   */
  private renderProgressBar(percentage: number): string {
    const filled = Math.floor(percentage / 10)
    const empty = 10 - filled
    const filledBar = "█".repeat(filled)
    const emptyBar = "░".repeat(empty)
    return `[${filledBar}${emptyBar}]`
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createProgressPersistence(
  config?: Partial<ProgressPersistenceConfig>
): ProgressPersistence {
  return new ProgressPersistence(config)
}
