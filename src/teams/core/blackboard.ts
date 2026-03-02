/**
 * Agent Teams - Shared Blackboard
 *
 * Central state sharing and event notification system for multi-agent collaboration.
 * Stores structured summaries only, not large raw content.
 */

import { EventEmitter } from "events"
import type { SharedBlackboard, TeamEvents, AgentMessage, TaskContract, WorkArtifact, ReviewArtifact } from "./types.js"

// ============================================================================
// Blackboard Entry Types
// ============================================================================

type BlackboardValue =
  | string
  | number
  | boolean
  | null
  | BlackboardValue[]
  | { [key: string]: BlackboardValue }

interface BlackboardEntry {
  value: BlackboardValue
  updatedAt: number
  updatedBy?: string
}

// ============================================================================
// Team Blackboard Implementation
// ============================================================================

export class TeamBlackboard extends EventEmitter implements SharedBlackboard {
  private store = new Map<string, BlackboardEntry>()
  private messages: Array<{ message: AgentMessage; from: string; to?: string; timestamp: number }> = []
  private auditLog: Array<{ timestamp: number; event: string; details: Record<string, unknown> }> = []

  // State storage
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key)
    return entry?.value as T | undefined
  }

  set<T>(key: string, value: T, updatedBy?: string): void {
    this.store.set(key, {
      value: value as unknown as BlackboardValue,
      updatedAt: Date.now(),
      updatedBy,
    })
    this.logEvent("state-updated", { key, updatedBy })
  }

  has(key: string): boolean {
    return this.store.has(key)
  }

  delete(key: string): boolean {
    const existed = this.store.delete(key)
    if (existed) {
      this.logEvent("state-deleted", { key })
    }
    return existed
  }

  keys(): string[] {
    return Array.from(this.store.keys())
  }

  snapshot(): Record<string, BlackboardValue> {
    const snapshot: Record<string, BlackboardValue> = {}
    for (const [key, entry] of this.store) {
      snapshot[key] = entry.value
    }
    return snapshot
  }

  restore(snapshot: Record<string, BlackboardValue>): void {
    this.store.clear()
    const now = Date.now()
    for (const [key, value] of Object.entries(snapshot)) {
      this.store.set(key, { value, updatedAt: now })
    }
    this.logEvent("state-restored", { keys: Object.keys(snapshot) })
  }

  clear(): void {
    this.store.clear()
    this.messages = []
    this.logEvent("state-cleared", {})
  }

  // Message passing
  postMessage(message: AgentMessage, from: string, to?: string): void {
    const entry = {
      message,
      from,
      to,
      timestamp: Date.now(),
    }
    this.messages.push(entry)
    this.logEvent("message-posted", { type: message.type, from, to })
    this.emit("message-received" as keyof TeamEvents, entry)
  }

  getMessages(filter?: { from?: string; to?: string; type?: string }): Array<{ message: AgentMessage; from: string; to?: string; timestamp: number }> {
    let filtered = this.messages

    if (filter?.from) {
      filtered = filtered.filter(m => m.from === filter.from)
    }
    if (filter?.to) {
      filtered = filtered.filter(m => m.to === filter.to)
    }
    if (filter?.type) {
      filtered = filtered.filter(m => m.message.type === filter.type)
    }

    return [...filtered]
  }

  clearMessages(): void {
    this.messages = []
  }

  // Contract helpers
  setTaskContract(contract: TaskContract): void {
    this.set("task-contract", contract as unknown as BlackboardValue, "system")
  }

  getTaskContract(): TaskContract | undefined {
    return this.get("task-contract") as unknown as TaskContract | undefined
  }

  setWorkArtifact(agentId: string, artifact: WorkArtifact): void {
    this.set(`work-artifact:${agentId}`, artifact as unknown as BlackboardValue, agentId)
  }

  getWorkArtifact(agentId: string): WorkArtifact | undefined {
    return this.get(`work-artifact:${agentId}`) as unknown as WorkArtifact | undefined
  }

  setReviewArtifact(agentId: string, artifact: ReviewArtifact): void {
    this.set(`review-artifact:${agentId}`, artifact as unknown as BlackboardValue, agentId)
  }

  getReviewArtifact(agentId: string): ReviewArtifact | undefined {
    return this.get(`review-artifact:${agentId}`) as unknown as ReviewArtifact | undefined
  }

  // Audit log
  logEvent(event: string, details: Record<string, unknown>): void {
    this.auditLog.push({
      timestamp: Date.now(),
      event,
      details,
    })

    // Keep only last 1000 events
    if (this.auditLog.length > 1000) {
      this.auditLog = this.auditLog.slice(-1000)
    }
  }

  getAuditLog(): Array<{ timestamp: number; event: string; details: Record<string, unknown> }> {
    return [...this.auditLog]
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createBlackboard(): SharedBlackboard {
  return new TeamBlackboard()
}
