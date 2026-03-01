/**
 * TeamSessionStore - Team 会话数据存储
 *
 * 管理团队模式的会话数据，包括：
 * - Team 运行元数据（模式、策略、状态）
 * - Agent 消息轨迹
 * - 检查点索引
 * - 成本追踪
 */

import Database from "better-sqlite3"
import { mkdirSync } from "fs"
import { dirname } from "path"
import type { TeamMode, TeamStatus, AgentRole, TeamResult } from "./types.js"
import type { Checkpoint } from "./checkpoint-store.js"
import type { WorkArtifact, ReviewArtifact } from "./contracts.js"

/**
 * Team 会话记录
 */
export interface TeamSession {
  /** 会话 ID (关联到 sessions 表) */
  sessionId: string
  /** Team 模式 */
  mode: TeamMode
  /** Leader-Workers 策略 (仅 mode=leader-workers 时有效) */
  strategy?: "collaborative" | "competitive"
  /** Team 状态 */
  status: TeamStatus
  /** 参与的 Agent 配置 JSON */
  agents: TeamAgentRecord[]
  /** 开始时间 */
  startedAt: number
  /** 结束时间 */
  completedAt?: number
  /** 执行结果摘要 */
  resultSummary?: string
  /** 统计数据 JSON */
  stats?: TeamSessionStats
  /** 创建时间 */
  createdAt: number
  /** 更新时间 */
  updatedAt: number
}

/**
 * Agent 记录
 */
export interface TeamAgentRecord {
  /** Agent ID */
  id: string
  /** Agent 角色 */
  role: AgentRole
  /** 使用的模型 */
  model: string
  /** 输入 tokens */
  inputTokens: number
  /** 输出 tokens */
  outputTokens: number
  /** 成本 (USD) */
  costUsd: number
  /** 状态 */
  status: "idle" | "working" | "completed" | "failed"
}

/**
 * Team 会话统计
 */
export interface TeamSessionStats {
  /** 总耗时 (ms) */
  duration: number
  /** 迭代次数 */
  iterations: number
  /** 总成本 */
  totalCost: number
  /** 总 tokens */
  totalTokens: number
  /** 检查点数量 */
  checkpointCount: number
  /** 产物数量 */
  artifactCount: number
}

/**
 * Agent 消息轨迹
 */
export interface AgentMessageTrace {
  /** 轨迹 ID */
  id: string
  /** Team 会话 ID */
  teamSessionId: string
  /** Agent ID */
  agentId: string
  /** Agent 角色 */
  agentRole: AgentRole
  /** 消息类型 */
  type: "task-assign" | "task-result" | "review-request" | "review-result" | "conflict-detected"
  /** 消息内容 JSON */
  content: Record<string, unknown>
  /** 时间戳 */
  timestamp: number
}

/**
 * 检查点索引
 */
export interface CheckpointIndex {
  /** Team 会话 ID */
  teamSessionId: string
  /** 检查点 ID */
  checkpointId: string
  /** 检查点数据 JSON */
  checkpoint: Checkpoint
  /** 创建时间 */
  createdAt: number
}

/**
 * 数据库 Team 会话记录
 */
export interface DBTeamSession {
  session_id: string
  mode: string
  strategy: string | null
  status: string
  agents: string
  started_at: number
  completed_at: number | null
  result_summary: string | null
  stats: string | null
  created_at: number
  updated_at: number
}

/**
 * 数据库 Agent 消息轨迹
 */
export interface DBAgentMessageTrace {
  id: string
  team_session_id: string
  agent_id: string
  agent_role: string
  type: string
  content: string
  timestamp: number
}

/**
 * 数据库检查点索引
 */
export interface DBCheckpointIndex {
  team_session_id: string
  checkpoint_id: string
  checkpoint: string
  created_at: number
}

/**
 * TeamSessionStore 类
 *
 * 使用 SQLite 存储 Team 会话数据
 */
export class TeamSessionStore {
  private db: Database.Database

  constructor(dbPath: string) {
    // 确保目录存在
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.init()
  }

