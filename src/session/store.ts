/**
 * SessionStore - 会话元数据存储
 *
 * 管理会话的创建、查询、更新和删除
 */

import Database from "better-sqlite3"
import { mkdirSync } from "fs"
import { dirname } from "path"
import type {
  Session,
  CreateSessionParams,
  UpdateSessionParams,
  ListSessionsOptions,
  DBSession,
} from "./types.js"

/**
 * SessionStore 类
 *
 * 使用 SQLite 存储会话元数据
 */
export class SessionStore {
  private db: Database.Database

  constructor(dbPath: string) {
    // Ensure directory exists
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.init()
  }

  /**
   * 初始化数据库表
   */
  private init() {
    // 创建 sessions 表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        cwd TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch()),
        message_count INTEGER DEFAULT 0,
        is_archived INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_cwd ON sessions(cwd);
      CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
    `)
  }

  /**
   * 创建新会话
   */
  create(params: CreateSessionParams): Session {
    const now = Math.floor(Date.now() / 1000)
    const session: Session = {
      id: params.id || this.generateId(),
      title: params.title || "New Session",
      cwd: params.cwd,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      isArchived: false,
    }

    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, title, cwd, created_at, updated_at, message_count, is_archived)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      session.id,
      session.title,
      session.cwd,
      session.createdAt,
      session.updatedAt,
      session.messageCount,
      session.isArchived ? 1 : 0
    )

    return session
  }

  /**
   * 获取会话
   */
  get(id: string): Session | null {
    const stmt = this.db.prepare<[string], DBSession>(
      "SELECT * FROM sessions WHERE id = ?"
    )
    const row = stmt.get(id)
    return row ? this.mapRowToSession(row) : null
  }

  /**
   * 获取指定目录的最后会话
   */
  getLastSession(cwd: string): Session | null {
    const stmt = this.db.prepare<[string, number], DBSession>(
      `SELECT * FROM sessions
       WHERE cwd = ? AND is_archived = ?
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    const row = stmt.get(cwd, 0)
    return row ? this.mapRowToSession(row) : null
  }

  /**
   * 获取最新的会话（不限目录）
   */
  getLatestSession(): Session | null {
    const stmt = this.db.prepare<[], DBSession>(
      `SELECT * FROM sessions
       WHERE is_archived = 0
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    const row = stmt.get()
    return row ? this.mapRowToSession(row) : null
  }

  /**
   * 列岿会话
   */
  list(options: ListSessionsOptions = {}): Session[] {
    const conditions: string[] = []
    const params: (string | number)[] = []

    if (options.cwd) {
      conditions.push("cwd = ?")
      params.push(options.cwd)
    }

    if (!options.includeArchived) {
      conditions.push("is_archived = 0")
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : ""

    const order = options.order === "asc" ? "ASC" : "DESC"
    const limitClause = options.limit ? `LIMIT ${options.limit}` : ""

    const sql = `SELECT * FROM sessions ${whereClause} ORDER BY updated_at ${order} ${limitClause}`.trim()
    const stmt = this.db.prepare<typeof params, DBSession>(sql)
    const rows = stmt.all(...params)

    return rows.map((row) => this.mapRowToSession(row))
  }

  /**
   * 更新会话
   */
  update(id: string, updates: UpdateSessionParams): void {
    const sets: string[] = []
    const params: (string | number)[] = []

    if (updates.title !== undefined) {
      sets.push("title = ?")
      params.push(updates.title)
    }

    if (updates.messageCount !== undefined) {
      sets.push("message_count = ?")
      params.push(updates.messageCount)
    }

    if (updates.isArchived !== undefined) {
      sets.push("is_archived = ?")
      params.push(updates.isArchived ? 1 : 0)
    }

    // 总是更新 updated_at
    sets.push("updated_at = ?")
    params.push(Math.floor(Date.now() / 1000))

    // 添加 id 到参数列表
    params.push(id)

    const sql = `UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`
    const stmt = this.db.prepare(sql)
    stmt.run(...params)
  }

  /**
   * 更新消息数量（原子操作）
   */
  incrementMessageCount(id: string, count = 1): void {
    const stmt = this.db.prepare(`
      UPDATE sessions
      SET message_count = message_count + ?, updated_at = ?
      WHERE id = ?
    `)
    stmt.run(count, Math.floor(Date.now() / 1000), id)
  }

  /**
   * 删除会话
   */
  delete(id: string): boolean {
    const stmt = this.db.prepare("DELETE FROM sessions WHERE id = ?")
    const result = stmt.run(id)
    return result.changes > 0
  }

  /**
   * 删除指定目录的所有会话
   */
  deleteByCwd(cwd: string): number {
    const stmt = this.db.prepare("DELETE FROM sessions WHERE cwd = ?")
    const result = stmt.run(cwd)
    return result.changes
  }

  /**
   * 归档会话
   */
  archive(id: string): void {
    this.update(id, { isArchived: true })
  }

  /**
   * 取消归档
   */
  unarchive(id: string): void {
    this.update(id, { isArchived: false })
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  }

  /**
   * 数据库行映射为 Session 对象
   */
  private mapRowToSession(row: DBSession): Session {
    return {
      id: row.id,
      title: row.title,
      cwd: row.cwd,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: row.message_count,
      isArchived: row.is_archived === 1,
    }
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    this.db.close()
  }
}

/**
 * 生成会话标题
 * 从第一条用户消息提取前50个字符
 */
export function generateSessionTitle(firstUserMessage: string): string {
  const cleaned = firstUserMessage
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50)
  return cleaned || "New Session"
}

/**
 * 格式化相对时间
 * 如：2小时前、昨天、3天前
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = now - timestamp

  if (diff < 60) {
    return "刚刚"
  }
  if (diff < 3600) {
    return `${Math.floor(diff / 60)}分钟前`
  }
  if (diff < 86400) {
    return `${Math.floor(diff / 3600)}小时前`
  }
  if (diff < 172800) {
    return "昨天"
  }
  if (diff < 604800) {
    return `${Math.floor(diff / 86400)}天前`
  }
  if (diff < 2592000) {
    return `${Math.floor(diff / 604800)}周前`
  }

  const date = new Date(timestamp * 1000)
  return date.toLocaleDateString("zh-CN")
}
