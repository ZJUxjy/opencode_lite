import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

export interface WorktreeIsolationConfig {
  enabled: boolean
  baseBranch: string
  worktreeDir: string
  cleanupOnComplete: boolean
}

export interface WorktreeHandle {
  branch: string
  path: string
}

export class WorktreeIsolation {
  constructor(private readonly cwd: string) {}

  create(workerName: string, config: WorktreeIsolationConfig): WorktreeHandle {
    const safe = workerName.replace(/[^a-zA-Z0-9-_]/g, "-")
    const branch = `${safe}-${Date.now()}`
    const root = resolve(this.cwd, config.worktreeDir)
    const target = join(root, safe)
    mkdirSync(root, { recursive: true })

    const result = spawnSync(
      "git",
      ["worktree", "add", target, "-b", branch, config.baseBranch],
      { cwd: this.cwd, encoding: "utf8" }
    )
    if (result.status !== 0) {
      throw new Error(`git worktree add failed: ${result.stderr || result.stdout}`)
    }

    return { branch, path: target }
  }

  cleanup(handle: WorktreeHandle, config: WorktreeIsolationConfig): void {
    if (!config.cleanupOnComplete) return
    if (existsSync(handle.path)) {
      const rm = spawnSync("git", ["worktree", "remove", "--force", handle.path], {
        cwd: this.cwd,
        encoding: "utf8",
      })
      if (rm.status !== 0) {
        rmSync(handle.path, { recursive: true, force: true })
      }
    }
    spawnSync("git", ["branch", "-D", handle.branch], { cwd: this.cwd, encoding: "utf8" })
  }
}
