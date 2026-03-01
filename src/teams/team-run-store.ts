import Database from "better-sqlite3"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type { TeamMode, TeamStatus } from "./types.js"

export interface PersistedTeamRunRecord {
  id: string
  mode: TeamMode
  task: string
  status: TeamStatus
  fallbackUsed: boolean
  failureReason?: string
  reviewRounds: number
  mustFixCount: number
  p0Count: number
  tokensUsed: number
  estimatedCostUsd: number
  durationMs: number
  createdAt: number
}

interface DBTeamRunRecord {
  id: string
  mode: TeamMode
  task: string
  status: TeamStatus
  fallback_used: number
  failure_reason: string | null
  review_rounds: number
  must_fix_count: number
  p0_count: number
  tokens_used: number
  estimated_cost_usd: number
  duration_ms: number
  created_at: number
}

export class TeamRunStore {
  private db: Database.Database

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.init()
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS team_runs (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        task TEXT NOT NULL,
        status TEXT NOT NULL,
        fallback_used INTEGER NOT NULL DEFAULT 0,
        failure_reason TEXT,
        review_rounds INTEGER NOT NULL DEFAULT 0,
        must_fix_count INTEGER NOT NULL DEFAULT 0,
        p0_count INTEGER NOT NULL DEFAULT 0,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_team_runs_created_at ON team_runs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_team_runs_mode ON team_runs(mode);
      CREATE INDEX IF NOT EXISTS idx_team_runs_status ON team_runs(status);
    `)
  }

  add(record: PersistedTeamRunRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO team_runs (
        id, mode, task, status, fallback_used, failure_reason,
        review_rounds, must_fix_count, p0_count, tokens_used,
        estimated_cost_usd, duration_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      record.id,
      record.mode,
      record.task,
      record.status,
      record.fallbackUsed ? 1 : 0,
      record.failureReason || null,
      record.reviewRounds,
      record.mustFixCount,
      record.p0Count,
      record.tokensUsed,
      record.estimatedCostUsd,
      record.durationMs,
      record.createdAt
    )
  }

  list(limit = 100): PersistedTeamRunRecord[] {
    const stmt = this.db.prepare<[number], DBTeamRunRecord>(
      "SELECT * FROM team_runs ORDER BY created_at DESC LIMIT ?"
    )
    return stmt.all(Math.max(1, limit)).map((row) => this.map(row))
  }

  close(): void {
    this.db.close()
  }

  private map(row: DBTeamRunRecord): PersistedTeamRunRecord {
    return {
      id: row.id,
      mode: row.mode,
      task: row.task,
      status: row.status,
      fallbackUsed: row.fallback_used === 1,
      failureReason: row.failure_reason || undefined,
      reviewRounds: row.review_rounds,
      mustFixCount: row.must_fix_count,
      p0Count: row.p0_count,
      tokensUsed: row.tokens_used,
      estimatedCostUsd: row.estimated_cost_usd,
      durationMs: row.duration_ms,
      createdAt: row.created_at,
    }
  }
}
