import { z } from "zod"
import type { Tool } from "../types.js"
import { enterPlanModeCurrent, getPlanFilePathCurrent } from "../plan/manager.js"

/**
 * 进入 Plan Mode 工具
 *
 * 进入只读规划模式，在此模式下：
 * - 只能使用只读工具（read, glob, grep, bash 安全命令）
 * - 不能修改任何文件（除了计划文件）
 * - 适合用于架构设计和方案规划
 */
export const enterPlanModeTool: Tool = {
  name: "enter_plan_mode",
  description: `Enter Plan Mode - a read-only environment for architecting solutions before implementation.

In Plan Mode:
- You can ONLY use read-only tools (read, glob, grep, safe bash commands)
- You CANNOT modify any files (except the plan file)
- You should explore the codebase, understand requirements, and create a detailed plan
- When ready, use exit_plan_mode to present your plan for approval

Use this when:
- The task is complex and requires careful planning
- You need to explore the codebase before making changes
- You want to align on an approach before implementation
- The user explicitly asks you to plan first`,
  parameters: z.object({}),
  execute: async (_params, ctx) => {
    const { planFilePath } = enterPlanModeCurrent()
    ctx.setPlanMode?.(true)  // 同步 PolicyEngine 状态
    ctx.setPlanFilePath?.(planFilePath)  // 设置计划文件路径
    const relativePath = planFilePath.replace(ctx.cwd, ".")

    return `Successfully entered Plan Mode.

📋 Plan Mode is now active. You can only use read-only tools.
📝 Plan file will be saved to: ${relativePath}

Next steps:
1. Explore the codebase to understand the current state
2. Identify relevant files and patterns
3. Create a detailed implementation plan
4. Use exit_plan_mode when ready to present your plan`
  },
}