  /**
   * 初始化数据库表
   */
  private init(): void {
    // 创建 team_sessions 表
    // 注意：不使用外键约束，以便独立测试和使用
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS team_sessions (
        session_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        strategy TEXT,
        status TEXT NOT NULL,
        agents TEXT NOT NULL DEFAULT '[]',
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        result_summary TEXT,
        stats TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_team_sessions_mode ON team_sessions(mode);
      CREATE INDEX IF NOT EXISTS idx_team_sessions_status ON team_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_team_sessions_started ON team_sessions(started_at DESC);
    `)

    // 创建 agent_message_traces 表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_message_traces (
        id TEXT PRIMARY KEY,
        team_session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        agent_role TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_agent_traces_session ON agent_message_traces(team_session_id);
      CREATE INDEX IF NOT EXISTS idx_agent_traces_agent ON agent_message_traces(agent_id);
      CREATE INDEX IF NOT EXISTS idx_agent_traces_time ON agent_message_traces(timestamp);
    `)

    // 创建 checkpoint_indexes 表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoint_indexes (
        team_session_id TEXT NOT NULL,
        checkpoint_id TEXT NOT NULL,
        checkpoint TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (team_session_id, checkpoint_id)
      );

      CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoint_indexes(team_session_id);
    `)
  }

  /**
   * 创建 Team 会话
   */
  createTeamSession(
    sessionId: string,
    mode: TeamMode,
    agents: TeamAgentRecord[],
    strategy?: "collaborative" | "competitive"
  ): TeamSession {
    const now = Date.now()
    const session: TeamSession = {
      sessionId,
      mode,
      strategy,
      status: "initializing",
      agents,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    }

    const stmt = this.db.prepare(`
      INSERT INTO team_sessions (
        session_id, mode, strategy, status, agents, started_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      session.sessionId,
      session.mode,
      session.strategy || null,
      session.status,
      JSON.stringify(session.agents),
      session.startedAt,
      session.createdAt,
      session.updatedAt
    )

