/**
 * Worker-Reviewer 模式
 *
 * 两个Agent协作：
 * - Worker: 制定计划、编写代码、实现功能
 * - Reviewer: Code Review、测试验收、质量把关
 *
 * 工作流程：
 * 1. Worker 分析需求并实现功能
 * 2. Worker 提交工作产物
 * 3. Reviewer 审查代码并提出意见
 * 4. 如果需要修改，Worker 修改后重新提交
 * 5. 重复步骤3-4，最多maxIterations轮
 * 6. Reviewer 最终验收
 */

import type { Agent } from "../../agent.js"
import type { TeamConfig, TeamResult } from "../types.js"
import type { TaskContract, WorkArtifact, ReviewArtifact } from "../contracts.js"
import { SharedBlackboard } from "../blackboard.js"
import { CostController } from "../cost-controller.js"
import { ProgressTracker } from "../progress-tracker.js"

/**
 * Worker-Reviewer 团队
 */
export class WorkerReviewerTeam {
  private config: TeamConfig
  private worker: Agent
  private reviewer: Agent
  private blackboard: SharedBlackboard
  private costController: CostController
  private progressTracker: ProgressTracker

  constructor(
    config: TeamConfig,
    worker: Agent,
    reviewer: Agent
  ) {
    if (config.mode !== "worker-reviewer") {
      throw new Error("Invalid mode for WorkerReviewerTeam")
    }

    this.config = config
    this.worker = worker
    this.reviewer = reviewer
    this.blackboard = new SharedBlackboard()
    this.costController = new CostController(config.budget)
    this.progressTracker = new ProgressTracker(config.maxIterations)
  }

  /**
   * 执行团队任务
   */
  async execute(userRequirement: string): Promise<TeamResult> {
    const startTime = Date.now()
    let iteration = 0
    let workArtifact: WorkArtifact | null = null
    let reviewArtifact: ReviewArtifact | null = null

    try {
      // 创建任务契约
      const taskContract: TaskContract = {
        taskId: `task-${Date.now()}`,
        objective: userRequirement,
        fileScope: [], // Worker自行决定
        acceptanceChecks: this.config.qualityGate.requiredChecks || [],
      }

      this.progressTracker.registerTask(taskContract, "worker")
      this.blackboard.publishTask(taskContract, "worker")

      // 迭代循环
      while (iteration < this.config.maxIterations) {
        iteration++
        this.progressTracker.startIteration()

        // Step 1: Worker 实现功能
        console.log(`\n[Iteration ${iteration}] Worker implementing...`)
        workArtifact = await this.workerImplement(taskContract, reviewArtifact)

        if (!workArtifact) {
          throw new Error("Worker failed to produce artifact")
        }

        this.blackboard.submitWork(workArtifact)
        this.progressTracker.completeTask(taskContract.taskId, workArtifact)

        // Step 2: Reviewer 审查
        console.log(`[Iteration ${iteration}] Reviewer reviewing...`)
        reviewArtifact = await this.reviewerReview(workArtifact)

        this.blackboard.submitReview(reviewArtifact)

        // Step 3: 检查是否通过
        if (reviewArtifact.status === "approved") {
          console.log(`[Iteration ${iteration}] Review approved!`)
          break
        }

        if (reviewArtifact.status === "rejected") {
          throw new Error("Review rejected, cannot proceed")
        }

        console.log(
          `[Iteration ${iteration}] Changes requested: ${reviewArtifact.mustFix.length} issues`
        )

        this.progressTracker.completeIteration()

        // 检查预算
        const budgetCheck = this.costController.checkBudget()
        if (budgetCheck.exceeded) {
          throw new Error(`Budget exceeded: ${budgetCheck.reason}`)
        }
      }

      // 检查是否达到最大迭代次数
      if (iteration >= this.config.maxIterations && reviewArtifact?.status !== "approved") {
        throw new Error("Max iterations reached without approval")
      }

      // 成功完成
      const duration = Date.now() - startTime
      const costSummary = this.costController.getSummary()

      return {
        status: "success",
        summary: `Task completed after ${iteration} iterations`,
        artifacts: workArtifact ? [workArtifact] : [],
        stats: {
          duration,
          iterations: iteration,
          totalCost: costSummary.total,
          totalTokens: this.costController.getTotalTokens(),
        },
      }
    } catch (error) {
      const duration = Date.now() - startTime
      const costSummary = this.costController.getSummary()

      return {
        status: "failure",
        summary: error instanceof Error ? error.message : "Unknown error",
        artifacts: workArtifact ? [workArtifact] : [],
        stats: {
          duration,
          iterations: iteration,
          totalCost: costSummary.total,
          totalTokens: this.costController.getTotalTokens(),
        },
      }
    }
  }

  /**
   * Worker 实现功能
   */
  private async workerImplement(
    contract: TaskContract,
    previousReview?: ReviewArtifact | null
  ): Promise<WorkArtifact> {
    // TODO: 实际调用 Worker Agent
    // 这里需要：
    // 1. 构建prompt（包含任务描述和review反馈）
    // 2. 调用 worker.run()
    // 3. 解析结果并构建 WorkArtifact

    throw new Error("Not implemented yet")
  }

  /**
   * Reviewer 审查代码
   */
  private async reviewerReview(artifact: WorkArtifact): Promise<ReviewArtifact> {
    // TODO: 实际调用 Reviewer Agent
    // 这里需要：
    // 1. 构建prompt（包含代码变更和质量标准）
    // 2. 调用 reviewer.run()
    // 3. 解析结果并构建 ReviewArtifact

    throw new Error("Not implemented yet")
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.blackboard.clear()
    this.costController.clear()
    this.progressTracker.clear()
  }
}
