import Database from "better-sqlite3"
import { mkdirSync } from "fs"
import { dirname, resolve } from "path"

/**
 * 数据库管理器 - 单例模式
 *
 * 解决多个 Store 类共享同一数据库连接的问题：
 * - 使用 WAL 模式提高并发性能
 * - 设置 busy_timeout 避免锁冲突
 * - 确保同一数据库文件只有一个连接实例
 */
export class DatabaseManager {
  private static instances: Map<string, DatabaseManager> = new Map()
  private db: Database.Database
  /** Normalized (resolved) path used as the map key */
  private readonly normalizedPath: string

  private constructor(normalizedPath: string) {
    this.normalizedPath = normalizedPath

    // 确保目录存在
    mkdirSync(dirname(normalizedPath), { recursive: true })

    // 创建数据库连接
    this.db = new Database(normalizedPath)

    // 启用 WAL 模式，提高并发性能
    // WAL 模式允许读写并发，避免读写互斥
    this.db.pragma('journal_mode = WAL')

    // 设置 busy_timeout 为 5 秒
    // 当数据库被锁定时，等待 5 秒而不是立即失败
    this.db.pragma('busy_timeout = 5000')

    // 设置同步模式为 NORMAL，平衡性能和数据安全
    this.db.pragma('synchronous = NORMAL')

    // 启用外键约束，确保引用完整性
    this.db.pragma('foreign_keys = ON')
  }

  /**
   * 获取数据库管理器实例
   * 同一数据库文件路径返回同一实例
   */
  static getInstance(dbPath: string): DatabaseManager {
    // 规范化路径，确保相同路径返回同一实例
    const normalizedPath = resolve(dbPath)

    if (!this.instances.has(normalizedPath)) {
      this.instances.set(normalizedPath, new DatabaseManager(normalizedPath))
    }
    return this.instances.get(normalizedPath)!
  }

  /**
   * 获取数据库连接
   */
  getDatabase(): Database.Database {
    return this.db
  }

  /**
   * 获取数据库路径
   */
  getDbPath(): string {
    return this.normalizedPath
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    try { this.db.close() } catch { }
    DatabaseManager.instances.delete(this.normalizedPath)
  }

  /**
   * 关闭所有数据库连接（进程退出时调用）
   */
  static closeAll(): void {
    for (const mgr of DatabaseManager.instances.values()) {
      try { mgr.db.close() } catch { }
    }
    DatabaseManager.instances.clear()
  }

  /**
   * 检查连接是否已打开
   */
  isOpen(): boolean {
    try {
      this.db.exec('SELECT 1')
      return true
    } catch {
      return false
    }
  }
}

// CR-21: Close all DB connections on process exit to ensure WAL checkpoint
process.on('exit', () => {
  DatabaseManager.closeAll()
})
