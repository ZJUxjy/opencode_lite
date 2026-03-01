import { EventEmitter } from "events"
import type { TeamConfig, TeamStatus, LeaderWorkersStrategy } from "../types.js"
import type { TaskContract, WorkArtifact, ReviewArtifact } from "../contracts.js"
import { SharedBlackboard } from "../blackboard.js"
import { CostController } from "../cost-controller.js"
import { ProgressTracker } from "../progress-tracker.js"
import { TaskDAG } from "../task-dag.js"
import { ConflictDetector } from "../conflict-detector.js"

// ============================================================================
// LeaderWorkersRunner - Leader-Workers 模式运行器
// ============================================================================

/**
 * Leader-Workers 模式
 *
 * collaborative:
 * - Leader 先拆 DAG
 * - 按 fileScope 分区给 Worker 并行执行
 * - 最后集成
 *
 * competitive:
 * - 多个 Worker 对同一任务出方案
 * - Leader 按统一标准选择或合并
 *
 * 评估标准（competitive权重）：
 * 1. 代码质量 30%
 * 2. 测试与可验证性 25%
 * 3. 性能 20%
 * 4. 可维护性 15%
 * 5. 需求符合度 10%
 */
export class LeaderWorkersRunner extends EventEmitter {
  private config: TeamConfig
  private strategy: LeaderWorkersStrategy

  // 组件
  private blackboard: SharedBlackboard
  private costController: CostController
  private progressTracker: ProgressTracker
  private taskDAG: TaskDAG
  private conflictDetector: ConflictDetector

  // 回调
  private leaderExecutor: (objective: string) => Promise<LeaderPlan>
  private workerExecutor: (task: TaskContract) => Promise<WorkArtifact>
  private reviewerExecutor?: (artifact: WorkArtifact, contract: TaskContract) => Promise<ReviewArtifact>

  // 状态
  private status: TeamStatus = "initializing"
  private currentObjective: string = ""
  private currentPlan: LeaderPlan | null = null
  private workerResults: Map<string, WorkArtifact[]> = new Map()
  private selectedResults: Map<string, WorkArtifact> = new Map()

