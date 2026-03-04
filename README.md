# Lite OpenCode

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A lightweight AI coding agent implementing the ReAct (Reasoning + Acting) pattern, inspired by Claude Code, gemini-cli, and kimi-cli.

[中文文档](README.zh-CN.md)

## ✨ Features

### 🤖 Dual Strategy Support
- **Function Calling (FC)**: Native tool calling for capable models (Claude, GPT-4, Gemini, etc.)
- **Chain-of-Thought (CoT)**: ReAct prompt format for other models with streaming parser

### 🛠️ Built-in Tools
- **File Operations**: read, write, edit, glob, grep
- **System**: bash command execution
- **Planning**: Plan Mode with task breakdown
- **Subagent**: Parallel exploration with resource limits
- **Skills**: Dynamic capability activation

### 🔐 Security (New)
- **Token Encryption**: Secure API key storage using system keyring or AES-256-GCM encrypted files
- **Risk-Based Approval**: Three-tier risk levels (low/medium/high) with configurable auto-approval
- **Permission Control**: Always Allow / Allow Once / Deny with learning

### 📊 MCP Integration (New)
- **Server Management**: Connect to multiple MCP servers
- **Status Monitoring**: Health checks and usage statistics
- **Tool Registry**: Automatic tool discovery and registration

### 🔄 Skills System (New)
- **Hot Reload**: Auto-reload skills when SKILL.md files change
- **Dynamic Activation**: LLM-driven skill selection
- **Dependency Management**: Automatic dependency resolution

### 💬 Enhanced TUI (New)
- **Message Grouping**: Collapsible message groups by type
- **Color Coding**: Visual distinction for different message types
- **Keyboard Shortcuts**: Ctrl+E (expand), Ctrl+C (collapse), Ctrl+H (hide system)

### 📝 Session Management
- **Persistent Sessions**: SQLite-based message storage
- **Session Resume**: Continue previous conversations
- **Context Compression**: Automatic compression at 92% threshold

## 🚀 Installation

```bash
# Clone the repository
git clone https://github.com/ZJUxjy/opencode_lite.git
cd opencode_lite

# Install dependencies
npm install

# Build the project
npm run build

# Optional: Link for global access
npm link
```

## ⚡ Quick Start

### 1. Configure API Key

```bash
# Using secure token storage (recommended)
npx lite-opencode config set-token anthropic sk-ant-xxxxx

# Or set environment variable
export ANTHROPIC_API_KEY=sk-ant-xxxxx
```

### 2. Start a Session

```bash
# Start new session
npm start

# Or with options
npm start -- -m claude-3-opus-20240229 -d ./my-project
```

### 3. Available Commands

```bash
# Session management
--list-sessions          # List all sessions
--resume [session-id]    # Resume a session
--continue               # Continue last session for current directory

# Advanced options
--no-stream              # Disable streaming output
--compression-threshold 0.92  # Set context compression threshold
```

## ⚙️ Configuration

### Settings File

Create `settings.json` in your project root or `~/.lite-opencode/`:

```json
{
  "env": {
    "ANTHROPIC_API_KEY": "sk-ant-xxxxx",
    "ANTHROPIC_MODEL": "claude-3-opus-20240229"
  },
  "mcp": {
    "servers": {
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
      }
    }
  },
  "policy": {
    "risk": {
      "autoApprove": ["low"],
      "promptApprove": ["medium", "high"],
      "deny": []
    }
  }
}
```

### Risk-Based Approval

Configure automatic approval levels:

```json
{
  "policy": {
    "risk": {
      "autoApprove": ["low"],        // Auto-approve read operations
      "promptApprove": ["medium", "high"],  // Ask for write/system commands
      "deny": []                      // Nothing denied by default
    }
  }
}
```

## 🛠️ Development

```bash
# Development mode with hot reload
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Build for production
npm run build
```

## 📁 Project Structure

```
.
├── src/
│   ├── agent.ts           # Core agent logic
│   ├── App.tsx            # TUI interface
│   ├── llm.ts             # LLM client
│   ├── policy.ts          # Permission engine
│   ├── react/             # ReAct system
│   │   ├── runner.ts      # Strategy router
│   │   ├── fc-runner.ts   # Function calling
│   │   └── cot-runner.ts  # Chain-of-thought
│   ├── tools/             # Tool implementations
│   ├── skills/            # Skills system
│   ├── tokens/            # Token encryption (new)
│   ├── mcp/               # MCP integration (new)
│   ├── messages/          # Message types (new)
│   └── prompts/           # System prompts
├── skills/                # Built-in skills
└── docs/                  # Documentation
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific test file
npm test -- src/tokens/__tests__/service.test.ts

# Run with coverage
npm run test:coverage
```

## 🔧 Troubleshooting

### Token Storage Issues

```bash
# Check token storage type
npx lite-opencode config list-tokens

# If keyring unavailable, falls back to encrypted file
# Encrypted file location: ~/.lite-opencode/tokens.enc
```

### MCP Connection Issues

```bash
# Check MCP server status
npx lite-opencode mcp status

# Diagnose specific server
npx lite-opencode mcp diagnose <server-name>
```

### Debug Mode

```bash
# Enable debug output
DEBUG=1 npm start
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

[MIT](LICENSE) © 2024 Lite OpenCode Contributors

## 🙏 Acknowledgments

Inspired by:
- [Claude Code](https://claude.ai/code) - AI pair programming
- [gemini-cli](https://github.com/google-gemini/gemini-cli) - Google's AI CLI
- [kimi-cli](https://github.com/moonshot-ai/kimi-cli) - Moonshot AI CLI

## 📞 Support

- [Issues](https://github.com/ZJUxjy/opencode_lite/issues)
- [Discussions](https://github.com/ZJUxjy/opencode_lite/discussions)

---

<p align="center">Built with ❤️ using TypeScript and Node.js</p>
