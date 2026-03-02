/**
 * Agent Teams - Conflict Detector
 *
 * Detects and resolves conflicts in multi-agent scenarios.
 * Handles file-level and semantic conflicts between agent outputs.
 */

import type { SharedBlackboard } from "./types.js"
import type { WorkArtifact } from "./contracts.js"

// ============================================================================
// Conflict Types
// ============================================================================

export type ConflictType = "file" | "semantic" | "dependency"
export type ConflictSeverity = "critical" | "major" | "minor"
export type ConflictStatus = "detected" | "resolving" | "resolved" | "unresolved"

export interface Conflict {
  id: string
  type: ConflictType
  severity: ConflictSeverity
  status: ConflictStatus
  agents: string[]
  files: string[]
  description: string
  suggestedResolution?: string
  detectedAt: number
  resolvedAt?: number
}

export interface FileChange {
  agentId: string
  filePath: string
  changeType: "added" | "modified" | "deleted"
  content?: string
  timestamp: number
}

// ============================================================================
// Conflict Detector
// ============================================================================

export interface ConflictDetectorConfig {
  autoResolve: boolean
  maxConflicts: number
  semanticAnalysis: boolean
}

export class ConflictDetector {
  private conflicts: Map<string, Conflict> = new Map()
  private fileChanges: FileChange[] = []
  private config: ConflictDetectorConfig
  private blackboard?: SharedBlackboard

  constructor(config: Partial<ConflictDetectorConfig> = {}) {
    this.config = {
      autoResolve: false,
      maxConflicts: 10,
      semanticAnalysis: true,
      ...config,
    }
  }

  /**
   * Set blackboard for conflict detection
   */
  setBlackboard(blackboard: SharedBlackboard): void {
    this.blackboard = blackboard
  }

  /**
   * Register a file change from an agent
   */
  registerChange(change: Omit<FileChange, "timestamp">): Conflict[] {
    const fullChange: FileChange = {
      ...change,
      timestamp: Date.now(),
    }

    // Check for conflicts BEFORE adding to array
    const conflicts = this.checkForConflicts(fullChange)

    for (const conflict of conflicts) {
      this.addConflict(conflict)
    }

    // Add to history after checking
    this.fileChanges.push(fullChange)

    return conflicts
  }

  /**
   * Register a work artifact and check for conflicts
   */
  registerArtifact(agentId: string, artifact: WorkArtifact): Conflict[] {
    const newConflicts: Conflict[] = []

    for (const file of artifact.changedFiles) {
      const conflicts = this.registerChange({
        agentId,
        filePath: file,
        changeType: "modified",
      })
      newConflicts.push(...conflicts)
    }

    return newConflicts
  }

  /**
   * Get all detected conflicts
   */
  getConflicts(filter?: { status?: ConflictStatus; type?: ConflictType }): Conflict[] {
    let conflicts = Array.from(this.conflicts.values())

    if (filter?.status) {
      conflicts = conflicts.filter((c) => c.status === filter.status)
    }

    if (filter?.type) {
      conflicts = conflicts.filter((c) => c.type === filter.type)
    }

    return conflicts.sort((a, b) => b.detectedAt - a.detectedAt)
  }

  /**
   * Get conflict by ID
   */
  getConflict(id: string): Conflict | undefined {
    return this.conflicts.get(id)
  }

  /**
   * Mark conflict as resolved
   */
  resolveConflict(id: string, resolution?: string): boolean {
    const conflict = this.conflicts.get(id)
    if (!conflict) return false

    conflict.status = "resolved"
    conflict.resolvedAt = Date.now()

    this.blackboard?.postMessage(
      {
        type: "conflict-detected",
        files: conflict.files,
      },
      "conflict-detector",
      "system"
    )

    return true
  }

  /**
   * Check if there are any unresolved critical conflicts
   */
  hasCriticalConflicts(): boolean {
    return Array.from(this.conflicts.values()).some(
      (c) => c.severity === "critical" && c.status !== "resolved"
    )
  }

  /**
   * Get conflict statistics
   */
  getStats(): {
    total: number
    detected: number
    resolving: number
    resolved: number
    unresolved: number
    byType: Record<ConflictType, number>
    bySeverity: Record<ConflictSeverity, number>
  } {
    const conflicts = Array.from(this.conflicts.values())

    return {
      total: conflicts.length,
      detected: conflicts.filter((c) => c.status === "detected").length,
      resolving: conflicts.filter((c) => c.status === "resolving").length,
      resolved: conflicts.filter((c) => c.status === "resolved").length,
      unresolved: conflicts.filter((c) => c.status !== "resolved").length,
      byType: {
        file: conflicts.filter((c) => c.type === "file").length,
        semantic: conflicts.filter((c) => c.type === "semantic").length,
        dependency: conflicts.filter((c) => c.type === "dependency").length,
      },
      bySeverity: {
        critical: conflicts.filter((c) => c.severity === "critical").length,
        major: conflicts.filter((c) => c.severity === "major").length,
        minor: conflicts.filter((c) => c.severity === "minor").length,
      },
    }
  }

  /**
   * Clear all conflicts and changes
   */
  clear(): void {
    this.conflicts.clear()
    this.fileChanges = []
  }

