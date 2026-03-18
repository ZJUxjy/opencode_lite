import { z } from "zod"
import type { Tool } from "../types.js"
import { exitPlanModeCurrent, getPlanFilePathCurrent, isPlanModeEnabledCurrent } from "../plan/manager.js"

/**
 * 退出 Plan Mode 工具
 *
 * 退出规划模式，准备开始执行计划。
 * 调用此工具后：
 * - 可以正常使用所有工具
 * - 计划文件可以作为执行参考
 * - 需要用户批准后开始实施
 */
export const exitPlanModeTool: Tool = {
  name: "exit_plan_mode",
  description: `Exit Plan Mode and prepare to implement the plan.

When you call this tool:
- Plan Mode will be disabled
- You can now use all tools to implement the plan
- The user will review and approve the plan before execution

Only call this when:
- You have completed your exploration and planning
- You have written a detailed plan to the plan file
- You are ready to present the plan for user approval`,
  parameters: z.object({}),
  execute: async (_params, ctx) => {
    if (!isPlanModeEnabledCurrent()) {
      return "Not in Plan Mode. No action taken."
    }

    const { planFilePath } = exitPlanModeCurrent()
    ctx.setPlanMode?.(false)  // 同步 PolicyEngine 状态
    ctx.setPlanFilePath?.(null)  // 清除计划文件路径
    const relativePath = planFilePath.replace(ctx.cwd, ".")

    return `Successfully exited Plan Mode.

✅ Plan is ready at: ${relativePath}
🔧 You can now implement the plan.

The user will review the plan and provide feedback before execution begins.`
  },
}
