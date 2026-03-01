import { EventEmitter } from "events"
import type { TeamConfig, TeamStatus } from "../types.js"
import type { TaskContract, WorkArtifact } from "../contracts.js"
import { SharedBlackboard } from "../blackboard.js"
import { CostController } from "../cost-controller.js"
import { ProgressTracker } from "../progress-tracker.js"

// ============================================================================
// HotfixGuardrailRunner - Hotfix Guardrail 模式运行器
// ============================================================================

/**
 * Hotfix Guardrail 模式
 *
 * 适用场景：线上紧急故障
 *
 * 角色：
 * 1. Fixer：最小修复
 * 2. Safety Reviewer：高风险项检查（安全、数据一致性、回滚路径）
 *
 * 强制规则：
 * 1. 只允许最小文件范围
 * 2. 必须产出回滚步骤
 * 3. 禁止顺手重构
 */
export class HotfixGuardrailRunner extends EventEmitter {
  private config: TeamConfig

  // 组件
  private blackboard: SharedBlackboard
  private costController: CostController
  private progressTracker: ProgressTracker

  // 回调
  private fixerExecutor: (task: TaskContract) => Promise<HotfixArtifact>
  private reviewerExecutor: (artifact: WorkArtifact) => Promise<SafetyReview>

  // 状态
  private status: TeamStatus = "initializing"
  private currentTask: TaskContract | null = null
  private rollbackSteps: RollbackStep[] = []

  constructor(
    config: TeamConfig,
    callbacks: {
      fixerExecutor: (task: TaskContract) => Promise<HotfixArtifact>
      reviewerExecutor: (artifact: WorkArtifact) => Promise<SafetyReview>
    }
  ) {
    super()
    this.config = config
    this.fixerExecutor = callbacks.fixerExecutor
    this.reviewerExecutor = callbacks.reviewerExecutor

    // 初始化组件
    this.blackboard = new SharedBlackboard()
    this.costController = new CostController(config.budget)
    this.progressTracker = new ProgressTracker(
      config.circuitBreaker,
      config.maxIterations
    )

    this.setupEventHandlers()
  }

  // ========================================================================
  // 事件处理
  // ========================================================================

  private setupEventHandlers(): void {
    this.blackboard.on("artifact-added", (artifact) => {
      this.emit("artifact-added", artifact)
    })

    this.blackboard.on("review-added", (review) => {
      this.emit("review-added", review)
    })

    this.costController.on("budget-warning", (data) => {
      this.emit("budget-warning", data)
    })

    this.costController.on("budget-exceeded", (data) => {
      this.emit("budget-exceeded", data)
      this.setStatus("failed")
    })

    this.progressTracker.on("no-progress", (data) => {
      this.emit("no-progress", data)
      this.setStatus("failed")
    })
  }

  // ========================================================================
  // 状态管理
  // ========================================================================

  private setStatus(status: TeamStatus): void {
    if (this.status === status) return

    this.status = status
    this.blackboard.setTeamStatus(status)
    this.emit("status-changed", status)
  }

  getStatus(): TeamStatus {
    return this.status
  }

  // ========================================================================
  // 任务执行
  // ========================================================================

  /**
   * 执行热修复
   */
  async run(task: TaskContract): Promise<HotfixArtifact | null> {
    this.setStatus("running")
    this.currentTask = task

    // 验证最小文件范围
    if (!this.validateFileScope(task.fileScope)) {
      this.emit("error", { reason: "file-scope-exceeded" })
      this.setStatus("failed")
      return null
    }

    this.progressTracker.addTask(task.taskId, task.objective)

    try {
      // 检查预算
      if (!this.costController.canStartNewTask()) {
        this.emit("error", { reason: "budget-exceeded" })
        this.setStatus("failed")
        return null
      }

      // 阶段 1: Fixer 执行最小修复
      this.emit("phase-change", { phase: "fixing" })
      this.progressTracker.startRound()

      const artifact = await this.executeFixer(task)

      if (!artifact) {
        this.setStatus("failed")
        return null
      }

      this.progressTracker.updateTaskStatus(task.taskId, "in_progress", 50)

      // 验证必须产出回滚步骤
      if (!artifact.rollbackSteps || artifact.rollbackSteps.length === 0) {
        this.emit("error", { reason: "no-rollback-steps" })
        this.setStatus("failed")
        return null
      }

      this.rollbackSteps = artifact.rollbackSteps
      this.blackboard.addWorkArtifact(artifact)

      // 阶段 2: Safety Reviewer 安全审查
      this.emit("phase-change", { phase: "safety-review" })

      // 检查是否禁止重构
      const hasRefactoring = this.detectRefactoring(artifact.changedFiles)
      if (hasRefactoring) {
        this.emit("warning", { reason: "refactoring-detected" })
      }

      const safetyReview = await this.executeReviewer(artifact)

      if (!safetyReview.approved) {
        this.emit("safety-failed", { issues: safetyReview.issues })
        this.setStatus("failed")
        return null
      }

      this.progressTracker.updateTaskStatus(task.taskId, "completed", 100)
      this.setStatus("completed")

      return artifact
    } catch (error) {
      this.setStatus("failed")
      this.emit("error", { error })
      return null
    }
  }

