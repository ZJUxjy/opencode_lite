/**
 * Agent Teams - Checkpoint System
 *
 * Persistent state checkpointing for long-running tasks.
 * Enables recovery from failures and resumption of interrupted work.
 */

import * as fs from "fs"
import * as path from "path"
import type { TeamConfig, TeamState } from "./types.js"
import type { TaskContract, WorkArtifact, ReviewArtifact } from "./contracts.js"

// ============================================================================
// Checkpoint Types
// ============================================================================

export interface Checkpoint {
  id: string
  teamId: string
  mode: string
  timestamp: number
  version: string

  // State snapshots
  teamState: TeamState
  taskContract: TaskContract
  workArtifacts: Record<string, WorkArtifact>
  reviewArtifacts: Record<string, ReviewArtifact>
  blackboardState: Record<string, unknown>

  // Metadata
  iteration: number
  phase: string
  progress: number // 0-100
}

export interface CheckpointConfig {
  checkpointDir: string
  autoCheckpointInterval: number // milliseconds
  maxCheckpoints: number
  compression: boolean
}

// ============================================================================
// Checkpoint Manager
// ============================================================================

export class CheckpointManager {
  private config: CheckpointConfig
  private teamId: string
  private lastCheckpointTime: number = 0
  private checkpointInProgress: boolean = false

  constructor(teamId: string, config: Partial<CheckpointConfig> = {}) {
    this.teamId = teamId
    this.config = {
      checkpointDir: path.join(process.cwd(), ".checkpoints"),
      autoCheckpointInterval: 60000, // 1 minute
      maxCheckpoints: 10,
      compression: false,
      ...config,
    }

    // Ensure checkpoint directory exists
    this.ensureDirectory()
  }

