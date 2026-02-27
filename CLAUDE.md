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
npm run dev            # tsx src/index.ts (uncompiled, for quick testing)

# CLI Options
node dist/index.js --help
node dist/index.js -m <model> --base-url <url> -d <working-directory>
node dist/index.js --list-sessions
```

## Architecture

This is a lightweight AI coding agent implementing the ReAct (Reasoning + Acting) pattern.

### Core Loop (agent.ts)

```
User Input → LLM Call → Parse Response → Tool Execution → Loop until no tools
```

The `Agent.run()` method implements the main loop:
1. Add user message to history
2. Load messages from SQLite store
3. Compress context if approaching token limit
4. Loop: call LLM → check for tool calls → execute tools → add results → repeat
5. Return when no tool calls

### Key Components

| File | Purpose |
|------|---------|
| `src/agent.ts` | Core Agent class with ReAct loop, integrates LLM + tools + storage |
| `src/llm.ts` | LLM client wrapper using Vercel AI SDK, supports Anthropic/OpenAI-compatible APIs |
| `src/store.ts` | Message persistence using better-sqlite3 |
| `src/loopDetection.ts` | Three-layer loop detection (tool calls, content repetition, LLM-assisted) |
| `src/tools/*.ts` | 6 built-in tools: bash, read, write, edit, grep, glob |
| `src/App.tsx` | Ink-based TUI with streaming output |
| `src/index.tsx` | CLI entry point with commander |

### Data Flow

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  index.tsx  │───▶│   App.tsx   │───▶│   Agent     │
│  (CLI)      │    │   (TUI)     │    │   (Loop)    │
└─────────────┘    └─────────────┘    └──────┬──────┘
                                             │
                    ┌────────────────────────┼────────────────────────┐
                    ▼                        ▼                        ▼
             ┌───────────┐           ┌───────────┐           ┌───────────┐
             │  LLMClient│           │ToolRegistry│          │MessageStore│
             │  (llm.ts) │           │ (tools/)   │          │ (store.ts) │
             └───────────┘           └───────────┘           └───────────┘
```

### Configuration

The project reads configuration from `/home/xjingyao/code/opencode_lite/settings.json`:

```json
{
  "ANTHROPIC_API_KEY": "...",
  "ANTHROPIC_BASE_URL": "...",
  "ANTHROPIC_MODEL": "..."
}
```

### Context Management

- Token estimation: ~4 characters per token
- Model context limits defined in `llm.ts` (Claude: 200K, MiniMax: 1M, etc.)
- Compression triggered at 92% capacity via `compressContext()`
- Compression strategy: keep first 2 + last 6 messages, summarize middle

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
    // ctx.cwd is working directory
    return "result string"
  },
}
```

2. Register in `src/tools/index.ts`

### Message Types

```typescript
interface Message {
  role: "user" | "assistant"
  content: string
  toolCalls?: ToolCall[]      // For assistant messages
  toolResults?: ToolResult[]  // For tool response messages
}
```

## Documentation

- `docs/agent-loop-research.md` - Research on kimi-cli, kilocode, gemini-cli ReAct implementations
- `docs/hook-system-design.md` - Hook system design for future implementation
