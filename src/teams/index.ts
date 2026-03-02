/**
 * Agent Teams - Unified Exports
 *
 * This module exports all Agent Teams components for multi-agent collaboration.
 * Merged from codex, kimi, and minimax branches.
 */

// Core types
export type {
  TeamMode,
  AgentRole,
  TeamConfig,
  TeamState,
  TeamExecutionResult,
  ThinkingBudget,
  ContextContract,
} from "./core/types.js"

export { defaultTeamConfig, TEAM_MODES, AGENT_ROLES } from "./core/types.js"

// Contracts
export type {
  TaskContract,
  WorkArtifact,
  ReviewArtifact,
  TestResult,
} from "./core/contracts.js"

export {
  createDefaultTaskContract,
  createEmptyWorkArtifact,
  createApprovalReview,
  createRejectionReview,
  createLooseContract,
  meetsQualityGate,
  toStrictContract,
  toContextContract,
  validateTaskContract,
  validateWorkArtifact,
  validateReviewArtifact,
  validateContextContract,
} from "./core/contracts.js"

// Core - Blackboard
export { SharedBlackboard } from "./core/blackboard.js"
export type { BlackboardConfig, BlackboardSnapshot } from "./core/blackboard.js"

// Core - Checkpoint
export { CheckpointManager } from "./core/checkpoint.js"
export type { Checkpoint, CheckpointOptions } from "./core/checkpoint.js"

// Core - Checkpoint Resume
export { CheckpointResumer, createCheckpointResumer } from "./core/checkpoint-resume.js"
export type { ResumeStrategy, ResumeOptions } from "./core/checkpoint-resume.js"

// Core - Conflict Detector
export { ConflictDetector } from "./core/conflict-detector.js"
export type { ConflictReport, ConflictType } from "./core/conflict-detector.js"

// Core - Team Run Store
export { TeamRunStore } from "./core/team-run-store.js"
export type { RunRecord, RunQuery } from "./core/team-run-store.js"

// Core - Thinking Budget
export { ThinkingBudgetManager } from "./core/thinking-budget.js"
export type { ThinkingConfig, ThinkingArtifact } from "./core/thinking-budget.js"

// Client
export { AgentLLMClient, createAgentLLMClient } from "./client/llm-client.js"
export type { AgentLLMConfig, WorkerOutput, ReviewerOutput } from "./client/llm-client.js"

export { AgentPool } from "./client/agent-pool.js"
export type { AgentInstance, AgentPoolConfig, InstanceRequest } from "./client/agent-pool.js"

// Execution
export { TaskDAG, createTaskDAG } from "./execution/task-dag.js"
export type { TaskNode } from "./execution/task-dag.js"

export { CostController } from "./execution/cost-controller.js"
export type { CostControllerConfig, BudgetStatus } from "./execution/cost-controller.js"

// Execution - Fallback
export { FallbackManager } from "./execution/fallback.js"
export type { FallbackStrategy, FallbackConfig } from "./execution/fallback.js"

// Execution - Progress
export { ProgressFileManager } from "./execution/progress-file.js"
export type { ProgressTask, ProgressTaskStatus } from "./execution/progress-file.js"

export { ProgressPersistence } from "./execution/progress-persistence.js"
export type { PersistenceOptions } from "./execution/progress-persistence.js"

export { ProgressTracker } from "./execution/progress-tracker.js"
export type { ProgressStats, ProgressConfig } from "./execution/progress-tracker.js"

// Isolation
export { WorktreeIsolation } from "./isolation/worktree-isolation.js"
export type { WorktreeHandle } from "./isolation/worktree-isolation.js"

// Loop
export { RalphLoopManager } from "./loop/ralph-loop.js"
export type { RalphTaskQueue, RalphLoopConfig, RalphLoopSummary } from "./loop/ralph-loop.js"

// Testing
export { runDrillScenario, listDrillScenarios, runAllDrillScenarios } from "./testing/drill.js"
export type { DrillScenarioResult, DrillReport } from "./testing/drill.js"

export { BaselineRunner, runBaselineComparison } from "./testing/benchmark.js"
export type { BaselineConfig, BaselineResult, BaselineComparison } from "./testing/benchmark.js"

export { LLMJudge } from "./testing/llm-judge.js"
export type { JudgeCriteria, JudgeResult } from "./testing/llm-judge.js"

// Modes
export { TEAM_MODES as MODE_TEAM_MODES, getDefaultMode } from "./modes/index.js"
export type { TeamMode as ModeTeamMode } from "./modes/index.js"
