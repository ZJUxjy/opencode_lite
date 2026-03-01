import { EventEmitter } from "events"
import type { TeamConfig, TeamAgentConfig, TeamStatus, AgentRole } from "../types.js"
import type { TaskContract, WorkArtifact, ReviewArtifact } from "../contracts.js"
import { SharedBlackboard } from "../blackboard.js"
import { CostController } from "../cost-controller.js"
import { ProgressTracker } from "../progress-tracker.js"

// ============================================================================
// WorkerReviewerRunner - Worker-Reviewer 模式运行器
// ============================================================================

/**
 * Worker-Reviewer 模式
 *
 * 流程：
 * 1. Worker 实现任务
 * 2. Reviewer 审核
 * 3. 未通过则回修（Worker 修复）
 * 4. 通过后统一验收
 *
 * 终止条件：
 * - qualityGate 满足且 Reviewer 批准
 * - 迭代超限、预算超限、超时触发失败
 * - 连续无进展轮次超过阈值，触发熔断
 */
export class WorkerReviewerRunner extends EventEmitter {
  private config: TeamConfig
  private blackboard: SharedBlackboard
  private costController: CostController
  private progressTracker: ProgressTracker

  // Agent 实例
  private worker: AgentExecutor | null = null
  private reviewer: AgentExecutor | null = null

  // 状态
  private status: TeamStatus = "initializing"
  private currentTask: TaskContract | null = null
  private currentWorkArtifact: WorkArtifact | null = null
  private reviewAttempts = 0

  // 回调
  private workerExecutor: (task: TaskContract) => Promise<WorkArtifact>
  private reviewerExecutor: (artifact: WorkArtifact, contract: TaskContract) => Promise<ReviewArtifact>

