import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join, relative, resolve, isAbsolute, parse } from "path"
import { randomBytes } from "crypto"
import { getLiteOpencodeBaseDir } from "../utils/config.js"

// Plan Mode 状态
interface PlanModeState {
  isEnabled: boolean
  slug: string | null
  hasExited: boolean
  needsExitAttachment: boolean
}

// 每个会话的 Plan Mode 状态
const planModeStates = new Map<string, PlanModeState>()
const planSlugCache = new Map<string, string>()

const DEFAULT_SESSION_KEY = "default"
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
 */
export class PlanModeManager {
  private sessionKey: string

  constructor(sessionKey: string = DEFAULT_SESSION_KEY) {
    this.sessionKey = sessionKey
  }

  /**
   * 进入 Plan Mode
   */
  enter(): { planFilePath: string } {
    const state = this.getState()
    state.isEnabled = true
    state.hasExited = false
    state.needsExitAttachment = false

    const planFilePath = this.getPlanFilePath()

    return { planFilePath }
  }

  /**
   * 退出 Plan Mode
   */
  exit(): { planFilePath: string } {
    const state = this.getState()
    state.isEnabled = false
    state.hasExited = true
    state.needsExitAttachment = true

    const planFilePath = this.getPlanFilePath()

    return { planFilePath }
  }

  /**
   * 检查是否在 Plan Mode
   */
  isEnabled(): boolean {
    return this.getState().isEnabled
  }

  /**
   * 获取计划文件路径
   */
  getPlanFilePath(): string {
    const slug = this.getOrCreateSlug()
    return join(this.getPlanDirectory(), `${slug}.md`)
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
    const expectedSlug = this.getOrCreateSlug()
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
   * 获取或创建 slug
   */
  private getOrCreateSlug(): string {
    const cached = planSlugCache.get(this.sessionKey)
    if (cached) return cached

    const dir = this.getPlanDirectory()
    let slug: string | null = null

    // 尝试生成不冲突的 slug
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      slug = generateSlug()
      const path = join(dir, `${slug}.md`)
      if (!existsSync(path)) break
    }

    if (!slug) slug = generateSlug()

    planSlugCache.set(this.sessionKey, slug)
    return slug
  }

  /**
   * 获取当前状态
   */
  private getState(): PlanModeState {
    let state = planModeStates.get(this.sessionKey)
    if (!state) {
      state = {
        isEnabled: false,
        slug: null,
        hasExited: false,
        needsExitAttachment: false,
      }
      planModeStates.set(this.sessionKey, state)
    }
    return state
  }

  /**
   * 重置状态（用于测试）
   */
  static reset(): void {
    planModeStates.clear()
    planSlugCache.clear()
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
 * 获取全局 Plan Mode 管理器实例
 */
let globalManager: PlanModeManager | null = null

export function getPlanModeManager(sessionKey?: string): PlanModeManager {
  if (!globalManager || sessionKey) {
    globalManager = new PlanModeManager(sessionKey)
  }
  return globalManager
}

/**
 * 检查是否在 Plan Mode
 */
export function isPlanModeEnabled(): boolean {
  return getPlanModeManager().isEnabled()
}

/**
 * 进入 Plan Mode
 */
export function enterPlanMode(): { planFilePath: string } {
  return getPlanModeManager().enter()
}

/**
 * 退出 Plan Mode
 */
export function exitPlanMode(): { planFilePath: string } {
  return getPlanModeManager().exit()
}

/**
 * 获取计划文件路径
 */
export function getPlanFilePath(): string {
  return getPlanModeManager().getPlanFilePath()
}

/**
 * 检查路径是否为计划文件
 */
export function isPlanFilePath(path: string): boolean {
  return getPlanModeManager().isPlanFilePath(path)
}

/**
 * 读取计划文件
 */
export function readPlanFile(): { content: string; exists: boolean; planFilePath: string } {
  return getPlanModeManager().readPlanFile()
}
