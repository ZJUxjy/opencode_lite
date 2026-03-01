import type { Command, CommandContext } from "./types.js"
import type { TeamMode, TeamConfig } from "../teams/types.js"
import { WorkerReviewerRunner, PlannerExecutorReviewerRunner } from "../teams/modes/index.js"
import type { TaskContract, WorkArtifact, ReviewArtifact, PlanningArtifact } from "../teams/contracts.js"

/**
 * Generate a unique message ID
 */
function generateMessageId(): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).slice(2, 6)
  return `msg-${timestamp}-${random}`
}

/**
 * Create a system message for display in the UI
 */
function createSystemMessage(content: string) {
  return {
    id: generateMessageId(),
    role: "system" as const,
    content,
    timestamp: Date.now(),
  }
}

/**
 * 默认 Team 配置
 */
function getDefaultTeamConfig(mode: TeamMode): TeamConfig {
  const baseConfig = {
    maxIterations: 3,
    timeoutMs: 1800000,
    qualityGate: {
      testsMustPass: true,
      noP0Issues: true,
      minCoverage: 70,
      requiredChecks: ["test"],
    },
    circuitBreaker: {
      maxConsecutiveFailures: 3,
      maxNoProgressRounds: 2,
      cooldownMs: 60000,
    },
    conflictResolution: "auto" as const,
  }

  switch (mode) {
    case "worker-reviewer":
      return {
        ...baseConfig,
        mode: "worker-reviewer",
        agents: [
          { role: "worker", model: "claude-sonnet-4-20250514" },
          { role: "reviewer", model: "claude-sonnet-4-20250514" },
        ],
      }
    case "planner-executor-reviewer":
      return {
        ...baseConfig,
        mode: "planner-executor-reviewer",
        agents: [
          { role: "planner", model: "claude-sonnet-4-20250514" },
          { role: "executor", model: "claude-haiku-4-20250514" },
          { role: "reviewer", model: "claude-sonnet-4-20250514" },
        ],
      }
    default:
      return {
        ...baseConfig,
        mode,
        agents: [],
      }
  }
}

/**
 * Team 命令
 * 用法:
 *   /team                    - 显示帮助
 *   /team worker-reviewer   - 启动 worker-reviewer 模式
 *   /team planner-executor  - 启动 planner-executor-reviewer 模式
 *   /team status            - 显示当前团队状态
 */
const teamCommand: Command = {
  name: "/team",
  description: "Manage Agent Teams",
  handler: async (args: string, ctx: CommandContext) => {
    const trimmedArgs = args.trim().toLowerCase()

    // 无参数，显示帮助
    if (!trimmedArgs) {
      const message = createSystemMessage(
        `# Agent Teams

Multi-Agent collaboration for improved code quality and efficiency.

## Available Modes

### worker-reviewer (Default)
Worker implements task → Reviewer审核 → 循环修复直到通过

### planner-executor-reviewer
Planner澄清需求 → Executor按约实现 → Reviewer验收
适用于需求不清晰的复杂任务

## Usage

\`/team worker-reviewer\`
\`/team planner-executor\`
\`/team status\`

## Configuration

Edit \`settings.json\` to customize team behavior:

\`\`\`json
{
  "teams": {
    "maxIterations": 3,
    "budget": {
      "maxTokens": 200000,
      "maxCostUsd": 1.0
    }
  }
}
\`\`\`
`
      )
      ctx.setMessages((prev) => [...prev, message])
      return
    }

    // 状态查询
    if (trimmedArgs === "status") {
      // TODO: 获取当前团队运行状态
      const message = createSystemMessage(
        `No active team run.

Use /team worker-reviewer or /team planner-executor to start a team.`
      )
      ctx.setMessages((prev) => [...prev, message])
      return
    }

    // 解析模式
    let mode: TeamMode
    if (trimmedArgs.includes("planner") || trimmedArgs.includes("executor")) {
      mode = "planner-executor-reviewer"
    } else if (trimmedArgs.includes("worker") || trimmedArgs.includes("reviewer")) {
      mode = "worker-reviewer"
    } else {
      const message = createSystemMessage(
        `Unknown team mode: ${trimmedArgs}

Available: worker-reviewer, planner-executor`
      )
      ctx.setMessages((prev) => [...prev, message])
      return
    }

    // 启动团队模式
    const config = getDefaultTeamConfig(mode)

    const message = createSystemMessage(
      `# Starting Team: ${mode}

Config:
- Max iterations: ${config.maxIterations}
- Timeout: ${config.timeoutMs / 60000} minutes
- Agents: ${config.agents.map((a) => `${a.role}(${a.model})`).join(", ")}

Note: Full team execution requires integration with the Agent's task system.
This is Phase 1 of the Agent Teams implementation.`
    )
    ctx.setMessages((prev) => [...prev, message])

    // 触发事件让 Agent 知道要进入团队模式
    ctx.emit?.("team-start", { mode, config })
  },
}

export { teamCommand }
