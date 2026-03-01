/**
 * Hotfix Guardrail 模式
 *
 * 专为线上紧急故障设计的双 Agent 协作模式：
 * - Fixer: 最小化修复
 * - Safety Reviewer: 高风险项检查（安全、数据一致性、回滚路径）
 *
 * 强制规则：
 * 1. 只允许最小文件范围
 * 2. 必须产出回滚步骤
 * 3. 禁止顺手重构
 *
 * 适用场景：
 * - 线上紧急故障修复
 * - 生产环境 hotfix
 * - 关键 bug 快速修复
 */

import type { Agent } from "../../agent.js"
import type { TeamConfig, TeamResult } from "../types.js"
import type { TaskContract, WorkArtifact, ReviewArtifact } from "../contracts.js"
import { SharedBlackboard } from "../blackboard.js"
import { CostController } from "../cost-controller.js"
import { ProgressTracker } from "../progress-tracker.js"

/**
 * Hotfix 报告
 */
export interface HotfixReport {
  /** 故障描述 */
  issueDescription: string
  /** 根因分析 */
  rootCause: string
  /** 修复内容 */
  fixContent: string
  /** 回滚步骤 */
  rollbackSteps: string[]
  /** 影响范围 */
  impactScope: {
    files: string[]
    services: string[]
    dataChanges: boolean
  }
  /** 风险评估 */
  riskAssessment: {
    level: "low" | "medium" | "high" | "critical"
    concerns: string[]
  }
  /** 测试验证 */
  verification: {
    testsPassed: boolean
    manualChecks: string[]
  }
}

/**
 * 安全审查结果
 */
export interface SafetyReviewResult {
  /** 是否通过 */
  approved: boolean
  /** 风险等级 */
  riskLevel: "low" | "medium" | "high" | "critical"
  /** 安全检查项 */
  safetyChecks: {
    dataIntegrity: boolean
    securityImpact: boolean
    performanceImpact: boolean
    rollbackFeasibility: boolean
    scopeMinimality: boolean
  }
  /** 必须修复项 */
  mustFix: string[]
  /** 建议 */
  suggestions: string[]
  /** 阻止发布的原因（如果有）*/
  blockers: string[]
}

/**
 * Hotfix 工作产物的元数据
 */
interface HotfixMetadata {
  rootCause?: string
  rollbackSteps?: string[]
  dataChanges?: boolean
  verification?: string
}

/**
 * Hotfix Guardrail 团队
 */
export class HotfixGuardrailTeam {
  private config: TeamConfig
  private fixer: Agent
  private safetyReviewer: Agent
  private blackboard: SharedBlackboard
  private costController: CostController
  private progressTracker: ProgressTracker
  private debug: boolean

  /** 最大允许修改文件数 */
  private readonly MAX_FILES_ALLOWED = 5

