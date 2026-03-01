/**
 * Worktree Isolation - Git Worktree 隔离支持
 *
 * 基于 agent-teams-supplement.md 原则 5: Parallel Execution First
 *
 * 为并行 worker 创建独立的 git worktree 环境，避免文件冲突。
 */

import * as childProcess from "child_process"
import * as fs from "fs"
import * as path from "path"

/**
 * Worktree 隔离配置
 */
export interface WorktreeIsolationConfig {
  /** 是否启用 */
  enabled: boolean
  /** 基础分支 */
  baseBranch: string
  /** worktree 目录 */
  worktreeDir: string
  /** 完成后是否清理 */
  cleanupOnComplete: boolean
  /** 工作目录 */
  cwd: string
  /** 分支名前缀 */
  branchPrefix: string
}

/**
 * 默认配置
 */
export const DEFAULT_WORKTREE_CONFIG: WorktreeIsolationConfig = {
  enabled: true,
  baseBranch: "main",
  worktreeDir: ".agent-teams/worktrees",
  cleanupOnComplete: true,
  cwd: process.cwd(),
  branchPrefix: "agent-worker",
}

/**
 * Worktree 信息
 */
export interface WorktreeInfo {
  /** worktree ID */
  id: string
  /** 分支名 */
  branch: string
  /** worktree 路径 */
  path: string
  /** 创建时间 */
  createdAt: number
  /** 状态 */
  status: "active" | "completed" | "failed"
}

/**
 * 执行 git 命令
 */
function execGit(args: string[], cwd: string): { stdout: string; stderr: string; code: number } {
  try {
    const result = childProcess.spawnSync("git", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    })
    return {
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      code: result.status ?? 1,
    }
  } catch (error) {
    return {
      stdout: "",
      stderr: error instanceof Error ? error.message : "Unknown error",
      code: 1,
    }
  }
}

/**
 * 检查是否在 git 仓库中
 */
export function isGitRepository(cwd: string = process.cwd()): boolean {
  const result = execGit(["rev-parse", "--is-inside-work-tree"], cwd)
  return result.code === 0 && result.stdout.trim() === "true"
}

/**
 * 获取当前分支名
 */
export function getCurrentBranch(cwd: string = process.cwd()): string | null {
  const result = execGit(["branch", "--show-current"], cwd)
  return result.code === 0 ? result.stdout.trim() : null
}

/**
 * 获取所有 worktree 列表
 */
export function listWorktrees(cwd: string = process.cwd()): WorktreeInfo[] {
  const result = execGit(["worktree", "list", "--porcelain"], cwd)
  if (result.code !== 0) return []

  const worktrees: WorktreeInfo[] = []
  let currentWorktree: Partial<WorktreeInfo> = {}

  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (currentWorktree.path) {
        worktrees.push(currentWorktree as WorktreeInfo)
      }
      currentWorktree = {
        path: line.substring(9),
        status: "active",
        createdAt: Date.now(),
      }
    } else if (line.startsWith("branch ")) {
      currentWorktree.branch = line.substring(7)
    }
  }

  if (currentWorktree.path) {
    worktrees.push(currentWorktree as WorktreeInfo)
  }

  return worktrees
}

/**
 * Worktree 管理器
 */
export class WorktreeManager {
  private config: WorktreeIsolationConfig
  private worktrees: Map<string, WorktreeInfo> = new Map()
  private idCounter: number = 0

  constructor(config: Partial<WorktreeIsolationConfig> = {}) {
    this.config = { ...DEFAULT_WORKTREE_CONFIG, ...config }
  }

  /**
   * 初始化 worktree 目录
   */
  private ensureWorktreeDir(): void {
    const worktreeBase = path.resolve(this.config.cwd, this.config.worktreeDir)
    if (!fs.existsSync(worktreeBase)) {
      fs.mkdirSync(worktreeBase, { recursive: true })
    }
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `worker-${Date.now()}-${++this.idCounter}`
  }

