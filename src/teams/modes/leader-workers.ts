/**
 * Leader-Workers 模式
 *
 * 多 Agent 并行协作模式，支持两种策略：
 *
 * 1. collaborative（协作模式）：
 *    - Leader 将任务拆分为 DAG
 *    - 按文件分区分配给 Worker 并行执行
 *    - Leader 集成验收
 *
 * 2. competitive（竞争模式）：
 *    - 多个 Worker 对同一任务出方案
 *    - Leader 按统一标准选择最佳方案
 *    - 或合并多个方案的优点
 *
 * 适用场景：
 * - collaborative: 多模块并行开发、大任务拆分
 * - competitive: 关键方案对比、技术选型
 */

import type { Agent } from "../../agent.js"
import type { TeamConfig, TeamResult, LeaderWorkersStrategy } from "../types.js"
import type { TaskContract, WorkArtifact, ReviewArtifact, EvaluationCriteria } from "../contracts.js"
import { SharedBlackboard } from "../blackboard.js"
import { CostController } from "../cost-controller.js"
import { ProgressTracker } from "../progress-tracker.js"
import { TaskDAG, createTaskNode, type TaskNode, type ExecutionPlan } from "../task-dag.js"
import { ConflictDetector, formatConflictReport } from "../conflict-detector.js"

/**
 * Leader-Workers 团队配置
 */
interface LeaderWorkersConfig {
  strategy: LeaderWorkersStrategy
  maxParallelWorkers: number
  evaluationCriteria: EvaluationCriteria
}

/**
 * Worker 执行结果
 */
interface WorkerResult {
  workerId: string
  artifact: WorkArtifact
  score?: number
  duration: number
}

/**
 * Leader-Workers 团队
 */
export class LeaderWorkersTeam {
  private config: TeamConfig
  private leader: Agent
  private workers: Agent[]
  private strategy: LeaderWorkersStrategy
  private blackboard: SharedBlackboard
  private costController: CostController
  private progressTracker: ProgressTracker
  private taskDAG: TaskDAG
  private conflictDetector: ConflictDetector
  private maxParallelWorkers: number
  private evaluationCriteria: EvaluationCriteria
  private debug: boolean

  constructor(
    config: TeamConfig,
    leader: Agent,
    workers: Agent[],
    options?: { debug?: boolean }
  ) {
    if (config.mode !== "leader-workers") {
      throw new Error("Invalid mode for LeaderWorkersTeam")
    }

    this.config = config
    this.leader = leader
    this.workers = workers
    this.strategy = config.strategy || "collaborative"
    this.blackboard = new SharedBlackboard()
    this.costController = new CostController(config.budget)
    this.progressTracker = new ProgressTracker(config.maxIterations)
    this.taskDAG = new TaskDAG()
    this.conflictDetector = new ConflictDetector()
    this.maxParallelWorkers = config.budget?.maxParallelAgents || 2
    this.evaluationCriteria = {
      codeQuality: 0.3,
      testCoverage: 0.25,
      performance: 0.2,
      maintainability: 0.15,
      requirementMatch: 0.1,
    }
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

    try {
      if (this.strategy === "collaborative") {
        return await this.executeCollaborative(userRequirement, startTime)
      } else {
        return await this.executeCompetitive(userRequirement, startTime)
      }
    } catch (error) {
      const duration = Date.now() - startTime
      const costSummary = this.costController.getSummary()

      return {
        status: "failure",
        summary: error instanceof Error ? error.message : "Unknown error",
        artifacts: [],
        stats: {
          duration,
          iterations: this.progressTracker.getSnapshot().currentIteration,
          totalCost: costSummary.total,
          totalTokens: this.costController.getTotalTokens(),
        },
      }
    }
  }

