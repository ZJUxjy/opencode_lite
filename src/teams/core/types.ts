/**
 * Agent Teams - Core Type Definitions
 *
 * Unified types merged from codex, kimi, and minimax branches
 * Multi-agent collaboration system type definitions
 */

import { z } from "zod"

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

// Runtime array for validation
export const TEAM_MODES: readonly TeamMode[] = [
  "worker-reviewer",
  "planner-executor-reviewer",
  "leader-workers",
  "hotfix-guardrail",
  "council",
] as const

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

// Runtime array for validation
export const AGENT_ROLES: readonly AgentRole[] = [
  "worker",
  "reviewer",
  "planner",
  "executor",
  "leader",
  "member",
  "speaker",
  "fixer",
  "safety-reviewer",
] as const

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
// Thinking Budget (from codex/minimax)
// ============================================================================

/**
 * ThinkingBudget controls extended thinking for agents
 *
 * Source: Anthropic's "thinking budget" mechanism
 * Usage: Enable for Planner/Leader roles, disable for Workers to save costs
 */
export interface ThinkingBudget {
  enabled: boolean
  maxThinkingTokens: number // Maximum tokens for thinking phase
  outputThinkingProcess: boolean // Whether to output thinking process
}

export const ThinkingBudgetSchema = z.object({
  enabled: z.boolean(),
  maxThinkingTokens: z.number(),
  outputThinkingProcess: z.boolean(),
})

// ============================================================================
// Budget Configuration
// ============================================================================

export interface BudgetConfig {
  maxTokens: number
  maxCostUsd?: number
  maxParallelAgents?: number
}

export const BudgetConfigSchema = z.object({
  maxTokens: z.number(),
  maxCostUsd: z.number().optional(),
  maxParallelAgents: z.number().optional(),
})

// ============================================================================
// Quality Gate Configuration
// ============================================================================

export interface QualityGateConfig {
  testsMustPass: boolean
  noP0Issues: boolean
  minCoverage?: number
  requiredChecks?: string[]
}

export const QualityGateConfigSchema = z.object({
  testsMustPass: z.boolean(),
  noP0Issues: z.boolean(),
  minCoverage: z.number().optional(),
  requiredChecks: z.array(z.string()).optional(),
})

// ============================================================================
// Circuit Breaker Configuration
// ============================================================================

export interface CircuitBreakerConfig {
  maxConsecutiveFailures: number
  maxNoProgressRounds: number
  cooldownMs: number
}

export const CircuitBreakerConfigSchema = z.object({
  maxConsecutiveFailures: z.number(),
  maxNoProgressRounds: z.number(),
  cooldownMs: z.number(),
})

// ============================================================================
// Parallel Strategy (from codex)
// ============================================================================

export interface ParallelStrategy {
  mode: "sequential" | "parallel" | "adaptive"
  adaptive?: {
    minParallelism: number
    maxParallelism: number
    scaleUpThreshold: number
    scaleDownOnFailure?: boolean
  }
  isolation?: "shared-context" | "isolated-context" | "worktree"
}

export const ParallelStrategySchema = z.object({
  mode: z.enum(["sequential", "parallel", "adaptive"]),
  adaptive: z
    .object({
      minParallelism: z.number(),
      maxParallelism: z.number(),
      scaleUpThreshold: z.number(),
      scaleDownOnFailure: z.boolean().optional(),
    })
    .optional(),
  isolation: z.enum(["shared-context", "isolated-context", "worktree"]).optional(),
})

// ============================================================================
// Evaluation Rubric (from codex)
// ============================================================================

export interface EvaluationRubricDimension {
  name: string
  weight: number
  scale: number
  criteria: string[]
  examples?: string[]
}

export interface EvaluationRubric {
  dimensions: EvaluationRubricDimension[]
  overallThreshold: number
}

// ============================================================================
// Agent Configuration
// ============================================================================

export interface TeamAgentConfig {
  role: AgentRole
  model: string
  skills?: string[]
  systemPrompt?: string
}

export const TeamAgentConfigSchema = z.object({
  role: z.enum([
    "worker",
    "reviewer",
    "planner",
    "executor",
    "leader",
    "member",
    "speaker",
    "fixer",
    "safety-reviewer",
  ]),
  model: z.string(),
  skills: z.array(z.string()).optional(),
  systemPrompt: z.string().optional(),
})

// ============================================================================
// Team Configuration
// ============================================================================

export interface TeamConfig {
  mode: TeamMode
  strategy?: LeaderWorkersStrategy // Only valid for leader-workers mode
  agents?: TeamAgentConfig[] // Optional - auto-generated if not provided

  maxIterations: number
  timeoutMs: number

  budget?: BudgetConfig

  qualityGate: QualityGateConfig

  circuitBreaker: CircuitBreakerConfig

  conflictResolution: "auto" | "manual"

  // Checkpoint configuration
  checkpointEnabled?: boolean
  checkpointDir?: string

  // Thinking budget configuration
  thinkingBudget?: ThinkingBudget

  // Parallel strategy (from codex)
  parallelStrategy?: ParallelStrategy