  constructor(
    config: TeamConfig,
    fixer: Agent,
    safetyReviewer: Agent,
    options?: { debug?: boolean }
  ) {
    if (config.mode !== "hotfix-guardrail") {
      throw new Error("Invalid mode for HotfixGuardrailTeam")
    }

    this.config = config
    this.fixer = fixer
    this.safetyReviewer = safetyReviewer
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
   * 获取类型化的元数据
   */
  private getMetadata(artifact: WorkArtifact): HotfixMetadata {
    return (artifact.metadata || {}) as HotfixMetadata
  }

  /**
   * 执行 Hotfix 流程
   */
  async execute(issueDescription: string): Promise<TeamResult> {
    const startTime = Date.now()
    let iteration = 0
    let workArtifact: WorkArtifact | undefined
    let safetyReview: SafetyReviewResult | undefined

    try {
      this.log("\n[Hotfix-Guardrail] Starting emergency fix process...")
      this.log(`[Issue] ${issueDescription}`)

      // 创建任务契约
      const taskContract: TaskContract = {
        taskId: `hotfix-${Date.now()}`,
        objective: `Emergency fix: ${issueDescription}`,
        fileScope: [], // Fixer 需要自行确定最小范围
        acceptanceChecks: [
          "Fix must be minimal and focused",
          "Rollback steps must be provided",
          "No unrelated refactoring allowed",
        ],
      }

      this.progressTracker.registerTask(taskContract, "fixer")
      this.blackboard.publishTask(taskContract, "fixer")

      // 迭代修复循环
      while (iteration < this.config.maxIterations) {
        iteration++
        this.progressTracker.startIteration()

        // Step 1: Fixer 实现修复
        this.log(`\n[Iteration ${iteration}] Fixer implementing minimal fix...`)
        workArtifact = await this.fixerImplement(taskContract, issueDescription, safetyReview)

        if (!workArtifact) {
          throw new Error("Fixer failed to produce artifact")
        }

        // 检查文件范围限制
        const scopeCheck = this.checkScopeConstraints(workArtifact)
        if (!scopeCheck.valid) {
          this.warn(`[Iteration ${iteration}] Scope constraint violation: ${scopeCheck.reason}`)
          // 继续让 Safety Reviewer 审查
        }

        this.blackboard.submitWork(workArtifact)
        this.progressTracker.completeTask(taskContract.taskId, workArtifact)

        // Step 2: Safety Reviewer 审查
        this.log(`[Iteration ${iteration}] Safety Reviewer checking...`)
        safetyReview = await this.safetyReview(workArtifact, issueDescription)

        // Step 3: 检查是否通过
        if (safetyReview.approved) {
          this.log(`[Iteration ${iteration}] Safety review approved!`)
          break
        }

        if (safetyReview.blockers.length > 0) {
          this.warn(`[Iteration ${iteration}] Blockers found:`)
          safetyReview.blockers.forEach(b => this.warn(`  - ${b}`))

          if (safetyReview.riskLevel === "critical") {
            throw new Error(`Critical safety issues: ${safetyReview.blockers.join(", ")}`)
          }
        }

        this.log(
          `[Iteration ${iteration}] Must fix: ${safetyReview.mustFix.length} issues`
        )

        this.progressTracker.completeIteration()

        // 检查预算
        const budgetCheck = this.costController.checkBudget()
        if (budgetCheck.exceeded) {
          throw new Error(`Budget exceeded: ${budgetCheck.reason}`)
        }
      }

      // 检查是否达到最大迭代次数
      if (iteration >= this.config.maxIterations && !safetyReview?.approved) {
        throw new Error("Max iterations reached without safety approval")
      }

      // 生成 Hotfix 报告
      const hotfixReport = this.generateHotfixReport(
        issueDescription,
        workArtifact!,
        safetyReview!
      )

      const duration = Date.now() - startTime
      const costSummary = this.costController.getSummary()

      return {
        status: "success",
        summary: `Hotfix approved after ${iteration} iterations. Risk level: ${safetyReview!.riskLevel}`,
        artifacts: [workArtifact!],
        stats: {
          duration,
          iterations: iteration,
          totalCost: costSummary.total,
          totalTokens: this.costController.getTotalTokens(),
        },
        metadata: {
          hotfixReport,
          safetyReview,
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
   * Fixer 实现最小化修复
   */
  private async fixerImplement(
    contract: TaskContract,
    issueDescription: string,
    previousReview?: SafetyReviewResult
  ): Promise<WorkArtifact> {
    let prompt = `You are a Fixer agent handling an EMERGENCY production issue.

**CRITICAL RULES**:
1. Make MINIMAL changes - only what's necessary to fix the issue
2. Do NOT refactor, optimize, or improve unrelated code
3. You MUST provide rollback steps
4. Maximum ${this.MAX_FILES_ALLOWED} files can be modified

**Issue Description**: ${issueDescription}

**Task ID**: ${contract.taskId}
`

    if (previousReview) {
      prompt += `\n**Previous Safety Review Feedback**:\n`
      prompt += `Risk Level: ${previousReview.riskLevel}\n`

      if (previousReview.mustFix.length > 0) {
        prompt += `Must Fix:\n`
        previousReview.mustFix.forEach(item => {
          prompt += `- ${item}\n`
        })
      }

      if (previousReview.suggestions.length > 0) {
        prompt += `\nSuggestions:\n`
        previousReview.suggestions.forEach(item => {
          prompt += `- ${item}\n`
        })
      }
    }

    prompt += `
Please implement the minimal fix and respond with:
1. ROOT_CAUSE: <brief root cause analysis>
2. FIX_APPLIED: <what you changed>
3. FILES_MODIFIED: <comma-separated list of files>
4. ROLLBACK_STEPS:
   - step 1
   - step 2
   - ...
5. DATA_CHANGES: <yes/no - does this change data schema or migration?>
6. VERIFICATION: <how to verify the fix works>`

    const response = await this.fixer.run(prompt)

    // 解析响应
    const artifact: WorkArtifact = {
      taskId: contract.taskId,
      agentId: "fixer",
      agentRole: "fixer",
      summary: this.extractSection(response, "FIX_APPLIED") || response.substring(0, 200),
      changedFiles: this.extractFilesList(response),
      patchRef: `hotfix-${Date.now()}`,
      testResults: [],
      risks: [],
      assumptions: [],
      createdAt: Date.now(),
      metadata: {
        rootCause: this.extractSection(response, "ROOT_CAUSE"),
        rollbackSteps: this.extractRollbackSteps(response),
        dataChanges: this.extractSection(response, "DATA_CHANGES")?.toLowerCase().includes("yes"),
        verification: this.extractSection(response, "VERIFICATION"),
      },
    }

    return artifact
  }

  /**
   * Safety Reviewer 审查
   */
  private async safetyReview(
    artifact: WorkArtifact,
    issueDescription: string
  ): Promise<SafetyReviewResult> {
    const meta = this.getMetadata(artifact)
    const prompt = `You are a Safety Reviewer for emergency production fixes.

**Your responsibility**: Ensure this hotfix is safe to deploy to production.

**Issue**: ${issueDescription}

**Fix Details**:
- Summary: ${artifact.summary}
- Files Changed: ${artifact.changedFiles.join(", ")}
- Root Cause: ${meta.rootCause || "Not provided"}
- Rollback Steps: ${meta.rollbackSteps?.join("\n  ") || "Not provided"}
- Data Changes: ${meta.dataChanges ? "Yes" : "No"}

**Safety Checklist**:
1. DATA_INTEGRITY: Does this fix risk data corruption or loss?
2. SECURITY_IMPACT: Could this introduce security vulnerabilities?
3. PERFORMANCE_IMPACT: Will this negatively impact performance?
4. ROLLBACK_FEASIBILITY: Can we easily rollback if something goes wrong?
5. SCOPE_MINIMALITY: Is this the minimum change needed?

**Constraints**:
- Maximum ${this.MAX_FILES_ALLOWED} files allowed (currently: ${artifact.changedFiles.length})
- Rollback steps MUST be provided
- No unrelated changes allowed

Please review and respond with:
1. DATA_INTEGRITY: <pass/concern> - <reason>
2. SECURITY_IMPACT: <pass/concern> - <reason>
3. PERFORMANCE_IMPACT: <pass/concern> - <reason>
4. ROLLBACK_FEASIBILITY: <pass/concern> - <reason>
5. SCOPE_MINIMALITY: <pass/concern> - <reason>
6. RISK_LEVEL: <low/medium/high/critical>
7. DECISION: <approved/changes_needed/blocked>
8. MUST_FIX: <issues that must be fixed before approval>
9. SUGGESTIONS: <optional improvements>
10. BLOCKERS: <critical issues that prevent deployment>`

    const response = await this.safetyReviewer.run(prompt)

    // 解析审查结果
    const result: SafetyReviewResult = {
      approved: this.parseDecision(response) === "approved",
      riskLevel: this.parseRiskLevel(response),
      safetyChecks: {
        dataIntegrity: this.parseCheckResult(response, "DATA_INTEGRITY"),
        securityImpact: this.parseCheckResult(response, "SECURITY_IMPACT"),
        performanceImpact: this.parseCheckResult(response, "PERFORMANCE_IMPACT"),
        rollbackFeasibility: this.parseCheckResult(response, "ROLLBACK_FEASIBILITY"),
        scopeMinimality: this.parseCheckResult(response, "SCOPE_MINIMALITY"),
      },
      mustFix: this.extractList(response, "MUST_FIX"),
      suggestions: this.extractList(response, "SUGGESTIONS"),
      blockers: this.extractList(response, "BLOCKERS"),
    }

    return result
  }

  /**
   * 检查范围约束
   */
  private checkScopeConstraints(
    artifact: WorkArtifact
  ): { valid: boolean; reason?: string } {
    if (artifact.changedFiles.length > this.MAX_FILES_ALLOWED) {
      return {
        valid: false,
        reason: `Too many files modified: ${artifact.changedFiles.length} > ${this.MAX_FILES_ALLOWED}`,
      }
    }

    const meta = this.getMetadata(artifact)
    if (!meta.rollbackSteps || meta.rollbackSteps.length === 0) {
      return {
        valid: false,
        reason: "Rollback steps not provided",
      }
    }

    return { valid: true }
  }

  /**
   * 生成 Hotfix 报告
   */
  private generateHotfixReport(
    issueDescription: string,
    artifact: WorkArtifact,
    safetyReview: SafetyReviewResult
  ): HotfixReport {
    const meta = this.getMetadata(artifact)
    return {
      issueDescription,
      rootCause: meta.rootCause || "Not analyzed",
      fixContent: artifact.summary,
      rollbackSteps: meta.rollbackSteps || [],
      impactScope: {
        files: artifact.changedFiles,
        services: [], // 需要从 artifact 中提取
        dataChanges: meta.dataChanges || false,
      },
      riskAssessment: {
        level: safetyReview.riskLevel,
        concerns: [...safetyReview.mustFix, ...safetyReview.blockers],
      },
      verification: {
        testsPassed: artifact.testResults.some(t => t.passed),
        manualChecks: meta.verification ? [meta.verification] : [],
      },
    }
  }

  // ============ 辅助方法 ============

  private extractSection(response: string, section: string): string | null {
    const regex = new RegExp(`${section}:\\s*(.+?)(?=\\n[A-Z_]+:|$)`, "is")
    const match = response.match(regex)
    return match ? match[1].trim() : null
  }

  private extractFilesList(response: string): string[] {
    const section = this.extractSection(response, "FILES_MODIFIED")
    if (!section) return []

    return section
      .split(",")
      .map(f => f.trim())
      .filter(f => f.length > 0)
  }

  private extractRollbackSteps(response: string): string[] {
    const section = this.extractSection(response, "ROLLBACK_STEPS")
    if (!section) return []

    return section
      .split("\n")
      .map(line => line.replace(/^[\s-*]*$/, "").trim())
      .filter(line => line.length > 0)
  }

  private parseDecision(response: string): "approved" | "changes_needed" | "blocked" {
    const match = response.match(/DECISION:\s*(approved|changes_needed|blocked)/i)
    return (match?.[1]?.toLowerCase() as any) || "changes_needed"
  }

  private parseRiskLevel(response: string): "low" | "medium" | "high" | "critical" {
    const match = response.match(/RISK_LEVEL:\s*(low|medium|high|critical)/i)
    return (match?.[1]?.toLowerCase() as any) || "medium"
  }

  private parseCheckResult(response: string, checkName: string): boolean {
    const regex = new RegExp(`${checkName}:\\s*(pass|concern)`, "i")
    const match = response.match(regex)
    return match?.[1]?.toLowerCase() === "pass"
  }

  private extractList(response: string, section: string): string[] {
    const content = this.extractSection(response, section)
    if (!content) return []

    return content
      .split("\n")
      .map(line => line.replace(/^[\s-*]*$/, "").trim())
      .filter(line => line.length > 0 && line !== "None" && line !== "N/A")
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
