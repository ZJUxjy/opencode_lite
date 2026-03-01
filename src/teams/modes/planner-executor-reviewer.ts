import { EventEmitter } from "events"
import type { TeamConfig, TeamStatus } from "../types.js"
import type { TaskContract, WorkArtifact, ReviewArtifact, PlanningArtifact } from "../contracts.js"
import { SharedBlackboard } from "../blackboard.js"
import { CostController } from "../cost-controller.js"
import { ProgressTracker } from "../progress-tracker.js"

// ============================================================================
// PlannerExecutorReviewerRunner - Planner-Executor-Reviewer 模式运行器
// ============================================================================

/**
 * Planner-Executor-Reviewer 模式
 *
 * 适用场景：需求模糊、变更范围不清晰、容易返工
 *
 * 角色：
 * 1. Planner：澄清需求、输出 TaskContract
 * 2. Executor：按契约实现并提交 WorkArtifact
 * 3. Reviewer：按契约验收，阻断越界改动与遗漏测试
 *
 * 收益：把"返工"前移到规划阶段，降低总 token 消耗
 */
export class PlannerExecutorReviewerRunner extends EventEmitter {
  private config: TeamConfig
  private blackboard: SharedBlackboard
  private costController: CostController
  private progressTracker: ProgressTracker

  // 回调
  private plannerExecutor: (objective: string) => Promise<PlanningArtifact>
  private executorExecutor: (contract: TaskContract) => Promise<WorkArtifact>
  private reviewerExecutor: (artifact: WorkArtifact, contract: TaskContract) => Promise<ReviewArtifact>

  // 状态
  private status: TeamStatus = "initializing"
  private currentObjective: string = ""
  private currentPlanning: PlanningArtifact | null = null
  private contracts: TaskContract[] = []
  private currentContractIndex = 0
  private executorRounds = 0

