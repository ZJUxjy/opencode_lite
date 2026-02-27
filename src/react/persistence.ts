/**
 * ThoughtPersistence - 思考过程持久化
 *
 * 将 ScratchpadUnit 存储到数据库，支持会话恢复
 *
 * 参考: dify MessageAgentThought
 */

import Database from "better-sqlite3"
import type { ScratchpadUnit, Action } from "./types.js"
import type { SerializableUnit } from "./scratchpad.js"

/**
 * 数据库中的思考记录
 */
export interface ThoughtRecord {
  id: number
  sessionId: string
  messageId: string | null
  position: number
  thought: string | null
  toolName: string | null
  toolInput: string | null
  observation: string | null
  createdAt: number
}

/**
 * ThoughtPersistence 配置
 */
export interface ThoughtPersistenceConfig {
  /** 是否启用持久化 */
  enabled?: boolean
  /** 最大存储条数（按会话） */
  maxRecordsPerSession?: number
}

/**
 * 思考过程持久化管理器
 *
 * 负责将思考过程存储到数据库，并支持恢复
 */
export class ThoughtPersistence {
  private db: Database.Database
  private config: ThoughtPersistenceConfig

  constructor(db: Database.Database, config: ThoughtPersistenceConfig = {}) {
    this.db = db
    this.config = {
      enabled: true,
      maxRecordsPerSession: 1000,
      ...config,
    }
    this.init()
  }

  /**
   * 初始化数据库表
   */
  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS thoughts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        message_id TEXT,
        position INTEGER NOT NULL,
        thought TEXT,
        tool_name TEXT,
        tool_input TEXT,
        observation TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_thoughts_session ON thoughts(session_id);
      CREATE INDEX IF NOT EXISTS idx_thoughts_message ON thoughts(message_id);
      CREATE INDEX IF NOT EXISTS idx_thoughts_position ON thoughts(session_id, position);
    `)
  }

  /**
   * 保存单个思考单元
   *
   * @param sessionId - 会话 ID
   * @param unit - 思考单元
   * @param position - 位置索引
   * @param messageId - 关联的消息 ID（可选）
   * @returns 插入的记录 ID
   */
  save(
    sessionId: string,
    unit: ScratchpadUnit,
    position: number,
    messageId?: string
  ): number {
    if (!this.config.enabled) {
      return -1
    }

    const stmt = this.db.prepare(`
      INSERT INTO thoughts (session_id, message_id, position, thought, tool_name, tool_input, observation)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const result = stmt.run(
      sessionId,
      messageId || null,
      position,
      unit.thought || null,
      unit.action?.name || null,
      unit.action ? JSON.stringify(unit.action.input) : null,
      unit.observation || null
    )

    // 检查是否需要清理旧记录
    this.checkAndCleanup(sessionId)

