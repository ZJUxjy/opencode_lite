import type { Message, ToolCall, ToolResult } from "./types.js"
import { SessionStore, generateSessionTitle } from "./session/index.js"
import { DatabaseManager } from "./db.js"

interface DBMessage {
  id: number
  session_id: string
  role: string
  content: string | null
  tool_calls: string | null
  tool_results: string | null
  created_at: number
}

export class MessageStore {
  private dbManager: DatabaseManager
  private sessionStore: SessionStore | null = null

  constructor(dbPath: string, sessionStore?: SessionStore) {
    // 使用 DatabaseManager 获取共享连接
    this.dbManager = DatabaseManager.getInstance(dbPath)
    this.sessionStore = sessionStore || null
    this.init()
  }

  /**
   * 获取数据库连接
   */
  private get db() {
    return this.dbManager.getDatabase()
  }

  /**
   * 设置 SessionStore（用于会话元数据管理）
   */
  setSessionStore(sessionStore: SessionStore): void {
    this.sessionStore = sessionStore
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT,
        tool_calls TEXT,
        tool_results TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_session ON messages(session_id);
    `)
  }

  add(sessionId: string, message: Message) {
    const stmt = this.db.prepare(`
      INSERT INTO messages (session_id, role, content, tool_calls, tool_results)
      VALUES (?, ?, ?, ?, ?)
    `)

    stmt.run(
      sessionId,
      message.role,
      message.content || null,
      message.toolCalls ? JSON.stringify(message.toolCalls) : null,
      message.toolResults ? JSON.stringify(message.toolResults) : null
    )

    // 更新会话元数据
    if (this.sessionStore) {
      const session = this.sessionStore.get(sessionId)
      if (session) {
        // 检查是否需要更新标题（第一条用户消息）
        if (message.role === "user" && session.messageCount === 0) {
          const title = generateSessionTitle(message.content || "")
          this.sessionStore.update(sessionId, { title, messageCount: 1 })
        } else {
          // 仅增加消息计数
          this.sessionStore.incrementMessageCount(sessionId)
        }
      }
    }
  }

  get(sessionId: string): Message[] {
    const stmt = this.db.prepare<[string], DBMessage>(
      "SELECT * FROM messages WHERE session_id = ? ORDER BY id"
    )
    const rows = stmt.all(sessionId)

    return rows.map((row) => ({
      role: row.role as "user" | "assistant",
      content: row.content || "",
      toolCalls: row.tool_calls ? (JSON.parse(row.tool_calls) as ToolCall[]) : undefined,
      toolResults: row.tool_results
        ? (JSON.parse(row.tool_results) as ToolResult[])
        : undefined,
    }))
  }

  clear(sessionId: string) {
    this.db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId)

    // 更新会话的消息计数为 0
    if (this.sessionStore) {
      this.sessionStore.update(sessionId, { messageCount: 0 })
    }
  }

  listSessions(): string[] {
    const stmt = this.db.prepare<[], { session_id: string }>(
      "SELECT DISTINCT session_id FROM messages ORDER BY session_id DESC"
    )
    const rows = stmt.all()
    return rows.map((r) => r.session_id)
  }

  close() {
    // 由 DatabaseManager 管理连接生命周期
    // 这里不再直接关闭
  }
}

/**
 * 组合 MessageStore 和 SessionStore 的工厂函数
 */
export function createStore(dbPath: string): {
  messageStore: MessageStore
  sessionStore: SessionStore
} {
  const sessionStore = new SessionStore(dbPath)
  const messageStore = new MessageStore(dbPath, sessionStore)
  return { messageStore, sessionStore }
}
