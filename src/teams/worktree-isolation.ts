import { execFile } from "child_process"
import * as path from "path"
import * as fs from "fs/promises"
import * as os from "os"

// ============================================================================
// WorktreeIsolation - Git Worktree 隔离管理器
// ============================================================================

/**
 * WorktreeIsolation - 为并行 Worker 创建隔离的 Git Worktree 环境
 *
 * 用途：
 * - Leader-Workers 竞争模式下，每个 Worker 独立 Worktree
 * - 避免文件冲突
 * - 支持并行独立修改
 */
export class WorktreeIsolation {
  private baseDir: string
  private baseBranch: string
  private cleanupOnComplete: boolean

  constructor(options: WorktreeIsolationOptions = {}) {
    this.baseDir = options.baseDir || ".agent-teams/worktrees"
    this.baseBranch = options.baseBranch || "main"
    this.cleanupOnComplete = options.cleanupOnComplete ?? true
  }

  /**
   * 为 Worker 创建隔离的 Worktree
   */
  async createWorkerWorktree(workerId: string): Promise<WorktreeHandle> {
    const worktreePath = path.join(this.baseDir, workerId)
    const branchName = `worker-${workerId}-${Date.now()}`

    // 创建 Worktree
    await this.runGitCommand("worktree", ["add", worktreePath, "-b", branchName])

    return {
      workerId,
      path: worktreePath,
      branch: branchName,
      cleanup: () => this.cleanupWorktree(workerId, branchName),
    }
  }

  /**
   * 批量创建 Worker Worktrees
   */
  async createWorkerWorktrees(count: number): Promise<WorktreeHandle[]> {
    const handles: WorktreeHandle[] = []

    for (let i = 0; i < count; i++) {
      const workerId = `worker-${i}`
      const handle = await this.createWorkerWorktree(workerId)
      handles.push(handle)
    }

    return handles
  }

  /**
   * 清理 Worktree
   */
  async cleanupWorktree(workerId: string, branch?: string): Promise<void> {
    const worktreePath = path.join(this.baseDir, workerId)

    try {
      // 删除 Worktree
      await this.runGitCommand("worktree", ["remove", worktreePath, "--force"])

      // 删除分支
      if (branch) {
        try {
          await this.runGitCommand("branch", ["-D", branch])
        } catch {
          // 分支可能已合并，忽略错误
        }
      }
    } catch (error) {
      console.warn(`Failed to cleanup worktree ${workerId}:`, error)
    }
  }

  /**
   * 清理所有 Worktrees
   */
  async cleanupAll(): Promise<void> {
    try {
      const entries = await fs.readdir(this.baseDir)

      for (const entry of entries) {
        const entryPath = path.join(this.baseDir, entry)
        const stat = await fs.stat(entryPath)

        if (stat.isDirectory()) {
          await this.runGitCommand("worktree", ["remove", entryPath, "--force"])
        }
      }
    } catch (error) {
      // 目录可能不存在，忽略错误
    }
  }

  /**
   * 列出所有 Worktrees
   */
  async listWorktrees(): Promise<string[]> {
    try {
      const output = await this.runGitCommand("worktree", ["list", "--porcelain"])
      const worktrees: string[] = []

      for (const line of output.split("\n")) {
        if (line.startsWith("worktree ")) {
          worktrees.push(line.replace("worktree ", "").trim())
        }
      }

      return worktrees
    } catch {
      return []
    }
  }

  /**
   * 运行 Git 命令 - 使用 execFile 避免命令注入
   */
  private async runGitCommand(command: string, args: string[] = []): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile("git", [command, ...args], (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`git ${command} ${args.join(" ")} failed: ${stderr || error.message}`))
        } else {
          resolve(stdout.trim())
        }
      })
    })
  }

  /**
   * 获取临时目录
   */
  getTempDir(): string {
    return path.join(os.tmpdir(), "lite-opencode-worktrees")
  }
}

// ============================================================================
// 类型定义
// ============================================================================

export interface WorktreeIsolationOptions {
  baseDir?: string
  baseBranch?: string
  cleanupOnComplete?: boolean
}

export interface WorktreeHandle {
  workerId: string
  path: string
  branch: string
  cleanup: () => Promise<void>
}

// ============================================================================
// 便捷函数
// ============================================================================

/**
 * 创建 Worktree 隔离管理器
 */
export function createWorktreeIsolation(options?: WorktreeIsolationOptions): WorktreeIsolation {
  return new WorktreeIsolation(options)
}
