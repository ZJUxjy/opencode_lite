# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Run Commands

```bash
# Build
npm run build          # tsc -> outputs to ./dist/

# Run
npm run start          # node dist/index.js
node dist/index.js     # direct execution

# Development
npm run dev            # tsx src/index.tsx (uncompiled, for quick testing)

# Test
npm run test           # vitest run
npm run test:watch     # vitest watch mode

# CLI Options
node dist/index.js --help
node dist/index.js -m <model> --base-url <url> -d <working-directory>

# Session Management
node dist/index.js --list-sessions                    # List all sessions
node dist/index.js --resume                           # Resume latest session
node dist/index.js --resume <session-id>              # Resume specific session
node dist/index.js --continue                         # Continue last session for current directory
node dist/index.js --session <id>                     # Use/create specific session ID

# Advanced Options
node dist/index.js --no-stream                        # Disable streaming output
node dist/index.js --compression-threshold <0-1>      # Set context compression threshold (default: 0.92)
```

## Architecture

This is a lightweight AI coding agent implementing the ReAct (Reasoning + Acting) pattern with dual strategy support.

### Core Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         Agent (agent.ts)                         │
│  - Session management                                             │
│  - Context compression                                            │
│  - Loop detection integration                                     │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│                    ReActRunner (react/runner.ts)                 │
│  - Strategy selection based on model capabilities                │
│  - FC_CAPABLE_MODELS: claude, gpt-4, gemini, qwen, deepseek,    │
│    glm-4, minimax, doubao, yi, moonshot, kimi                   │
└─────────────┬────────────────────────────────┬──────────────────┘
              │                                │
              ▼                                ▼
┌─────────────────────────┐      ┌─────────────────────────────────┐
│  FCRunner (fc-runner)   │      │   CoTRunner (cot-runner)        │
│  - Native tool calling  │      │   - ReAct Prompt format         │
│  - Uses model's FC API  │      │   - Thought/Action/Observation  │
└─────────────────────────┘      │   - ReActParser (streaming)     │
                                 └─────────────────────────────────┘
```

### Key Components

| File/Directory | Purpose |
|----------------|---------|
| `src/agent.ts` | Core Agent class, session management, integrates all components |
| `src/llm.ts` | LLM client using Vercel AI SDK, supports Anthropic/OpenAI-compatible APIs |
| `src/store.ts` | Message persistence using better-sqlite3 |
| `src/session/` | Session management (create, resume, list, archive) |
| `src/compression.ts` | Progressive context compression (light → moderate → aggressive) |
| `src/loopDetection.ts` | Three-layer loop detection (tool calls, content repetition, LLM-assisted) |
| `src/policy.ts` | Policy engine for permission control |
| `src/mcp/` | Model Context Protocol integration for external tools |
| `src/App.tsx` | Ink-based TUI with Static/dynamic separation for proper scrolling |
| `src/index.tsx` | CLI entry point with commander |

### ReAct System (`src/react/`)

| File | Purpose |
|------|---------|
| `runner.ts` | Strategy router, selects FC or CoT based on model |
| `fc-runner.ts` | Function Calling mode implementation |
| `cot-runner.ts` | Chain-of-Thought mode with ReAct prompt |
| `parser.ts` | Streaming ReAct output parser (Thought/Action/Observation) |
| `scratchpad.ts` | Thought process management |
| `persistence.ts` | Thought persistence to SQLite |

### Prompt System (`src/prompts/`)

10 sections assembled by `PromptProvider`:

1. **identity** - Agent identity (Lite OpenCode)
2. **objectives** - Task objectives
3. **environment** - Working directory, platform, date
4. **tools** - Tool usage guidelines
5. **workflow** - Work process guidelines
6. **skills** - Active skills injection (conditional)
7. **memory** - Context management guidance
8. **errorHandling** - Error handling guidelines
9. **constraints** - Behavior constraints
10. **react** - ReAct format (conditional, CoT mode only)

### TUI Architecture (`src/App.tsx`)

```
App (Main Container)
├── Static (Message History) - Scrolls with terminal
│   └── MessageItem (stable IDs: msg-${timestamp}-${counter}-${random})
├── Dynamic Section (Streaming output)
│   ├── Reasoning display (💭)
│   ├── Streaming text with cursor (▌)
│   └── Tool call display (🔧)
├── Separator Line (terminal width)
└── Bottom Section
    ├── Status Bar (Context %: green<80%, yellow 80-92%, red>92%)
    └── Input Box
