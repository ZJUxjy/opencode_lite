# Code Review Findings

**Date:** 2026-03-18
**Reviewer:** Claude Sonnet 4.6
**Codebase:** lite-opencode v1.1.0
**Total issues:** 29 (Critical: 2, High: 6, Medium: 11, Low: 10)

---

## 🔴 Critical

### [CR-1] `src/subagent/manager.ts:389` — SubagentManager uses stub execution, returns fake data

**Reason:** `simulateExecution()` always returns a hardcoded fake string instead of running a real Agent. Every call to `task` / `parallel_explore` tools silently returns simulated output.

**Risk:** The entire subagent feature is non-functional. Users believe plan-mode tasks are executing real code analysis; they are receiving fabricated results. No error or warning is surfaced.

**Fix:** Replace `simulateExecution()` with a `SubagentRunner.execute()` call. Wire the `SubagentManager` to `SubagentRunner` or remove `SubagentManager.execute()` and route all execution through `SubagentRunner`.

---

### [CR-2] `src/subagent/runner.ts:135` — `runWithLimits()` is dead code; turn limits never enforced

**Reason:** `runWithLimits()` is defined but never called from `execute()`. The method simply delegates to `agent.run(objective)` without implementing turn counting or timer-based interruption. `DeadlineTimer` is started but never connected to `agent.abort()`.

**Risk:** Subagents can run indefinitely regardless of the configured `maxTurns`/`maxTimeMs`. Cost overruns and hangs are possible in production.

**Fix:** In `execute()`, replace the bare `agent.run(objective)` call with a `Promise.race()` between the agent and the `DeadlineTimer`, and invoke `agent.abort()` on timeout. The `turnCount` variable is also always 0 — increment it each time the agent loop iterates.

---

## 🟠 High

### [CR-3] `src/policy.ts:203-222` — Unknown (non-builtin) tool names silently auto-allowed

**Reason:** The guard at lines 203-222 checks `!builtinTools.includes(toolName)` and, if true, immediately returns `allow` when matching the `mcp_*` rule. Any tool name that isn't in the hard-coded `builtinTools` array (e.g., a future built-in, or a typo) bypasses all permission checks and is auto-approved.

**Risk:** A malicious or misbehaving LLM could hallucinate a non-existent tool name that silently gets "allowed", potentially executing unregistered code paths or confusing downstream logic.

**Fix:** Remove the early-return MCP shortcut from `check()`. Let MCP tools fall through to normal rule-matching via the `mcp_*` wildcard at line 155. The result is identical for legitimate MCP tools and closes the bypass.

---

### [CR-4] `src/policy.ts:510,519` — `loadLearnedRules`/`saveLearnedRules` are TODO stubs

**Reason:** Both methods are empty. Learned "Always Allow" rules live only in memory and are lost when the process exits or when `clearLearnedRules()` is called (e.g., on session clear). The config and docs imply persistence.

**Risk:** Users who click "Always Allow" believe they won't be prompted again for future sessions. They will be. This erodes trust. Worse, the dead-letter `learnedRulesPath` config field creates false confidence that a file-based allowlist exists.

**Fix:** Implement JSON file persistence in `saveLearnedRules()` / `loadLearnedRules()` using `learnedRulesPath` (default `~/.lite-opencode/learned-rules.json`). Alternatively, remove the `enableLearning` config option and document that learning is session-scoped only.

---

### [CR-5] `src/mcp/connection.ts:304` — MCP tool result content is unbounded

**Reason:** `callTool()` passes `result.content` directly to the caller without any size check. A malicious or buggy MCP server can return an arbitrarily large payload that is inserted verbatim into the agent's context window.

**Risk:** Context exhaustion, performance degradation, and potential prompt-injection via oversized tool results.

**Fix:** After the `Promise.race` completes, truncate each `content` item to a maximum size (e.g., 512 KB total across all items). Return a warning annotation when truncation occurs.

---

### [CR-6] `src/mcp/connection.ts:238` — MCP server can shadow built-in tool names

**Reason:** `listTools()` returns tool names exactly as provided by the external server. If a server provides a tool named `bash`, `read`, or `write`, it would be registered under that name and could be called instead of the built-in.

**Risk:** A compromised or malicious MCP server can redirect built-in tool calls to its own implementation, bypassing the policy engine's risk classification.