  constructor(
    config: TeamConfig,
    callbacks: {
      plannerExecutor: (objective: string) => Promise<PlanningArtifact>
      executorExecutor: (contract: TaskContract) => Promise<WorkArtifact>
      reviewerExecutor: (artifact: WorkArtifact, contract: TaskContract) => Promise<ReviewArtifact>
    }
  ) {
    super()
    this.config = config
    this.plannerExecutor = callbacks.plannerExecutor
    this.executorExecutor = callbacks.executorExecutor
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
    this.blackboard.on("planning-added", (planning) => {
      this.emit("planning-added", planning)
    })

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

    this.costController.on("downgrade", (data) => {
      this.emit("downgrade", data)
    })

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
  async run(objective: string): Promise<WorkArtifact[] | null> {
    this.setStatus("running")
    this.currentObjective = objective

    try {
      // 检查预算
      if (!this.costController.canStartNewTask()) {
        this.emit("error", { reason: "budget-exceeded" })
        this.setStatus("failed")
        return null
      }

      // 阶段 1: Planner 规划
      this.emit("phase-change", { phase: "planning" })
      const planning = await this.executePlanner(objective)

      if (!planning) {
        this.setStatus("failed")
        return null
      }

      this.currentPlanning = planning
      this.contracts = planning.contracts
      this.blackboard.addPlanningArtifact(planning)

      // 注册所有任务
      for (const contract of this.contracts) {
        this.progressTracker.addTask(contract.taskId, contract.objective)
      }

      // 阶段 2: Executor 执行 + Reviewer 审核
      this.emit("phase-change", { phase: "execution" })
      const artifacts = await this.executeContracts()

      // 阶段 3: 最终验收
      this.emit("phase-change", { phase: "final-review" })

      if (artifacts && artifacts.length > 0) {
        this.setStatus("completed")
        return artifacts
      } else {
        this.setStatus("failed")
        return null
      }
    } catch (error) {
      this.setStatus("failed")
      this.emit("error", { error })
      return null
    }
  }

  /**
   * Planner 执行
   */
  private async executePlanner(objective: string): Promise<PlanningArtifact | null> {
    try {
      const planning = await this.plannerExecutor(objective)
      return planning
    } catch (error) {
      this.emit("planner-error", { error })
      return null
    }
  }

  /**
   * 按依赖顺序执行契约
   */
  private async executeContracts(): Promise<WorkArtifact[]> {
    const artifacts: WorkArtifact[] = []
    const completed = new Set<string>()

    for (let i = 0; i < this.contracts.length; i++) {
      this.currentContractIndex = i
      const contract = this.contracts[i]

      // 检查依赖是否满足
      const dependencies = this.currentPlanning?.dependencies[contract.taskId] || []
      const depsSatisfied = dependencies.every((dep) => completed.has(dep))

      if (!depsSatisfied) {
        // 依赖未满足，跳过或等待
        this.emit("dependency-waiting", { taskId: contract.taskId, dependencies })
        continue
      }

      this.progressTracker.startRound()
      this.progressTracker.updateTaskStatus(contract.taskId, "in_progress")

      // 执行
      const artifact = await this.executeExecutor(contract)

      if (!artifact) {
        this.progressTracker.updateTaskStatus(contract.taskId, "failed")
        if (this.config.circuitBreaker.maxConsecutiveFailures > 0) {
          this.progressTracker.recordFailure()
        }
        continue
      }

      // Review
      const review = await this.executeReviewer(artifact, contract)
      this.blackboard.addReviewArtifact(review)

      if (review.status === "approved") {
        this.progressTracker.updateTaskStatus(contract.taskId, "completed", 100)
        completed.add(contract.taskId)
        artifacts.push(artifact)
        this.blackboard.addWorkArtifact(artifact)
      } else {
        // 需要修复
        this.progressTracker.updateTaskStatus(contract.taskId, "failed")
        this.emit("contract-rejected", { contract, review })
      }

      // 检查是否应该继续
      if (!this.progressTracker.shouldContinue(this.status)) {
        break
      }
    }

    return artifacts
  }

  /**
   * Executor 执行
   */
  private async executeExecutor(contract: TaskContract): Promise<WorkArtifact | null> {
    try {
      this.executorRounds++
      const artifact = await this.executorExecutor(contract)
      return artifact
    } catch (error) {
      this.emit("executor-error", { error })
      return null
    }
  }

  /**
   * Reviewer 执行
   */
  private async executeReviewer(artifact: WorkArtifact, contract: TaskContract): Promise<ReviewArtifact> {
    try {
      const review = await this.reviewerExecutor(artifact, contract)

      // 检查文件范围
      const outOfScope = artifact.changedFiles.filter(
        (f) => !contract.fileScope.some((scope) => f.startsWith(scope))
      )
      if (outOfScope.length > 0) {
        review.status = "changes_requested"
        review.mustFix.push(`越界修改: ${outOfScope.join(", ")}`)
      }

      // 检查测试覆盖
      if (!artifact.testResults || artifact.testResults.length === 0) {
        review.status = "changes_requested"
        review.mustFix.push("缺少测试用例")
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

  // ========================================================================
  // 状态查询
  // ========================================================================

  /**
   * 获取统计信息
   */
  getStats(): PlannerExecutorReviewerStats {
    return {
      status: this.status,
      phase: this.getCurrentPhase(),
      currentObjective: this.currentObjective,
      totalContracts: this.contracts.length,
      completedContracts: this.progressTracker.getProgress().completedTasks,
      executorRounds: this.executorRounds,
      progress: this.progressTracker.getProgress(),
      cost: this.costController.getStats(),
      blackboard: this.blackboard.getSnapshot(),
    }
  }

  private getCurrentPhase(): "planning" | "execution" | "final-review" {
    if (!this.currentPlanning) return "planning"
    if (this.currentContractIndex < this.contracts.length) return "execution"
    return "final-review"
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

export interface PlannerExecutorReviewerStats {
  status: TeamStatus
  phase: "planning" | "execution" | "final-review"
  currentObjective: string
  totalContracts: number
  completedContracts: number
  executorRounds: number
  progress: ReturnType<ProgressTracker["getProgress"]>
  cost: ReturnType<CostController["getStats"]>
  blackboard: ReturnType<SharedBlackboard["getSnapshot"]>
}