  /**
   * Fixer 执行
   */
  private async executeFixer(task: TaskContract): Promise<HotfixArtifact | null> {
    try {
      const artifact = await this.fixerExecutor(task)
      return artifact
    } catch (error) {
      this.emit("fixer-error", { error })
      return null
    }
  }

  /**
   * Safety Reviewer 执行
   */
  private async executeReviewer(artifact: WorkArtifact): Promise<SafetyReview> {
    try {
      const safetyReview = await this.reviewerExecutor(artifact)

      // 自动检查项
      const issues: SafetyIssue[] = [...safetyReview.issues]

      // 检查回滚步骤是否完整 (HotfixArtifact 才有)
      const hotfixArtifact = artifact as HotfixArtifact
      if (!hotfixArtifact.rollbackSteps || hotfixArtifact.rollbackSteps.length === 0) {
        issues.push({
          category: "rollback",
          severity: "high",
          description: "缺少回滚步骤",
        })
      }

      // 检查是否修改了敏感文件
      const sensitivePatterns = [".env", "credentials", "password", "secret"]
      const hasSensitiveChanges = artifact.changedFiles.some((file) =>
        sensitivePatterns.some((pattern) => file.toLowerCase().includes(pattern))
      )

      if (hasSensitiveChanges) {
        issues.push({
          category: "security",
          severity: "critical",
          description: "检测到敏感文件修改",
        })
      }

      const approved = issues.filter((i) => i.severity === "critical" || i.severity === "high").length === 0

      // 从safetyReview中提取review属性
      const result: SafetyReview = {
        approved,
        issues,
        review: safetyReview.review,
      }
      return result
    } catch (error) {
      this.emit("reviewer-error", { error })
      const errorResult: SafetyReview = {
        approved: false,
        issues: [
          {
            category: "system",
            severity: "critical",
            description: `Safety Review 执行失败: ${error}`,
          },
        ],
        review: null,
      }
      return errorResult
    }
  }

  /**
   * 验证文件范围
   */
  private validateFileScope(fileScope: string[]): boolean {
    // 热修复应该限制在少数文件
    const maxFiles = 5
    if (fileScope.length > maxFiles) {
      this.emit("warning", {
        reason: "file-scope-too-large",
        message: `文件范围超出最小修复限制 (${fileScope.length} > ${maxFiles})`,
      })
      return false
    }

    return true
  }

  /**
   * 检测顺手重构
   */
  private detectRefactoring(changedFiles: string[]): boolean {
    // 简化实现：检查是否修改了未在fileScope中的文件
    if (!this.currentTask) return false

    const scopeSet = new Set(this.currentTask.fileScope)
    const extraFiles = changedFiles.filter((f) => !scopeSet.has(f))

    return extraFiles.length > 0
  }

  // ========================================================================
  // 状态查询
  // ========================================================================

  /**
   * 获取回滚步骤
   */
  getRollbackSteps(): RollbackStep[] {
    return this.rollbackSteps
  }

  /**
   * 获取统计信息
   */
  getStats(): HotfixGuardrailStats {
    return {
      status: this.status,
      currentTask: this.currentTask?.taskId,
      rollbackStepsCount: this.rollbackSteps.length,
      progress: this.progressTracker.getProgress(),
      cost: this.costController.getStats(),
    }
  }

  /**
   * 取消执行
   */
  cancel(): void {
    this.setStatus("cancelled")
  }

  /**
   * 获取组件实例
   */
  getBlackboard(): SharedBlackboard {
    return this.blackboard
  }

  getCostController(): CostController {
    return this.costController
  }

  getProgressTracker(): ProgressTracker {
    return this.progressTracker
  }
}

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 热修复产物
 */
export interface HotfixArtifact extends WorkArtifact {
  rollbackSteps: RollbackStep[]
  impactAssessment: string
  verificationSteps: string[]
}

/**
 * 回滚步骤
 */
export interface RollbackStep {
  order: number
  description: string
  command?: string
  files?: string[]
  estimatedDuration?: number
}

/**
 * 安全审查
 */
/**
 * 安全审查结果
 */
export interface SafetyReviewResult {
  status: "approved" | "changes_requested"
  severity: "P0" | "P1" | "P2" | "P3"
  mustFix: string[]
  suggestions: string[]
}

/**
 * 安全审查
 */
export type SafetyReview = {
  approved: boolean
  issues: SafetyIssue[]
  review: SafetyReviewResult | null | undefined
}

/**
 * 安全问题
 */
export interface SafetyIssue {
  category: "security" | "data" | "rollback" | "refactoring" | "system"
  severity: "critical" | "high" | "medium" | "low"
  description: string
  suggestion?: string
}

export interface HotfixGuardrailStats {
  status: TeamStatus
  currentTask: string | undefined
  rollbackStepsCount: number
  progress: ReturnType<ProgressTracker["getProgress"]>
  cost: ReturnType<CostController["getStats"]>
}