**Fix:** In `createMCPToolWrapper` or the tool registry registration step, check for name conflicts with built-in tools and either reject the tool or prefix its name (e.g., `mcp_<server>_<name>` is already the convention — verify it is always applied).

---

### [CR-7] `src/subagent/manager.ts:282-288` — Concurrency limit enforced by slice, not live count

**Reason:** `executeParallel()` limits concurrency with `ids.slice(0, this.config.maxConcurrent)`, which caps a single batch but does not check how many subagents are currently running. A second call to `executeParallel` before the first completes bypasses the cap.

**Risk:** More than 3 concurrent subagents can be spawned, causing unexpected resource consumption and potential race conditions on shared state.

**Fix:** In `execute()`, count the number of subagents with `status === "running"` before starting a new one. If the count meets the max, queue or reject the request.

---

### [CR-8] `src/mcp/tools.ts:40` — `new RegExp(schema.pattern)` — ReDoS risk

**Reason:** The `pattern` field from a remote MCP server's JSON Schema is passed directly to `new RegExp()`. A server controlled by an attacker can supply a catastrophically backtracking pattern (e.g., `(a+)+$`).

**Risk:** A single MCP tool schema load can freeze the Node.js event loop for seconds, effectively causing a denial-of-service.

**Fix:** Wrap `new RegExp(schema.pattern)` in a try/catch and enforce a pattern length limit (e.g., 500 chars). Consider using a safe-regex library to pre-validate patterns before compilation.

---

## 🟡 Medium

### [CR-9] `src/db.ts:45` — Path normalization uses `process.cwd()` concatenation instead of `path.resolve()`

**Reason:** `const normalizedPath = dbPath.startsWith('/') ? dbPath : process.cwd() + '/' + dbPath` uses manual string concatenation instead of `path.resolve(dbPath)`. On non-POSIX systems, the separator would be wrong; on any system, `path.resolve` is the idiomatic and correct approach.

**Risk:** Incorrect singleton keying if `process.cwd()` changes between calls (e.g., a `cd` in a bash tool). Two supposedly shared connections would get different keys and open duplicate database handles.

**Fix:** Replace with `const normalizedPath = path.resolve(dbPath)`. Import `resolve` from `"path"` (already imported as `dirname`).

---

### [CR-10] `src/react/fc-runner.ts:182` — FCRunner context missing `setPlanMode`/`setPlanFilePath`

**Reason:** `const ctx: Context = { cwd: this.cwd, messages: [] }` does not include `setPlanMode` or `setPlanFilePath`. The `enter_plan_mode` and `exit_plan_mode` tools call these methods on the context, so they silently become no-ops when FCRunner executes them.

**Risk:** In FC mode (the default for Claude/GPT/Gemini), the `enter_plan_mode` tool appears to succeed but the policy engine's plan mode is never actually engaged. The LLM is told it's in plan mode but write/edit operations are not restricted.

**Fix:** Pass the agent's `setPlanMode` and `setPlanFilePath` callbacks into FCRunner either via the constructor or a `setContext()` method, mirroring what `agent.ts:executeTools` does at lines 337-338.

---

### [CR-11] `src/policy.ts:230` — YOLO mode dangerous pattern regex is bypassable

**Reason:** The "extremely dangerous" guard in YOLO mode only matches a narrow set of patterns: `rm -rf /`, `mkfs`, `dd if=`, and writes to specific `/dev/` paths. Commands like `rm -rf /home/user`, `sudo rm -rf`, `sudo su`, `chmod 777 /etc/sudoers`, or ` > /etc/passwd` are not blocked.

**Risk:** In YOLO mode, a confused LLM can cause serious and irreversible system damage that the user believed was prevented.

**Fix:** Expand the pattern to cover `sudo`, `rm -rf` (any target), `> /etc/`, `chmod.*sudoers`, etc. More robustly: in YOLO mode, never auto-approve `bash` commands that match medium/high risk patterns — always prompt for `bash`, even in YOLO mode.

---

### [CR-12] `src/tools/write.ts:19` / `src/tools/edit.ts:19` — Path traversal outside `ctx.cwd`

**Reason:** Both tools resolve relative paths with `` `${ctx.cwd}/${path}` `` but never verify the resolved path stays within `ctx.cwd`. An LLM-supplied path like `../../.ssh/authorized_keys` resolves outside the working directory.

