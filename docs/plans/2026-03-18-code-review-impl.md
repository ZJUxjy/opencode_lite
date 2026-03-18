# Code Review Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Conduct a full layered code review of lite-opencode, produce a prioritized findings list, and commit it to `docs/plans/2026-03-18-code-review-findings.md`.

**Architecture:** Four-layer risk-driven scan (Security → Core Logic → Integration → Peripheral). Each layer produces findings in a standard format. All findings are consolidated at the end into a single sorted document.

**Tech Stack:** TypeScript, Node.js, better-sqlite3, Vercel AI SDK, Ink/React TUI, Vitest, Zod, MCP SDK.

---

## Task 1: Layer 1 — Security / Data Integrity Review

**Files:**
- Read: `src/tools/bash.ts`
- Read: `src/policy.ts`
- Read: `src/policy/risk.ts`
- Read: `src/db.ts`
- Read: `src/store.ts`
- Read: `src/session/store.ts`
- Read: `src/mcp/connection.ts`
- Read: `src/mcp/tools.ts`
- Write findings to: scratch notes (accumulate for Task 5)

**Step 1: Review `src/tools/bash.ts`**

Read the full file. Check for:
- Does it sanitize or quote shell arguments before execution?
- Does it enforce a working-directory boundary (`cwd` option passed to `exec`)?
- Does it cap execution time with a timeout?
- Does it prevent `sudo`, network commands, or destructive patterns?
- Is the stderr/stdout output size bounded?

**Step 2: Review `src/policy.ts` + `src/policy/risk.ts`**

Read both files fully. Check for:
- Lines 511 and 519: TODO stubs for learning-rules load/save — are they dead code that create false confidence?
- Can Plan Mode be bypassed? Trace the `isPlanMode` flag path from `setPlanMode()` through to actual enforcement.
- Is `yoloMode` (auto-approve all) guarded against accidental activation?
- Can a high-risk tool be re-classified as low-risk via `customRiskRules` without validation?

**Step 3: Review `src/db.ts`**

Read the full file. Check for:
- Line 45: `process.cwd() + '/' + dbPath` — should be `path.resolve(dbPath)`. Does this cause incorrect singleton keying?
- Is `close()` ever called on the singleton? What happens at process exit?
- Is the singleton map ever cleared (memory leak in long-running processes)?
- Is `foreign_keys = ON` pragma set? (better-sqlite3 disables FK enforcement by default)

**Step 4: Review `src/store.ts` and `src/session/store.ts`**

Read both files. Check for:
- All SQL queries: are user-supplied values parameterized (no string interpolation into SQL)?
- Are multi-step writes wrapped in transactions?
- Is there a schema migration strategy, or is it append-only DDL?

**Step 5: Review `src/mcp/connection.ts` and `src/mcp/tools.ts`**

Read both files. Check for:
- In `mcp/tools.ts`: `jsonSchemaToZod` receives `schema: any` — is the output schema validated before being used?
- In `mcp/connection.ts`: tool results from external servers — are they size-bounded before being put into context?
- Is the reconnect timer (`reconnectTimer`) always cleared on `close()`?
- Can a malicious MCP server inject tool names that shadow built-in tools?

**Step 6: Record Layer 1 findings** in the scratch format:
```
[Level] file:line — description
Reason: ...
Risk: ...
Fix: ...
```

---

## Task 2: Layer 2 — Core Logic Review

**Files:**
- Read: `src/agent.ts` (full file)
- Read: `src/react/parser.ts` (full file)
- Read: `src/react/fc-runner.ts`
- Read: `src/react/cot-runner.ts`
- Read: `src/react/runner.ts`
- Read: `src/compression.ts` (full file)
- Read: `src/loopDetection.ts` (full file)
- Read: `src/subagent/manager.ts`
- Read: `src/subagent/runner.ts`

**Step 1: Review `src/agent.ts`**

