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
  private debug: boolean

  constructor(
    config: TeamConfig,
    worker: Agent,
    reviewer: Agent,
    options?: { debug?: boolean }
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
        this.log(`\n[Iteration ${iteration}] Worker implementing...`)
        workArtifact = await this.workerImplement(taskContract, reviewArtifact)

        if (!workArtifact) {
          throw new Error("Worker failed to produce artifact")
        }

        this.blackboard.submitWork(workArtifact)
        this.progressTracker.completeTask(taskContract.taskId, workArtifact)

        // Step 2: Reviewer 审查
        this.log(`[Iteration ${iteration}] Reviewer reviewing...`)
        reviewArtifact = await this.reviewerReview(workArtifact)

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
    // 构建prompt
    let prompt = `You are a Worker agent. Your task is to implement the following requirement:\n\n`
    prompt += `**Objective**: ${contract.objective}\n\n`

    if (contract.fileScope.length > 0) {
      prompt += `**File Scope** (you should only modify these files):\n`
      contract.fileScope.forEach(file => prompt += `- ${file}\n`)
      prompt += `\n`
    }

    if (contract.acceptanceChecks.length > 0) {
      prompt += `**Acceptance Checks** (you must run these commands):\n`
      contract.acceptanceChecks.forEach(check => prompt += `- ${check}\n`)
      prompt += `\n`
    }

    if (previousReview) {
      prompt += `**Previous Review Feedback**:\n`
      prompt += `Status: ${previousReview.status}\n`
      if (previousReview.mustFix.length > 0) {
        prompt += `\nMust fix:\n`
        previousReview.mustFix.forEach(comment => {
          prompt += `- ${comment.message}\n`
        })
      }
      prompt += `\n`
    }

    prompt += `Please implement the functionality and provide:\n`
    prompt += `1. A summary of what you did\n`
    prompt += `2. List of changed files\n`
    prompt += `3. Any risks or assumptions\n\n`
    prompt += `After implementation, respond with "IMPLEMENTATION COMPLETE"`

    // 调用Worker Agent
    const response = await this.worker.run(prompt)

    // 解析响应并构建WorkArtifact
    // 注意：这是简化实现，实际应该解析response提取结构化信息
    const artifact: WorkArtifact = {
      taskId: contract.taskId,
      agentId: "worker",
      agentRole: "worker",
      summary: response.substring(0, 200), // 简化：取前200字符作为摘要
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
   * Reviewer 审查代码
   */
  private async reviewerReview(artifact: WorkArtifact): Promise<ReviewArtifact> {
    // 构建prompt
    let prompt = `You are a Reviewer agent. Please review the following work:\n\n`
    prompt += `**Summary**: ${artifact.summary}\n\n`
    prompt += `**Changed Files**:\n`
    artifact.changedFiles.forEach(file => prompt += `- ${file}\n`)
    prompt += `\n`

    prompt += `Please review the code and provide:\n`
    prompt += `1. Overall assessment (approved/changes_requested/rejected)\n`
    prompt += `2. List of issues that must be fixed\n`
    prompt += `3. Suggestions for improvement\n\n`
    prompt += `Respond with your review decision: APPROVED, CHANGES_REQUESTED, or REJECTED`

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
   * 从响应中提取变更的文件列表
   */
  private extractChangedFiles(response: string, fileScope: string[]): string[] {
    // 简化实现：如果有fileScope，返回fileScope；否则尝试从响应中提取
    if (fileScope.length > 0) {
      return fileScope
    }

    // 尝试匹配文件路径模式
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
    // 简化实现：将响应按行分割，查找问题描述
    const lines = response.split('\n')
    const comments: Array<{
      message: string
      category: "bug" | "style" | "performance" | "security" | "other"
    }> = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('-') || trimmed.startsWith('*') || trimmed.startsWith('•')) {
        const message = trimmed.substring(1).trim()
        if (message.length > 10) { // 过滤太短的行
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
   * 清理资源
   */
  cleanup(): void {
    this.blackboard.clear()
    this.costController.clear()
    this.progressTracker.clear()
  }
}
