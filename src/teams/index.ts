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
  ContextContractSchema,
  validateTaskContract,
  validateWorkArtifact,
  validateReviewArtifact,
  meetsQualityGate,
  createDefaultTaskContract,
  createEmptyWorkArtifact,
  createApprovalReview,
  createRejectionReview,
  validateContextContract,
  createLooseContract,
  toStrictContract,
  toContextContract,
  type ContextContract,
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

export {
  HotfixGuardrailMode,
  createHotfixGuardrailMode,
} from "./modes/hotfix-guardrail.js"

export {
  CouncilMode,
  createCouncilMode,
} from "./modes/council.js"

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
// Checkpoint Exports
// ============================================================================

export {
  CheckpointManager,
  createCheckpointManager,
  type Checkpoint,
  type CheckpointConfig,
  type ResumableTaskRunner,
} from "./checkpoint.js"

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

// ============================================================================
// Team Run Store Exports
// ============================================================================

export {
  TeamRunStore,
  createTeamRunStore,
  type TeamRun,
  type CreateTeamRunParams,
  type UpdateTeamRunParams,
  type CheckpointRef,
  type CreateCheckpointRefParams,
  type ListTeamRunsOptions,
} from "./team-run-store.js"

// ============================================================================
// Agent Pool Exports
// ============================================================================

export {
  AgentPool,
  createAgentPool,
  type AgentInstance,
  type AgentPoolConfig,
  type InstanceRequest,
} from "./agent-pool.js"

// ============================================================================
// Artifact Store Exports
// ============================================================================

export {
  ArtifactStore,
  createArtifactStore,
  type ArtifactFormat,
  type ArtifactMetadata,
  type FilesystemArtifact,
  type ArtifactStoreConfig,
  type ArtifactQuery,
  type StoreArtifactInput,
} from "./artifact-store.js"

// ============================================================================
// Benchmark Exports
// ============================================================================

export {
  BaselineRunner,
  createBaselineRunner,
  formatBaselineReport,
  saveBaselineReport,
  DEFAULT_TEST_SUITE,
  type BaselineCategory,
  type BaselineTestSuite,
  type BaselineSample,
  type BaselineResult,
  type BaselineComparison,
  type BaselineReport,
  type BenchmarkConfig,
} from "./benchmark.js"

// ============================================================================
// Progress Persistence Exports
// ============================================================================

export {
  ProgressPersistence,
  createProgressPersistence,
  type ProgressReport,
  type ProgressPersistenceConfig,
} from "./progress-persistence.js"

// ============================================================================
// LLM Judge Exports
// ============================================================================

export {
  LLMJudge,
  createLLMJudge,
  DEFAULT_CODE_QUALITY_RUBRIC,
  type EvaluationRubric,
  type EvaluationDimension,
  type JudgementResult,
  type LLMJudgeConfig,
} from "./llm-judge.js"

// ============================================================================
// Checkpoint Resume Exports
// ============================================================================

export {
  CheckpointResumer,
  createCheckpointResumer,
  type ResumedExecution,
  type ResumeContext,
  type CheckpointResumeConfig,
} from "./checkpoint-resume.js"
