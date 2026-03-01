/**
 * Agent Teams - 多Agent协作系统
 *
 * 导出所有公共接口
 */

// 类型定义
export type {
  TeamMode,
  LeaderWorkersStrategy,
  AgentRole,
  TeamStatus,
  TeamConfig,
  TeamAgentConfig,
  TeamAgent,
  Team,
  TeamResult,
  StateTransition,
  CostRecord,
  CostSummary,
  TimeoutConfig,
} from "./types.js"

// 产物契约
export type {
  TaskContract,
  WorkArtifact,
  TestResult,
  ReviewArtifact,
  ReviewComment,
  Patch,
  MergeStrategy,
  EvaluationCriteria,
} from "./contracts.js"

// 共享黑板
export {
  SharedBlackboard,
  type BlackboardEvent,
  type BlackboardEntry,
  type AgentStatus,
} from "./blackboard.js"

// 成本控制
export {
  CostController,
  type PricingTable,
  type DegradationAction,
} from "./cost-controller.js"

// 进度追踪
export {
  ProgressTracker,
  type TaskProgress,
  type IterationRecord,
  type ProgressSnapshot,
} from "./progress-tracker.js"

// 协作模式
export { WorkerReviewerTeam } from "./modes/worker-reviewer.js"
export { PlannerExecutorReviewerTeam } from "./modes/planner-executor-reviewer.js"
export { LeaderWorkersTeam } from "./modes/leader-workers.js"
export { HotfixGuardrailTeam, type HotfixReport, type SafetyReviewResult } from "./modes/hotfix-guardrail.js"
export { CouncilTeam, type DecisionOption, type DecisionRecord, type DiscussionRound } from "./modes/council.js"

// 降级机制
export {
  executeWithFallback,
  generateRecoveryPrompt,
  shouldFallback,
  formatFailureReport,
  type TeamFailureReport,
  type FallbackResult,
  type FallbackConfig,
} from "./fallback.js"

// 任务 DAG
export {
  TaskDAG,
  createTaskNode,
  createDAGFromContracts,
  type TaskNode,
  type ParallelLevel,
  type ExecutionPlan,
} from "./task-dag.js"

// 冲突检测器
export {
  ConflictDetector,
  createFileChange,
  formatConflictReport,
  type FileChange,
  type ChangeRegion,
  type ConflictType,
  type Conflict,
  type ConflictResolution,
  type ConflictDetectionResult,
} from "./conflict-detector.js"

// 检查点存储
export {
  CheckpointStore,
  type Checkpoint,
} from "./checkpoint-store.js"

// Team 会话存储
export {
  TeamSessionStore,
  formatTeamStatus,
  formatTeamMode,
  type TeamSession,
  type TeamAgentRecord,
  type TeamSessionStats,
  type AgentMessageTrace,
  type CheckpointIndex,
} from "./team-session-store.js"

// Team 执行器
export {
  TeamExecutor,
  createTeamExecutor,
  type TeamExecutionEvents,
  type TeamExecutorConfig,
} from "./team-executor.js"
