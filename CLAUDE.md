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

# Token Management
node dist/index.js config set-token <provider> <key>  # Store API key securely
node dist/index.js config list-tokens                 # List stored tokens
node dist/index.js config delete-token <provider>     # Delete a stored token
```

### Token Management

API keys can be stored securely using system keyring (macOS Keychain, Windows Credential Manager, Linux Secret Service) or encrypted file storage.

**Set a token:**
```bash
lite-opencode config set-token anthropic sk-ant-xxxxx
lite-opencode config set-token openai sk-xxxxx
```

**List stored tokens:**
```bash
lite-opencode config list-tokens
```

**Delete a token:**
```bash
lite-opencode config delete-token anthropic
```

**Use in settings.json:**
Tokens stored securely take precedence over settings.json values.

```json
{
  "env": {
    // These will be overridden by secure tokens if present
    "ANTHROPIC_API_KEY": "..."
  }
}
```

### Provider Configuration

Configure LLM providers interactively:

```bash
# Interactive configuration wizard
lite-opencode config

# List all configured providers
lite-opencode config list

# Switch default provider
lite-opencode config switch anthropic

# Show provider details
lite-opencode config show [provider]
```

**In-session tools:**

```
show_config                        # Show current configuration
switch_provider provider="openai"  # Switch provider (auto-saves)
switch_model model="gpt-4o"        # Switch model (auto-saves)
list_models provider="openai"      # List available models
```

**Configuration files:**
- `~/.lite-opencode/providers.json` - Provider configurations (non-sensitive)
- API keys stored securely in system keyring or encrypted file

**Supported providers:**
| Provider | Default Model | Protocol |
|----------|---------------|----------|
| Anthropic | claude-sonnet-4-6 | anthropic |
| OpenAI | gpt-4o | openai |
| Gemini | gemini-2.0-flash | google |
| DeepSeek | deepseek-chat | anthropic (compatible) |
| MiniMax | MiniMax-Text-01 | anthropic (compatible) |
| Kimi | moonshot-v1-128k | anthropic (compatible) |

**Configuration priority:** CLI args > ProviderService > settings.json > env vars > defaults

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
| `src/policy/risk.ts` | Risk level classification (low/medium/high) for tools |
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

### Message System (`src/messages/`)

Messages are organized with types, metadata, and filtering:

**Message Types:**
- `text` - Regular text message
- `tool_call` - Tool invocation
- `tool_result` - Tool execution result
- `reasoning` - Chain of thought
- `error` - Error message
- `notification` - System notification

**Color Coding:**
| Type | Border | Background |
|------|--------|------------|
| text | gray | transparent |
| tool_call | blue | #1a1a2e |
| tool_result | green | #0a1a0a |
| reasoning | yellow | #1a1a0a |
| error | red | #1a0a0a |
| notification | cyan | #0a1a1a |

**Keyboard Shortcuts:**
- `Ctrl+E`: Expand all message groups
- `Ctrl+O`: Collapse all message groups
- `Ctrl+H`: Toggle system message visibility
- `Ctrl+C`: Exit application
- `Escape`: Cancel ongoing request

**Message Filter Tool:**
```
filter_messages mode="show_all"       # Show all messages
filter_messages mode="hide_system"    # Hide system/tool messages
filter_messages mode="show_errors_only" # Only show errors
filter_messages mode="compact"        # Collapse all groups
```

### Tools (`src/tools/`)

12 built-in tools:
- **File**: `read`, `write`, `edit`, `grep`, `glob`
- **System**: `bash`
- **Plan Mode**: `enter_plan_mode`, `exit_plan_mode`, `task`, `get_subagent_result`, `parallel_explore`
- **Skills**: `list_skills`, `activate_skill`, `deactivate_skill`, `show_skill`, `get_active_skills_prompt`
- **UI**: `filter_messages`

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

**Skills Hot Reload**:

Skills can be reloaded automatically when their SKILL.md files change:

Enable hot reload:
```
/skills watch
```

Manual reload:
```
reload_skill id="builtin:git"
```

When hot reload is enabled:
- Changes to SKILL.md are automatically detected
- Skills are reloaded with preserved activation state
- UI shows notification when skills are reloaded
- 300ms debounce prevents excessive reloads

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

### Risk-Based Approval

The policy engine supports three risk levels for tool operations:

| Risk Level | Tools | Behavior |
|------------|-------|----------|
| **Low** | read, glob, grep, list_skills, show_skill, get_active_skills_prompt, web_search, get_subagent_result | Auto-approved by default |
| **Medium** | write, edit, activate_skill, deactivate_skill, enter_plan_mode, exit_plan_mode | Prompts for approval |
| **High** | bash, task, parallel_explore, mcp_* | Prompts for approval |

**Configure in `settings.json`:**

```json
{
  "policy": {
    "risk": {
      "autoApprove": ["low"],
      "promptApprove": ["medium", "high"],
      "deny": []
    }
  }
}
```

**Configuration options:**
- `autoApprove`: Risk levels that are automatically approved without prompting
- `promptApprove`: Risk levels that require user confirmation
- `deny`: Risk levels that are always denied

**UI Display:**
When a permission prompt appears, the risk level is shown with:
- ✓ GREEN for low risk operations
- ! YELLOW for medium risk operations
- ⚠ RED for high risk operations

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

### MCP Status Monitoring

Monitor MCP (Model Context Protocol) server health and usage:

**CLI commands:**
```bash
lite-opencode mcp status              # Show all servers status
lite-opencode mcp status <server>     # Show specific server
lite-opencode mcp diagnose            # Diagnose all servers
lite-opencode mcp diagnose <server>   # Diagnose specific server
```

**Using tools in session:**
```
mcp_status                    # Show all servers
mcp_status server="my-mcp"    # Show specific server
mcp_diagnose                  # Diagnose all servers
mcp_diagnose server="my-mcp"  # Diagnose specific server
```

**Status indicators:**
- 🟢 Connected and healthy
- ⚠️ Connected but degraded (high error rate > 50%)
- 🔴 Disconnected or unhealthy

**Statistics tracked:**
- Total calls per server
- Success/failure rates
- Average response time
- Recent errors

**Status bar display:**
- `🔌 MCP 2/2` - All servers connected and healthy
- `⚠ MCP 1/2 (1 degraded)` - Some servers have high error rate
- `🔴 MCP 1/2` - Some servers disconnected

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