Check for:
- MCP lazy-load race: `mcpInitializing` flag — is it checked atomically? Can two concurrent `send()` calls both pass the `!mcpInitialized && !mcpInitializing` guard before either sets `mcpInitializing = true`?
- Session ID ownership: is `_sessionId` ever mutated after construction?
- Error propagation: do all error paths in the main loop surface to the caller, or are some silently swallowed?
- `setPlanMode` and `setPlanFilePath` on Context — are these set before the first tool call, or could there be a window where they're undefined?

**Step 2: Review `src/react/parser.ts`**

Check for:
- State machine reset: is `reset()` called between turns? What happens if two turns run without reset?
- Nested brace counter (`braceCount`) — does it handle escaped braces or strings containing `{}`?
- What happens when the stream ends mid-JSON (incomplete action)?
- `json: any` in `JsonExtraction` — is the result narrowed before use?

**Step 3: Review `src/react/fc-runner.ts` and `cot-runner.ts`**

Check for:
- Token limit handling: what happens if the model returns a response that exceeds the context?
- Do both runners emit identical event shapes, or are there inconsistencies that could confuse `agent.ts`?
- In `cot-runner.ts`: is the ReAct prompt injected once or every turn?

**Step 4: Review `src/compression.ts`**

Check for:
- Zero test coverage — what are the critical invariants that MUST hold? (e.g., system message always preserved, most recent N messages always preserved)
- What happens if the LLM summary call fails? Is there a fallback?
- Is the "non-destructive" compression actually non-destructive? Verify the marker-vs-delete claim.
- Can compression be triggered recursively (compression call triggers another compression)?

**Step 5: Review `src/loopDetection.ts`**

Check for:
- Zero test coverage — what are the false-positive risk scenarios?
- Layer 1 (tool call): is the "same call" comparison deep-equal or reference-equal?
- Layer 2 (content): sliding window over what data structure? Thread-safe?
- Layer 3 (LLM-assisted): the LLM call for verification — what happens if it times out or errors?

**Step 6: Review `src/subagent/manager.ts` and `runner.ts`**

Check for:
- Is the concurrency limit (max 3) enforced atomically?
- What happens to a running subagent if the parent agent is interrupted (Escape key)?
- Are subagent processes cleaned up on timeout, or do they leak?
- `DeadlineTimer` — is it always cancelled on normal completion?

**Step 7: Record Layer 2 findings.**

---

## Task 3: Layer 3 — Integration Layer Review

**Files:**
- Read: `src/providers/service.ts`
- Read: `src/providers/registry.ts`
- Read: `src/session/store.ts` (if not fully covered in Task 1)
- Read: `src/teams/core/team-run-store.ts`
- Read: `src/teams/modes/leader-workers.ts`
- Read: `src/teams/modes/worker-reviewer.ts`
- Read: `src/skills/registry.ts`
- Read: `src/skills/loader.ts`
- Read: `src/plan/manager.ts`

**Step 1: Review `src/providers/service.ts`**

Check for:
- API key storage: is the key ever logged or included in error messages?
- Config file write: is it atomic (write to temp then rename), or can a crash corrupt the config?
- Backup logic at line 323: does the backup path prevent overwriting good data?

**Step 2: Review `src/teams/core/team-run-store.ts`**

Check for:
- Opens its own `new Database(dbPath)` — bypasses `DatabaseManager` singleton. Can this cause WAL conflicts if the main DB and teams DB share a path?
- Is this intentional (separate DB file) or an oversight?

**Step 3: Review `src/skills/registry.ts` and `loader.ts`**

Check for:
- SKILL.md from arbitrary paths — is there path traversal risk when loading external skills?
- Hot-reload watcher: is the debounce (300ms) actually applied, or can rapid file changes queue unbounded reloads?
- Activation state preserved across hot-reload — is this implemented correctly?

**Step 4: Review `src/plan/manager.ts`**

