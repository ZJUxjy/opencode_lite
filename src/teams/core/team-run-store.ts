/**
 * Team Run Store - Team 运行记录持久化
 *
 * 存储 Team 运行的元数据、成本、状态、检查点索引
 */

import { DatabaseManager } from "../../db.js"
import type { TeamMode } from "./types.js"

// ============================================================================
// Types
// ============================================================================

export interface TeamRun {
  /** 运行唯一ID */
  id: string
  /** 关联的会话ID */
  sessionId: string
  /** Team 模式 */
  mode: TeamMode
  /** 策略（leader-workers 模式使用） */
  strategy?: string
  /** 目标描述 */
  objective?: string
  /** 文件范围 */
  fileScope: string[]
  /** 运行状态 */
  status: "running" | "completed" | "failed" | "timeout" | "cancelled"
  /** 开始时间 */
  startedAt: number
  /** 结束时间 */
  endedAt?: number
  /** Token 使用统计 */
  tokensUsed: {
    input: number
    output: number
  }
  /** 成本估算 (USD) */
  costUsd: number
  /** Agent 数量 */
  agentCount: number
  /** 迭代次数 */
  iterations: number
  /** 失败原因 */
  failureReason?: string
  /** 降级标记 */
  isFallback: boolean
  /** 原 Team ID（如果是从 checkpoint 恢复） */
  originalTeamId?: string
}

export interface CreateTeamRunParams {
  sessionId: string
  mode: TeamMode
  strategy?: string
  objective?: string
  fileScope?: string[]
  agentCount: number
  originalTeamId?: string
}

export interface UpdateTeamRunParams {
  status?: TeamRun["status"]
  endedAt?: number
  tokensUsed?: TeamRun["tokensUsed"]
  costUsd?: number
  iterations?: number
  failureReason?: string
  isFallback?: boolean
}

export interface CheckpointRef {
  /** 检查点ID */
  id: string
  /** 关联的 Team Run ID */
  teamRunId: string
  /** Team ID */
  teamId: string
  /** 创建时间 */
  createdAt: number
  /** 迭代数 */
  iteration: number
  /** 进度百分比 */
  progress: number
  /** 阶段 */
  phase: string
  /** 文件路径 */
  filePath: string
}

export interface CreateCheckpointRefParams {
  teamRunId: string
  teamId: string
  iteration: number
  progress: number
  phase: string
  filePath: string
}

export interface ListTeamRunsOptions {
  sessionId?: string
  mode?: TeamMode
  status?: TeamRun["status"]
  limit?: number
  order?: "asc" | "desc"
}

// ============================================================================
// Team Run Store
// ============================================================================

export class TeamRunStore {
  private db: ReturnType<DatabaseManager["getDatabase"]>

  constructor(dbPath: string) {
    this.db = DatabaseManager.getInstance(dbPath).getDatabase()
    this.init()
  }