    return session
  }

  /**
   * 获取 Team 会话
   */
  getTeamSession(sessionId: string): TeamSession | null {
    const stmt = this.db.prepare<[string], DBTeamSession>(
      "SELECT * FROM team_sessions WHERE session_id = ?"
    )
    const row = stmt.get(sessionId)
    return row ? this.mapRowToTeamSession(row) : null
  }

  /**
   * 更新 Team 会话状态
   */
  updateTeamSessionStatus(
    sessionId: string,
    status: TeamStatus,
    result?: TeamResult
  ): void {
    const now = Date.now()
    const sets: string[] = ["status = ?", "updated_at = ?"]
    const params: (string | number | null)[] = [status, now]

    if (status === "completed" || status === "failed") {
      sets.push("completed_at = ?")
      params.push(now)
    }

    if (result) {
      sets.push("result_summary = ?")
      params.push(result.summary)

      if (result.stats) {
        sets.push("stats = ?")
        params.push(JSON.stringify({
          duration: result.stats.duration,
          iterations: result.stats.iterations,
          totalCost: result.stats.totalCost,
          totalTokens: result.stats.totalTokens,
          artifactCount: result.artifacts.length,
          checkpointCount: 0, // 由 checkpoint_indexes 表计算
        }))
      }
    }

    params.push(sessionId)

    const sql = `UPDATE team_sessions SET ${sets.join(", ")} WHERE session_id = ?`
    this.db.prepare(sql).run(...params)
  }

  /**
   * 更新 Agent 状态和成本
   */
  updateAgentStats(
    sessionId: string,
    agentId: string,
    stats: {
      inputTokens: number
      outputTokens: number
      costUsd: number
      status: "idle" | "working" | "completed" | "failed"
    }
  ): void {
    // 获取当前会话
    const session = this.getTeamSession(sessionId)
    if (!session) return

    // 更新 agents 数组中的对应 agent
    const agents = session.agents.map(a =>
      a.id === agentId ? { ...a, ...stats } : a
    )

    // 更新数据库
    const stmt = this.db.prepare(`
      UPDATE team_sessions SET agents = ?, updated_at = ? WHERE session_id = ?
    `)
    stmt.run(JSON.stringify(agents), Date.now(), sessionId)
  }

  /**
   * 记录 Agent 消息轨迹
   */
  recordMessageTrace(trace: Omit<AgentMessageTrace, "id">): AgentMessageTrace {
    const id = `trace-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    const fullTrace: AgentMessageTrace = {
      id,
      ...trace,
    }

    const stmt = this.db.prepare(`
      INSERT INTO agent_message_traces (
        id, team_session_id, agent_id, agent_role, type, content, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      fullTrace.id,
      fullTrace.teamSessionId,
      fullTrace.agentId,
      fullTrace.agentRole,
      fullTrace.type,
      JSON.stringify(fullTrace.content),
      fullTrace.timestamp
    )

    return fullTrace
  }

  /**
   * 获取会话的消息轨迹
   */
  getMessageTraces(sessionId: string): AgentMessageTrace[] {
    const stmt = this.db.prepare<[string], DBAgentMessageTrace>(
      "SELECT * FROM agent_message_traces WHERE team_session_id = ? ORDER BY timestamp ASC"
    )
    const rows = stmt.all(sessionId)
    return rows.map(this.mapRowToMessageTrace)
  }

  /**
   * 获取 Agent 的消息轨迹
   */
  getAgentMessageTraces(sessionId: string, agentId: string): AgentMessageTrace[] {
    const stmt = this.db.prepare<[string, string], DBAgentMessageTrace>(
      "SELECT * FROM agent_message_traces WHERE team_session_id = ? AND agent_id = ? ORDER BY timestamp ASC"
    )
    const rows = stmt.all(sessionId, agentId)
    return rows.map(this.mapRowToMessageTrace)
  }

  /**
   * 保存检查点索引
   */
  saveCheckpointIndex(sessionId: string, checkpoint: Checkpoint): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO checkpoint_indexes (
        team_session_id, checkpoint_id, checkpoint, created_at
      ) VALUES (?, ?, ?, ?)
    `)

    stmt.run(sessionId, checkpoint.id, JSON.stringify(checkpoint), Date.now())

    // 更新 team_sessions 中的 checkpoint_count
    this.updateCheckpointCount(sessionId)
  }

  /**
   * 获取会话的检查点列表
   */
  getCheckpoints(sessionId: string): Checkpoint[] {
    const stmt = this.db.prepare<[string], DBCheckpointIndex>(
      "SELECT * FROM checkpoint_indexes WHERE team_session_id = ? ORDER BY created_at ASC"
    )
    const rows = stmt.all(sessionId)
    return rows.map(row => {
      try {
        return JSON.parse(row.checkpoint) as Checkpoint
      } catch {
        return null
      }
    }).filter((c): c is Checkpoint => c !== null)
  }

  /**
   * 列出 Team 会话
   */
  listTeamSessions(options?: {
    mode?: TeamMode
    status?: TeamStatus
    limit?: number
  }): TeamSession[] {
    const conditions: string[] = []
    const params: (string | number)[] = []

    if (options?.mode) {
      conditions.push("mode = ?")
      params.push(options.mode)
    }

    if (options?.status) {
      conditions.push("status = ?")
      params.push(options.status)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
    const limitClause = options?.limit ? `LIMIT ${options.limit}` : ""

    const sql = `SELECT * FROM team_sessions ${whereClause} ORDER BY started_at DESC ${limitClause}`
    const stmt = this.db.prepare<typeof params, DBTeamSession>(sql)
    const rows = stmt.all(...params)

    return rows.map(this.mapRowToTeamSession)
  }

  /**
   * 删除 Team 会话及其关联数据
   */
  deleteTeamSession(sessionId: string): boolean {
    // 手动删除关联数据（因为不使用外键约束）
    this.db.prepare("DELETE FROM agent_message_traces WHERE team_session_id = ?").run(sessionId)
    this.db.prepare("DELETE FROM checkpoint_indexes WHERE team_session_id = ?").run(sessionId)

    // 删除 team_session
    const stmt = this.db.prepare("DELETE FROM team_sessions WHERE session_id = ?")
    const result = stmt.run(sessionId)
    return result.changes > 0
  }

  /**
   * 获取 Team 会话统计摘要
   */
  getTeamSessionSummary(sessionId: string): {
    agentCount: number
    totalInputTokens: number
    totalOutputTokens: number
    totalCost: number
    traceCount: number
    checkpointCount: number
  } {
    const session = this.getTeamSession(sessionId)
    if (!session) {
      return {
        agentCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCost: 0,
        traceCount: 0,
        checkpointCount: 0,
      }
    }

    // 计算总 token 和成本
    const totalInputTokens = session.agents.reduce((sum, a) => sum + a.inputTokens, 0)
    const totalOutputTokens = session.agents.reduce((sum, a) => sum + a.outputTokens, 0)
    const totalCost = session.agents.reduce((sum, a) => sum + a.costUsd, 0)

    // 获取轨迹数量
    const traceStmt = this.db.prepare<[string], { count: number }>(
      "SELECT COUNT(*) as count FROM agent_message_traces WHERE team_session_id = ?"
    )
    const traceResult = traceStmt.get(sessionId)
    const traceCount = traceResult?.count || 0

    // 获取检查点数量
    const checkpointStmt = this.db.prepare<[string], { count: number }>(
      "SELECT COUNT(*) as count FROM checkpoint_indexes WHERE team_session_id = ?"
    )
    const checkpointResult = checkpointStmt.get(sessionId)
    const checkpointCount = checkpointResult?.count || 0

    return {
      agentCount: session.agents.length,
      totalInputTokens,
      totalOutputTokens,
      totalCost,
      traceCount,
      checkpointCount,
    }
  }

  /**
   * 更新检查点计数
   */
  private updateCheckpointCount(sessionId: string): void {
    const session = this.getTeamSession(sessionId)
    if (!session || !session.stats) return

    const checkpointStmt = this.db.prepare<[string], { count: number }>(
      "SELECT COUNT(*) as count FROM checkpoint_indexes WHERE team_session_id = ?"
    )
    const result = checkpointStmt.get(sessionId)
    const checkpointCount = result?.count || 0

    const stats = { ...session.stats, checkpointCount }
    const stmt = this.db.prepare(`
      UPDATE team_sessions SET stats = ?, updated_at = ? WHERE session_id = ?
    `)
    stmt.run(JSON.stringify(stats), Date.now(), sessionId)
  }

  /**
   * 映射数据库行到 TeamSession
   */
  private mapRowToTeamSession(row: DBTeamSession): TeamSession {
    let agents: TeamAgentRecord[] = []
    try {
      agents = JSON.parse(row.agents || "[]")
    } catch {
      agents = []
    }

    let stats: TeamSessionStats | undefined
    try {
      stats = row.stats ? JSON.parse(row.stats) : undefined
    } catch {
      stats = undefined
    }

    return {
      sessionId: row.session_id,
      mode: row.mode as TeamMode,
      strategy: row.strategy as "collaborative" | "competitive" | undefined,
      status: row.status as TeamStatus,
      agents,
      startedAt: row.started_at,
      completedAt: row.completed_at || undefined,
      resultSummary: row.result_summary || undefined,
      stats,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  /**
   * 映射数据库行到 AgentMessageTrace
   */
  private mapRowToMessageTrace(row: DBAgentMessageTrace): AgentMessageTrace {
    let content: Record<string, unknown> = {}
    try {
      content = JSON.parse(row.content)
    } catch {
      content = {}
    }

    return {
      id: row.id,
      teamSessionId: row.team_session_id,
      agentId: row.agent_id,
      agentRole: row.agent_role as AgentRole,
      type: row.type as AgentMessageTrace["type"],
      content,
      timestamp: row.timestamp,
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
 * 格式化 Team 会话状态
 */
export function formatTeamStatus(status: TeamStatus): string {
  const statusMap: Record<TeamStatus, string> = {
    initializing: "🔄 初始化中",
    running: "🏃 运行中",
    completed: "✅ 已完成",
    failed: "❌ 失败",
    timeout: "⏱️ 超时",
    cancelled: "🚫 已取消",
  }
  return statusMap[status] || status
}

/**
 * 格式化 Team 模式名称
 */
export function formatTeamMode(mode: TeamMode): string {
  const modeMap: Record<TeamMode, string> = {
    "worker-reviewer": "Worker-Reviewer",
    "planner-executor-reviewer": "Planner-Executor-Reviewer",
    "leader-workers": "Leader-Workers",
    "hotfix-guardrail": "Hotfix Guardrail",
    "council": "Council",
  }
  return modeMap[mode] || mode
}
