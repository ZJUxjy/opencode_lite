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
  ModeRunner,
  SharedBlackboard,
  CostController,
  ProgressTracker,
} from "./core/types.js"

export { defaultTeamConfig, TEAM_MODES, AGENT_ROLES } from "./core/types.js"

// Contracts
export type {
  TaskContract,
  WorkArtifact,
  ReviewArtifact,
  TestResult,
  ContextContract as LooseContract,
} from "./core/contracts.js"

export {
  TaskContractSchema,
  WorkArtifactSchema,
  ReviewArtifactSchema,
  TestResultSchema,
  ContextContractSchema,
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
export { TeamBlackboard, createBlackboard } from "./core/blackboard.js"

// Core - Checkpoint
export { CheckpointManager, createCheckpointManager } from "./core/checkpoint.js"
export type { Checkpoint, CheckpointConfig } from "./core/checkpoint.js"

// Core - Checkpoint Resume
export { CheckpointResumer, createCheckpointResumer } from "./core/checkpoint-resume.js"
export type { CheckpointResumeConfig, ResumedExecution } from "./core/checkpoint-resume.js"

// Core - Conflict Detector
export { ConflictDetector, createConflictDetector } from "./core/conflict-detector.js"
export type { Conflict, ConflictType, ConflictSeverity, ConflictStatus } from "./core/conflict-detector.js"

// Core - Team Run Store
export { TeamRunStore, createTeamRunStore } from "./core/team-run-store.js"
export type { TeamRun, CreateTeamRunParams, UpdateTeamRunParams, ListTeamRunsOptions } from "./core/team-run-store.js"

// Core - Thinking Budget
export { ThinkingBudgetManager, createThinkingBudgetManager, DEFAULT_THINKING_CONFIG, THINKING_PROMPT_TEMPLATE } from "./core/thinking-budget.js"
export type { ThinkingBudgetConfig, ThinkingArtifact } from "./core/thinking-budget.js"

// Client
export { AgentLLMClient, createAgentLLMClient } from "./client/llm-client.js"
export type { AgentLLMConfig, WorkerOutput, ReviewerOutput } from "./client/llm-client.js"

export { AgentPool } from "./client/agent-pool.js"
export type { AgentInstance, AgentPoolConfig, InstanceRequest } from "./client/agent-pool.js"

// Execution
export { TaskDAG, createTaskDAG } from "./execution/task-dag.js"
export type { TaskNode } from "./execution/task-dag.js"

export { TeamCostController, createCostController } from "./execution/cost-controller.js"
export type { CostController as ICostController } from "./execution/cost-controller.js"

// Execution - Fallback
export { TeamFallbackHandler, createFallbackHandler } from "./execution/fallback.js"
export type { TeamFailureReport, FallbackContext } from "./execution/fallback.js"

// Execution - Progress
export { ProgressFileManager } from "./execution/progress-file.js"
export type { ProgressTask, ProgressTaskStatus } from "./execution/progress-file.js"

export { ProgressPersistence, createProgressPersistence } from "./execution/progress-persistence.js"
export type { ProgressPersistenceConfig } from "./execution/progress-persistence.js"

export { TeamProgressTracker, createProgressTracker } from "./execution/progress-tracker.js"
export type { ProgressTracker as IProgressTracker } from "./execution/progress-tracker.js"

// Isolation
export { WorktreeIsolation } from "./isolation/worktree-isolation.js"
export type { WorktreeHandle } from "./isolation/worktree-isolation.js"

// Loop
export { RalphLoopManager } from "./loop/ralph-loop.js"
export type { RalphTaskQueue, RalphLoopConfig, RalphLoopSummary } from "./loop/ralph-loop.js"

// Testing
export { runDrillScenario, listDrillScenarios, runAllDrillScenarios } from "./testing/drill.js"
export type { DrillScenarioResult, DrillReport } from "./testing/drill.js"

export { BaselineRunner } from "./testing/benchmark.js"
export type { BaselineSample, BaselineResult, BaselineComparison, BaselineReport, BenchmarkConfig } from "./testing/benchmark.js"

export { LLMJudge, createLLMJudge, DEFAULT_CODE_QUALITY_RUBRIC } from "./testing/llm-judge.js"
export type { EvaluationDimension, EvaluationRubric, JudgementResult, LLMJudgeConfig } from "./testing/llm-judge.js"

// Modes
export { TEAM_MODES as MODE_TEAM_MODES, getDefaultMode } from "./modes/index.js"
export type { TeamMode as ModeTeamMode } from "./modes/index.js"
