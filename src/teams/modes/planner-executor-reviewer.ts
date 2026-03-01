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
  private debug: boolean

  constructor(
    config: TeamConfig,
    planner: Agent,
    executor: Agent,
    reviewer: Agent,
    options?: { debug?: boolean }
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
    this.debug = options?.debug ?? false
  }

  /**
   * 调试日志
   */
  private log(message: string): void {
    if (this.debug) {
      console.log(message)
    }
  }

  /**
   * 警告日志（始终输出）
   */
  private warn(message: string): void {
    console.warn(message)
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
      this.log("\n[Phase 1] Planner analyzing requirements...")
      taskContract = await this.plannerAnalyze(userRequirement)

      if (!taskContract) {
        throw new Error("Planner failed to produce task contract")
      }

      this.progressTracker.registerTask(taskContract, "executor")
      this.blackboard.publishTask(taskContract, "executor")

      this.log(`[Phase 1] Task contract created:`)
      this.log(`  - Objective: ${taskContract.objective}`)
      this.log(`  - File scope: ${taskContract.fileScope.length} files`)
      this.log(`  - Acceptance checks: ${taskContract.acceptanceChecks.length}`)

      // Phase 2: Executor 实现 + Reviewer 验收（迭代循环）
      while (iteration < this.config.maxIterations) {
        iteration++
        this.progressTracker.startIteration()

        // Step 1: Executor 按契约实现
        this.log(`\n[Iteration ${iteration}] Executor implementing...`)
        workArtifact = await this.executorImplement(taskContract, reviewArtifact)

        if (!workArtifact) {
          throw new Error("Executor failed to produce artifact")
        }

        // 检查是否越界修改
        const outOfScope = this.checkScopeViolation(taskContract, workArtifact)
        if (outOfScope.length > 0) {
          this.warn(`[Iteration ${iteration}] Warning: Out-of-scope changes detected:`)
          outOfScope.forEach(file => this.warn(`  - ${file}`))
        }

        this.blackboard.submitWork(workArtifact)
        this.progressTracker.completeTask(taskContract.taskId, workArtifact)

        // Step 2: Reviewer 按契约验收
        this.log(`[Iteration ${iteration}] Reviewer reviewing against contract...`)
        reviewArtifact = await this.reviewerReview(taskContract, workArtifact)

        this.blackboard.submitReview(reviewArtifact)

        // Step 3: 检查是否通过
        if (reviewArtifact.status === "approved") {
          this.log(`[Iteration ${iteration}] Review approved!`)
          break
        }

        if (reviewArtifact.status === "rejected") {
          throw new Error("Review rejected, cannot proceed")
        }

        this.log(
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
    // 构建prompt
    let prompt = `You are a Planner agent. Your task is to analyze the requirement and create a detailed task contract.\n\n`
    prompt += `**User Requirement**: ${requirement}\n\n`
    prompt += `Please analyze and provide:\n`
    prompt += `1. Clear objective (what needs to be achieved)\n`
    prompt += `2. File scope (which files should be modified)\n`
    prompt += `3. Acceptance checks (commands to verify the implementation)\n`
    prompt += `4. Any API contracts or constraints\n\n`
    prompt += `Format your response as:\n`
    prompt += `OBJECTIVE: <clear objective>\n`
    prompt += `FILES: <comma-separated list of files>\n`
    prompt += `CHECKS: <comma-separated list of commands>\n`

    // 调用Planner Agent
    const response = await this.planner.run(prompt)

    // 解析响应并构建TaskContract
    const contract: TaskContract = {
      taskId: `task-${Date.now()}`,
      objective: this.extractObjective(response) || requirement,
      fileScope: this.extractFileScope(response),
      acceptanceChecks: this.extractAcceptanceChecks(response),
      apiContracts: [],
    }

    return contract
  }

  /**
   * Executor 按契约实现功能
   */
  private async executorImplement(
    contract: TaskContract,
    previousReview?: ReviewArtifact | null
  ): Promise<WorkArtifact> {
    // 构建prompt
    let prompt = `You are an Executor agent. You must implement according to the task contract.\n\n`
    prompt += `**Task Contract**:\n`
    prompt += `- Objective: ${contract.objective}\n`

    if (contract.fileScope.length > 0) {
      prompt += `- File Scope (MUST ONLY modify these files):\n`
      contract.fileScope.forEach(file => prompt += `  * ${file}\n`)
    }

    if (contract.acceptanceChecks.length > 0) {
      prompt += `- Acceptance Checks (MUST run these):\n`
      contract.acceptanceChecks.forEach(check => prompt += `  * ${check}\n`)
    }

    if (previousReview) {
      prompt += `\n**Previous Review Feedback**:\n`
      prompt += `Status: ${previousReview.status}\n`
      if (previousReview.mustFix.length > 0) {
        prompt += `Must fix:\n`
        previousReview.mustFix.forEach(comment => {
          prompt += `- ${comment.message}\n`
        })
      }
    }

    prompt += `\nIMPORTANT: You MUST stay within the file scope defined in the contract.\n`
    prompt += `\nPlease implement and respond with "IMPLEMENTATION COMPLETE"`

    // 调用Executor Agent
    const response = await this.executor.run(prompt)

    // 解析响应并构建WorkArtifact
    const artifact: WorkArtifact = {
      taskId: contract.taskId,
      agentId: "executor",
      agentRole: "executor",
      summary: response.substring(0, 200),
      changedFiles: this.extractChangedFiles(response, contract.fileScope),
      patchRef: `patch-${Date.now()}`,
      testResults: [],
      risks: [],
      assumptions: [],
      createdAt: Date.now(),
    }

    return artifact
  }

  /**
   * Reviewer 按契约验收
   */
  private async reviewerReview(
    contract: TaskContract,
    artifact: WorkArtifact
  ): Promise<ReviewArtifact> {
    // 构建prompt
    let prompt = `You are a Reviewer agent. Review the work against the task contract.\n\n`
    prompt += `**Task Contract**:\n`
    prompt += `- Objective: ${contract.objective}\n`
    prompt += `- File Scope: ${contract.fileScope.join(', ')}\n`
    prompt += `- Acceptance Checks: ${contract.acceptanceChecks.join(', ')}\n\n`

    prompt += `**Work Submitted**:\n`
    prompt += `- Summary: ${artifact.summary}\n`
    prompt += `- Changed Files: ${artifact.changedFiles.join(', ')}\n\n`

    prompt += `Please verify:\n`
    prompt += `1. Does it meet the objective?\n`
    prompt += `2. Are all changes within the file scope?\n`
    prompt += `3. Were all acceptance checks executed?\n`
    prompt += `4. Code quality and test coverage\n\n`
    prompt += `Respond with: APPROVED, CHANGES_REQUESTED, or REJECTED`

    // 调用Reviewer Agent
    const response = await this.reviewer.run(prompt)

    // 解析响应并构建ReviewArtifact
    const status = this.parseReviewStatus(response)

    const review: ReviewArtifact = {
      workArtifactId: artifact.taskId,
      reviewerId: "reviewer",
      status,
      severity: "P1",
      mustFix: this.extractReviewComments(response),
      suggestions: [],
      createdAt: Date.now(),
    }

    return review
  }

  /**
   * 从响应中提取目标
   */
  private extractObjective(response: string): string | null {
    const match = response.match(/OBJECTIVE:\s*(.+?)(?:\n|$)/i)
    return match ? match[1].trim() : null
  }

  /**
   * 从响应中提取文件范围
   */
  private extractFileScope(response: string): string[] {
    const match = response.match(/FILES:\s*(.+?)(?:\n|$)/i)
    if (!match) return []

    return match[1]
      .split(',')
      .map(f => f.trim())
      .filter(f => f.length > 0)
  }

  /**
   * 从响应中提取验收检查
   */
  private extractAcceptanceChecks(response: string): string[] {
    const match = response.match(/CHECKS:\s*(.+?)(?:\n|$)/i)
    if (!match) return []

    return match[1]
      .split(',')
      .map(c => c.trim())
      .filter(c => c.length > 0)
  }

  /**
   * 从响应中提取变更的文件列表
   */
  private extractChangedFiles(response: string, fileScope: string[]): string[] {
    // 如果有fileScope，优先返回fileScope
    if (fileScope.length > 0) {
      return fileScope
    }

    // 尝试从响应中提取
    const filePattern = /(?:modified|created|changed):\s*([^\s]+\.(ts|js|tsx|jsx|py|java|go|rs))/gi
    const matches = response.matchAll(filePattern)
    const files = Array.from(matches, m => m[1])

    return files.length > 0 ? files : ["unknown-file"]
  }

  /**
   * 解析审查状态
   */
  private parseReviewStatus(response: string): "approved" | "changes_requested" | "rejected" {
    const lowerResponse = response.toLowerCase()

    if (lowerResponse.includes("approved") || lowerResponse.includes("looks good")) {
      return "approved"
    }

    if (lowerResponse.includes("rejected") || lowerResponse.includes("cannot proceed")) {
      return "rejected"
    }

    return "changes_requested"
  }

  /**
   * 从响应中提取审查评论
   */
  private extractReviewComments(response: string): Array<{
    file?: string
    line?: number
    message: string
    category: "bug" | "style" | "performance" | "security" | "other"
  }> {
    const lines = response.split('\n')
    const comments: Array<{
      message: string
      category: "bug" | "style" | "performance" | "security" | "other"
    }> = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('-') || trimmed.startsWith('*') || trimmed.startsWith('•')) {
        const message = trimmed.substring(1).trim()
        if (message.length > 10) {
          comments.push({
            message,
            category: "other",
          })
        }
      }
    }

    return comments
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