  // Evaluation rubric (from codex)
  evaluationRubric?: EvaluationRubric
}

export const TeamConfigSchema = z.object({
  mode: z.enum([
    "worker-reviewer",
    "planner-executor-reviewer",
    "leader-workers",
    "hotfix-guardrail",
    "council",
  ]),
  strategy: z.enum(["collaborative", "competitive"]).optional(),
  agents: z.array(TeamAgentConfigSchema).optional(),
  maxIterations: z.number(),
  timeoutMs: z.number(),
  budget: BudgetConfigSchema.optional(),
  qualityGate: QualityGateConfigSchema,
  circuitBreaker: CircuitBreakerConfigSchema,
  conflictResolution: z.enum(["auto", "manual"]),
  checkpointEnabled: z.boolean().optional(),
  checkpointDir: z.string().optional(),
  thinkingBudget: ThinkingBudgetSchema.optional(),
  parallelStrategy: ParallelStrategySchema.optional(),
})

// ============================================================================
// Default Team Configuration
// ============================================================================

export const defaultTeamConfig: TeamConfig = {
  mode: "worker-reviewer",
  maxIterations: 10,
  timeoutMs: 300000, // 5 minutes
  qualityGate: {
    testsMustPass: true,
    noP0Issues: true,
    requiredChecks: [],
  },
  circuitBreaker: {
    maxConsecutiveFailures: 3,
    maxNoProgressRounds: 5,
    cooldownMs: 60000, // 1 minute
  },
  conflictResolution: "auto",
}

// ============================================================================
// Team State (from kimi)
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
// Team Events (from kimi)
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
  error: (error: Error) => void
  completed: (result: unknown) => void
}

// ============================================================================
// Context Contract (from minimax/kimi)
// ============================================================================

/**
 * ContextContract defines a looser agreement between agents
 * Used for exploration, research, and tasks with fluid boundaries
 */
export interface ContextContract {
  taskId: string

  objective: string // Clear goal - what needs to be achieved

  context: {
    background: string // Why this task matters
    constraints: string[] // Hard constraints that must be followed
    references: string[] // File paths, docs, code to reference
  }

  boundaries: {
    mustNot: string[] // Things that must NOT be done
    shouldConsider: string[] // Things to keep in mind
  }

  expectedOutcome: {
    intent: string // What success looks like
    validationHint: string // How to verify the outcome
  }

  strictContract?: TaskContract // Optional: can escalate to strict contract
}

export const ContextContractSchema = z.object({
  taskId: z.string(),
  objective: z.string().describe("Clear goal - what needs to be achieved"),
  context: z.object({
    background: z.string().describe("Why this task matters"),
    constraints: z.array(z.string()).describe("Hard constraints that must be followed"),
    references: z.array(z.string()).describe("File paths, docs, code to reference"),
  }),
  boundaries: z.object({
    mustNot: z.array(z.string()).describe("Things that must NOT be done"),
    shouldConsider: z.array(z.string()).describe("Things to keep in mind"),
  }),
  expectedOutcome: z.object({
    intent: z.string().describe("What success looks like"),
    validationHint: z.string().describe("How to verify the outcome"),
  }),
  strictContract: z.any().optional(), // Will be replaced with TaskContractSchema
})

// ============================================================================
// Task Contract (from kimi)
// ============================================================================

/**
 * TaskContract defines the strict agreement between planner and executor
 * It specifies what needs to be done, boundaries, and acceptance criteria
 */
export interface TaskContract {
  taskId: string
  objective: string // Clear description of what needs to be done
  fileScope: string[] // List of files that can be modified
  apiContracts?: string[] // API or schema constraints that must be followed
  acceptanceChecks: string[] // Commands that must pass (e.g., npm test, npm run build)
}

export const TaskContractSchema = z.object({
  taskId: z.string(),
  objective: z.string().describe("Clear description of what needs to be done"),
  fileScope: z.array(z.string()).describe("List of files that can be modified"),
  apiContracts: z.array(z.string()).optional().describe("API or schema constraints that must be followed"),
  acceptanceChecks: z.array(z.string()).describe("Commands that must pass (e.g., npm test, npm run build)"),
})

// ============================================================================
// Work Artifact (from kimi)
// ============================================================================

/**
 * WorkArtifact represents the output of a worker/executor
 * It includes the changes made, test results, and risk assessment
 */
export interface TestResult {
  command: string
  passed: boolean
  outputRef?: string // Reference to full output
}

export interface WorkArtifact {
  taskId: string
  summary: string // Summary of changes made
  changedFiles: string[]
  patchRef: string // Git patch or commit reference containing the changes
  testResults: TestResult[]
  risks: string[] // Identified risks or concerns
  assumptions: string[] // Assumptions made during implementation
}

export const TestResultSchema = z.object({
  command: z.string(),
  passed: z.boolean(),
  outputRef: z.string().optional(),
})