    return result.lastInsertRowid as number
  }

  /**
   * 批量保存思考单元
   */
  saveBatch(
    sessionId: string,
    units: ScratchpadUnit[],
    messageId?: string
  ): number[] {
    const ids: number[] = []
    const stmt = this.db.prepare(`
      INSERT INTO thoughts (session_id, message_id, position, thought, tool_name, tool_input, observation)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const insertMany = this.db.transaction((items: ScratchpadUnit[]) => {
      for (let i = 0; i < items.length; i++) {
        const unit = items[i]
        const result = stmt.run(
          sessionId,
          messageId || null,
          i,
          unit.thought || null,
          unit.action?.name || null,
          unit.action ? JSON.stringify(unit.action.input) : null,
          unit.observation || null
        )
        ids.push(result.lastInsertRowid as number)
      }
    })

    insertMany(units)
    this.checkAndCleanup(sessionId)

    return ids
  }

  /**
   * 获取会话的所有思考记录
   */
  get(sessionId: string): ThoughtRecord[] {
    const stmt = this.db.prepare<[string], ThoughtRecord>(
      "SELECT * FROM thoughts WHERE session_id = ? ORDER BY position"
    )
    return stmt.all(sessionId)
  }

  /**
   * 获取会话最近的 N 条思考记录
   */
  getRecent(sessionId: string, limit: number = 10): ThoughtRecord[] {
    const stmt = this.db.prepare<[string, number], ThoughtRecord>(
      "SELECT * FROM thoughts WHERE session_id = ? ORDER BY position DESC LIMIT ?"
    )
    return stmt.all(sessionId, limit).reverse()
  }

  /**
   * 转换为 ScratchpadUnit 数组
   */
  toScratchpadUnits(records: ThoughtRecord[]): ScratchpadUnit[] {
    return records.map(record => ({
      thought: record.thought || "",
      action: record.toolName ? {
        name: record.toolName,
        input: record.toolInput ? JSON.parse(record.toolInput) : {},
      } as Action : null,
      actionStr: record.toolInput || "",
      observation: record.observation,
    }))
  }

  /**
   * 从历史重建消息（用于 LLM 上下文）
   *
   * 将思考过程转换为 Message 格式，用于恢复对话上下文
   */
  rebuildMessages(sessionId: string): Array<{
    role: "assistant" | "user"
    content: string
    toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
    toolResults?: Array<{ toolCallId: string; content: string }>
  }> {
    const records = this.get(sessionId)
    const messages: Array<{
      role: "assistant" | "user"
      content: string
      toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
      toolResults?: Array<{ toolCallId: string; content: string }>
    }> = []

    for (const record of records) {
      // Assistant 消息（思考 + 工具调用）
      if (record.thought || record.toolName) {
        const toolCalls = record.toolName ? [{
          id: `thought-${record.id}`,
          name: record.toolName,
          arguments: record.toolInput ? JSON.parse(record.toolInput) : {},
        }] : undefined

        messages.push({
          role: "assistant",
          content: record.thought || "",
          toolCalls,
        })
      }

      // User 消息（工具结果）
      if (record.observation) {
        messages.push({
          role: "user",
          content: "",
          toolResults: [{
            toolCallId: `thought-${record.id}`,
            content: record.observation,
          }],
        })
      }
    }

    return messages
  }

  /**
   * 获取会话的思考过程摘要
   */
  getSummary(sessionId: string): {
    totalUnits: number
    toolCalls: number
    finalAnswers: number
    lastThought: string | null
  } {
    const records = this.get(sessionId)

    let toolCalls = 0
    let finalAnswers = 0
    let lastThought: string | null = null

    for (const record of records) {
      if (record.toolName) {
        toolCalls++
        if (record.toolName.toLowerCase().includes("final")) {
          finalAnswers++
        }
      }
      if (record.thought) {
        lastThought = record.thought
      }
    }

    return {
      totalUnits: records.length,
      toolCalls,
      finalAnswers,
      lastThought,
    }
  }

  /**
   * 清除会话的思考记录
   */
  clear(sessionId: string): void {
    this.db.prepare("DELETE FROM thoughts WHERE session_id = ?").run(sessionId)
  }

  /**
   * 检查并清理旧记录
   */
  private checkAndCleanup(sessionId: string): void {
    const count = this.getCount(sessionId)
    if (count > this.config.maxRecordsPerSession!) {
      // 删除最旧的记录，保留最新的 maxRecordsPerSession 条
      this.db.prepare(`
        DELETE FROM thoughts
        WHERE session_id = ?
        AND id NOT IN (
          SELECT id FROM thoughts
          WHERE session_id = ?
          ORDER BY position DESC
          LIMIT ?
        )
      `).run(sessionId, sessionId, this.config.maxRecordsPerSession)
    }
  }

  /**
   * 获取会话的记录数
   */
  getCount(sessionId: string): number {
    const result = this.db.prepare<[string], { count: number }>(
      "SELECT COUNT(*) as count FROM thoughts WHERE session_id = ?"
    ).get(sessionId)
    return result?.count || 0
  }

  /**
   * 列出所有有思考记录的会话
   */
  listSessions(): string[] {
    const stmt = this.db.prepare<[], { session_id: string }>(
      "SELECT DISTINCT session_id FROM thoughts ORDER BY session_id DESC"
    )
    return stmt.all().map(r => r.session_id)
  }

  /**
   * 导出会话数据为 JSON
   */
  export(sessionId: string): string {
    const records = this.get(sessionId)
    const units = this.toScratchpadUnits(records)
    return JSON.stringify(units, null, 2)
  }

  /**
   * 从 JSON 导入数据
   */
  import(sessionId: string, json: string): number {
    const units = JSON.parse(json) as ScratchpadUnit[]
    const ids = this.saveBatch(sessionId, units)
    return ids.length
  }
}