  constructor(
    config: TeamConfig,
    callbacks: {
      workerExecutor: (task: TaskContract) => Promise<WorkArtifact>
      reviewerExecutor: (artifact: WorkArtifact, contract: TaskContract) => Promise<ReviewArtifact>
    }
  ) {
    super()
    this.config = config
    this.workerExecutor = callbacks.workerExecutor
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
    // 黑板事件
    this.blackboard.on("task-added", (task) => {
      this.emit("task-added", task)
    })

    this.blackboard.on("artifact-added", (artifact) => {
      this.emit("artifact-added", artifact)
    })

    this.blackboard.on("review-added", (review) => {
      this.emit("review-added", review)
    })

    // 成本事件
    this.costController.on("budget-warning", (data) => {
      this.emit("budget-warning", data)
    })

    this.costController.on("budget-exceeded", (data) => {
      this.emit("budget-exceeded", data)
      this.setStatus("failed")
    })

    this.costController.on("downgrade", (data) => {
      this.emit("downgrade", data)
    })

    // 进度事件
    this.progressTracker.on("no-progress", (data) => {
      this.emit("no-progress", data)
      this.setStatus("failed")
    })

    this.progressTracker.on("circuit-open", (data) => {
      this.emit("circuit-open", data)
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
   * 执行任务
   */
  async run(task: TaskContract): Promise<WorkArtifact | null> {
    this.setStatus("running")
    this.currentTask = task
    this.progressTracker.addTask(task.taskId, task.objective)

    try {
      // 检查预算
      if (!this.costController.canStartNewTask()) {
        this.emit("error", { reason: "budget-exceeded" })
        this.setStatus("failed")
        return null
      }

      // 开始第一轮
      this.progressTracker.startRound()

      // 循环执行直到通过或终止
      while (this.progressTracker.shouldContinue(this.status)) {
        // Worker 执行
        this.progressTracker.updateTaskStatus(task.taskId, "in_progress")
        const artifact = await this.executeWorker(task)

        if (!artifact) {
          this.progressTracker.recordFailure()
          this.setStatus("failed")
          return null
        }

        this.currentWorkArtifact = artifact
        this.blackboard.addWorkArtifact(artifact)

        // 检查质量门禁
        if (this.checkQualityGate(artifact)) {
          this.progressTracker.updateTaskStatus(task.taskId, "completed", 100)
          this.setStatus("completed")
          return artifact
        }

        // Reviewer 审核
        const review = await this.executeReviewer(artifact, task)
        this.blackboard.addReviewArtifact(review)
        this.reviewAttempts++

        if (review.status === "approved") {
          this.progressTracker.updateTaskStatus(task.taskId, "completed", 100)
          this.setStatus("completed")
          return artifact
        }

        // 有 mustFix，需要回修
        if (review.mustFix.length > 0) {
          // 将 review 反馈给 worker 修复
          task = {
            ...task,
            objective: `${task.objective}\n\n请修复以下问题:\n${review.mustFix.map((m) => `- ${m}`).join("\n")}`,
          }

          // 检查迭代限制
          if (this.progressTracker.getCurrentIteration() >= this.config.maxIterations) {
            this.setStatus("failed")
            return artifact
          }

          // 继续下一轮
          this.progressTracker.startRound()
        }
      }

      // 达到最大迭代或熔断
      if (this.status === "running") {
        this.setStatus(this.progressTracker.getConsecutiveFailures() > 0 ? "failed" : "timeout")
      }

      return this.currentWorkArtifact
    } catch (error) {
      this.progressTracker.recordFailure()
      this.setStatus("failed")
      this.emit("error", { error })
      return null
    }
  }

  /**
   * Worker 执行
   */
  private async executeWorker(task: TaskContract): Promise<WorkArtifact | null> {
    try {
      const artifact = await this.workerExecutor(task)
      this.progressTracker.updateTaskStatus(task.taskId, "in_progress", 50)
      return artifact
    } catch (error) {
      this.progressTracker.updateTaskStatus(task.taskId, "failed")
      this.emit("worker-error", { error })
      return null
    }
  }

  /**
   * Reviewer 执行
   */
  private async executeReviewer(artifact: WorkArtifact, contract: TaskContract): Promise<ReviewArtifact> {
    try {
      const review = await this.reviewerExecutor(artifact, contract)

      // 检查是否有 P0 问题
      if (review.severity === "P0" && this.config.qualityGate.noP0Issues) {
        review.status = "changes_requested"
        if (!review.mustFix.includes("存在 P0 级别问题，必须修复")) {
          review.mustFix.unshift("存在 P0 级别问题，必须修复")
        }
      }

      // 检查测试是否通过
      if (this.config.qualityGate.testsMustPass) {
        const hasFailingTests = artifact.testResults.some((r) => !r.passed)
        if (hasFailingTests) {
          review.status = "changes_requested"
          if (!review.mustFix.includes("存在测试失败，必须修复")) {
            review.mustFix.unshift("存在测试失败，必须修复")
          }
        }
      }

      return review
    } catch (error) {
      this.emit("reviewer-error", { error })
      return {
        status: "changes_requested",
        severity: "P0",
        mustFix: [`Reviewer 执行失败: ${error}`],
        suggestions: [],
      }
    }
  }

  /**
   * 检查质量门禁
   */
  private checkQualityGate(artifact: WorkArtifact): boolean {
    const gate = this.config.qualityGate

    // 测试必须通过
    if (gate.testsMustPass) {
      const allTestsPassed = artifact.testResults.every((r) => r.passed)
      if (!allTestsPassed) return false
    }

    // 必须检查项
    if (gate.requiredChecks && gate.requiredChecks.length > 0) {
      const passedChecks = artifact.testResults
        .filter((r) => r.passed)
        .map((r) => r.command)
      const allChecksPassed = gate.requiredChecks.every((check) =>
        passedChecks.some((passed) => passed.includes(check))
      )
      if (!allChecksPassed) return false
    }

    return true
  }

  // ========================================================================
  // 状态查询
  // ========================================================================

  /**
   * 获取统计信息
   */
  getStats(): TeamRunStats {
    return {
      status: this.status,
      currentTask: this.currentTask?.taskId,
      reviewAttempts: this.reviewAttempts,
      progress: this.progressTracker.getProgress(),
      cost: this.costController.getStats(),
      blackboard: this.blackboard.getSnapshot(),
    }
  }

  /**
   * 取消执行
   */
  cancel(): void {
    this.setStatus("cancelled")
  }

  /**
   * 获取组件实例（供外部访问）
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
// AgentExecutor - Agent 执行器接口
// ============================================================================

export interface AgentExecutor {
  role: AgentRole
  model: string
  execute(task: TaskContract): Promise<WorkArtifact>
  review(artifact: WorkArtifact, contract: TaskContract): Promise<ReviewArtifact>
}

// ============================================================================
// 类型定义
// ============================================================================

export interface TeamRunStats {
  status: TeamStatus
  currentTask: string | undefined
  reviewAttempts: number
  progress: ReturnType<ProgressTracker["getProgress"]>
  cost: ReturnType<CostController["getStats"]>
  blackboard: ReturnType<SharedBlackboard["getSnapshot"]>
}