**Risk:** Arbitrary file write anywhere the process has write permission. An adversarial prompt or confused LLM could overwrite SSH keys, shell profiles, or other sensitive files.

**Fix:** After resolving `fullPath`, verify `fullPath.startsWith(ctx.cwd + path.sep)` and reject paths that escape. Also use `path.join` instead of string template for path construction.

---

### [CR-13] `src/tools/write.ts:24` / `src/tools/edit.ts:34` — Non-atomic file writes

**Reason:** Both tools call `writeFile()` directly on the target path. A process crash or `SIGKILL` during the write leaves a partially written file with no recovery path.

**Risk:** Corrupt source files with no backup or rollback. This is especially dangerous for `edit.ts`, which reads, modifies, and rewrites in place.

**Fix:** Write to `${fullPath}.tmp`, then `rename(tmpPath, fullPath)`. This is atomic on POSIX systems. For `edit.ts`, preserve the original via `rename` before overwrite or keep a `.bak` file.

---

### [CR-14] `src/providers/service.ts:98` — `providers.json` write is not atomic

**Reason:** `writeFileSync(this.filePath, ...)` writes directly to the config file. A crash mid-write corrupts the only copy of provider configuration including API keys.

**Risk:** Users lose all provider configuration on next startup. On migration (`migrateTokensFromV1`), the original encrypted token file has already been renamed to `.backup` before the new config is confirmed written — a crash here loses both copies.

**Fix:** Write to a temp file then `renameSync(tmpPath, this.filePath)`. This is already partially understood in the codebase (the `renameSync` import is present).

---

### [CR-15] `src/llm.ts:119` — Plan Mode model ID `"claude-opus-4"` missing version suffix

**Reason:** `planModel: process.env.PLAN_MODE_MODEL || "claude-opus-4"` uses a model ID that does not match any current Anthropic model. Current IDs follow the pattern `claude-opus-4-5-20251101` or `claude-opus-4-20250514`.

**Risk:** Plan Mode silently uses the wrong model (or fails with an API error), degrading plan quality without any user-visible indication.

**Fix:** Update the default to `"claude-opus-4-5-20251101"` (or the latest stable Opus 4 ID). Add an explicit warning log when the model ID cannot be resolved.

---

### [CR-16] `src/loopDetection.ts:293-314` — `simplifyArgs` uses string-length ranges, causing false positives and negatives

**Reason:** All string arguments are reduced to `"string(N)"` before hashing. Two `bash` calls with completely different commands of the same length are treated as identical (false positive loop). Two identical `bash` calls where the command length differs by even one character are treated as different (false negative).

**Risk:** Real loops in bash tool usage go undetected; legitimate repeated reads of files with the same name-length cause spurious loop termination.

**Fix:** For `bash`, hash the full `command` string. For read/write tools, hash the full `path`. Only normalize large content payloads (e.g., `content` argument for `write`).

---

### [CR-17] `src/teams/core/team-run-store.ts:119` — TeamRunStore bypasses `DatabaseManager` singleton

**Reason:** `TeamRunStore` opens `new Database(dbPath)` directly instead of going through `DatabaseManager.getInstance()`. If the same `dbPath` is used for both the main store and team runs, two independent SQLite connections compete for the WAL file.

**Risk:** WAL conflicts, potential data corruption, `SQLITE_BUSY` errors in high-concurrency team mode.

**Fix:** Either use a dedicated separate DB file path for team runs (document this explicitly), or refactor `TeamRunStore` to use `DatabaseManager.getInstance(dbPath)`.

---

### [CR-18] `src/App.tsx:779` — `error: any` in top-level catch; bypasses type safety

**Reason:** `catch (error: any)` then accesses `error.message` without narrowing. Should use `unknown` and `getErrorMessage()` from `src/utils/error.ts`, which is already used elsewhere in the codebase.

**Risk:** If `error` is not an `Error` object (e.g., a plain string throw), `error.message` is `undefined` and the error silently disappears from the UI.

**Fix:** Change to `catch (error: unknown)` and use `getErrorMessage(error)` already imported in the file.

---

### [CR-19] `src/compression.ts` — CLAUDE.md describes compression as "non-destructive" but implementation is destructive