```

Key TUI techniques:
- **Static/Dynamic separation**: Completed messages go to Static component for proper scrolling
- **Ref + throttling**: Streaming text uses `useRef` with 150ms batched updates to reduce re-renders
- **Stable keys**: Messages use unique IDs, not array indices

### Tools (`src/tools/`)

11 built-in tools:
- **File**: `read`, `write`, `edit`, `grep`, `glob`
- **System**: `bash`
- **Plan Mode**: `enter_plan_mode`, `exit_plan_mode`, `task`, `get_subagent_result`, `parallel_explore`
- **Skills**: `list_skills`, `activate_skill`, `deactivate_skill`, `show_skill`, `get_active_skills_prompt`

### Skills System (`src/skills/`)

Markdown-based capability system with YAML frontmatter:

```
skills/
├── git/SKILL.md              # Git best practices
├── code-review/SKILL.md      # Code review guidelines
├── tdd/SKILL.md              # Test-driven development
├── react/SKILL.md            # React development (auto-activate)
├── nodejs/SKILL.md           # Node.js backend (auto-activate)
├── documentation/SKILL.md    # Documentation writing
└── _template/SKILL.md        # Template for new skills
```

**Skill format**:
```markdown
---
id: builtin:git
name: Git Expert
description: Best practices for Git operations
version: "1.0.0"
activation: manual
tags: [git, version-control]
---

# Git Operations Guidelines
...
```

**Key Classes**:
- `SkillLoader` - Load and parse SKILL.md files
- `SkillRegistry` - Manage skill lifecycle and activation
- `skillsSection` - Prompt integration

**Activation strategies**:
- `auto` - Auto-activate based on file patterns/keywords
- `manual` - User activates via `activate_skill` tool or `/skills` command
- `always` - Always active when loaded

### Configuration

Config loaded from `settings.json` (search order):
1. Current working directory
2. Project root (relative to executable)
3. `~/.lite-opencode/settings.json`

```json
{
  "env": {
    "ANTHROPIC_API_KEY": "...",
    "ANTHROPIC_BASE_URL": "...",
    "ANTHROPIC_MODEL": "...",
    "API_TIMEOUT_MS": "120000"
  },
  "mcp": {
    "servers": {
      "server-name": {
        "command": "node",
        "args": ["path/to/server.js"],
        "env": {}
      }
    }
  }
}
```

**Priority**: CLI arguments > settings.json > environment variables > defaults

### Session Management

Sessions are stored in `~/.lite-opencode/history.db` with metadata:
- **Session ID**: Unique identifier (auto-generated or user-specified)
- **Working directory**: Associated cwd for each session
- **Title**: Auto-generated from first user message
- **Message count**: Number of messages in session
- **Timestamps**: Created/updated times
- **Archive status**: Sessions can be archived

**Session resolution priority**:
1. `--resume <id>` - Resume specific session
2. `--resume` - Resume latest session
3. `--continue` - Continue last session for current directory
4. `--session <id>` - Use/create specific session
5. New session (auto-generated ID)

### MCP Integration

Model Context Protocol support for external tools via `settings.json`:
- Servers defined in `mcp.servers` configuration
- Each server runs as a subprocess with stdio communication
- Tools from MCP servers are automatically registered and available to the agent
- See `src/mcp/` for implementation details

### Context Management

- Token estimation: ~4 characters per token
- Model context limits in `llm.ts` (Claude: 200K, MiniMax: 1M, etc.)
- Compression triggered at 92% capacity (configurable via `--compression-threshold`)
- Progressive compression: light → moderate → aggressive

### Adding New Tools

1. Create `src/tools/myTool.ts`:

```typescript
import { z } from "zod"
import type { Tool } from "../types.js"

export const myTool: Tool = {
  name: "my_tool",
  description: "Description for LLM",
  parameters: z.object({
    arg1: z.string().describe("Arg description"),
  }),
  execute: async (params, ctx) => {
    return "result string"
  },
}
```

2. Register in `src/tools/index.ts`

## Documentation

- `docs/agent-loop-research.md` - Research on kimi-cli, kilocode, gemini-cli ReAct implementations
- `docs/react-development-plan.md` - ReAct system development phases and future plans
- `docs/modular-prompt-research.md` - Modular prompt system design
- `docs/hook-system-design.md` - Hook system design for future implementation
- `docs/dify-architecture-deep-dive.md` - Dify architecture analysis
- `docs/agent-architecture-research.md` - Agent architecture research
- `docs/skills-system-design.md` - Skills system design and implementation
- `docs/session-restoration-plan.md` - Session restoration feature documentation
- `docs/debugging-guide.md` - VS Code debugging configuration and tips