  /**
   * 初始化数据库表
   */
  private init() {
    // Team runs 表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS team_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        strategy TEXT,
        objective TEXT,
        file_scope TEXT DEFAULT '[]',
        status TEXT DEFAULT 'running',
        started_at INTEGER DEFAULT (unixepoch()),
        ended_at INTEGER,
        tokens_input INTEGER DEFAULT 0,
        tokens_output INTEGER DEFAULT 0,
        cost_usd REAL DEFAULT 0,
        agent_count INTEGER DEFAULT 0,
        iterations INTEGER DEFAULT 0,
        failure_reason TEXT,
        is_fallback INTEGER DEFAULT 0,
        original_team_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_team_runs_session ON team_runs(session_id);
      CREATE INDEX IF NOT EXISTS idx_team_runs_mode ON team_runs(mode);
      CREATE INDEX IF NOT EXISTS idx_team_runs_status ON team_runs(status);
      CREATE INDEX IF NOT EXISTS idx_team_runs_started ON team_runs(started_at DESC);
    `)

    // Checkpoint refs 表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoint_refs (
        id TEXT PRIMARY KEY,
        team_run_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        iteration INTEGER DEFAULT 0,
        progress INTEGER DEFAULT 0,
        phase TEXT,
        file_path TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_checkpoint_refs_run ON checkpoint_refs(team_run_id);
      CREATE INDEX IF NOT EXISTS idx_checkpoint_refs_team ON checkpoint_refs(team_id);
      CREATE INDEX IF NOT EXISTS idx_checkpoint_refs_created ON checkpoint_refs(created_at DESC);
    `)
  }

  /**
   * 创建新的 Team Run 记录
   */
  create(params: CreateTeamRunParams): TeamRun {
    const id = `team-run-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const now = Math.floor(Date.now() / 1000)

    const teamRun: TeamRun = {
      id,
      sessionId: params.sessionId,
      mode: params.mode,
      strategy: params.strategy,
      objective: params.objective,
      fileScope: params.fileScope ?? [],
      status: "running",
      startedAt: now,
      tokensUsed: { input: 0, output: 0 },
      costUsd: 0,
      agentCount: params.agentCount,
      iterations: 0,
      isFallback: false,
      originalTeamId: params.originalTeamId,
    }

    const stmt = this.db.prepare(`
      INSERT INTO team_runs (
        id, session_id, mode, strategy, objective, file_scope, status,
        started_at, tokens_input, tokens_output, cost_usd, agent_count,
        iterations, is_fallback, original_team_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      teamRun.id,
      teamRun.sessionId,
      teamRun.mode,
      teamRun.strategy ?? null,
      teamRun.objective ?? null,
      JSON.stringify(teamRun.fileScope),
      teamRun.status,
      teamRun.startedAt,
      teamRun.tokensUsed.input,
      teamRun.tokensUsed.output,
      teamRun.costUsd,
      teamRun.agentCount,
      teamRun.iterations,
      teamRun.isFallback ? 1 : 0,
      teamRun.originalTeamId ?? null
    )

    return teamRun
  }

  /**
   * 获取 Team Run
   */
  get(id: string): TeamRun | null {
    const stmt = this.db.prepare<[string], DBTeamRun>(
      "SELECT * FROM team_runs WHERE id = ?"
    )
    const row = stmt.get(id)
    return row ? this.mapRowToTeamRun(row) : null
  }

  /**
   * 获取会话的所有 Team Runs
   */
  list(options: ListTeamRunsOptions = {}): TeamRun[] {
    const conditions: string[] = []
    const params: (string | number)[] = []

    if (options.sessionId) {
      conditions.push("session_id = ?")
      params.push(options.sessionId)
    }

    if (options.mode) {
      conditions.push("mode = ?")
      params.push(options.mode)
    }

    if (options.status) {
      conditions.push("status = ?")
      params.push(options.status)
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : ""

    const order = options.order === "asc" ? "ASC" : "DESC"
    const limitClause = options.limit ? `LIMIT ${options.limit}` : ""

    const sql = `SELECT * FROM team_runs ${whereClause} ORDER BY started_at ${order} ${limitClause}`.trim()
    const stmt = this.db.prepare<typeof params, DBTeamRun>(sql)
    const rows = stmt.all(...params) as DBTeamRun[]

    return rows.map((row) => this.mapRowToTeamRun(row))
  }

  /**
   * 更新 Team Run
   */
  update(id: string, updates: UpdateTeamRunParams): void {
    const sets: string[] = []
    const params: (string | number)[] = []

    if (updates.status !== undefined) {
      sets.push("status = ?")
      params.push(updates.status)
    }

    if (updates.endedAt !== undefined) {
      sets.push("ended_at = ?")
      params.push(updates.endedAt)
    }

    if (updates.tokensUsed !== undefined) {
      sets.push("tokens_input = ?")
      sets.push("tokens_output = ?")
      params.push(updates.tokensUsed.input)
      params.push(updates.tokensUsed.output)
    }

    if (updates.costUsd !== undefined) {
      sets.push("cost_usd = ?")
      params.push(updates.costUsd)
    }

    if (updates.iterations !== undefined) {
      sets.push("iterations = ?")
      params.push(updates.iterations)
    }

    if (updates.failureReason !== undefined) {
      sets.push("failure_reason = ?")
      params.push(updates.failureReason)
    }

    if (updates.isFallback !== undefined) {
      sets.push("is_fallback = ?")
      params.push(updates.isFallback ? 1 : 0)
    }

    if (sets.length === 0) return

    params.push(id)
    const sql = `UPDATE team_runs SET ${sets.join(", ")} WHERE id = ?`
    const stmt = this.db.prepare(sql)
    stmt.run(...params)
  }

  /**
   * 标记 Team Run 为完成
   */
  complete(id: string, finalStats: {
    tokensUsed: TeamRun["tokensUsed"]
    costUsd: number
    iterations: number
  }): void {
    this.update(id, {
      status: "completed",
      endedAt: Math.floor(Date.now() / 1000),
      ...finalStats,
    })
  }

  /**
   * 标记 Team Run 为失败
   */
  fail(id: string, reason: string, finalStats?: {
    tokensUsed: TeamRun["tokensUsed"]
    costUsd: number
    iterations: number
  }): void {
    this.update(id, {
      status: "failed",
      endedAt: Math.floor(Date.now() / 1000),
      failureReason: reason,
      ...finalStats,
    })
  }

  /**
   * 标记为降级运行
   */
  markAsFallback(id: string): void {
    this.update(id, { isFallback: true })
  }

  /**
   * 删除 Team Run
   */
  delete(id: string): boolean {
    // 先删除关联的检查点引用
    this.db.prepare("DELETE FROM checkpoint_refs WHERE team_run_id = ?").run(id)

    const stmt = this.db.prepare("DELETE FROM team_runs WHERE id = ?")
    const result = stmt.run(id)
    return result.changes > 0
  }

  // ============================================================================
  // Checkpoint References
  // ============================================================================

  /**
   * 创建检查点引用
   */
  createCheckpointRef(params: CreateCheckpointRefParams): CheckpointRef {
    const id = `cp-ref-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const now = Math.floor(Date.now() / 1000)

    const ref: CheckpointRef = {
      id,
      teamRunId: params.teamRunId,
      teamId: params.teamId,
      createdAt: now,
      iteration: params.iteration,
      progress: params.progress,
      phase: params.phase,
      filePath: params.filePath,
    }

    const stmt = this.db.prepare(`
      INSERT INTO checkpoint_refs (id, team_run_id, team_id, created_at, iteration, progress, phase, file_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      ref.id,
      ref.teamRunId,
      ref.teamId,
      ref.createdAt,
      ref.iteration,
      ref.progress,
      ref.phase,
      ref.filePath
    )

    return ref
  }

  /**
   * 获取 Team Run 的所有检查点引用
   */
  getCheckpointRefs(teamRunId: string): CheckpointRef[] {
    const stmt = this.db.prepare<[string], DBCheckpointRef>(
      `SELECT * FROM checkpoint_refs
       WHERE team_run_id = ?
       ORDER BY created_at DESC`
    )
    const rows = stmt.all(teamRunId)
    return rows.map((row) => this.mapRowToCheckpointRef(row))
  }

  /**
   * 获取最新的检查点引用
   */
  getLatestCheckpointRef(teamRunId: string): CheckpointRef | null {
    const stmt = this.db.prepare<[string], DBCheckpointRef>(
      `SELECT * FROM checkpoint_refs
       WHERE team_run_id = ?
       ORDER BY created_at DESC
       LIMIT 1`
    )
    const row = stmt.get(teamRunId)
    return row ? this.mapRowToCheckpointRef(row) : null
  }

  /**
   * 删除检查点引用
   */
  deleteCheckpointRef(id: string): boolean {
    const stmt = this.db.prepare("DELETE FROM checkpoint_refs WHERE id = ?")
    const result = stmt.run(id)
    return result.changes > 0
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  /**
   * 获取会话的 Team 统计信息
   */
  getSessionStats(sessionId: string): {
    totalRuns: number
    completedRuns: number
    failedRuns: number
    totalCostUsd: number
    totalTokens: number
  } {
    const stmt = this.db.prepare<[string], { total: number; completed: number; failed: number; cost: number; tokens: number }>(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(cost_usd) as cost,
        SUM(tokens_input + tokens_output) as tokens
      FROM team_runs
      WHERE session_id = ?
    `)
    const row = stmt.get(sessionId)

    return {
      totalRuns: row?.total ?? 0,
      completedRuns: row?.completed ?? 0,
      failedRuns: row?.failed ?? 0,
      totalCostUsd: row?.cost ?? 0,
      totalTokens: row?.tokens ?? 0,
    }
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private mapRowToTeamRun(row: DBTeamRun): TeamRun {
    return {
      id: row.id,
      sessionId: row.session_id,
      mode: row.mode as TeamMode,
      strategy: row.strategy ?? undefined,
      objective: row.objective ?? undefined,
      fileScope: JSON.parse(row.file_scope || "[]"),
      status: row.status as TeamRun["status"],
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      tokensUsed: {
        input: row.tokens_input,
        output: row.tokens_output,
      },
      costUsd: row.cost_usd,
      agentCount: row.agent_count,
      iterations: row.iterations,
      failureReason: row.failure_reason ?? undefined,
      isFallback: row.is_fallback === 1,
      originalTeamId: row.original_team_id ?? undefined,
    }
  }

  private mapRowToCheckpointRef(row: DBCheckpointRef): CheckpointRef {
    return {
      id: row.id,
      teamRunId: row.team_run_id,
      teamId: row.team_id,
      createdAt: row.created_at,
      iteration: row.iteration,
      progress: row.progress,
      phase: row.phase,
      filePath: row.file_path,
    }
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    this.db.close()
  }
}

// ============================================================================
// Database Row Types
// ============================================================================

interface DBTeamRun {
  id: string
  session_id: string
  mode: string
  strategy: string | null
  objective: string | null
  file_scope: string
  status: string
  started_at: number
  ended_at: number | null
  tokens_input: number
  tokens_output: number
  cost_usd: number
  agent_count: number
  iterations: number
  failure_reason: string | null
  is_fallback: number
  original_team_id: string | null
}

interface DBCheckpointRef {
  id: string
  team_run_id: string
  team_id: string
  created_at: number
  iteration: number
  progress: number
  phase: string
  file_path: string
}

// ============================================================================
// Factory
// ============================================================================

export function createTeamRunStore(dbPath: string): TeamRunStore {
  return new TeamRunStore(dbPath)
}
