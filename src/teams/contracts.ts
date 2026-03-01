import { z } from "zod"

// ============================================================================
// 产物契约 - Task Contract
// ============================================================================

/**
 * 任务契约 - 定义任务的边界和验收标准
 */
export interface TaskContract {
  taskId: string
  objective: string
  fileScope: string[] // 允许修改的文件范围
  apiContracts?: string[] // API/schema 约束
  acceptanceChecks: string[] // 必须执行的命令，例如 npm test
}

/**
 * 上下文契约 - 宽松上下文契约
 *
 * 来源: "Context, Not Control" 原则
 * 用途: 替代严格的 TaskContract，给予 Agent 更多自主判断空间
 *
 * 与 TaskContract 的区别:
 * - 目标 (objective) 而非具体步骤
 * - 背景知识 (context) 而非强制指令
 * - 边界 (boundaries) 而非范围限制
 * - 输出期望 (expectedOutcome) 而非固定格式
 */
export interface ContextContract {
  // 目标 - 描述要达成的目标，而非具体步骤
  objective: string

  // 背景知识 - Agent 需要了解的信息，而非强制指令
  context: {
    background: string
    constraints: string[]
    references: string[] // 文件路径、文档链接
  }

  // 边界 - 禁止事项和建议考虑
  boundaries: {
    mustNot: string[] // 禁止事项
    shouldConsider: string[] // 建议考虑
  }

  // 输出期望 - 期望的结果，而非固定格式
  expectedOutcome: {
    intent: string // 意图描述
    validationHint: string // 验证提示
  }
}

/**
 * Test Result - 单个测试命令的结果
 */
export interface TestResult {
  command: string
  passed: boolean
  outputRef?: string
  duration?: number
}

/**
 * Work Artifact - Worker 的产出物
 */
export interface WorkArtifact {
  taskId: string
  summary: string
  changedFiles: string[]
  patchRef: string // patch 或 commit 引用
  testResults: TestResult[]
  risks: string[]
  assumptions: string[]
}

/**
 * Review Severity - 问题严重程度
 */
export type ReviewSeverity = "P0" | "P1" | "P2" | "P3"

/**
 * Review Status - 评审状态
 */
export type ReviewStatus = "approved" | "changes_requested"

/**
 * Review Artifact - Reviewer 的评审结果
 */
export interface ReviewArtifact {
  status: ReviewStatus
  severity: ReviewSeverity
  mustFix: string[]
  suggestions: string[]
  testCoverage?: number
  securityIssues?: string[]
  performanceConcerns?: string[]
}

/**
 * Planning Artifact - Planner 的规划产出
 */
export interface PlanningArtifact {
  taskId: string
  contracts: TaskContract[]
  dependencies: Record<string, string[]> // taskId -> dependsOn[]
  estimatedComplexity: "low" | "medium" | "high"
  recommendedStrategy: string
}

/**
 * Decision Artifact - Council 的决策产出
 */
export interface DecisionArtifact {
  topic: string
  options: Array<{
    name: string
    pros: string[]
    cons: string[]
    recommendation: string
  }>
  finalDecision: string
  reasoning: string
  actionItems: string[]
}

// ============================================================================
// Zod Schemas
// ============================================================================

export const TestResultSchema = z.object({
  command: z.string(),
  passed: z.boolean(),
  outputRef: z.string().optional(),
  duration: z.number().optional(),
})

export const TaskContractSchema = z.object({
  taskId: z.string(),
  objective: z.string(),
  fileScope: z.array(z.string()),
  apiContracts: z.array(z.string()).optional(),
  acceptanceChecks: z.array(z.string()),
})

export const WorkArtifactSchema = z.object({
  taskId: z.string(),
  summary: z.string(),
  changedFiles: z.array(z.string()),
  patchRef: z.string(),
  testResults: z.array(TestResultSchema),
  risks: z.array(z.string()),
  assumptions: z.array(z.string()),
})

export const ReviewArtifactSchema = z.object({
  status: z.enum(["approved", "changes_requested"]),
  severity: z.enum(["P0", "P1", "P2", "P3"]),
  mustFix: z.array(z.string()),
  suggestions: z.array(z.string()),
  testCoverage: z.number().optional(),
  securityIssues: z.array(z.string()).optional(),
  performanceConcerns: z.array(z.string()).optional(),
})

export const PlanningArtifactSchema = z.object({
  taskId: z.string(),
  contracts: z.array(TaskContractSchema),
  dependencies: z.record(z.array(z.string())),
  estimatedComplexity: z.enum(["low", "medium", "high"]),
  recommendedStrategy: z.string(),
})

export const DecisionArtifactSchema = z.object({
  topic: z.string(),
  options: z.array(
    z.object({
      name: z.string(),
      pros: z.array(z.string()),
      cons: z.array(z.string()),
      recommendation: z.string(),
    })
  ),
  finalDecision: z.string(),
  reasoning: z.string(),
  actionItems: z.array(z.string()),
})
