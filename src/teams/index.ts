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

// ============================================================================
// Team Manager Exports
// ============================================================================

export {
  TeamManager,
  createTeamManager,
  type TeamManagerOptions,
} from "./team-manager.js"
