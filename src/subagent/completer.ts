import { z } from "zod"
import type { CompleteTaskParams } from "./types.js"

/**
 * complete_task 工具的参数 schema
 */
export const CompleteTaskSchema = z.object({
  result: z.string().describe("任务的最终结果摘要"),
  filesChanged: z.array(z.string()).optional().describe("被修改的文件列表"),
  success: z.boolean().optional().describe("任务是否成功完成"),
})

/**
 * complete_task 工具定义（用于 ToolRegistry）
 */
export const completeTaskTool = {
  name: "complete_task",
  description: `提交最终结果并完成任务。这是唯一合法的结束方式。

如果不调用此工具，任务将被视为失败。
必须在 result 参数中提供完整的任务结果。

示例：
{
  "result": "完成了用户认证模块的重构...",
  "filesChanged": ["src/auth.ts", "src/user.ts"],
  "success": true
}`,
  parameters: CompleteTaskSchema,
}

/**
 * TaskCompleter - 管理任务完成状态
 */
export class TaskCompleter {
  private completed: boolean = false
  private output?: CompleteTaskParams

  /**
   * 标记任务完成
   */
  complete(params: CompleteTaskParams): void {
    if (this.completed) {
      throw new Error("Task already completed")
    }
    this.completed = true
    this.output = params
  }

  /**
   * 检查任务是否已完成
   */
  isCompleted(): boolean {
    return this.completed
  }

  /**
   * 获取完成输出
   */
  getOutput(): CompleteTaskParams | undefined {
    return this.output
  }

  /**
   * 序列化输出为字符串
   */
  serializeOutput(): string {
    if (!this.output) return ""
    return JSON.stringify(this.output, null, 2)
  }
}