  /**
   * 协作模式执行
   */
  private async executeCollaborative(
    userRequirement: string,
    startTime: number
  ): Promise<TeamResult> {
    this.log("\n[Leader-Workers] Starting collaborative mode...")

    // Phase 1: Leader 分析需求并拆分任务
    this.log("[Phase 1] Leader analyzing and splitting tasks...")
    const taskContracts = await this.leaderSplitTasks(userRequirement)

    if (taskContracts.length === 0) {
      throw new Error("Leader failed to split tasks")
    }

    this.log(`[Phase 1] Split into ${taskContracts.length} tasks`)

    // 构建 DAG
    for (const contract of taskContracts) {
      this.taskDAG.addTask(createTaskNode(contract, contract.dependencies))
    }

    // 检测循环依赖
    const cycleCheck = this.taskDAG.detectCycle()
    if (cycleCheck.hasCycle) {
      throw new Error(`Circular dependency detected: ${cycleCheck.cyclePath.join(" -> ")}`)
    }

    // 生成执行计划
    const plan = this.taskDAG.generateExecutionPlan()
    this.log(`[Phase 1] Execution plan: ${plan.levels.length} levels, max parallelism: ${plan.maxParallelism}`)

    // Phase 2: 按层级并行执行
    this.log("\n[Phase 2] Workers executing tasks...")
    const allArtifacts: WorkArtifact[] = []

    for (const level of plan.levels) {
      this.log(`\n[Level ${level.level}] Executing ${level.tasks.length} tasks in parallel...`)

      const levelArtifacts = await this.executeLevel(level.tasks)
      allArtifacts.push(...levelArtifacts)

      // 检测冲突
      for (const artifact of levelArtifacts) {
        this.conflictDetector.registerArtifact(artifact)
      }

      const conflictResult = this.conflictDetector.detectConflicts()
      if (conflictResult.hasConflicts) {
        this.warn(`[Level ${level.level}] Detected ${conflictResult.conflicts.length} conflicts`)
        for (const conflict of conflictResult.conflicts) {
          this.warn(formatConflictReport(conflict))
        }
      }

      // 检查预算
      const budgetCheck = this.costController.checkBudget()
      if (budgetCheck.exceeded) {
        throw new Error(`Budget exceeded: ${budgetCheck.reason}`)
      }
    }

    // Phase 3: Leader 集成验收
    this.log("\n[Phase 3] Leader integrating and reviewing...")
    const finalArtifact = await this.leaderIntegrate(allArtifacts, userRequirement)

    const duration = Date.now() - startTime
    const costSummary = this.costController.getSummary()
    const dagStats = this.taskDAG.getStats()

    return {
      status: "success",
      summary: `Completed ${dagStats.completed}/${dagStats.total} tasks in ${plan.levels.length} levels`,
      artifacts: [finalArtifact],
      stats: {
        duration,
        iterations: plan.levels.length,
        totalCost: costSummary.total,
        totalTokens: this.costController.getTotalTokens(),
      },
    }
  }

  /**
   * 竞争模式执行
   */
  private async executeCompetitive(
    userRequirement: string,
    startTime: number
  ): Promise<TeamResult> {
    this.log("\n[Leader-Workers] Starting competitive mode...")

    // Phase 1: Leader 定义评估标准
    this.log("[Phase 1] Leader defining evaluation criteria...")
    const criteria = await this.leaderDefineCriteria(userRequirement)

    // Phase 2: Workers 并行出方案
    this.log(`\n[Phase 2] ${this.workers.length} workers proposing solutions...`)
    const workerResults = await this.executeWorkersInParallel(
      userRequirement,
      undefined
    )

    // Phase 3: Leader 评估并选择
    this.log("\n[Phase 3] Leader evaluating solutions...")
    const evaluation = await this.leaderEvaluate(workerResults, criteria)

    const duration = Date.now() - startTime
    const costSummary = this.costController.getSummary()

    if (evaluation.selectedArtifact) {
      return {
        status: "success",
        summary: `Selected solution from ${evaluation.selectedWorker} with score ${evaluation.selectedScore?.toFixed(2)}`,
        artifacts: [evaluation.selectedArtifact],
        stats: {
          duration,
          iterations: 1,
          totalCost: costSummary.total,
          totalTokens: this.costController.getTotalTokens(),
        },
      }
    }

    return {
      status: "failure",
      summary: "Leader failed to select a suitable solution",
      artifacts: workerResults.map(r => r.artifact),
      stats: {
        duration,
        iterations: 1,
        totalCost: costSummary.total,
        totalTokens: this.costController.getTotalTokens(),
      },
    }
  }

  /**
   * Leader 拆分任务
   */
  private async leaderSplitTasks(requirement: string): Promise<TaskContract[]> {
    const prompt = `You are a Leader agent. Analyze the requirement and split it into independent tasks.

**Requirement**: ${requirement}

Please split this into 2-5 tasks that can be executed in parallel or with minimal dependencies.

For each task, provide:
- Task ID (e.g., task-1, task-2)
- Objective (what needs to be done)
- File scope (which files to modify)
- Dependencies (IDs of tasks that must complete first)
- Acceptance checks (commands to verify)

Format your response as:
TASK: task-1
OBJECTIVE: <objective>
FILES: <comma-separated files>
DEPENDS: <comma-separated task IDs or "none">
CHECKS: <comma-separated commands>

TASK: task-2
...`

    const response = await this.leader.run(prompt)

    // 解析任务
    const tasks = this.parseTaskContracts(response)
    return tasks
  }

