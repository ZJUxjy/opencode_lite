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

// 产物存储
export {
  ArtifactStorage,
  DEFAULT_ARTIFACT_STORAGE_CONFIG,
  type ArtifactFormat,
  type FilesystemArtifact,
  type ArtifactStorageConfig,
} from "./artifact-storage.js"

// 评估 Rubric
export {
  RubricEvaluator,
  DEFAULT_CODE_RUBRIC,
  createDefaultEvaluator,
  type EvaluationRubric,
  type EvaluationDimension,
  type DimensionScore,
  type JudgementResult,
  type ScoreLevel,
} from "./evaluation-rubric.js"

// 检查点恢复
export {
  CheckpointResumeManager,
  createCheckpointResumeManager,
  DEFAULT_RESUME_CONFIG,
  type ResumeStrategy,
  type ContextInjectionConfig,
  type CheckpointResumeConfig,
  type ResumeContext,
} from "./checkpoint-resume.js"

// 宽松上下文契约
export {
  ContextContractBuilder,
  generateContextPrompt,
  createContract,
  createFeatureContract,
  createBugFixContract,
  type ContextContract,
  type ContextReference,
  type BoundaryConstraints,
  type OutputExpectation,
} from "./context-contract.js"

// 进度文件持久化
export {
  ProgressFileManager,
  createProgressManager,
  type ProgressFile,
  type ProgressTask,
  type TaskStatus,
  type TaskPriority,
} from "./progress-file.js"

// Git Worktree 隔离
export {
  WorktreeManager,
  createWorktreeManager,
  withIsolatedWorktree,
  isGitRepository,
  getCurrentBranch,
  listWorktrees,
  DEFAULT_WORKTREE_CONFIG,
  type WorktreeIsolationConfig,
  type WorktreeInfo,
} from "./worktree-isolation.js"

// Ralph Loop 持续执行
export {
  RalphLoop,
  ParallelExecutor,
  createRalphLoop,
  DEFAULT_RALPH_CONFIG,
  type RalphLoopConfig,
  type TaskSourceType,
  type TaskDefinition,
  type TaskExecutionResult,
  type RalphLoopStats,
  type RalphEvent,
  type RalphOutputFormat,
  type HealthStatus,
  type ParallelConfig,
  type ParallelTaskResult,
  type PlanModeConfig,
} from "./ralph-loop.js"

// 扩展思考预算
export {
  ThinkingBudgetManager,
  createThinkingBudgetManager,
  prependThinkingPrompt,
  THINKING_PROMPT_TEMPLATE,
  DEFAULT_THINKING_CONFIG,
  type ThinkingBudgetConfig,
  type ThinkingArtifact,
} from "./thinking-budget.js"

// 非交互模式
export {
  NonInteractiveExecutor,
  createNonInteractiveExecutor,
  runNonInteractive,
  DEFAULT_NON_INTERACTIVE_CONFIG,
  type NonInteractiveConfig,
  type NonInteractiveResult,
  type OutputFormat,
} from "./non-interactive.js"