  /**
   * 创建隔离的 worktree
   */
  createWorktree(workerId?: string): WorktreeInfo | null {
    if (!this.config.enabled) {
      return null
    }

    // 检查是否在 git 仓库中
    if (!isGitRepository(this.config.cwd)) {
      console.warn("[WorktreeManager] Not in a git repository, worktree isolation disabled")
      return null
    }

    this.ensureWorktreeDir()

    const id = workerId || this.generateId()
    const branchName = `${this.config.branchPrefix}/${id}`
    const worktreePath = path.resolve(this.config.cwd, this.config.worktreeDir, id)

    // 创建分支和 worktree
    const result = execGit(
      ["worktree", "add", "-b", branchName, worktreePath, this.config.baseBranch],
      this.config.cwd
    )

    if (result.code !== 0) {
      console.error(`[WorktreeManager] Failed to create worktree: ${result.stderr}`)
      return null
    }

    const info: WorktreeInfo = {
      id,
      branch: branchName,
      path: worktreePath,
      createdAt: Date.now(),
      status: "active",
    }

    this.worktrees.set(id, info)
    return info
  }

  /**
   * 获取 worktree 信息
   */
  getWorktree(id: string): WorktreeInfo | undefined {
    return this.worktrees.get(id)
  }

  /**
   * 获取 worktree 的工作目录
   */
  getWorktreePath(id: string): string | undefined {
    const info = this.worktrees.get(id)
    return info?.path
  }

  /**
   * 完成 worktree（合并更改）
   */
  completeWorktree(id: string, mergeToBase: boolean = false): boolean {
    const info = this.worktrees.get(id)
    if (!info) return false

    // 如果需要合并到基础分支
    if (mergeToBase) {
      // 切换到基础分支
      execGit(["checkout", this.config.baseBranch], this.config.cwd)

      // 合并 worker 分支
      const mergeResult = execGit(["merge", info.branch, "--no-ff", "-m", `Merge ${info.branch}`], this.config.cwd)
      if (mergeResult.code !== 0) {
        console.error(`[WorktreeManager] Failed to merge: ${mergeResult.stderr}`)
        info.status = "failed"
        return false
      }
    }

    info.status = "completed"

    // 如果配置了自动清理
    if (this.config.cleanupOnComplete) {
      this.removeWorktree(id)
    }

    return true
  }

  /**
   * 标记 worktree 为失败
   */
  failWorktree(id: string): boolean {
    const info = this.worktrees.get(id)
    if (!info) return false

    info.status = "failed"

    if (this.config.cleanupOnComplete) {
      this.removeWorktree(id)
    }

    return true
  }

  /**
   * 移除 worktree
   */
  removeWorktree(id: string): boolean {
    const info = this.worktrees.get(id)
    if (!info) return false

    // 移除 worktree
    const result = execGit(["worktree", "remove", info.path, "--force"], this.config.cwd)

    // 删除分支（如果存在）
    execGit(["branch", "-D", info.branch], this.config.cwd)

    this.worktrees.delete(id)
    return result.code === 0
  }

  /**
   * 清理所有 worktree
   */
  cleanup(): number {
    let cleaned = 0
    for (const [id] of this.worktrees) {
      if (this.removeWorktree(id)) {
        cleaned++
      }
    }
    return cleaned
  }

  /**
   * 获取所有活跃的 worktree
   */
  getActiveWorktrees(): WorktreeInfo[] {
    return Array.from(this.worktrees.values()).filter(w => w.status === "active")
  }

  /**
   * 获取配置
   */
  getConfig(): WorktreeIsolationConfig {
    return { ...this.config }
  }

  /**
   * 检查 worktree 是否启用
   */
  isEnabled(): boolean {
    return this.config.enabled && isGitRepository(this.config.cwd)
  }
}

/**
 * 创建 worktree 管理器
 */
export function createWorktreeManager(config?: Partial<WorktreeIsolationConfig>): WorktreeManager {
  return new WorktreeManager(config)
}

/**
 * 为 worker 创建隔离环境的辅助函数
 */
export async function withIsolatedWorktree<T>(
  fn: (worktreePath: string, worktreeId: string) => Promise<T>,
  config?: Partial<WorktreeIsolationConfig>
): Promise<T | null> {
  const manager = new WorktreeManager(config)

  if (!manager.isEnabled()) {
    // 如果 worktree 未启用，在当前目录执行
    return fn(process.cwd(), "main")
  }

  const worktree = manager.createWorktree()
  if (!worktree) {
    return null
  }

  try {
    const result = await fn(worktree.path, worktree.id)
    manager.completeWorktree(worktree.id)
    return result
  } catch (error) {
    manager.failWorktree(worktree.id)
    throw error
  }
}