  constructor(
    config: TeamConfig,
    callbacks: {
      leaderExecutor: (objective: string) => Promise<LeaderPlan>
      workerExecutor: (task: TaskContract) => Promise<WorkArtifact>
      reviewerExecutor?: (artifact: WorkArtifact, contract: TaskContract) => Promise<ReviewArtifact>
    }
  ) {
    super()
    this.config = config
    this.strategy = config.strategy || "collaborative"
    this.leaderExecutor = callbacks.leaderExecutor
    this.workerExecutor = callbacks.workerExecutor
    this.reviewerExecutor = callbacks.reviewerExecutor

    // 初始化组件
    this.blackboard = new SharedBlackboard()
    this.costController = new CostController(config.budget)
    this.progressTracker = new ProgressTracker(
      config.circuitBreaker,
      config.maxIterations
    )
    this.taskDAG = new TaskDAG()
    this.conflictDetector = new ConflictDetector()

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

      // 阶段 1: Leader 规划
      this.emit("phase-change", { phase: "planning" })
      const plan = await this.executeLeader(objective)

      if (!plan) {
        this.setStatus("failed")
        return null
      }

      this.currentPlan = plan

      // 构建 DAG
      for (const task of plan.tasks) {
        const deps = plan.dependencies[task.taskId] || []
        this.taskDAG.addTask(task, deps)
        this.progressTracker.addTask(task.taskId, task.objective)

        // 设置文件分区
        for (const file of task.fileScope) {
          this.conflictDetector.setPartition(file, task.taskId)
        }
      }

      // 阶段 2: Workers 执行
      this.emit("phase-change", { phase: "execution" })
      const artifacts = await this.executeWorkers(plan.tasks)

      if (!artifacts || artifacts.length === 0) {
        this.setStatus("failed")
        return null
      }

      // 阶段 3: Leader 集成与选择
      this.emit("phase-change", { phase: "integration" })
      const finalArtifacts = await this.integrateResults(artifacts)

      if (finalArtifacts && finalArtifacts.length > 0) {
        this.setStatus("completed")
        return finalArtifacts
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
   * Leader 执行
   */
  private async executeLeader(objective: string): Promise<LeaderPlan | null> {
    try {
      const plan = await this.leaderExecutor(objective)
      return plan
    } catch (error) {
      this.emit("leader-error", { error })
      return null
    }
  }

  /**
   * Workers 并行执行
   */
  private async executeWorkers(tasks: TaskContract[]): Promise<WorkArtifact[]> {
    const completedTasks = new Set<string>()
    const artifacts: WorkArtifact[] = []
    const maxParallel = this.costController.getMaxParallelAgents()

    // 按拓扑顺序执行
    const sortedTasks = this.taskDAG.topologicalSort()

    let index = 0
    while (index < sortedTasks.length) {
      // 获取可并行执行的任务
      const parallelizable = this.taskDAG.getParallelizableTasks(completedTasks)
      const toExecute = parallelizable.slice(0, maxParallel)

      if (toExecute.length === 0) {
        // 无可执行任务，可能是循环依赖
        break
      }

      // 并行执行
      const promises = toExecute.map(async (taskId) => {
        const task = tasks.find((t) => t.taskId === taskId)
        if (!task) return null

        // 检查冲突
        const conflictResult = this.conflictDetector.detectConflicts(taskId, task.fileScope)
        if (!conflictResult.canProceed) {
          this.emit("conflict-detected", { taskId, conflicts: conflictResult.conflicts })
          return null
        }

        // 锁定文件
        for (const file of task.fileScope) {
          this.conflictDetector.lockFile(file, taskId)
        }

        this.progressTracker.startRound()
        this.progressTracker.updateTaskStatus(taskId, "in_progress")

        try {
          const artifact = await this.workerExecutor(task)

          // 记录修改
          for (const file of task.fileScope) {
            this.conflictDetector.recordModification(file, taskId, {
              content: task.objective,
            })
          }

          this.progressTracker.updateTaskStatus(taskId, "completed", 100)
          completedTasks.add(taskId)

          // 保存结果
          if (this.strategy === "competitive") {
            const existing = this.workerResults.get(taskId) || []
            existing.push(artifact)
            this.workerResults.set(taskId, existing)
          } else {
            this.selectedResults.set(taskId, artifact)
          }

          return artifact
        } finally {
          // 解锁文件 - 确保执行，捕获异常避免永久锁定
          for (const file of task.fileScope) {
            try {
              this.conflictDetector.unlockFile(file, taskId)
            } catch (error) {
              // 记录警告但不阻塞流程
              this.emit("unlock-warning", { file, taskId, error })
            }
          }
        }
      })

      const results = await Promise.all(promises)
      artifacts.push(...results.filter((r): r is WorkArtifact => r !== null))

      index += toExecute.length
    }

    return artifacts
  }

  /**
   * 集成结果
   */
  private async integrateResults(artifacts: WorkArtifact[]): Promise<WorkArtifact[]> {
    if (this.strategy === "collaborative") {
      // collaborative: 直接使用已选择的结果
      return Array.from(this.selectedResults.values())
    }

    // competitive: Leader 选择最佳方案
    if (!this.reviewerExecutor) {
      // 没有 reviewer，使用默认选择（第一个）
      return artifacts
    }

    const selected: WorkArtifact[] = []

    for (const [taskId, results] of this.workerResults) {
      if (results.length === 1) {
        selected.push(results[0])
        continue
      }

      // 让 reviewer 评估
      const task = this.currentPlan?.tasks.find((t) => t.taskId === taskId)
      if (!task) continue

      let bestArtifact = results[0]
      let bestScore = -1

      for (const artifact of results) {
        const review = await this.reviewerExecutor(artifact, task)
        const score = this.calculateScore(artifact, review)

        if (score > bestScore) {
          bestScore = score
          bestArtifact = artifact
        }
      }

      selected.push(bestArtifact)
    }

    return selected
  }

  /**
   * 计算评分
   */
  private calculateScore(artifact: WorkArtifact, review: ReviewArtifact): number {
    // 评分权重
    const weights = {
      codeQuality: 0.3,
      testCoverage: 0.25,
      performance: 0.2,
      maintainability: 0.15,
      requirementMatch: 0.1,
    }

    let score = 0

    // 代码质量 (30%) - 假设 review 包含质量评分
    const qualityScore = review.status === "approved" ? 100 : 50
    score += qualityScore * weights.codeQuality

    // 测试覆盖 (25%)
    const testPassed = artifact.testResults.every((r) => r.passed)
    const testScore = testPassed ? 100 : 0
    score += testScore * weights.testCoverage

    // 性能 (20%) - 简化处理
    score += 80 * weights.performance

    // 可维护性 (15%)
    score += 80 * weights.maintainability

    // 需求符合度 (10%)
    const requirementScore = review.mustFix.length === 0 ? 100 : 100 - review.mustFix.length * 20
    score += requirementScore * weights.requirementMatch

    return score
  }

  // ========================================================================
  // 状态查询
  // ========================================================================

  /**
   * 获取统计信息
   */
  getStats(): LeaderWorkersStats {
    return {
      status: this.status,
      strategy: this.strategy,
      currentObjective: this.currentObjective,
      totalTasks: this.taskDAG.getStats().totalTasks,
      completedTasks: this.progressTracker.getProgress().completedTasks,
      progress: this.progressTracker.getProgress(),
      cost: this.costController.getStats(),
      dagStats: this.taskDAG.getStats(),
      conflictStats: this.conflictDetector.getStats(),
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

  getTaskDAG(): TaskDAG {
    return this.taskDAG
  }

  getConflictDetector(): ConflictDetector {
    return this.conflictDetector
  }
}

// ============================================================================
// 类型定义
// ============================================================================

export interface LeaderPlan {
  objective: string
  tasks: TaskContract[]
  dependencies: Record<string, string[]> // taskId -> dependsOn[]
  strategy: LeaderWorkersStrategy
}

export interface LeaderWorkersStats {
  status: TeamStatus
  strategy: LeaderWorkersStrategy
  currentObjective: string
  totalTasks: number
  completedTasks: number
  progress: ReturnType<ProgressTracker["getProgress"]>
  cost: ReturnType<CostController["getStats"]>
  dagStats: ReturnType<TaskDAG["getStats"]>
  conflictStats: ReturnType<ConflictDetector["getStats"]>
}