  /**
   * 解析任务契约
   */
  private parseTaskContracts(response: string): TaskContract[] {
    const tasks: TaskContract[] = []
    const taskBlocks = response.split(/TASK:\s*/i).filter(s => s.trim())

    for (const block of taskBlocks) {
      const objectiveMatch = block.match(/OBJECTIVE:\s*(.+?)(?:\n|$)/i)
      const filesMatch = block.match(/FILES:\s*(.+?)(?:\n|$)/i)
      const dependsMatch = block.match(/DEPENDS:\s*(.+?)(?:\n|$)/i)
      const checksMatch = block.match(/CHECKS:\s*(.+?)(?:\n|$)/i)

      const taskId = `task-${Date.now()}-${tasks.length}`

      tasks.push({
        taskId,
        objective: objectiveMatch?.[1]?.trim() || "",
        fileScope: filesMatch?.[1]?.split(",").map(f => f.trim()).filter(Boolean) || [],
        acceptanceChecks: checksMatch?.[1]?.split(",").map(c => c.trim()).filter(Boolean) || [],
        dependencies: dependsMatch?.[1]?.toLowerCase() === "none"
          ? []
          : dependsMatch?.[1]?.split(",").map(d => d.trim()).filter(Boolean) || [],
      })
    }

    return tasks
  }

  /**
   * 执行一个层级的任务
   */
  private async executeLevel(tasks: TaskNode[]): Promise<WorkArtifact[]> {
    const artifacts: WorkArtifact[] = []

    // 分批并行执行
    for (let i = 0; i < tasks.length; i += this.maxParallelWorkers) {
      const batch = tasks.slice(i, i + this.maxParallelWorkers)
      const batchPromises = batch.map((task, index) =>
        this.executeWorkerTask(this.workers[index % this.workers.length], task)
      )

      const batchResults = await Promise.all(batchPromises)
      artifacts.push(...batchResults)

      // 更新任务状态
      for (const task of batch) {
        this.taskDAG.updateTaskStatus(task.id, "completed")
      }
    }

    return artifacts
  }

  /**
   * Worker 执行单个任务
   */
  private async executeWorkerTask(
    worker: Agent,
    task: TaskNode
  ): Promise<WorkArtifact> {
    const prompt = `You are a Worker agent. Execute the following task.

**Task ID**: ${task.id}
**Objective**: ${task.contract.objective}
**File Scope**: ${task.contract.fileScope.join(", ") || "any"}
**Acceptance Checks**: ${task.contract.acceptanceChecks.join(", ") || "none"}

Please implement the task and stay within the file scope.
Respond with "IMPLEMENTATION COMPLETE" when done.`

    const response = await worker.run(prompt)
    const artifact: WorkArtifact = {
      taskId: task.id,
      agentId: "worker",
      agentRole: "worker",
      summary: response.substring(0, 200),
      changedFiles: task.contract.fileScope.length > 0
        ? task.contract.fileScope
        : this.extractChangedFiles(response),
      patchRef: `patch-${Date.now()}`,
      testResults: [],
      risks: [],
      assumptions: [],
      createdAt: Date.now(),
    }

    return artifact
  }

  /**
   * Leader 集成产物
   */
  private async leaderIntegrate(
    artifacts: WorkArtifact[],
    originalRequirement: string
  ): Promise<WorkArtifact> {
    const summaries = artifacts.map(a => `- ${a.taskId}: ${a.summary}`).join("\n")
    const files = [...new Set(artifacts.flatMap(a => a.changedFiles))]

    const prompt = `You are a Leader agent. Integrate the following worker outputs.

**Original Requirement**: ${originalRequirement}

**Worker Outputs**:
${summaries}

**All Changed Files**: ${files.join(", ")}

Please verify:
1. All tasks are properly integrated
2. No conflicts or inconsistencies
3. The original requirement is met

Provide a summary of the integration.`

    const response = await this.leader.run(prompt)

    return {
      taskId: "integrated",
      agentId: "leader",
      agentRole: "leader",
      summary: response.substring(0, 200),
      changedFiles: files,
      patchRef: `patch-integrated-${Date.now()}`,
      testResults: [],
      risks: [],
      assumptions: [],
      createdAt: Date.now(),
    }
  }

  /**
   * Leader 定义评估标准
   */
  private async leaderDefineCriteria(
    requirement: string
  ): Promise<EvaluationCriteria> {
    // 使用默认评估标准
    // 未来可以让 Leader 动态定义
    return this.evaluationCriteria
  }

