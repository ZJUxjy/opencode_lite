/**
 * Agent Teams - Progress Tracker
 *
 * Detects progress and no-progress conditions across iterations.
 * Implements circuit breaker logic for no-progress scenarios.
 */

import type { TeamConfig } from "./types.js"

// ============================================================================
// Progress Tracker Interface
// ============================================================================

export interface ProgressTracker {
  // Progress recording
  recordProgress(type: "code" | "test" | "review", details?: string): void
  recordCodeChange(filesChanged: number): void
  recordTestResult(passed: boolean): void
  recordReviewIssue(severity: "P0" | "P1" | "P2" | "P3", fixed?: boolean): void

  // Progress checking
  checkProgress(): boolean
  getConsecutiveNoProgressRounds(): number

  // Circuit breaker
  shouldCircuitBreak(): boolean
  getCircuitBreakerReason(): string | null

  // Statistics
  getStats(): {
    totalRounds: number
    progressRounds: number
    noProgressRounds: number
    codeChanges: number
    testsPassed: number
    testsFailed: number
    p0Issues: number
    p1Issues: number
    p2Issues: number
    p3Issues: number
  }

  // Reset
  reset(): void
}

// ============================================================================
// Round State
// ============================================================================

interface RoundState {
  round: number
  filesChanged: number
  testPassed: boolean | null
  p0Count: number
  p1Count: number
  timestamp: number
}

// ============================================================================
// Progress Tracker Implementation
// ============================================================================

export class TeamProgressTracker implements ProgressTracker {
  private rounds: RoundState[] = []
  private currentRound: RoundState = {
    round: 0,
    filesChanged: 0,
    testPassed: null,
    p0Count: 0,
    p1Count: 0,
    timestamp: Date.now(),
  }
  private maxNoProgressRounds: number
  private maxConsecutiveFailures: number

  constructor(config: Pick<TeamConfig, "circuitBreaker">) {
    this.maxNoProgressRounds = config.circuitBreaker.maxNoProgressRounds
    this.maxConsecutiveFailures = config.circuitBreaker.maxConsecutiveFailures
  }

  recordProgress(type: "code" | "test" | "review", details?: string): void {
    switch (type) {
      case "code":
        if (details) {
          const match = details.match(/(\d+) files? changed/)
          if (match) {
            this.currentRound.filesChanged += parseInt(match[1], 10)
          }
        }
        break
      case "test":
        // Test progress is recorded via recordTestResult
        break
      case "review":
        // Review progress is recorded via recordReviewIssue
        break
    }
  }

  recordCodeChange(filesChanged: number): void {
    this.currentRound.filesChanged += filesChanged
  }

  recordTestResult(passed: boolean): void {
    // Only record if not already recorded for this round
    if (this.currentRound.testPassed === null) {
      this.currentRound.testPassed = passed
    }
  }

  recordReviewIssue(severity: "P0" | "P1" | "P2" | "P3", fixed?: boolean): void {
    if (severity === "P0") {
      if (fixed) {
        this.currentRound.p0Count = Math.max(0, this.currentRound.p0Count - 1)
      } else {
        this.currentRound.p0Count++
      }
    } else if (severity === "P1") {
      if (fixed) {
        this.currentRound.p1Count = Math.max(0, this.currentRound.p1Count - 1)
      } else {
        this.currentRound.p1Count++
      }
    }
  }

  checkProgress(): boolean {
    // Save current round and start new one
    this.rounds.push({ ...this.currentRound })
    this.currentRound = {
      round: this.rounds.length,
      filesChanged: 0,
      testPassed: null,
      p0Count: 0,
      p1Count: 0,
      timestamp: Date.now(),
    }

    if (this.rounds.length < 2) {
      return true // Not enough history to determine
    }

    const current = this.rounds[this.rounds.length - 1]
    const previous = this.rounds[this.rounds.length - 2]

    // Check for progress according to design doc criteria:
    // 1. Files changed > 0
    // 2. P0/P1 issues decreased
    // 3. Tests passing (if previously failing)

    const hasCodeProgress = current.filesChanged > 0
    const hasIssueProgress = current.p0Count < previous.p0Count || current.p1Count < previous.p1Count
    const hasTestProgress =
      current.testPassed === true && previous.testPassed === false

    return hasCodeProgress || hasIssueProgress || hasTestProgress
  }

  getConsecutiveNoProgressRounds(): number {
    if (this.rounds.length === 0) return 0

    // Track no-progress by comparing consecutive rounds
    // A round has no progress if: no files changed AND no issues resolved
    let noProgressCount = 0

    // Start from the most recent round and work backwards
    for (let i = this.rounds.length - 1; i >= 0; i--) {
      const current = this.rounds[i]
      const previous = i > 0 ? this.rounds[i - 1] : null

      // Check if this round had progress
      const hasCodeProgress = current.filesChanged > 0

      // Issue progress: current has fewer P0/P1 than previous
      const hasIssueProgress = previous
        ? current.p0Count < previous.p0Count || current.p1Count < previous.p1Count
        : false

      // Test progress: test passed in this round
      const hasTestProgress = current.testPassed === true

      const hasProgress = hasCodeProgress || hasIssueProgress || hasTestProgress

      if (!hasProgress) {
        noProgressCount++
      } else {
        break
      }
    }

    return noProgressCount
  }

  shouldCircuitBreak(): boolean {
    return (
      this.getConsecutiveNoProgressRounds() >= this.maxNoProgressRounds ||
      this.getConsecutiveFailures() >= this.maxConsecutiveFailures
    )
  }

  getCircuitBreakerReason(): string | null {
    if (this.getConsecutiveNoProgressRounds() >= this.maxNoProgressRounds) {
      return `No progress for ${this.getConsecutiveNoProgressRounds()} consecutive rounds`
    }
    if (this.getConsecutiveFailures() >= this.maxConsecutiveFailures) {
      return `Too many consecutive failures (${this.getConsecutiveFailures()})`
    }
    return null
  }

  getStats() {
    // Calculate net issues from current round (which tracks active issues)
    const activeP0 = this.currentRound.p0Count
    const activeP1 = this.currentRound.p1Count

    return {
      totalRounds: this.rounds.length,
      progressRounds: this.rounds.filter(r => r.filesChanged > 0).length,
      noProgressRounds: this.rounds.filter(r => r.filesChanged === 0).length,
      codeChanges: this.rounds.reduce((sum, r) => sum + r.filesChanged, 0),
      testsPassed: this.rounds.filter(r => r.testPassed === true).length,
      testsFailed: this.rounds.filter(r => r.testPassed === false).length,
      p0Issues: activeP0,
      p1Issues: activeP1,
      p2Issues: 0, // Not tracked per round
      p3Issues: 0, // Not tracked per round
    }
  }

  reset(): void {
    this.rounds = []
    this.currentRound = {
      round: 0,
      filesChanged: 0,
      testPassed: null,
      p0Count: 0,
      p1Count: 0,
      timestamp: Date.now(),
    }
  }

  private getConsecutiveFailures(): number {
    // Simplified - count consecutive rounds with test failures
    let count = 0
    for (let i = this.rounds.length - 1; i >= 0; i--) {
      if (this.rounds[i].testPassed === false) {
        count++
      } else {
        break
      }
    }
    return count
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createProgressTracker(
  config: Pick<TeamConfig, "circuitBreaker">
): ProgressTracker {
  return new TeamProgressTracker(config)
}