/**
 * PlanStore - Plan 状态持久化存储
 *
 * 使用 SQLite 存储 Plan 与会话的关联
 */

import { DatabaseManager } from "../db.js"

/**
 * Plan 记录数据库结构
 */
export interface PlanRecord {
  id: number
  session_id: string
  slug: string
  is_enabled: number
  has_exited: number
  file_path: string
  created_at: number
  updated_at: number
}

/**
 * Plan 状态
 */
export interface PlanState {
  isEnabled: boolean
  slug: string | null
  hasExited: boolean
  filePath: string | null
}

/**
 * PlanStore 类
 *
 * 管理 plans 表的增删改查
 */
export class PlanStore {
  private dbManager: DatabaseManager

  constructor(dbPath: string) {
    this.dbManager = DatabaseManager.getInstance(dbPath)
    this.init()
  }

  /**
   * 获取数据库连接
   */
  private get db() {
    return this.dbManager.getDatabase()
  }

  /**
   * 初始化数据库表
   */
  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL UNIQUE,
        slug TEXT NOT NULL,
        is_enabled INTEGER DEFAULT 0,
        has_exited INTEGER DEFAULT 0,
        file_path TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_plans_session ON plans(session_id);
      CREATE INDEX IF NOT EXISTS idx_plans_slug ON plans(slug);
    `)
  }

  /**
   * 获取或创建 Plan 记录
   */
  getOrCreate(sessionId: string, filePath: string, slug: string): PlanState {
    const existing = this.get(sessionId)
    if (existing) {
      return existing
    }

    const stmt = this.db.prepare(`
      INSERT INTO plans (session_id, slug, is_enabled, has_exited, file_path, updated_at)
      VALUES (?, ?, 0, 0, ?, unixepoch())
    `)

    stmt.run(sessionId, slug, filePath)

    return {
      isEnabled: false,
      slug,
      hasExited: false,
      filePath,
    }
  }

  /**
   * 获取 Plan 状态
   */
  get(sessionId: string): PlanState | null {
    const stmt = this.db.prepare<[string], PlanRecord>(
      "SELECT * FROM plans WHERE session_id = ?"
    )
    const row = stmt.get(sessionId)

    if (!row) return null

    return {
      isEnabled: row.is_enabled === 1,
      slug: row.slug,
      hasExited: row.has_exited === 1,
      filePath: row.file_path,
    }
  }

  /**
   * 更新 Plan 状态
   */
  update(sessionId: string, updates: Partial<Omit<PlanState, "slug">>): void {
    const sets: string[] = []
    const params: (string | number)[] = []

    if (updates.isEnabled !== undefined) {
      sets.push("is_enabled = ?")
      params.push(updates.isEnabled ? 1 : 0)
    }

    if (updates.hasExited !== undefined) {
      sets.push("has_exited = ?")
      params.push(updates.hasExited ? 1 : 0)
    }

    if (updates.filePath !== undefined && updates.filePath !== null) {
      sets.push("file_path = ?")
      params.push(updates.filePath)
    }

    if (sets.length === 0) return

    sets.push("updated_at = ?")
    params.push(Math.floor(Date.now() / 1000))
    params.push(sessionId)

    const sql = `UPDATE plans SET ${sets.join(", ")} WHERE session_id = ?`
    const stmt = this.db.prepare(sql)
    stmt.run(...params)
  }

  /**
   * 删除 Plan 记录
   */
  delete(sessionId: string): boolean {
    const stmt = this.db.prepare("DELETE FROM plans WHERE session_id = ?")
    const result = stmt.run(sessionId)
    return result.changes > 0
  }

  /**
   * 列出所有 Plan
   */
  list(): Array<PlanState & { sessionId: string; createdAt: number; updatedAt: number }> {
    const stmt = this.db.prepare<[], PlanRecord>(
      "SELECT * FROM plans ORDER BY updated_at DESC"
    )
    const rows = stmt.all()

    return rows.map((row) => ({
      sessionId: row.session_id,
      isEnabled: row.is_enabled === 1,
      slug: row.slug,
      hasExited: row.has_exited === 1,
      filePath: row.file_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  /**
   * 检查是否存在
   */
  exists(sessionId: string): boolean {
    const stmt = this.db.prepare<[string], { count: number }>(
      "SELECT COUNT(*) as count FROM plans WHERE session_id = ?"
    )
    const result = stmt.get(sessionId)
    return result ? result.count > 0 : false
  }

  /**
   * 通过 slug 查找
   */
  findBySlug(slug: string): (PlanState & { sessionId: string }) | null {
    const stmt = this.db.prepare<[string], PlanRecord>(
      "SELECT * FROM plans WHERE slug = ?"
    )
    const row = stmt.get(slug)

    if (!row) return null

    return {
      sessionId: row.session_id,
      isEnabled: row.is_enabled === 1,
      slug: row.slug,
      hasExited: row.has_exited === 1,
      filePath: row.file_path,
    }
  }
}
