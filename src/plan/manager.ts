import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join, relative, resolve, isAbsolute, parse } from "path"
import { randomBytes } from "crypto"
import { getLiteOpencodeBaseDir } from "../utils/config.js"
import { PlanStore, type PlanState } from "./store.js"
import type { DatabaseManager } from "../db.js"
import { getPlanContext, requirePlanContext, type PlanContext } from "./context.js"

const MAX_SLUG_ATTEMPTS = 10

// Slug 生成词库
const SLUG_ADJECTIVES = [
  "bright", "dark", "light", "swift", "slow", "quiet", "loud",
  "calm", "wild", "bold", "soft", "hard", "sharp", "smooth",
  "warm", "cool", "fresh", "old", "new", "true",
] as const

const SLUG_VERBS = [
  "shining", "rising", "falling", "running", "walking", "flying",
  "sailing", "dancing", "singing", "thinking", "dreaming", "building",
  "creating", "exploring", "discovering", "learning", "growing",
] as const

const SLUG_NOUNS = [
  "moon", "sun", "star", "sky", "sea", "wind", "rain", "snow",
  "tree", "flower", "mountain", "river", "ocean", "forest",
  "bird", "fish", "wolf", "bear", "lion", "eagle",
] as const

/**
 * Plan Mode 管理器
 *
 * 负责：
 * - Plan Mode 状态管理（进入/退出/查询）
 * - 计划文件路径管理
 * - Slug 生成和缓存
 * - 与会话的关联持久化
 */
export class PlanModeManager {
  private sessionId: string
  private planStore: PlanStore
  private _cachedState: PlanState | null = null

  constructor(sessionId: string, dbPathOrManager: string | DatabaseManager) {
    this.sessionId = sessionId
    this.planStore = new PlanStore(
      typeof dbPathOrManager === "string" ? dbPathOrManager : dbPathOrManager.getDbPath()
    )
  }

  /**
   * 获取当前状态
   */
  private getState(): PlanState {
    if (this._cachedState) {
      return this._cachedState
    }

    const filePath = this.getPlanFilePath()
    const slug = this.getSlug()
    const state = this.planStore.getOrCreate(this.sessionId, filePath, slug)
    this._cachedState = state
    return state
  }

  /**
   * 进入 Plan Mode
   */
  enter(): { planFilePath: string } {
    const state = this.getState()
    state.isEnabled = true
    state.hasExited = false

    this.planStore.update(this.sessionId, {
      isEnabled: true,
      hasExited: false,
    })

    return { planFilePath: state.filePath! }
  }

  /**
   * 退出 Plan Mode
   */
  exit(): { planFilePath: string } {
    const state = this.getState()
    state.isEnabled = false
    state.hasExited = true

    this.planStore.update(this.sessionId, {
      isEnabled: false,
      hasExited: true,
    })

    return { planFilePath: state.filePath! }
  }

  /**
   * 检查是否在 Plan Mode
   */
  isEnabled(): boolean {
    return this.getState().isEnabled
  }

  /**
   * 检查是否需要附加 exit 信息
   */
  needsExitAttachment(): boolean {
    const state = this.getState()
    return state.hasExited && !state.isEnabled
  }

  /**
   * 获取计划文件路径
   */
  getPlanFilePath(): string {
    const slug = this.getSlug()
    return join(this.getPlanDirectory(), `${slug}.md`)
  }

  /**
   * 获取 slug
   */
  private getSlug(): string {
    const existing = this.planStore.get(this.sessionId)
    if (existing?.slug) {
      return existing.slug
    }

    const dir = this.getPlanDirectory()
    let slug: string | null = null

    // 尝试生成不冲突的 slug
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      slug = generateSlug()
      const path = join(dir, `${slug}.md`)
      if (!existsSync(path) && !this.planStore.findBySlug(slug)) break
    }

    if (!slug) slug = generateSlug()

    // 保存到数据库以便持久化
    const filePath = join(dir, `${slug}.md`)
    this.planStore.getOrCreate(this.sessionId, filePath, slug)

    return slug
  }

  /**
   * 检查路径是否为当前会话的计划文件
   */
  isPlanFilePath(path: string): boolean {
    const planDir = resolve(this.getPlanDirectory())
    const target = resolve(path)
    const rel = relative(planDir, target)

    // 路径不在 plan 目录内
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
      return false
    }

    // 检查文件名是否匹配当前 slug
    const expectedSlug = this.getSlug()
    const targetName = parse(target).name

    return targetName === expectedSlug || targetName.startsWith(`${expectedSlug}-agent-`)
  }

  /**
   * 检查路径是否在计划目录内
   */
  isPathInPlanDirectory(path: string): boolean {
    const planDir = resolve(this.getPlanDirectory())
    const target = resolve(path)
    const rel = relative(planDir, target)

    if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
      return false
    }
    return true
  }

  /**
   * 读取计划文件内容
   */
  readPlanFile(): { content: string; exists: boolean; planFilePath: string } {
    const planFilePath = this.getPlanFilePath()

    if (!existsSync(planFilePath)) {
      return { content: "", exists: false, planFilePath }
    }

    return {
      content: readFileSync(planFilePath, "utf8"),
      exists: true,
      planFilePath,
    }
  }

  /**
   * 写入计划文件
   */
  writePlanFile(content: string): { planFilePath: string } {
    const planFilePath = this.getPlanFilePath()
    writeFileSync(planFilePath, content, "utf8")
    return { planFilePath }
  }

  /**
   * 获取计划目录
   */
  getPlanDirectory(): string {
    const dir = join(getLiteOpencodeBaseDir(), "plans")
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    return dir
  }

  /**
   * 获取 PlanStore 实例（用于高级操作）
   */
  getStore(): PlanStore {
    return this.planStore
  }

  /**
   * 获取会话 ID
   */
  getSessionId(): string {
    return this.sessionId
  }
}

