/**
 * Agent Teams - Core Type Definitions
 *
 * Multi-agent collaboration system type definitions
 */

// ============================================================================
// Team Modes
// ============================================================================

export type TeamMode =
  | "worker-reviewer"
  | "planner-executor-reviewer"
  | "leader-workers"
  | "hotfix-guardrail"
  | "council"

export type LeaderWorkersStrategy = "collaborative" | "competitive"

// ============================================================================
// Agent Roles
// ============================================================================

export type AgentRole =
  | "worker"
  | "reviewer"
  | "planner"
  | "executor"
  | "leader"
  | "member"
  | "speaker"
  | "fixer"
  | "safety-reviewer"

// ============================================================================
// Team Status
// ============================================================================

export type TeamStatus =
  | "initializing"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "cancelled"

// ============================================================================
// Team Configuration
// ============================================================================

export interface TeamConfig {
  mode: TeamMode
  strategy?: LeaderWorkersStrategy // Only valid for leader-workers mode
  agents: TeamAgentConfig[]

  maxIterations: number
  timeoutMs: number

  budget?: {
    maxTokens: number
    maxCostUsd?: number
    maxParallelAgents?: number
  }

  qualityGate: {
    testsMustPass: boolean
    noP0Issues: boolean
    minCoverage?: number
    requiredChecks?: string[]
  }

  circuitBreaker: {
    maxConsecutiveFailures: number
    maxNoProgressRounds: number
    cooldownMs: number
  }

  conflictResolution: "auto" | "manual"
}

export interface TeamAgentConfig {
  role: AgentRole
  model: string
  skills?: string[]
  systemPrompt?: string
}

// ============================================================================
// Team State
// ============================================================================

export interface TeamState {
  teamId: string
  mode: TeamMode
  status: TeamStatus
  currentIteration: number
  startTime: number
  endTime?: number

  // Cost tracking
  tokensUsed: {
    input: number
    output: number
  }
  costUsd: number

  // Progress tracking
  lastProgressAt: number
  consecutiveNoProgressRounds: number
  consecutiveFailures: number

  // Current task/phase
  currentPhase?: string
  currentAgent?: string
}

// ============================================================================
// Team Events
// ============================================================================

export interface TeamEvents {
  "status-changed": (status: TeamStatus, previous: TeamStatus) => void
  "iteration-started": (iteration: number, agent: string, role: AgentRole) => void
  "iteration-completed": (iteration: number, result: unknown) => void
  "cost-updated": (tokens: { input: number; output: number }, cost: number) => void
  "progress-detected": (type: "code" | "test" | "review") => void
  "no-progress": (rounds: number) => void
  "circuit-breaker": (reason: string) => void
  "conflict-detected": (files: string[]) => void
  "error": (error: Error) => void
  "completed": (result: unknown) => void
}

// ============================================================================
// Agent Message Protocol
// ============================================================================

export interface TaskContract {
  taskId: string
  objective: string
  fileScope: string[] // Allowed files to modify
  apiContracts?: string[] // API/schema constraints
  acceptanceChecks: string[] // Required commands to run (e.g., npm test)
}

export interface WorkArtifact {
  taskId: string
  summary: string
  changedFiles: string[]
  patchRef: string // Patch or commit reference
  testResults: Array<{
    command: string
    passed: boolean
    outputRef?: string
  }>
  risks: string[]
  assumptions: string[]
}

export interface ReviewArtifact {
  status: "approved" | "changes_requested"
  severity: "P0" | "P1" | "P2" | "P3"
  mustFix: string[]
  suggestions: string[]
}

export type AgentMessage =
  | { type: "task-assign"; task: TaskContract }
  | { type: "task-result"; artifact: WorkArtifact }
  | { type: "review-request"; artifact: WorkArtifact }
  | { type: "review-result"; review: ReviewArtifact }
  | { type: "conflict-detected"; files: string[] }
  | { type: "progress"; category: "code" | "test" | "review"; details: string }
  | { type: "error"; error: string }