export const WorkArtifactSchema = z.object({
  taskId: z.string(),
  summary: z.string().describe("Summary of changes made"),
  changedFiles: z.array(z.string()),
  patchRef: z.string().describe("Git patch or commit reference containing the changes"),
  testResults: z.array(TestResultSchema),
  risks: z.array(z.string()).describe("Identified risks or concerns"),
  assumptions: z.array(z.string()).describe("Assumptions made during implementation"),
})

// ============================================================================
// Review Artifact (from kimi)
// ============================================================================

/**
 * ReviewArtifact represents the output of a reviewer
 * It includes approval status and required changes
 */
export interface ReviewArtifact {
  status: "approved" | "changes_requested"
  severity: "P0" | "P1" | "P2" | "P3" // P0 = blocking, P3 = minor
  mustFix: string[] // Issues that must be fixed
  suggestions: string[] // Optional improvements
}

export const ReviewArtifactSchema = z.object({
  status: z.enum(["approved", "changes_requested"]),
  severity: z.enum(["P0", "P1", "P2", "P3"]).describe("P0 = blocking, P3 = minor"),
  mustFix: z.array(z.string()).describe("Issues that must be fixed"),
  suggestions: z.array(z.string()).describe("Optional improvements"),
})

// ============================================================================
// Agent Message Protocol (from kimi)
// ============================================================================

export type AgentMessage =
  | { type: "task-assign"; task: TaskContract }
  | { type: "task-result"; artifact: WorkArtifact }
  | { type: "review-request"; artifact: WorkArtifact }
  | { type: "review-result"; review: ReviewArtifact }
  | { type: "conflict-detected"; files: string[] }
  | { type: "progress"; category: "code" | "test" | "review"; details: string }
  | { type: "error"; error: string }

// ============================================================================
// Checkpoint (from kimi)
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
// Pricing (from kimi)
// ============================================================================

export interface PricingTable {
  [model: string]: {
    inputPer1M: number
    outputPer1M: number
    updatedAt: number
  }
}

// ============================================================================
// Team Execution Result (from codex)
// ============================================================================

export interface TeamRunStats {
  durationMs: number
  iterations: number
  tokensUsed: number
  estimatedCostUsd: number
}

export interface TeamFailureReport {
  teamId: string
  reason: "failed" | "timeout" | "budget_exceeded" | "circuit_open"
  completedTasks: string[]
  pendingTasks: string[]
  recoveryPrompt: string
}

export interface TeamExecutionResult {
  status: "success" | "failure" | "timeout"
  output: string
  reviewRounds: number
  mustFixCount: number
  p0Count: number
  stats: TeamRunStats
  fallbackUsed?: boolean
}

// ============================================================================
// Agent Instance (from minimax)
// ============================================================================

export interface AgentInstance {
  id: string
  role: AgentRole
  model: string
  status: "idle" | "working" | "completed" | "error"
  currentTaskId?: string
  createdAt: number
  lastActiveAt: number
}

// ============================================================================
// Team Context (from minimax)
// ============================================================================

export interface TeamContext {
  teamId: string
  config: TeamConfig
  status: TeamStatus
  agents: Map<string, AgentInstance>
  currentIteration: number
  startTime: number
  endTime?: number

  // Statistics
  totalTokens: number
  totalCostUsd: number
  completedTasks: number
  failedTasks: number
}

// ============================================================================
// Validation Functions
// ============================================================================

export function validateTeamConfig(data: unknown): TeamConfig {
  return TeamConfigSchema.parse(data)
}

export function validateTaskContract(data: unknown): TaskContract {
  return TaskContractSchema.parse(data)
}

export function validateWorkArtifact(data: unknown): WorkArtifact {
  return WorkArtifactSchema.parse(data)
}

export function validateReviewArtifact(data: unknown): ReviewArtifact {
  return ReviewArtifactSchema.parse(data)
}

export function validateContextContract(data: unknown): ContextContract {
  return ContextContractSchema.parse(data)
}

// ============================================================================
// Shared Blackboard (from kimi)
// ============================================================================

/**
 * SharedBlackboard is the central state sharing and event notification system
 * for multi-agent collaboration. Stores structured summaries only, not large raw content.
 */
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
  getMessages(filter?: {
    from?: string
    to?: string
    type?: string
  }): Array<{ message: AgentMessage; from: string; to?: string; timestamp: number }>
  clearMessages(): void

  // Contract helpers
  setTaskContract(contract: TaskContract): void
  getTaskContract(): TaskContract | undefined
  setWorkArtifact(agentId: string, artifact: WorkArtifact): void
  getWorkArtifact(agentId: string): WorkArtifact | undefined
  setReviewArtifact(agentId: string, artifact: ReviewArtifact): void
  getReviewArtifact(agentId: string): ReviewArtifact | undefined

  // Audit log
  logEvent(event: string, details: Record<string, unknown>): void
  getAuditLog(): Array<{ timestamp: number; event: string; details: Record<string, unknown> }>
}

// ============================================================================
// Mode Runner Interface (from kimi branch)
// ============================================================================

/**
 * ModeRunner defines the interface for team mode implementations.
 * Each team mode (worker-reviewer, leader-workers, etc.) implements this interface
 * to provide its specific collaboration pattern.
 */
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
