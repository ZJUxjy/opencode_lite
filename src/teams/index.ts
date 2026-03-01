/**
 * Agent Teams - Multi-Agent Collaboration System
 *
 * A multi-agent collaboration system for complex development tasks.
 *
 * @example
 * ```typescript
 * import { TeamManager } from "./teams/index.js"
 *
 * const manager = new TeamManager({
 *   mode: "worker-reviewer",
 *   agents: [
 *     { role: "worker", model: "claude-sonnet-4" },
 *     { role: "reviewer", model: "claude-sonnet-4" },
 *   ],
 *   maxIterations: 3,
 *   timeoutMs: 300000,
 * })
 *
 * await manager.run({ objective: "Implement feature X", fileScope: ["src/x.ts"] })
 * ```
 */

// ============================================================================
// Type Exports
// ============================================================================

export type {
  TeamMode,
  LeaderWorkersStrategy,
  AgentRole,
  TeamStatus,
  TeamConfig,
  TeamAgentConfig,
  TeamState,
  TeamEvents,
  TaskContract,
  WorkArtifact,
  ReviewArtifact,
  AgentMessage,
  Checkpoint,
  PricingTable,
  ModeRunner,
} from "./types.js"

// ============================================================================
// Contract Exports
// ============================================================================

export {
  TaskContractSchema,
  WorkArtifactSchema,
  ReviewArtifactSchema,
  TestResultSchema,
  validateTaskContract,
  validateWorkArtifact,
  validateReviewArtifact,
  meetsQualityGate,
  createDefaultTaskContract,
  createEmptyWorkArtifact,
  createApprovalReview,
  createRejectionReview,
} from "./contracts.js"

// ============================================================================
// Blackboard Exports
// ============================================================================

export {
  TeamBlackboard,
  createBlackboard,
} from "./blackboard.js"

// ============================================================================
// Cost Controller Exports
// ============================================================================

export {
  TeamCostController,
  createCostController,
  type CostController,
} from "./cost-controller.js"

// ============================================================================
// Progress Tracker Exports
// ============================================================================

export {
  TeamProgressTracker,
  createProgressTracker,
  type ProgressTracker,
} from "./progress-tracker.js"

// ============================================================================
// LLM Client Exports
// ============================================================================

export {
  AgentLLMClient,
  createAgentLLMClient,
  type AgentLLMConfig,
  type WorkerOutput,
  type ReviewerOutput,
} from "./llm-client.js"

// ============================================================================
// Mode Exports
// ============================================================================

export {
  WorkerReviewerMode,
  createWorkerReviewerMode,
} from "./modes/worker-reviewer.js"

export {
  PlannerExecutorReviewerMode,
  createPlannerExecutorReviewerMode,
} from "./modes/planner-executor-reviewer.js"

export {
  LeaderWorkersMode,
  createLeaderWorkersMode,
} from "./modes/leader-workers.js"

// ============================================================================
// Task DAG Exports
// ============================================================================

export {
  TaskDAG,
  ParallelTaskScheduler,
  createTaskDAG,
  createParallelScheduler,
  type TaskNode,
  type TaskEdge,
  type TaskStatus,
  type TaskExecutor,
  type SchedulerConfig,
} from "./task-dag.js"

// ============================================================================
// Conflict Detector Exports
// ============================================================================

export {
  ConflictDetector,
  createConflictDetector,
  ResolutionStrategies,
  type Conflict,
  type ConflictType,
  type ConflictSeverity,
  type ConflictStatus,
  type FileChange,
  type ConflictDetectorConfig,
  type ConflictResolution,
} from "./conflict-detector.js"

// ============================================================================
// Fallback Exports
// ============================================================================

export {
  TeamFallbackHandler,
  createFallbackHandler,
  type TeamFailureReport,
  type FallbackContext,
  type FallbackAgentInput,
} from "./fallback.js"

// ============================================================================
// Team Manager Exports
// ============================================================================

export {
  TeamManager,
  createTeamManager,
  type TeamManagerOptions,
} from "./team-manager.js"