**Reason:** `tryCompress()` always calls `destructiveCompress()` which deletes middle messages. The method name in the code explicitly says "destructive". However, `CLAUDE.md` (and a now-removed code path) described compression as "non-destructive (marker-vs-delete)".

**Risk:** Users relying on being able to scroll back through history will find messages permanently erased from the database (via `clear()` + re-add in `compactContext()`).

**Fix:** Either implement a non-destructive path that marks messages as compressed but retains them in the DB, or update `CLAUDE.md` and user-facing docs to accurately describe compression as destructive.

---

## 🔵 Low

### [CR-20] `src/db.ts` — Missing `foreign_keys = ON` pragma

**Reason:** better-sqlite3 disables FK enforcement by default. No `PRAGMA foreign_keys = ON` is set.

**Risk:** Low currently (no explicit FK constraints in schema), but any future schema addition relying on FK cascades would silently be ignored.

**Fix:** Add `this.db.pragma('foreign_keys = ON')` in the `DatabaseManager` constructor alongside the existing pragmas.

---

### [CR-21] `src/db.ts` — No `process.on('exit')` handler for DB cleanup

**Reason:** The `DatabaseManager` singleton is never closed at process exit. While SQLite is generally robust to this, WAL files may not be checkpointed.

**Fix:** Add `process.on('exit', () => { for (const mgr of this.instances.values()) mgr.db.close() })` in `DatabaseManager`.

---

### [CR-22] `src/store.ts:56-84` — Message insert and session metadata update not transactional

**Reason:** `add()` first inserts the message, then calls `sessionStore.update()` or `incrementMessageCount()`. If the process dies between the two writes, message count in `sessions` table diverges from actual message count.

**Fix:** Wrap both operations in `this.db.transaction(() => { ... })()`.

---

### [CR-23] `src/react/parser.ts:246,261` — `processChar()` stub; async stream parsing non-functional

**Reason:** `processChar()` returns an empty `ParseResult` with `type: null`. `parseStreamAsync()` yields nothing useful. Any caller relying on `parseStreamAsync` receives no output.

**Fix:** Implement `processChar()` or deprecate `parseStreamAsync()` and document that only `parse()` and `parseStream()` are supported.

---

### [CR-24] `src/loopDetection.ts` — Layer 3 LLM verification context is populated but never consumed

**Reason:** `LoopDetectionResult.verificationContext` is populated when `needsVerification = true`, but no caller in `agent.ts` or `fc-runner.ts` reads this field or calls the LLM for verification. `shouldCheckWithLLM()` is also never called.

**Risk:** Layer 3 detection (LLM-assisted at turn 30+) is completely inactive. Persistent loops beyond turn 30 go unchecked.

**Fix:** In `agent.ts:runWithReAct`, after `incrementTurn()`, check `this.loopDetection.shouldCheckWithLLM()` and perform the verification call when true.

---

### [CR-25] `src/subagent/runner.ts:86,116,128` — `turnCount` always 0 in result

**Reason:** `turnCount` is declared at line 86 and never incremented. All `SubagentRunnerResult` objects report `turnCount: 0`.

**Fix:** Integrate turn counting into the agent event loop (requires access to per-turn callbacks or agent iteration events).

---

### [CR-26] `src/commands/builtins.ts:301` — Fragile private field access `(registry as any)["watcher"]`

**Reason:** The `/skills watch` command checks `!!(registry as any)["watcher"]` to detect whether hot reload is active, bypassing TypeScript's type system.

**Risk:** A rename of the private `watcher` field breaks this silently; TypeScript will not catch it.

**Fix:** Add a public `isHotReloadEnabled(): boolean` method to `SkillRegistry` and use it here.

---

### [CR-27] `src/db.ts:70` — `close()` deletes by `this.dbPath` but map key may differ

**Reason:** The singleton map is keyed by `normalizedPath` (line 47), but `close()` calls `DatabaseManager.instances.delete(this.dbPath)`. Since `this.dbPath = dbPath` in the constructor (where `dbPath` is already the `normalizedPath`), these are the same value. However, this is fragile — if the constructor assignment ever uses the un-normalized path, the map delete would silently fail and leak the instance.

**Fix:** Store and use a `private readonly normalizedPath: string` field; key the map and the `delete` on this single field.

---

### [CR-28] Multiple files — `error: any` should be `error: unknown`

