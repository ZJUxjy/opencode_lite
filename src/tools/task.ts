import { z } from "zod"
import type { Tool } from "../types.js"
import { getSubagentManager } from "../subagent/manager.js"
import { isPlanModeEnabled } from "../plan/manager.js"
import type { ExploreTask } from "../subagent/types.js"

const MAX_PARALLEL_SUBAGENTS = 3

/**
 * Task Tool - 创建子代理执行任务
 *
 * 在 Plan Mode 下，可以创建多个子代理并行探索代码库。
 * 支持三种类型的子代理：
 * - explore: 探索代码库特定区域
 * - plan: 设计实现方案
 * - review: 审查计划合理性
 */
export const taskTool: Tool = {
  name: "task",
  description: `Create a subagent to perform a specific task.

In Plan Mode, you can create up to ${MAX_PARALLEL_SUBAGENTS} subagents in parallel for exploration.

Types of subagents:
- **explore**: Code exploration agent. Focuses on searching and understanding code patterns. Read-only.
- **plan**: Planning agent. Designs implementation approaches based on exploration results.
- **review**: Review agent. Checks plans for completeness and potential issues.

Use this when:
- You need to explore multiple areas of the codebase simultaneously
- You want different perspectives on a problem
- The task can be divided into independent subtasks
- You need specialized analysis (exploration vs planning vs review)

Important:
- Subagents run in isolation with their own context
- Results are returned when all subagents complete
- Each subagent should have a clear, specific task`,

  parameters: z.object({
    type: z
      .enum(["explore", "plan", "review"])
      .describe("Type of subagent: explore (read-only), plan (design), or review (validate)"),
    prompt: z
      .string()
      .describe("Detailed instructions for the subagent. Be specific about what to do."),
  }),

  execute: async (params, ctx) => {
    const { type, prompt } = params

    // 检查是否在 Plan Mode
    if (!isPlanModeEnabled()) {
      return `Error: task tool is only available in Plan Mode.
Use enter_plan_mode first to enable subagent capabilities.`
    }

    const manager = getSubagentManager()

    // 检查当前并行子代理数量
    const runningCount = manager.getByStatus("running").length
    const pendingCount = manager.getByStatus("pending").length

    if (runningCount + pendingCount >= MAX_PARALLEL_SUBAGENTS) {
      return `Error: Maximum number of parallel subagents (${MAX_PARALLEL_SUBAGENTS}) reached.
Please wait for current subagents to complete before creating new ones.

Current status:
- Running: ${runningCount}
- Pending: ${pendingCount}
- Max allowed: ${MAX_PARALLEL_SUBAGENTS}`
    }

    // 创建子代理
    const subagent = manager.create({
      type,
      prompt,
      parentContext: {
        cwd: ctx.cwd,
        messages: ctx.messages,
      },
    })

    // 异步执行子代理
    // 注意：这里不等待结果，让主 Agent 通过其他方式获取结果
    manager.execute(subagent.id).catch((error) => {
      console.error(`Subagent ${subagent.id} failed:`, error)
    })

    return `Created ${type} subagent: ${subagent.id}

Task: ${prompt.slice(0, 100)}${prompt.length > 100 ? "..." : ""}

Status: ${subagent.status}

The subagent is now running in the background. You can create up to ${MAX_PARALLEL_SUBAGENTS} subagents in parallel.

Use the subagent ID to reference this task in future steps.`
  },
}

/**
 * 获取子代理结果工具
 */
export const getSubagentResultTool: Tool = {
  name: "get_subagent_result",
  description: `Get the result of a completed subagent task.

Use this to retrieve results from subagents created with the task tool.
You need the subagent ID returned when the task was created.`,

  parameters: z.object({
    id: z.string().describe("The subagent ID returned by the task tool"),
  }),

  execute: async (params) => {
    const { id } = params
    const manager = getSubagentManager()
    const subagent = manager.get(id)

    if (!subagent) {
      return `Error: Subagent ${id} not found`
    }

    if (subagent.status === "pending") {
      return `Subagent ${id} is still pending and hasn't started yet.`
    }

    if (subagent.status === "running") {
      return `Subagent ${id} is still running. Check back later for results.`
    }

    if (subagent.status === "failed") {
      return `Subagent ${id} failed with error:\n${subagent.error || "Unknown error"}`
    }

    if (subagent.status === "cancelled") {
      return `Subagent ${id} was cancelled.`
    }

    return `# Subagent Result: ${id}

Type: ${subagent.type}
Status: ${subagent.status}
Duration: ${subagent.completedAt && subagent.startedAt ? subagent.completedAt - subagent.startedAt : "N/A"}ms

## Result

${subagent.result || "No result available"}`
  },
}

/**
 * 并行探索工具（专门用于 Phase 1）
 */
export const parallelExploreTool: Tool = {
  name: "parallel_explore",
  description: `Run multiple explore agents in parallel for efficient codebase exploration.

This is a convenience tool for Plan Mode Phase 1 (Initial Understanding).
It creates multiple explore agents and runs them in parallel, then aggregates the results.

Each task should focus on a different area of the codebase or a different question.
Up to 3 tasks can run in parallel.`,

  parameters: z.object({
    tasks: z
      .array(
        z.object({
          focus: z.string().describe("What to explore, e.g., 'authentication flow'"),
          scope: z
            .array(z.string())
            .describe("Files/directories to focus on, e.g., ['src/auth', 'src/middleware']"),
          questions: z
            .array(z.string())
            .describe("Questions this agent should answer"),
        })
      )
      .min(1)
      .max(3)
      .describe("Exploration tasks (1-3 tasks)"),
    aggregation: z
      .enum(["merge", "concat", "summary"])
      .optional()
      .describe("How to aggregate results: merge (deduplicate), concat (append), or summary (brief overview)"),
  }),

  execute: async (params) => {
    const { tasks, aggregation = "merge" } = params

    if (!isPlanModeEnabled()) {
      return `Error: parallel_explore is only available in Plan Mode.`
    }

    const manager = getSubagentManager()

    // 转换为 ExploreTask 格式
    const exploreTasks: ExploreTask[] = tasks.map((t: { focus: string; scope: string[]; questions: string[] }) => ({
      focus: t.focus,
      scope: t.scope,
      questions: t.questions,
    }))

    // 执行并行探索
    const result = await manager.runParallelExploration(exploreTasks, {
      maxAgents: 3,
      aggregationStrategy: aggregation,
    })

    return `# Parallel Exploration Results

## Statistics
- Total agents: ${result.stats.total}
- Completed: ${result.stats.completed}
- Failed: ${result.stats.failed}
- Duration: ${result.stats.duration}ms

## Aggregated Findings

${result.content}

---

## Individual Results

${result.results
  .map(
    (r, i) => `### Agent ${i + 1} (${r.status})
${r.result ? r.result.slice(0, 300) + "..." : r.error || "No result"}`
  )
  .join("\n\n---\n\n")}`
  },
}
