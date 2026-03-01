import type { BaselineComparison, TeamMode } from "./types.js"

export interface TeamRunRecord {
  mode: TeamMode | "single-agent"
  task: string
  durationMs: number
  tokensUsed: number
  mustFixCount?: number
  p0Count?: number
  reviewRounds?: number
}

export class ProgressTracker {
  private records: TeamRunRecord[] = []
  private baselines: BaselineComparison[] = []

  addRecord(record: TeamRunRecord): void {
    this.records.push(record)
  }

  addBaseline(comparison: BaselineComparison): void {
    this.baselines.push(comparison)
  }

  getRecords(): TeamRunRecord[] {
    return [...this.records]
  }

  getBaselines(): BaselineComparison[] {
    return [...this.baselines]
  }
}
