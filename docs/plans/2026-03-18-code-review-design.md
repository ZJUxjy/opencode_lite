# Code Review Design

**Date:** 2026-03-18
**Goal:** Quality consolidation — find bugs, bad patterns, and tech debt across the full codebase. Produce a prioritized findings list, then convert to an actionable fix plan.

## Objective

Full-codebase audit of `lite-opencode` (v1.1.0). Output:
1. `docs/plans/2026-03-18-code-review-findings.md` — prioritized problem list
2. `docs/plans/2026-03-18-code-review-impl.md` — executable fix plan (from writing-plans)

## Approach: Layered Risk-Driven Scan

Modules reviewed in four layers, highest risk first.

### Layer 1 — Security / Data Integrity
| File | Focus |
|------|-------|
| `src/tools/bash.ts` | Command injection surface, argument validation, execution isolation |
| `src/policy.ts` + `src/policy/risk.ts` | TODO stubs, rule bypass paths, Plan Mode execution boundary |
| `src/db.ts` | Path normalization bug, WAL config, connection lifecycle |
| `src/store.ts` + `src/session/store.ts` | SQL injection, transaction boundaries, schema migration |
| `src/mcp/connection.ts` + `src/mcp/tools.ts` | External tool execution surface, argument deserialization, error isolation |

### Layer 2 — Core Logic
| File | Focus |
|------|-------|
| `src/agent.ts` | Concurrency safety, MCP lazy-load race condition, error propagation |
| `src/react/parser.ts` + `fc-runner.ts` + `cot-runner.ts` | State machine robustness, streaming parse edge cases |
| `src/compression.ts` | Zero test coverage, compression failure recovery |
| `src/loopDetection.ts` | Zero test coverage, confidence calculation boundaries |
| `src/subagent/manager.ts` + `runner.ts` | Concurrency limit, timeout handling, resource cleanup |

### Layer 3 — Integration Layer
`src/providers/`, `src/session/`, `src/teams/`, `src/skills/`, `src/plan/`

### Layer 4 — Peripheral
`src/App.tsx`, `src/commands/builtins.ts`, remaining tool files

## Severity Scale

| Level | Criteria |
|-------|----------|
| 🔴 Critical | Data loss, security vulnerability, or crash |
| 🟠 High | Logic error or severe tech debt affecting core reliability |
| 🟡 Medium | Quality issue that may fail at boundary conditions |
| 🔵 Low | Style/maintainability, no runtime impact |

## Finding Format

```
[Level] file:line — brief description
Reason: why this is a problem
Risk: what could happen if unfixed
Fix: one-line fix direction
```

## Context Gathered (Pre-scan)

Already identified during brainstorming exploration:
- `compression.ts` and `loopDetection.ts` have zero test coverage
- 64 explicit `any` usages across source (tools use `error: any` vs `unknown`)
- 2 TODO stubs in `policy.ts` (learning rules load/save never implemented)
- `teams/core/team-run-store.ts` opens its own DB instead of using `DatabaseManager` singleton
- `db.ts` uses string concatenation for path normalization instead of `path.resolve()`
- `process.env.PLAN_MODE_MODEL` defaults to `"claude-opus-4"` (possibly wrong model name)
