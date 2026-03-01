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
} from "./core/contracts.js"

// Client
export { AgentLLMClient, createAgentLLMClient } from "./client/llm-client.js"
export type { AgentLLMConfig, WorkerOutput, ReviewerOutput } from "./client/llm-client.js"

export { AgentPool } from "./client/agent-pool.js"
export type { AgentInstance, AgentPoolConfig, InstanceRequest } from "./client/agent-pool.js"

// Execution
export { TaskDAG, createTaskDAG } from "./execution/task-dag.js"
export type { TaskNode } from "./execution/task-dag.js"

export { CostController } from "./execution/cost-controller.js"

// Isolation
export { WorktreeIsolation } from "./isolation/worktree-isolation.js"
export type { WorktreeHandle } from "./isolation/worktree-isolation.js"

// Loop
export { RalphLoopManager } from "./loop/ralph-loop.js"
export type { RalphTaskQueue, RalphLoopConfig, RalphLoopSummary } from "./loop/ralph-loop.js"

// Testing
export { runDrillScenario, listDrillScenarios, runAllDrillScenarios } from "./testing/drill.js"
export type { DrillScenarioResult, DrillReport } from "./testing/drill.js"

// Modes
export { TEAM_MODES as MODE_TEAM_MODES, getDefaultMode } from "./modes/index.js"
export type { TeamMode as ModeTeamMode } from "./modes/index.js"
