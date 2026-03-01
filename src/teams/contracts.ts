/**
 * 产物契约定义
 *
 * 定义并行模式下的统一产物结构，确保"能生成且能集成"
 */

/**
 * 任务契约
 *
 * 定义任务的边界、约束和验收标准
 */
export interface TaskContract {
  taskId: string
  objective: string
  fileScope: string[]          // 允许修改的文件范围
  apiContracts?: string[]      // API/schema 约束
  acceptanceChecks: string[]   // 必须执行的命令，例如 npm test
  dependencies?: string[]      // 依赖的其他任务ID
  estimatedTokens?: number     // 预估token消耗
}

/**
 * 工作产物
 *
 * Agent 完成任务后提交的标准化产物
 */
export interface WorkArtifact {
  taskId: string
  agentId: string
  agentRole: string
  summary: string
  changedFiles: string[]
  patchRef: string             // patch 或 commit 引用
  testResults: TestResult[]
  risks: string[]
  assumptions: string[]
  createdAt: number
  metadata?: Record<string, unknown>  // 扩展字段，用于存储模式特定信息
}

/**
 * 测试结果
 */
export interface TestResult {
  command: string
  passed: boolean
  outputRef?: string
  duration?: number
}

/**
 * 审查产物
 *
 * Reviewer 审查后的反馈
 */
export interface ReviewArtifact {
  workArtifactId: string
  reviewerId: string
  status: "approved" | "changes_requested" | "rejected"
  severity: "P0" | "P1" | "P2" | "P3"
  mustFix: ReviewComment[]
  suggestions: ReviewComment[]
  createdAt: number
}

/**
 * 审查评论
 */
export interface ReviewComment {
  file?: string
  line?: number
  message: string
  category: "bug" | "style" | "performance" | "security" | "other"
}

/**
 * Patch 格式
 */
export interface Patch {
  format: "git-patch" | "unified-diff"
  baseCommit: string
  content: string
  metadata: {
    author: string  // 哪个Agent产生的
    timestamp: number
    affectedFiles: string[]
  }
}

/**
 * 合并策略
 */
export type MergeStrategy =
  | { type: "pick-best"; criteria: EvaluationCriteria }
  | { type: "merge-features"; conflicts: "manual" | "llm-resolve" }
  | { type: "hybrid"; pickCore: string; mergeExtras: string[] }

/**
 * 评估标准
 */
export interface EvaluationCriteria {
  codeQuality: number      // 权重 0-1
  testCoverage: number     // 权重 0-1
  performance: number      // 权重 0-1
  maintainability: number  // 权重 0-1
  requirementMatch: number // 权重 0-1
}
