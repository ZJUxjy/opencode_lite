/**
 * Plan Mode 全局上下文
 *
 * 用于在工具调用时自动获取当前会话信息
 */

export interface PlanContext {
  sessionId: string
  dbPath: string
}

// 全局上下文
let currentContext: PlanContext | null = null

/**
 * 设置当前 Plan 上下文
 */
export function setPlanContext(context: PlanContext): void {
  currentContext = context
}

/**
 * 获取当前 Plan 上下文
 */
export function getPlanContext(): PlanContext | null {
  return currentContext
}

/**
 * 清除 Plan 上下文
 */
export function clearPlanContext(): void {
  currentContext = null
}

/**
 * 断言获取 Plan 上下文（如果不存在则抛出错误）
 */
export function requirePlanContext(): PlanContext {
  if (!currentContext) {
    throw new Error("Plan context not set. Call setPlanContext() first.")
  }
  return currentContext
}