  /**
   * Create a checkpoint
   */
  async createCheckpoint(
    state: {
      teamState: TeamState
      taskContract: TaskContract
      workArtifacts: Map<string, WorkArtifact>
      reviewArtifacts: Map<string, ReviewArtifact>
      blackboardState: Map<string, unknown>
    }
  ): Promise<Checkpoint> {
    if (this.checkpointInProgress) {
      throw new Error("Checkpoint already in progress")
    }

    this.checkpointInProgress = true

    try {
      const checkpoint: Checkpoint = {
        id: `checkpoint-${this.teamId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        teamId: this.teamId,
        mode: state.teamState.mode,
        timestamp: Date.now(),
        version: "1.0.0",
        teamState: { ...state.teamState },
        taskContract: { ...state.taskContract },
        workArtifacts: Object.fromEntries(state.workArtifacts),
        reviewArtifacts: Object.fromEntries(state.reviewArtifacts),
        blackboardState: Object.fromEntries(state.blackboardState),
        iteration: state.teamState.currentIteration,
        phase: state.teamState.status,
        progress: this.calculateProgress(state),
      }

      // Save to file
      await this.saveCheckpoint(checkpoint)

      // Cleanup old checkpoints
      await this.cleanupOldCheckpoints()

      this.lastCheckpointTime = Date.now()

      return checkpoint
    } finally {
      this.checkpointInProgress = false
    }
  }

  /**
   * Restore from a checkpoint
   */
  async restoreCheckpoint(checkpointId: string): Promise<Checkpoint | null> {
    const checkpointPath = this.getCheckpointPath(checkpointId)

    try {
      const data = await fs.promises.readFile(checkpointPath, "utf-8")
      const checkpoint: Checkpoint = JSON.parse(data)

      // Validate checkpoint
      if (checkpoint.teamId !== this.teamId) {
        throw new Error(`Checkpoint team ID mismatch: ${checkpoint.teamId} != ${this.teamId}`)
      }

      return checkpoint
    } catch (error) {
      // Re-throw team ID mismatch errors
      if (error instanceof Error && error.message.includes("team ID mismatch")) {
        throw error
      }
      console.error(`Failed to restore checkpoint ${checkpointId}:`, error)
      return null
    }
  }

  /**
   * Restore from latest checkpoint
   */
  async restoreLatestCheckpoint(): Promise<Checkpoint | null> {
    const checkpoints = await this.listCheckpoints()

    if (checkpoints.length === 0) {
      return null
    }

    // Sort by timestamp descending and get the latest
    const latest = checkpoints.sort((a, b) => b.timestamp - a.timestamp)[0]

    return this.restoreCheckpoint(latest.id)
  }

  /**
   * List all checkpoints for this team
   */
  async listCheckpoints(): Promise<Array<{ id: string; timestamp: number; progress: number; phase: string }>> {
    try {
      const files = await fs.promises.readdir(this.config.checkpointDir)
      const checkpoints: Array<{ id: string; timestamp: number; progress: number; phase: string }> = []

      for (const file of files) {
        if (!file.startsWith(`checkpoint-${this.teamId}`)) continue

        const checkpointPath = path.join(this.config.checkpointDir, file)
        try {
          const data = await fs.promises.readFile(checkpointPath, "utf-8")
          const checkpoint: Checkpoint = JSON.parse(data)
          checkpoints.push({
            id: checkpoint.id,
            timestamp: checkpoint.timestamp,
            progress: checkpoint.progress,
            phase: checkpoint.phase,
          })
        } catch {
          // Ignore corrupted checkpoint files
        }
      }

      return checkpoints.sort((a, b) => b.timestamp - a.timestamp)
    } catch {
      return []
    }
  }

  /**
   * Delete a checkpoint
   */
  async deleteCheckpoint(checkpointId: string): Promise<boolean> {
    const checkpointPath = this.getCheckpointPath(checkpointId)

    try {
      await fs.promises.unlink(checkpointPath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Check if auto-checkpoint should be triggered
   */
  shouldAutoCheckpoint(): boolean {
    const timeSinceLastCheckpoint = Date.now() - this.lastCheckpointTime
    return timeSinceLastCheckpoint >= this.config.autoCheckpointInterval
  }

  /**
   * Get checkpoint file path
   */
  private getCheckpointPath(checkpointId: string): string {
    return path.join(this.config.checkpointDir, `${checkpointId}.json`)
  }

  /**
   * Ensure checkpoint directory exists
   */
  private ensureDirectory(): void {
    if (!fs.existsSync(this.config.checkpointDir)) {
      fs.mkdirSync(this.config.checkpointDir, { recursive: true })
    }
  }

  /**
   * Save checkpoint to file
   */
  private async saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
    const checkpointPath = this.getCheckpointPath(checkpoint.id)
    const data = JSON.stringify(checkpoint, null, 2)

    await fs.promises.writeFile(checkpointPath, data, "utf-8")
  }

  /**
   * Cleanup old checkpoints beyond max limit
   */
  private async cleanupOldCheckpoints(): Promise<void> {
    const checkpoints = await this.listCheckpoints()

    if (checkpoints.length <= this.config.maxCheckpoints) {
      return
    }

    // Delete oldest checkpoints
    const toDelete = checkpoints.slice(this.config.maxCheckpoints)

    for (const checkpoint of toDelete) {
      await this.deleteCheckpoint(checkpoint.id)
    }
  }

  /**
   * Calculate progress percentage
   */
  private calculateProgress(state: {
    teamState: TeamState
    workArtifacts: Map<string, WorkArtifact>
    reviewArtifacts: Map<string, ReviewArtifact>
  }): number {
    // Simple progress calculation based on iterations and artifacts
    const iterationProgress = Math.min(state.teamState.currentIteration * 10, 50)
    const artifactProgress = state.workArtifacts.size * 10
    const reviewProgress = state.reviewArtifacts.size * 10

    return Math.min(iterationProgress + artifactProgress + reviewProgress, 100)
  }
}

// ============================================================================
// Resumable Task Runner
// ============================================================================

export interface ResumableTaskRunner {
  run(): Promise<unknown>
  restoreFromCheckpoint(checkpoint: Checkpoint): Promise<void>
  getStateForCheckpoint(): {
    teamState: TeamState
    taskContract: TaskContract
    workArtifacts: Map<string, WorkArtifact>
    reviewArtifacts: Map<string, ReviewArtifact>
    blackboardState: Map<string, unknown>
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createCheckpointManager(
  teamId: string,
  config?: Partial<CheckpointConfig>
): CheckpointManager {
  return new CheckpointManager(teamId, config)
}