// ============================================================================
// Checkpoint
// ============================================================================

export interface Checkpoint {
  id: string
  timestamp: number
  description: string
  baseRef: string // Git commit / tree hash
  patchRefs: string[] // Incremental patches
  artifactRefs: string[] // Work/Review artifact references
  blackboardSnapshotRef: string // Serialized summary reference
}

// ============================================================================
// Pricing
// ============================================================================

export interface PricingTable {
  [model: string]: {
    inputPer1M: number
    outputPer1M: number
    updatedAt: number
  }
}

// ============================================================================
// Mode Runner Interface
// ============================================================================

export interface ModeRunner {
  readonly mode: TeamMode
  run(
    config: TeamConfig,
    blackboard: SharedBlackboard,
    costController: CostController,
    progressTracker: ProgressTracker
  ): Promise<unknown>
  cancel(): void
}

// ============================================================================
// Forward declarations (implemented in other modules)
// ============================================================================

export interface SharedBlackboard {
  // State storage
  get<T>(key: string): T | undefined
  set<T>(key: string, value: T, updatedBy?: string): void
  has(key: string): boolean
  delete(key: string): boolean
  keys(): string[]
  snapshot(): Record<string, unknown>
  restore(snapshot: Record<string, unknown>): void
  clear(): void

  // Event handling
  emit<K extends keyof TeamEvents>(event: K, ...args: Parameters<TeamEvents[K]>): boolean
  on<K extends keyof TeamEvents>(event: K, listener: TeamEvents[K]): void
  off<K extends keyof TeamEvents>(event: K, listener: TeamEvents[K]): void
  once<K extends keyof TeamEvents>(event: K, listener: TeamEvents[K]): void

  // Message passing
  postMessage(message: AgentMessage, from: string, to?: string): void
  getMessages(filter?: { from?: string; to?: string; type?: string }): Array<{ message: AgentMessage; from: string; to?: string; timestamp: number }>
  clearMessages(): void

  // Contract helpers
  setTaskContract(contract: TaskContract): void
  getTaskContract(): TaskContract | undefined
  setWorkArtifact(agentId: string, artifact: WorkArtifact): void
  getWorkArtifact(agentId: string): WorkArtifact | undefined
  setReviewArtifact(agentId: string, artifact: ReviewArtifact): void
  getReviewArtifact(agentId: string): ReviewArtifact | undefined

  // Audit
  logEvent(event: string, details: Record<string, unknown>): void
  getAuditLog(): Array<{ timestamp: number; event: string; details: Record<string, unknown> }>
}

export interface CostController {
  recordUsage(inputTokens: number, outputTokens: number, model: string): void
  getCurrentCost(): number
  getCurrentTokens(): { input: number; output: number }
  getUsageByModel(): Map<string, { input: number; output: number; cost: number }>
  isBudgetExceeded(): boolean
  isTokenBudgetExceeded(): boolean
  isCostBudgetExceeded(): boolean
  getBudgetStatus(): {
    tokens: { used: number; limit: number; percentage: number }
    cost: { used: number; limit: number | null; percentage: number | null }
  }
  getPricingTable(): PricingTable
  updatePricingTable(pricing: PricingTable): void
  getModelPrice(model: string): { inputPer1M: number; outputPer1M: number }
  shouldDegrade(): "none" | "reduce-concurrency" | "switch-model" | "stop"
  onBudgetExceeded(callback: () => void): void
  onDegradationNeeded(callback: (level: "reduce-concurrency" | "switch-model" | "stop") => void): void
}

export interface ProgressTracker {
  recordProgress(type: "code" | "test" | "review", details?: string): void
  recordCodeChange(filesChanged: number): void
  recordTestResult(passed: boolean): void
  recordReviewIssue(severity: "P0" | "P1" | "P2" | "P3", fixed?: boolean): void
  checkProgress(): boolean
  getConsecutiveNoProgressRounds(): number
  shouldCircuitBreak(): boolean
  getCircuitBreakerReason(): string | null
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
  reset(): void
}
