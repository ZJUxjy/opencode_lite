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
