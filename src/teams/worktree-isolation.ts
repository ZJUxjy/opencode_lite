import * as path from "path"
import { promisify } from "util"
import { exec } from "child_process"

const execAsync = promisify(exec)

export interface WorktreeIsolationConfig {
  enabled: boolean
  baseBranch: string
  worktreeDir: string
  cleanupOnComplete: boolean
}

export interface IsolatedWorktree {
  id: string
  worktreePath: string
  branchName: string
  agentId: string
}

export class WorktreeIsolationManager {
  private config: WorktreeIsolationConfig
  private worktrees: Map<string, IsolatedWorktree> = new Map()
  private originalCwd: string

  constructor(config: Partial<WorktreeIsolationConfig> = {}) {
    this.config = {
      enabled: true,
      baseBranch: "main",
      worktreeDir: ".agent-teams/worktrees",
      cleanupOnComplete: true,
      ...config,
    }
    this.originalCwd = process.cwd()
  }

  /**
   * Create an isolated worktree for an agent
   */
  async createIsolatedWorktree(
    agentId: string,
    index: number
  ): Promise<IsolatedWorktree> {
    if (!this.config.enabled) {
      throw new Error("Worktree isolation is not enabled")
    }

    const id = `${agentId}-${index}`
    const branchName = `agent-${id}`
    const worktreePath = path.join(this.originalCwd, this.config.worktreeDir, id)

    try {
      // Create branch from base
      await execAsync(
        `git checkout -b ${branchName} ${this.config.baseBranch}`,
        { cwd: this.originalCwd }
      )

      // Create worktree
      await execAsync(
        `git worktree add ${worktreePath} ${branchName}`,
        { cwd: this.originalCwd }
      )

      const worktree: IsolatedWorktree = {
        id,
        worktreePath,
        branchName,
        agentId,
      }

      this.worktrees.set(id, worktree)
      return worktree
    } catch (error) {
      throw new Error(
        `Failed to create isolated worktree for ${agentId}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Get worktree for an agent
   */
  getWorktree(agentId: string, index?: number): IsolatedWorktree | undefined {
    const id = index !== undefined ? `${agentId}-${index}` : agentId
    return this.worktrees.get(id)
  }

  /**
   * List all active worktrees
   */
  listWorktrees(): IsolatedWorktree[] {
    return Array.from(this.worktrees.values())
  }

  /**
   * Clean up a specific worktree
   */
  async cleanupWorktree(id: string): Promise<void> {
    const worktree = this.worktrees.get(id)
    if (!worktree) {
      return
    }

    try {
      // Remove worktree
      await execAsync(
        `git worktree remove ${worktree.worktreePath}`,
        { cwd: this.originalCwd }
      )

      // Delete branch
      await execAsync(
        `git branch -D ${worktree.branchName}`,
        { cwd: this.originalCwd }
      )

      this.worktrees.delete(id)
    } catch (error) {
      console.error(`Failed to cleanup worktree ${id}:`, error)
    }
  }

  /**
   * Clean up all worktrees
   */
  async cleanupAll(): Promise<void> {
    for (const id of this.worktrees.keys()) {
      await this.cleanupWorktree(id)
    }
  }

  /**
   * Check if worktree isolation is supported in current environment
   */
  async isSupported(): Promise<boolean> {
    try {
      await execAsync("git --version", { cwd: this.originalCwd })
      return true
    } catch {
      return false
    }
  }
}

export function createWorktreeIsolationManager(
  config?: Partial<WorktreeIsolationConfig>
): WorktreeIsolationManager {
  return new WorktreeIsolationManager(config)
}