**Reason:** `bash.ts:33`, `write.ts:26`, `edit.ts:37`, and `subagent/manager.ts:262` all use `catch (error: any)`. The utility `getErrorMessage()` in `src/utils/error.ts` already handles the `unknown` narrowing.

**Fix:** Replace all `catch (error: any)` with `catch (error: unknown)` and use `getErrorMessage(error)` for the message string.

---

### [CR-29] `src/llm.ts` — `DEBUG_LLM` check scattered across 8+ call sites

**Reason:** `if (process.env.DEBUG_LLM === "1")` is repeated inline rather than behind a module-level boolean constant.

**Risk:** Cosmetic only, but makes it easy to miss a debug log that should be removed before a release.

**Fix:** Add `const DEBUG = process.env.DEBUG_LLM === "1"` at module top and replace all inline checks.

---

## Summary Table

| ID | Severity | Area | File | Quick Fix |
|----|----------|------|------|-----------|
| CR-1 | 🔴 Critical | Core Logic | `subagent/manager.ts:389` | Wire to real Agent execution |
| CR-2 | 🔴 Critical | Core Logic | `subagent/runner.ts:135` | Implement turn limits + abort |
| CR-3 | 🟠 High | Security | `policy.ts:203` | Remove mcp_* shortcut bypass |
| CR-4 | 🟠 High | Security | `policy.ts:510,519` | Implement file persistence |
| CR-5 | 🟠 High | Security | `mcp/connection.ts:304` | Bound result content size |
| CR-6 | 🟠 High | Security | `mcp/connection.ts:238` | Reject shadowed built-in names |
| CR-7 | 🟠 High | Core Logic | `subagent/manager.ts:282` | Check live running count |
| CR-8 | 🟠 High | Security | `mcp/tools.ts:40` | Validate/limit regex patterns |
| CR-9 | 🟡 Medium | Data Integrity | `db.ts:45` | Use `path.resolve()` |
| CR-10 | 🟡 Medium | Core Logic | `react/fc-runner.ts:182` | Pass plan callbacks to context |
| CR-11 | 🟡 Medium | Security | `policy.ts:230` | Expand YOLO dangerous patterns |
| CR-12 | 🟡 Medium | Security | `tools/write.ts:19`, `edit.ts:19` | Check cwd boundary |
| CR-13 | 🟡 Medium | Data Integrity | `tools/write.ts:24`, `edit.ts:34` | Atomic temp-rename writes |
| CR-14 | 🟡 Medium | Data Integrity | `providers/service.ts:98` | Atomic temp-rename writes |
| CR-15 | 🟡 Medium | Core Logic | `llm.ts:119` | Fix model ID version suffix |
| CR-16 | 🟡 Medium | Core Logic | `loopDetection.ts:293` | Hash full strings for bash/read |
| CR-17 | 🟡 Medium | Data Integrity | `teams/core/team-run-store.ts:119` | Use `DatabaseManager` singleton |
| CR-18 | 🟡 Medium | Peripheral | `App.tsx:779` | `unknown` + `getErrorMessage` |
| CR-19 | 🟡 Medium | Core Logic | `compression.ts` | Fix docs or implement non-destructive |
| CR-20 | 🔵 Low | Data Integrity | `db.ts` | Add `foreign_keys = ON` pragma |
| CR-21 | 🔵 Low | Data Integrity | `db.ts` | Add `process.on('exit')` handler |
| CR-22 | 🔵 Low | Data Integrity | `store.ts:56` | Wrap in transaction |
| CR-23 | 🔵 Low | Core Logic | `react/parser.ts:246` | Implement or deprecate `processChar` |
| CR-24 | 🔵 Low | Core Logic | `loopDetection.ts` | Wire Layer 3 LLM verification |
| CR-25 | 🔵 Low | Core Logic | `subagent/runner.ts:86` | Implement turn counting |
| CR-26 | 🔵 Low | Peripheral | `commands/builtins.ts:301` | Add public `isHotReloadEnabled()` |
| CR-27 | 🔵 Low | Data Integrity | `db.ts:70` | Use stored `normalizedPath` for delete |
| CR-28 | 🔵 Low | Peripheral | Multiple | Replace `error: any` with `unknown` |
| CR-29 | 🔵 Low | Peripheral | `llm.ts` | Extract `DEBUG` constant |