/**
 * 生成随机 slug
 * 格式: adjective-verb-noun (例如: bright-shining-moon)
 */
function generateSlug(): string {
  const adjective = SLUG_ADJECTIVES[randomIndex(SLUG_ADJECTIVES.length)]
  const verb = SLUG_VERBS[randomIndex(SLUG_VERBS.length)]
  const noun = SLUG_NOUNS[randomIndex(SLUG_NOUNS.length)]
  return `${adjective}-${verb}-${noun}`
}

function randomIndex(length: number): number {
  return randomBytes(4).readUInt32BE(0) % length
}

/**
 * 全局管理器缓存（按 sessionId）
 */
const managerCache = new Map<string, PlanModeManager>()

/**
 * 获取 Plan Mode 管理器实例
 */
export function getPlanModeManager(
  sessionId: string,
  dbPath: string
): PlanModeManager {
  const key = `${sessionId}:${dbPath}`
  if (!managerCache.has(key)) {
    managerCache.set(key, new PlanModeManager(sessionId, dbPath))
  }
  return managerCache.get(key)!
}

/**
 * 清除缓存（用于测试）
 */
export function clearPlanModeManagerCache(): void {
  managerCache.clear()
}

/**
 * 检查是否在 Plan Mode（需要传入 sessionId）
 */
export function isPlanModeEnabled(sessionId: string, dbPath: string): boolean {
  return getPlanModeManager(sessionId, dbPath).isEnabled()
}

/**
 * 进入 Plan Mode（需要传入 sessionId）
 */
export function enterPlanMode(
  sessionId: string,
  dbPath: string
): { planFilePath: string } {
  return getPlanModeManager(sessionId, dbPath).enter()
}

/**
 * 退出 Plan Mode（需要传入 sessionId）
 */
export function exitPlanMode(
  sessionId: string,
  dbPath: string
): { planFilePath: string } {
  return getPlanModeManager(sessionId, dbPath).exit()
}

/**
 * 获取计划文件路径（需要传入 sessionId）
 */
export function getPlanFilePath(sessionId: string, dbPath: string): string {
  return getPlanModeManager(sessionId, dbPath).getPlanFilePath()
}

/**
 * 检查路径是否为计划文件（需要传入 sessionId）
 */
export function isPlanFilePath(
  sessionId: string,
  dbPath: string,
  path: string
): boolean {
  return getPlanModeManager(sessionId, dbPath).isPlanFilePath(path)
}

/**
 * 读取计划文件（需要传入 sessionId）
 */
export function readPlanFile(
  sessionId: string,
  dbPath: string
): { content: string; exists: boolean; planFilePath: string } {
  return getPlanModeManager(sessionId, dbPath).readPlanFile()
}

// ============================================================================
// 全局上下文便捷函数（自动从当前上下文获取 sessionId 和 dbPath）
// ============================================================================

/**
 * 获取当前上下文的 Plan Mode 管理器
 */
function getCurrentManager(): PlanModeManager {
  const ctx = requirePlanContext()
  return getPlanModeManager(ctx.sessionId, ctx.dbPath)
}

/**
 * 检查是否在 Plan Mode（使用全局上下文）
 */
export function isPlanModeEnabledCurrent(): boolean {
  const ctx = getPlanContext()
  if (!ctx) return false
  return getPlanModeManager(ctx.sessionId, ctx.dbPath).isEnabled()
}

/**
 * 进入 Plan Mode（使用全局上下文）
 */
export function enterPlanModeCurrent(): { planFilePath: string } {
  return getCurrentManager().enter()
}

/**
 * 退出 Plan Mode（使用全局上下文）
 */
export function exitPlanModeCurrent(): { planFilePath: string } {
  return getCurrentManager().exit()
}

/**
 * 获取计划文件路径（使用全局上下文）
 */
export function getPlanFilePathCurrent(): string {
  return getCurrentManager().getPlanFilePath()
}

/**
 * 检查路径是否为计划文件（使用全局上下文）
 */
export function isPlanFilePathCurrent(path: string): boolean {
  return getCurrentManager().isPlanFilePath(path)
}

/**
 * 读取计划文件（使用全局上下文）
 */
export function readPlanFileCurrent(): {
  content: string
  exists: boolean
  planFilePath: string
} {
  return getCurrentManager().readPlanFile()
}
