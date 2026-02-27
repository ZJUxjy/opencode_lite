import Database from "better-sqlite3"
import { mkdirSync } from "fs"
import { dirname } from "path"
import type { Message, ToolCall, ToolResult } from "./types.js"

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
  private db: Database.Database

  constructor(dbPath: string) {
    // Ensure directory exists
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.init()
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
  }

  listSessions(): string[] {
    const stmt = this.db.prepare<[], { session_id: string }>(
      "SELECT DISTINCT session_id FROM messages ORDER BY session_id DESC"
    )
    const rows = stmt.all()
    return rows.map((r) => r.session_id)
  }

  close() {
    this.db.close()
  }
}
