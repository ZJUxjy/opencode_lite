/**
 * Planner-Executor-Reviewer 模式
 *
 * 三个Agent协作：
 * - Planner: 澄清需求、分析范围、输出 TaskContract
 * - Executor: 按契约实现功能、提交 WorkArtifact
 * - Reviewer: 按契约验收、阻断越界改动与遗漏测试
 *
 * 工作流程：
 * 1. Planner 分析需求并制定详细的任务契约
 * 2. Executor 按照契约实现功能
 * 3. Reviewer 验证是否符合契约（范围、测试、质量）
 * 4. 如果需要修改，Executor 修改后重新提交
 * 5. 重复步骤3-4，最多maxIterations轮
 * 6. Reviewer 最终验收
 *
 * 收益：
 * - 把"返工"前移到规划阶段，降低总token消耗
 * - 明确的契约边界，避免范围蔓延
 * - Reviewer可以检查是否越界修改
 */

import type { Agent } from "../../agent.js"
import type { TeamConfig, TeamResult } from "../types.js"
import type { TaskContract, WorkArtifact, ReviewArtifact } from "../contracts.js"
import { SharedBlackboard } from "../blackboard.js"
import { CostController } from "../cost-controller.js"
import { ProgressTracker } from "../progress-tracker.js"

/**
 * Planner-Executor-Reviewer 团队
 */
export class PlannerExecutorReviewerTeam {
  private config: TeamConfig
  private planner: Agent
  private executor: Agent
  private reviewer: Agent
  private blackboard: SharedBlackboard
  private costController: CostController
  private progressTracker: ProgressTracker

  constructor(
    config: TeamConfig,
    planner: Agent,
    executor: Agent,
    reviewer: Agent
  ) {
    if (config.mode !== "planner-executor-reviewer") {
      throw new Error("Invalid mode for PlannerExecutorReviewerTeam")
    }

    this.config = config
    this.planner = planner
    this.executor = executor
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
    let taskContract: TaskContract | null = null
    let workArtifact: WorkArtifact | null = null
    let reviewArtifact: ReviewArtifact | null = null

    try {
      // Phase 1: Planner 制定任务契约
      console.log("\n[Phase 1] Planner analyzing requirements...")
      taskContract = await this.plannerAnalyze(userRequirement)

      if (!taskContract) {
        throw new Error("Planner failed to produce task contract")
      }

      this.progressTracker.registerTask(taskContract, "executor")
      this.blackboard.publishTask(taskContract, "executor")

      console.log(`[Phase 1] Task contract created:`)
      console.log(`  - Objective: ${taskContract.objective}`)
      console.log(`  - File scope: ${taskContract.fileScope.length} files`)
      console.log(`  - Acceptance checks: ${taskContract.acceptanceChecks.length}`)

      // Phase 2: Executor 实现 + Reviewer 验收（迭代循环）
      while (iteration < this.config.maxIterations) {
        iteration++
        this.progressTracker.startIteration()

        // Step 1: Executor 按契约实现
        console.log(`\n[Iteration ${iteration}] Executor implementing...`)
        workArtifact = await this.executorImplement(taskContract, reviewArtifact)

        if (!workArtifact) {
          throw new Error("Executor failed to produce artifact")
        }

        // 检查是否越界修改
        const outOfScope = this.checkScopeViolation(taskContract, workArtifact)
        if (outOfScope.length > 0) {
          console.warn(`[Iteration ${iteration}] Warning: Out-of-scope changes detected:`)
          outOfScope.forEach(file => console.warn(`  - ${file}`))
        }

        this.blackboard.submitWork(workArtifact)
        this.progressTracker.completeTask(taskContract.taskId, workArtifact)

        // Step 2: Reviewer 按契约验收
        console.log(`[Iteration ${iteration}] Reviewer reviewing against contract...`)
        reviewArtifact = await this.reviewerReview(taskContract, workArtifact)

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
        summary: `Task completed after ${iteration} iterations (1 planning + ${iteration} execution)`,
        artifacts: workArtifact ? [workArtifact] : [],
        stats: {
          duration,
          iterations: iteration + 1, // 包含planning阶段
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
          iterations: iteration + 1,
          totalCost: costSummary.total,
          totalTokens: this.costController.getTotalTokens(),
        },
      }
    }
  }

  /**
   * Planner 分析需求并制定任务契约
   */
  private async plannerAnalyze(requirement: string): Promise<TaskContract> {
    // TODO: 实际调用 Planner Agent
    // 这里需要：
    // 1. 构建prompt（包含需求和契约模板）
    // 2. 调用 planner.run()
    // 3. 解析结果并构建 TaskContract
    //
    // Prompt应该包含：
    // - 用户需求
    // - 要求Planner明确：目标、文件范围、API约束、验收标准
    // - 要求Planner考虑：依赖关系、风险点、预估工作量

    throw new Error("Not implemented yet")
  }

  /**
   * Executor 按契约实现功能
   */
  private async executorImplement(
    contract: TaskContract,
    previousReview?: ReviewArtifact | null
  ): Promise<WorkArtifact> {
    // TODO: 实际调用 Executor Agent
    // 这里需要：
    // 1. 构建prompt（包含契约、review反馈）
    // 2. 调用 executor.run()
    // 3. 解析结果并构建 WorkArtifact
    //
    // Prompt应该强调：
    // - 必须遵守fileScope限制
    // - 必须执行acceptanceChecks
    // - 必须遵守apiContracts

    throw new Error("Not implemented yet")
  }

  /**
   * Reviewer 按契约验收
   */
  private async reviewerReview(
    contract: TaskContract,
    artifact: WorkArtifact
  ): Promise<ReviewArtifact> {
    // TODO: 实际调用 Reviewer Agent
    // 这里需要：
    // 1. 构建prompt（包含契约、工作产物）
    // 2. 调用 reviewer.run()
    // 3. 解析结果并构建 ReviewArtifact
    //
    // Prompt应该要求Reviewer检查：
    // - 是否符合契约目标
    // - 是否有越界修改（changedFiles vs fileScope）
    // - 是否执行了所有acceptanceChecks
    // - 是否遵守了apiContracts
    // - 代码质量和测试覆盖

    throw new Error("Not implemented yet")
  }

  /**
   * 检查范围违规
   */
  private checkScopeViolation(
    contract: TaskContract,
    artifact: WorkArtifact
  ): string[] {
    // 如果契约没有限制fileScope，则不检查
    if (contract.fileScope.length === 0) {
      return []
    }

    const allowedFiles = new Set(contract.fileScope)
    const violations: string[] = []

    for (const file of artifact.changedFiles) {
      if (!allowedFiles.has(file)) {
        violations.push(file)
      }
    }

    return violations
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