  /**
   * Auto-resolve non-critical conflicts if enabled
   */
  autoResolve(): Conflict[] {
    if (!this.config.autoResolve) return []

    const resolved: Conflict[] = []

    for (const conflict of this.conflicts.values()) {
      if (conflict.severity !== "critical" && conflict.status === "detected") {
        // Simple auto-resolution: mark as resolved
        conflict.status = "resolved"
        conflict.resolvedAt = Date.now()
        conflict.suggestedResolution = "Auto-resolved: non-critical conflict"
        resolved.push(conflict)
      }
    }

    return resolved
  }

  // ========================================================================
  // Private Methods
  // ========================================================================

  private checkForConflicts(newChange: FileChange): Conflict[] {
    const conflicts: Conflict[] = []

    // Check for file-level conflicts (same file modified by multiple agents)
    // Note: newChange is not yet in fileChanges array
    const existingChanges = this.fileChanges.filter(
      (c) =>
        c.filePath === newChange.filePath &&
        c.agentId !== newChange.agentId
    )

    for (const existing of existingChanges) {
      const severity = this.determineSeverity(existing, newChange)

      conflicts.push({
        id: `conflict-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        type: "file",
        severity,
        status: "detected",
        agents: [existing.agentId, newChange.agentId],
        files: [newChange.filePath],
        description: `File '${newChange.filePath}' modified by both ${existing.agentId} and ${newChange.agentId}`,
        suggestedResolution: "Manual merge required",
        detectedAt: Date.now(),
      })
    }

    // Check for semantic conflicts if enabled
    if (this.config.semanticAnalysis) {
      const semanticConflicts = this.checkSemanticConflicts(newChange)
      conflicts.push(...semanticConflicts)
    }

    return conflicts
  }

  private checkSemanticConflicts(newChange: FileChange): Conflict[] {
    const conflicts: Conflict[] = []

    // Check for dependency conflicts (files that import/modify each other)
    const relatedChanges = this.fileChanges.filter(
      (c) =>
        c.agentId !== newChange.agentId &&
        this.areFilesRelated(c.filePath, newChange.filePath)
    )

    for (const related of relatedChanges) {
      conflicts.push({
        id: `conflict-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        type: "dependency",
        severity: "minor",
        status: "detected",
        agents: [related.agentId, newChange.agentId],
        files: [related.filePath, newChange.filePath],
        description: `Potential dependency conflict between '${related.filePath}' and '${newChange.filePath}'`,
        suggestedResolution: "Review interaction between components",
        detectedAt: Date.now(),
      })
    }

    return conflicts
  }

  private areFilesRelated(file1: string, file2: string): boolean {
    // Same file is handled by file-level conflict detection
    if (file1 === file2) return false

    // Simple heuristic: files in the same directory might be related
    const dir1 = file1.split("/").slice(0, -1).join("/")
    const dir2 = file2.split("/").slice(0, -1).join("/")

    return dir1 === dir2 && dir1 !== ""
  }

  private determineSeverity(change1: FileChange, change2: FileChange): ConflictSeverity {
    // Determine severity based on change types
    if (change1.changeType === "deleted" || change2.changeType === "deleted") {
      return "critical"
    }

    if (change1.changeType === "modified" && change2.changeType === "modified") {
      return "major"
    }

    return "minor"
  }

  private addConflict(conflict: Conflict): void {
    // Check max conflicts limit
    if (this.conflicts.size >= this.config.maxConflicts) {
      console.warn(`Max conflicts (${this.config.maxConflicts}) reached, ignoring new conflict`)
      return
    }

    this.conflicts.set(conflict.id, conflict)

    // Emit conflict event
    this.blackboard?.postMessage(
      {
        type: "conflict-detected",
        files: conflict.files,
      },
      "conflict-detector",
      "system"
    )
  }
}

// ============================================================================
// Conflict Resolution Strategies
// ============================================================================

export interface ConflictResolution {
  strategy: "manual" | "auto-merge" | "leader-arbitration" | "timestamp"
  description: string
  apply(conflict: Conflict, artifacts: WorkArtifact[]): WorkArtifact | null
}

export const ResolutionStrategies: Record<string, ConflictResolution> = {
  manual: {
    strategy: "manual",
    description: "Manual resolution by user",
    apply: () => null, // Returns null to indicate manual resolution needed
  },

  timestamp: {
    strategy: "timestamp",
    description: "Use most recent change based on timestamp",
    apply: (conflict, artifacts) => {
      // Find the most recent artifact for the conflicting file
      const relevantArtifacts = artifacts.filter((a) =>
        conflict.files.some((f) => a.changedFiles.includes(f))
      )

      if (relevantArtifacts.length === 0) return null

      // Return the most recent one (would need timestamp in artifact)
      return relevantArtifacts[relevantArtifacts.length - 1]
    },
  },

  leaderArbitration: {
    strategy: "leader-arbitration",
    description: "Leader agent decides which change to keep",
    apply: () => null, // Would require LLM call
  },
}

// ============================================================================
// Factory
// ============================================================================

export function createConflictDetector(
  config?: Partial<ConflictDetectorConfig>
): ConflictDetector {
  return new ConflictDetector(config)
}