Check for:
- Plan file path: is it validated to be within the working directory (prevent writes outside cwd)?
- `isPlanModeEnabledCurrent()` — is this a module-level singleton safe for concurrent use?

**Step 5: Record Layer 3 findings.**

---

## Task 4: Layer 4 — Peripheral Review

**Files:**
- Read: `src/App.tsx` (focus on event handlers and timers)
- Read: `src/commands/builtins.ts`
- Read: `src/tools/bash.ts` (if not fully covered in Task 1)
- Read: `src/tools/write.ts`
- Read: `src/tools/edit.ts`
- Read: `src/llm.ts` (focus on env var usage and model routing)

**Step 1: Review `src/App.tsx`**

Check for:
- `setInterval` for display throttle (line 606): is it cleared in the cleanup return of `useEffect`?
- Two `setTimeout` calls (lines 533, 543): could these fire after component unmount?
- `process.exit(0)` called directly from render handlers — is there a graceful shutdown sequence?
- `error: any` at line 779 — should use `unknown` + `getErrorMessage`.

**Step 2: Review `src/commands/builtins.ts`**

Check for:
- Line 101: `t.parameters as any` — is there a safer way to inspect tool schema?
- Line 301: `registry as any` to check `watcher` property — fragile private field access.
- Line 231: `error: any` catch — should use `unknown`.

**Step 3: Review `src/llm.ts`**

Check for:
- Line 119: `process.env.PLAN_MODE_MODEL || "claude-opus-4"` — `"claude-opus-4"` appears to be missing the version suffix (should likely be `"claude-opus-4-5"` or similar). Verify against current model names.
- `DEBUG_LLM` scattered across 8 locations — should these be consolidated?
- Model context limit map: is it kept up-to-date with new model releases?

**Step 4: Review `src/tools/write.ts` and `src/tools/edit.ts`**

Check for:
- Path traversal: can these write outside `ctx.cwd`?
- Atomic writes: does `write.ts` use temp-file-then-rename, or direct overwrite (risk of partial write on crash)?

**Step 5: Record Layer 4 findings.**

---

## Task 5: Compile and Prioritize All Findings

**File to create:** `docs/plans/2026-03-18-code-review-findings.md`

**Step 1: Aggregate** all findings from Tasks 1–4 into one list.

**Step 2: Sort** by severity: 🔴 Critical → 🟠 High → 🟡 Medium → 🔵 Low.

**Step 3: Within each severity**, sort by impact area: Security > Data Integrity > Core Logic > Integration > Peripheral.

**Step 4: Write** the findings document using this template:

```markdown
# Code Review Findings

**Date:** 2026-03-18
**Reviewer:** Claude Sonnet 4.6
**Codebase:** lite-opencode v1.1.0
**Total issues:** N (Critical: X, High: Y, Medium: Z, Low: W)

---

## 🔴 Critical

### [CR-1] file:line — title
**Reason:** ...
**Risk:** ...
**Fix:** ...

---

## 🟠 High
...

## 🟡 Medium
...

## 🔵 Low
...
```

**Step 5: Commit** the findings:
```bash
git add docs/plans/2026-03-18-code-review-findings.md
git commit -m "docs: add code review findings for lite-opencode v1.1.0"
```

---

## Task 6: Execution Handoff

After findings doc is committed, present the two execution options (per writing-plans skill):

1. **Subagent-Driven** — dispatch a fresh subagent per fix group, review between batches
2. **Parallel Session** — open new session with executing-plans skill for batch execution

---

## Notes

- Run `node --version` and verify build before any fixes: `node dist/index.js --help`
- All fixes should have a corresponding test added or updated
- Commit after each fix group (don't batch unrelated changes)
- Reference `src/utils/error.ts:getErrorMessage` for all `error: any` → `unknown` conversions
- The `path.resolve()` fix in `db.ts` must be verified not to break the singleton keying logic
