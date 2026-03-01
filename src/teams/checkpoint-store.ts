import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { TeamMode } from "./types.js"

export interface Checkpoint {
  id: string
  timestamp: number
  description: string
  baseRef: string
  patchRefs: string[]
  artifactRefs: string[]
  blackboardSnapshotRef: string
  context?: {
    task: string
    mode: TeamMode
    lastOutput?: string
    reviewRounds?: number
    pendingTasks?: string[]
  }
}

export interface CheckpointStoreOptions {
  filePath?: string
}

export interface ResumeContext {
  checkpointId: string
  mode: TeamMode
  task: string
  pendingTasks: string[]
  reviewRounds: number
  lastOutput?: string
}

export class CheckpointStore {
  private checkpoints: Checkpoint[] = []
  private readonly filePath?: string

  constructor(options: CheckpointStoreOptions = {}) {
    this.filePath = options.filePath
    this.loadFromDisk()
  }

  create(input: Omit<Checkpoint, "id" | "timestamp">): Checkpoint {
    const checkpoint: Checkpoint = {
      id: `cp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      ...input,
    }
    this.checkpoints.push(checkpoint)
    this.saveToDisk()
    return checkpoint
  }

  list(): Checkpoint[] {
    return [...this.checkpoints].sort((a, b) => b.timestamp - a.timestamp)
  }

  get(id: string): Checkpoint | undefined {
    return this.checkpoints.find((c) => c.id === id)
  }

  prune(opts: { keepLatest: number }): number {
    const keep = Math.max(0, opts.keepLatest)
    const sorted = this.list()
    const toKeep = new Set(sorted.slice(0, keep).map((c) => c.id))
    const before = this.checkpoints.length
    this.checkpoints = this.checkpoints.filter((c) => toKeep.has(c.id))
    this.saveToDisk()
    return before - this.checkpoints.length
  }

  buildRollbackPlan(id: string): { baseRef: string; reversePatchRefs: string[] } {
    const checkpoint = this.get(id)
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${id}`)
    }
    return {
      baseRef: checkpoint.baseRef,
      reversePatchRefs: [...checkpoint.patchRefs].reverse(),
    }
  }

  getResumeContext(
    id: string,
    strategy: "restart-task" | "continue-iteration" | "skip-completed" = "continue-iteration"
  ): ResumeContext {
    const checkpoint = this.get(id)
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${id}`)
    }
    if (!checkpoint.context) {
      throw new Error(`Checkpoint has no resumable context: ${id}`)
    }

    const pendingTasks = strategy === "skip-completed"
      ? checkpoint.context.pendingTasks || [checkpoint.context.task]
      : [checkpoint.context.task]

    return {
      checkpointId: checkpoint.id,
      mode: checkpoint.context.mode,
      task: checkpoint.context.task,
      pendingTasks,
      reviewRounds: checkpoint.context.reviewRounds || 0,
      lastOutput: checkpoint.context.lastOutput,
    }
  }

  private loadFromDisk(): void {
    if (!this.filePath || !existsSync(this.filePath)) return
    try {
      const raw = readFileSync(this.filePath, "utf8")
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        this.checkpoints = parsed.filter(this.isCheckpointLike)
      }
    } catch {
      this.checkpoints = []
    }
  }

  private saveToDisk(): void {
    if (!this.filePath) return
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(this.checkpoints, null, 2), "utf8")
  }

  private isCheckpointLike(value: unknown): value is Checkpoint {
    if (!value || typeof value !== "object") return false
    const item = value as Partial<Checkpoint>
    return (
      typeof item.id === "string" &&
      typeof item.timestamp === "number" &&
      typeof item.description === "string" &&
      typeof item.baseRef === "string" &&
      Array.isArray(item.patchRefs) &&
      Array.isArray(item.artifactRefs) &&
      typeof item.blackboardSnapshotRef === "string"
    )
  }
}