  /**
   * 并行执行 Workers
   */
  private async executeWorkersInParallel(
    requirement: string,
    _contract?: TaskContract
  ): Promise<WorkerResult[]> {
    const promises = this.workers.map(async (worker, index) => {
      const startTime = Date.now()

      const prompt = `You are Worker ${index + 1}. Propose a solution for the following requirement.

**Requirement**: ${requirement}

Please provide a complete implementation.
Respond with "IMPLEMENTATION COMPLETE" when done.`

      const response = await worker.run(prompt)

      const artifact: WorkArtifact = {
        taskId: `proposal-${index}`,
        agentId: `worker-${index}`,
        agentRole: "worker",
        summary: response.substring(0, 200),
        changedFiles: this.extractChangedFiles(response),
        patchRef: `patch-${Date.now()}-${index}`,
        testResults: [],
        risks: [],
        assumptions: [],
        createdAt: Date.now(),
      }

      return {
        workerId: `worker-${index}`,
        artifact,
        duration: Date.now() - startTime,
      }
    })

    return Promise.all(promises)
  }

  /**
   * Leader 评估方案
   */
  private async leaderEvaluate(
    results: WorkerResult[],
    criteria: EvaluationCriteria
  ): Promise<{
    selectedWorker: string | null
    selectedArtifact: WorkArtifact | null
    selectedScore: number | null
    scores: Array<{ workerId: string; score: number }>
  }> {
    const summaries = results.map(r =>
      `Worker ${r.workerId}:\n${r.artifact.summary}\nFiles: ${r.artifact.changedFiles.join(", ")}`
    ).join("\n\n")

    const prompt = `You are a Leader agent. Evaluate the following solutions and select the best one.

**Evaluation Criteria** (weights):
- Code Quality: ${criteria.codeQuality * 100}%
- Test Coverage: ${criteria.testCoverage * 100}%
- Performance: ${criteria.performance * 100}%
- Maintainability: ${criteria.maintainability * 100}%
- Requirement Match: ${criteria.requirementMatch * 100}%

**Solutions**:
${summaries}

Please evaluate each solution and select the best one.
Respond with:
SELECTED: <worker-id>
REASON: <brief reason>`

    const response = await this.leader.run(prompt)

    // 解析选择结果
    const selectedMatch = response.match(/SELECTED:\s*(worker-\d+)/i)
    const selectedWorkerId = selectedMatch?.[1]

    const selectedResult = results.find(r => r.workerId === selectedWorkerId)

    // 计算分数（使用加权评分）
    const scores = results.map(r => {
      const score = this.calculateScore(r.artifact, criteria)
      return {
        workerId: r.workerId,
        score,
      }
    })

    // 找到最高分
    const bestResult = scores.reduce((best, current) =>
      current.score > best.score ? current : best,
      { workerId: "", score: -1 }
    )

    const bestWorkerId = bestResult.workerId || null
    const bestResultData = results.find(r => r.workerId === bestWorkerId)

    return {
      selectedWorker: bestWorkerId,
      selectedArtifact: bestResultData?.artifact || selectedResult?.artifact || null,
      selectedScore: bestResult.score > 0 ? bestResult.score : null,
      scores,
    }
  }

  /**
   * 计算方案分数（基于 EvaluationCriteria 加权）
   */
  private calculateScore(
    artifact: WorkArtifact,
    criteria: EvaluationCriteria
  ): number {
    let score = 0

    // 1. 代码质量：基于变更文件数量
    const fileCount = artifact.changedFiles.length
    const codeQualityScore = Math.min(fileCount / 10, 0.3)
    score += criteria.codeQuality * codeQualityScore

    // 2. 测试覆盖率：基于测试结果
    const passedTests = artifact.testResults.filter(t => t.passed).length
    const totalTests = artifact.testResults.length
    const testCoverageScore = totalTests > 0 ? passedTests / totalTests : 0
    score += criteria.testCoverage * testCoverageScore

    // 3. 性能：基于执行时间（假设有）
    if (passedTests > 0) {
      score += criteria.performance * 0.3
    }

    // 4. 可维护性：基于风险数量
    const riskCount = artifact.risks.length
    const maintainabilityScore = Math.max(0, 1 - riskCount * 0.2)
    score += criteria.maintainability * maintainabilityScore

    // 5. 需求符合度：基于摘要长度
    const summaryLength = artifact.summary.length
    const requirementScore = summaryLength > 100 && summaryLength < 500 ? 1 : 0
    score += criteria.requirementMatch * requirementScore

    return score
  }

  /**
   * 从响应中提取变更的文件列表
   */
  private extractChangedFiles(response: string): string[] {
    const filePattern = /(?:modified|created|changed):\s*([^\s]+\.(ts|js|tsx|jsx|py|java|go|rs))/gi
    const matches = response.matchAll(filePattern)
    const files = Array.from(matches, m => m[1])

    return files.length > 0 ? files : ["unknown-file"]
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.blackboard.clear()
    this.costController.clear()
    this.progressTracker.clear()
    this.taskDAG.clear()
    this.conflictDetector.clear()
  }
}
