# Merge Kimi Agent Teams into Master Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Merge kimi branch's Agent Teams advanced features into master branch, preserving master directory structure while porting kimi's unique capabilities.

**Architecture:** Keep master's hierarchical directory structure (core/, client/, execution/, etc.) and place kimi's flat files into appropriate directories. For files existing in both branches, compare and select the better implementation.

**Tech Stack:** TypeScript, Vitest, Git worktree merge strategy

---

## Phase 1: Foundation - Update types.ts with ModeRunner interface

**Files:**
- Modify: `src/teams/core/types.ts:210-230`

**Step 1: Check if ModeRunner interface exists in master types.ts**

Read: `src/teams/core/types.ts`
Search for "ModeRunner" interface
Expected: Not found (kimi has it, master doesn't)

**Step 2: Add ModeRunner interface and related imports**

Add after line 648 (before the end of file):

```typescript
// ============================================================================
// Mode Runner Interface (from kimi branch)
// ============================================================================

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
```

**Step 3: Run tests to ensure types compile**

Run: `npm run build`
Expected: No TypeScript compilation errors

**Step 4: Commit**

```bash
git add src/teams/core/types.ts
git commit -m "feat(teams): add ModeRunner interface from kimi branch

Add ModeRunner interface to support pluggable team mode runners.
Enables different collaboration patterns (worker-reviewer, leader-workers, etc.)
to be implemented as interchangeable runners."
```

---

## Phase 2: Compare and Merge - Core Module Files

### Task 2.1: Compare and Merge contracts.ts

**Files:**
- Read: `src/teams/core/contracts.ts` (master)
- Read: `src/teams-kimi/src/teams/contracts.ts` (kimi - via worktree)
- Modify: `src/teams/core/contracts.ts`

**Step 1: Read both files**

Master file: `src/teams/core/contracts.ts`
Kimi file: `/home/xjingyao/code/opencode_lite/lite-opencode-kimi/src/teams/contracts.ts`

**Step 2: Compare exports and functionality**

Compare:
- Function signatures
- Type definitions
- Helper functions

**Step 3: Merge the better implementation**

Decision criteria:
- Keep master's Zod schemas if they exist
- Add any missing functions from kimi
- Ensure all types are exported from index.ts

**Step 4: Run tests**

Run: `npm test src/teams/__tests__/contracts.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/teams/core/contracts.ts
git commit -m "feat(teams): merge contracts.ts from kimi branch

Unified contract types and helper functions for Agent Teams."
```

---

### Task 2.2: Compare and Merge agent-pool.ts

**Files:**
- Read: `src/teams/client/agent-pool.ts` (master)
- Read: `src/teams-kimi/src/teams/agent-pool.ts` (kimi)
- Modify: `src/teams/client/agent-pool.ts`

**Step 1: Read both files**

**Step 2: Compare implementations**

Check for:
- Factory function vs Class
- Feature completeness
- Error handling

**Step 3: Select better implementation**

If kimi has more features: port kimi's code to master's file
If master is more complete: keep master

**Step 4: Run tests**

Run: `npm test src/teams/__tests__/agent-pool.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/teams/client/agent-pool.ts
git commit -m "feat(teams): merge agent-pool from kimi branch

Enhanced agent pool management with instance lifecycle."
```

---

### Task 2.3: Compare and Merge cost-controller.ts

**Files:**
- Read: `src/teams/execution/cost-controller.ts` (master)
- Read: `src/teams-kimi/src/teams/cost-controller.ts` (kimi)
- Modify: `src/teams/execution/cost-controller.ts`

**Step 1-5:** Same pattern as Task 2.2

---

### Task 2.4: Compare and Merge worktree-isolation.ts

**Files:**
- Read: `src/teams/isolation/worktree-isolation.ts` (master)
- Read: `src/teams-kimi/src/teams/worktree-isolation.ts` (kimi)
- Modify: `src/teams/isolation/worktree-isolation.ts`

**Step 1-5:** Same pattern as Task 2.2

---

### Task 2.5: Replace ralph-loop.ts with Kimi Enhanced Version

**Files:**
- Read: `src/teams/loop/ralph-loop.ts` (master)
- Read: `src/teams-kimi/src/teams/ralph-loop.ts` (kimi)
- Modify: `src/teams/loop/ralph-loop.ts`

**Step 1: Read kimi's enhanced version**

Kimi has:
- RalphEvent system (start, task_start, task_complete, iteration, heartbeat, error, complete)
- RalphLoopStats for metrics
- Run loop with retry logic
- Heartbeat mechanism
- Event listeners

**Step 2: Replace master with kimi version**

Copy kimi's implementation to master
Update imports to use master's directory structure

**Step 3: Update exports in index.ts**

Add any new exports from ralph-loop.ts

**Step 4: Run tests**

Run: `npm test src/teams/__tests__/ralph-loop.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/teams/loop/ralph-loop.ts src/teams/index.ts
git commit -m "feat(teams): enhance ralph-loop with event system and heartbeat

Add comprehensive features from kimi branch:
- RalphEvent system for monitoring
- RalphLoopStats for execution metrics
- Heartbeat mechanism
- Enhanced configuration options"
```

---

## Phase 3: Port Missing Modules (12 files)

### Task 3.1: Port Benchmark Framework

**Files:**
- Create: `src/teams/testing/benchmark.ts`
- Modify: `src/teams/index.ts` (add exports)

**Step 1: Copy kimi's benchmark.ts**

Source: `/home/xjingyao/code/opencode_lite/lite-opencode-kimi/src/teams/benchmark.ts`
Target: `src/teams/testing/benchmark.ts`

**Step 2: Update imports**

Change relative imports:
- `from "./types.js"` → `from "../core/types.js"`
- `from "./contracts.js"` → `from "../core/contracts.js"`

**Step 3: Add exports to index.ts**

```typescript
// Testing
export { runDrillScenario, listDrillScenarios, runAllDrillScenarios } from "./testing/drill.js"
export type { DrillScenarioResult, DrillReport } from "./testing/drill.js"
export { BaselineRunner, runBaselineComparison } from "./testing/benchmark.js"
export type { BaselineConfig, BaselineResult, BaselineComparison } from "./testing/benchmark.js"
```

**Step 4: Run tests**

Run: `npm test src/teams/__tests__/benchmark.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/teams/testing/benchmark.ts src/teams/index.ts
git commit -m "feat(teams): add benchmark framework from kimi branch

Add BaselineRunner for comparing single-agent vs team performance.
Supports multiple modes, metrics calculation, and report generation."
```

---

### Task 3.2: Port Blackboard Module

**Files:**
- Create: `src/teams/core/blackboard.ts`
- Modify: `src/teams/index.ts`

**Step 1-5:** Same pattern as Task 3.1

Place in: `src/teams/core/blackboard.ts`
Update imports to use `../core/` paths

---

### Task 3.3: Port Checkpoint Module

**Files:**
- Create: `src/teams/core/checkpoint.ts`
- Modify: `src/teams/index.ts`

**Step 1-5:** Same pattern as Task 3.1

---

### Task 3.4: Port Checkpoint Resume Module

**Files:**
- Create: `src/teams/core/checkpoint-resume.ts`
- Modify: `src/teams/index.ts`

**Step 1-5:** Same pattern as Task 3.1

---

### Task 3.5: Port Conflict Detector

**Files:**
- Create: `src/teams/core/conflict-detector.ts`
- Modify: `src/teams/index.ts`

**Step 1-5:** Same pattern as Task 3.1

---

### Task 3.6: Port Fallback Module

**Files:**
- Create: `src/teams/execution/fallback.ts`
- Modify: `src/teams/index.ts`

**Step 1-5:** Same pattern as Task 3.1

---

### Task 3.7: Port LLM Judge

**Files:**
- Create: `src/teams/testing/llm-judge.ts`
- Modify: `src/teams/index.ts`

**Step 1-5:** Same pattern as Task 3.1

---

### Task 3.8: Port Progress File Manager

**Files:**
- Create: `src/teams/execution/progress-file.ts`
- Modify: `src/teams/index.ts`

**Step 1-5:** Same pattern as Task 3.1

---

### Task 3.9: Port Progress Persistence

**Files:**
- Create: `src/teams/execution/progress-persistence.ts`
- Modify: `src/teams/index.ts`

**Step 1-5:** Same pattern as Task 3.1

---

### Task 3.10: Port Progress Tracker

**Files:**
- Create: `src/teams/execution/progress-tracker.ts`
- Modify: `src/teams/index.ts`

**Step 1-5:** Same pattern as Task 3.1

---

### Task 3.11: Port Team Run Store

**Files:**
- Create: `src/teams/core/team-run-store.ts`
- Modify: `src/teams/index.ts`

**Step 1-5:** Same pattern as Task 3.1

---

### Task 3.12: Port Thinking Budget

**Files:**
- Create: `src/teams/core/thinking-budget.ts`
- Modify: `src/teams/index.ts`

**Step 1-5:** Same pattern as Task 3.1

---

## Phase 4: Update Index and Integration

### Task 4.1: Update teams/index.ts with all new exports

**Files:**
- Modify: `src/teams/index.ts`

**Step 1: Ensure all new modules are exported**

Verify exports for:
- All Phase 2 merged modules
- All Phase 3 ported modules

**Step 2: Organize exports by category**

```typescript
// Core
export type { ... } from "./core/types.js"
export { ... } from "./core/contracts.js"
export { SharedBlackboard } from "./core/blackboard.js"
export { CheckpointManager } from "./core/checkpoint.js"
export { CheckpointResumer } from "./core/checkpoint-resume.js"
export { ConflictDetector } from "./core/conflict-detector.js"
export { TeamRunStore } from "./core/team-run-store.js"
export { ThinkingBudgetManager } from "./core/thinking-budget.js"

// Client
export { AgentLLMClient, createAgentLLMClient } from "./client/llm-client.js"
export { AgentPool } from "./client/agent-pool.js"

// Execution
export { TaskDAG, createTaskDAG } from "./execution/task-dag.js"
export { CostController } from "./execution/cost-controller.js"
export { FallbackManager } from "./execution/fallback.js"
export { ProgressFileManager } from "./execution/progress-file.js"
export { ProgressPersistence } from "./execution/progress-persistence.js"
export { ProgressTracker } from "./execution/progress-tracker.js"

// Isolation
export { WorktreeIsolation } from "./isolation/worktree-isolation.js"

// Loop
export { RalphLoopManager } from "./loop/ralph-loop.js"

// Testing
export { ... } from "./testing/drill.js"
export { BaselineRunner, ... } from "./testing/benchmark.js"
export { LLMJudge, ... } from "./testing/llm-judge.js"

// Modes
export { ... } from "./modes/index.js"

// Manager
export { TeamManager } from "./manager.js"
```

**Step 3: Commit**

```bash
git add src/teams/index.ts
git commit -m "feat(teams): update exports for all kimi modules

Organize exports by functional category and add all new modules."
```

---

### Task 4.2: Verify manager.ts compatibility

**Files:**
- Read: `src/teams/manager.ts`
- Run: Build and tests

**Step 1: Check if manager.ts uses new types correctly**

Verify imports from `./core/types.js` work
Check for any missing type references

**Step 2: Run build**

Run: `npm run build`
Expected: No errors

**Step 3: Run all tests**

Run: `npm test`
Expected: All 380+ tests pass

**Step 4: Commit (if fixes needed)**

```bash
git add src/teams/manager.ts
git commit -m "fix(teams): ensure manager.ts compatibility with new modules"
```

---

## Phase 5: Documentation and Final Verification

### Task 5.1: Update AGENT_TEAMS_GUIDE.md

**Files:**
- Read: `docs/AGENT_TEAMS_GUIDE.md` (from kimi)
- Create/Modify: `docs/AGENT_TEAMS_GUIDE.md`

**Step 1: Copy kimi's guide if master doesn't have it**

**Step 2: Update paths to match master structure**

**Step 3: Commit**

```bash
git add docs/AGENT_TEAMS_GUIDE.md
git commit -m "docs(teams): add comprehensive Agent Teams guide

Document all team modes, configuration options, and usage examples."
```

---

### Task 5.2: Run Full Test Suite

**Files:**
- All test files

**Step 1: Run complete test suite**

Run: `npm test`
Expected: All tests pass (380+)

**Step 2: Run build**

Run: `npm run build`
Expected: No TypeScript errors

**Step 3: Verify exports**

Run: `node -e "const t = require('./dist/teams/index.js'); console.log(Object.keys(t).slice(0, 20))"`
Expected: List of exported modules

---

### Task 5.3: Final Commit and Summary

**Step 1: Create summary of changes**

```bash
git log --oneline master..HEAD
```

**Step 2: Final verification**

- All tests pass
- Build succeeds
- Exports are correct

**Step 3: Summary report**

Report:
- Number of files modified: ~10
- Number of files created: ~12
- Number of tests passing: 380+
- Features added: 12 new modules

---

## Appendix: Quick Reference

### Kimi Worktree Location
```
/home/xjingyao/code/opencode_lite/lite-opencode-kimi
```

### Master Branch Location
```
/home/xjingyao/code/opencode_lite/lite-opencode
```

### File Mapping

| Kimi Path | Master Path |
|-----------|-------------|
| `src/teams/types.ts` | `src/teams/core/types.ts` |
| `src/teams/contracts.ts` | `src/teams/core/contracts.ts` |
| `src/teams/agent-pool.ts` | `src/teams/client/agent-pool.ts` |
| `src/teams/llm-client.ts` | `src/teams/client/llm-client.ts` |
| `src/teams/task-dag.ts` | `src/teams/execution/task-dag.ts` |
| `src/teams/cost-controller.ts` | `src/teams/execution/cost-controller.ts` |
| `src/teams/worktree-isolation.ts` | `src/teams/isolation/worktree-isolation.ts` |
| `src/teams/ralph-loop.ts` | `src/teams/loop/ralph-loop.ts` |
| `src/teams/blackboard.ts` | `src/teams/core/blackboard.ts` |
| `src/teams/checkpoint.ts` | `src/teams/core/checkpoint.ts` |
| `src/teams/checkpoint-resume.ts` | `src/teams/core/checkpoint-resume.ts` |
| `src/teams/conflict-detector.ts` | `src/teams/core/conflict-detector.ts` |
| `src/teams/team-run-store.ts` | `src/teams/core/team-run-store.ts` |
| `src/teams/thinking-budget.ts` | `src/teams/core/thinking-budget.ts` |
| `src/teams/benchmark.ts` | `src/teams/testing/benchmark.ts` |
| `src/teams/llm-judge.ts` | `src/teams/testing/llm-judge.ts` |
| `src/teams/fallback.ts` | `src/teams/execution/fallback.ts` |
| `src/teams/progress-file.ts` | `src/teams/execution/progress-file.ts` |
| `src/teams/progress-persistence.ts` | `src/teams/execution/progress-persistence.ts` |
| `src/teams/progress-tracker.ts` | `src/teams/execution/progress-tracker.ts` |
| `src/teams/team-manager.ts` | `src/teams/manager.ts` (compare first) |

### Test Commands

```bash
# Run all tests
npm test

# Run specific test file
npm test src/teams/__tests__/specific.test.ts

# Run with coverage
npm test -- --coverage

# Build
npm run build
```
