/**
 * Agent Teams - Leader-Workers Mode
 *
 * Leader decomposes task into subtasks, workers execute in parallel,
 * then leader integrates results.
 */

import type { ModeRunner, TeamConfig, SharedBlackboard, CostController, ProgressTracker } from "../types.js"
import type { TaskContract, WorkArtifact, ReviewArtifact } from "../contracts.js"
import { createDefaultTaskContract, meetsQualityGate } from "../contracts.js"
import { createAgentLLMClient } from "../llm-client.js"
import { createTaskDAG, createParallelScheduler, type TaskNode, type TaskDAG } from "../task-dag.js"

// ============================================================================
// Leader-Workers State
// ============================================================================

type LeaderWorkersPhase = "idle" | "planning" | "executing" | "integrating" | "completed" | "failed"
type LeaderWorkersStrategy = "collaborative" | "competitive"

interface LeaderWorkersState {
  phase: LeaderWorkersPhase
  iteration: number
  strategy: LeaderWorkersStrategy
  taskContract?: TaskContract
  subtaskDAG?: TaskDAG<WorkArtifact>
  workArtifacts: Map<string, WorkArtifact>
  finalArtifact?: WorkArtifact
  error?: string
}

interface SubtaskResult {
  subtaskId: string
  artifact: WorkArtifact
}

// ============================================================================
// Leader-Workers Mode Runner
// ============================================================================

export class LeaderWorkersMode implements ModeRunner {
  readonly mode = "leader-workers" as const

  private config?: TeamConfig
  private blackboard?: SharedBlackboard
  private costController?: CostController
  private progressTracker?: ProgressTracker
  private state: LeaderWorkersState
  private abortController?: AbortController
  private timeoutId?: ReturnType<typeof setTimeout>

  constructor(strategy: LeaderWorkersStrategy = "collaborative") {
    this.state = {
      phase: "idle",
      iteration: 0,
      strategy,
      workArtifacts: new Map(),
    }
  }

  async run(
    config: TeamConfig,
    blackboard: SharedBlackboard,
    costController: CostController,
    progressTracker: ProgressTracker
  ): Promise<WorkArtifact | null> {
    this.config = config
    this.blackboard = blackboard
    this.costController = costController
    this.progressTracker = progressTracker
    this.abortController = new AbortController()

    // Get leader and worker configs
    const leaderConfig = config.agents.find((a) => a.role === "leader")
    const workerConfigs = config.agents.filter((a) => a.role === "worker" || a.role === "member")

    if (!leaderConfig) {
      throw new Error("Leader-Workers mode requires a leader agent")
    }

    if (workerConfigs.length === 0) {
      throw new Error("Leader-Workers mode requires at least one worker")
    }

    // Get task from blackboard or create default
    const taskContract = blackboard.getTaskContract() ?? this.createDefaultTask()
    this.state.taskContract = taskContract
    blackboard.setTaskContract(taskContract)

    // Set timeout
    this.timeoutId = setTimeout(() => {
      this.handleTimeout()
    }, config.timeoutMs)

    try {
      blackboard.emit("status-changed", "running", "initializing")

      // Phase 1: Leader plans and decomposes task
      this.state.phase = "planning"
      blackboard.emit("iteration-started", 1, leaderConfig.role, "leader")

      const subtaskDAG = await this.runLeaderPlanning(leaderConfig.model, taskContract)
      this.state.subtaskDAG = subtaskDAG

      // Phase 2: Execute workers in parallel
      this.state.phase = "executing"

      const executionResult = await this.executeWorkers(
        workerConfigs.map((c) => c.model),
        subtaskDAG,
        config
      )

      if (!executionResult.success) {
        throw new Error(`Worker execution failed: ${executionResult.failed.map((f) => `${f.id}: ${f.error}`).join(", ")}`)
      }

      // Phase 3: Leader integrates results
      this.state.phase = "integrating"
      blackboard.emit("iteration-started", 2, leaderConfig.role, "leader")

      const finalArtifact = await this.runLeaderIntegration(
        leaderConfig.model,
        taskContract,
        subtaskDAG,
        executionResult.results
      )

      this.state.finalArtifact = finalArtifact
      this.state.phase = "completed"

      blackboard.emit("progress-detected", "review")
      blackboard.emit("completed", finalArtifact)

      return finalArtifact
    } catch (error) {
      this.state.phase = "failed"
      this.state.error = error instanceof Error ? error.message : String(error)
      blackboard.emit("error", error instanceof Error ? error : new Error(String(error)))
      throw error
    } finally {
      if (this.timeoutId) {
        clearTimeout(this.timeoutId)
        this.timeoutId = undefined
      }
    }
  }

  cancel(): void {
    this.abortController?.abort()
    if (this.timeoutId) {
      clearTimeout(this.timeoutId)
    }
  }

  // ========================================================================
  // Private Methods
  // ========================================================================

  private async runLeaderPlanning(model: string, taskContract: TaskContract): Promise<TaskDAG<WorkArtifact>> {
    if (!this.blackboard || !this.costController) {
      throw new Error("Not initialized")
    }

    this.blackboard.postMessage(
      { type: "task-assign", task: taskContract },
      "system",
      "leader"
    )

    // Create LLM client for leader
    const llmClient = createAgentLLMClient({ model })
    llmClient.setCostController(this.costController)
    llmClient.setBlackboard(this.blackboard)

    // For MVP, we'll create a simple 3-subtask decomposition
    // In a full implementation, this would call the LLM to decompose
    const dag = createTaskDAG<WorkArtifact>()

    // Create subtasks based on strategy
    if (this.state.strategy === "collaborative") {
      // Collaborative: subtasks can have dependencies
      dag.addNode({
        id: "analysis",
        name: "Analyze Requirements",
        description: "Analyze the task requirements and identify key components",
        dependencies: [],
      })

      dag.addNode({
        id: "implementation",
        name: "Implement Core Logic",
        description: "Implement the main functionality",
        dependencies: ["analysis"],
      })

      dag.addNode({
        id: "testing",
        name: "Add Tests",
        description: "Add comprehensive tests",
        dependencies: ["implementation"],
      })

      dag.addEdge("analysis", "implementation")
      dag.addEdge("implementation", "testing")
    } else {
      // Competitive: independent subtasks for comparison
      dag.addNode({ id: "worker-1", name: "Worker 1 Implementation", dependencies: [] })
      dag.addNode({ id: "worker-2", name: "Worker 2 Implementation", dependencies: [] })
      dag.addNode({ id: "worker-3", name: "Worker 3 Implementation", dependencies: [] })
    }

    this.blackboard.postMessage(
      { type: "task-result", artifact: { taskId: "planning", summary: `Created ${dag.getAllNodes().length} subtasks`, changedFiles: [], patchRef: "", testResults: [], risks: [], assumptions: [] } },
      "leader",
      "system"
    )

    return dag
  }

  private async executeWorkers(
    workerModels: string[],
    dag: TaskDAG<WorkArtifact>,
    config: TeamConfig
  ): Promise<{ success: boolean; results: SubtaskResult[]; failed: Array<{ id: string; error: string }> }> {
    if (!this.blackboard || !this.costController) {
      throw new Error("Not initialized")
    }

    const results: SubtaskResult[] = []

    // Create executor function for subtasks
    const executor = async (task: TaskNode<WorkArtifact>): Promise<WorkArtifact> => {
      // Check for cancellation
      if (this.abortController?.signal.aborted) {
        throw new Error("Execution cancelled")
      }

      // Check circuit breaker
      if (this.progressTracker?.shouldCircuitBreak()) {
        throw new Error("Circuit breaker triggered")
      }

      // Check budget
      if (this.costController?.isBudgetExceeded()) {
        throw new Error("Budget exceeded")
      }

      // Assign worker (round-robin)
      const workerIndex = results.length % workerModels.length
      const workerModel = workerModels[workerIndex]

      // Create subtask contract
      const subtaskContract: TaskContract = {
        taskId: task.id,
        objective: task.description || `Complete subtask: ${task.name}`,
        fileScope: this.state.taskContract?.fileScope || [],
        acceptanceChecks: this.state.taskContract?.acceptanceChecks || [],
      }

      // Execute worker
      if (!this.costController || !this.blackboard) {
        throw new Error("Not initialized")
      }

      const llmClient = createAgentLLMClient({ model: workerModel })
      llmClient.setCostController(this.costController)
      llmClient.setBlackboard(this.blackboard)

      const artifact = await llmClient.executeWorker(subtaskContract, 1)

      // Record progress
      this.progressTracker?.recordCodeChange(artifact.changedFiles.length)

      results.push({ subtaskId: task.id, artifact })

      return artifact
    }

    // Create and run scheduler
    const scheduler = createParallelScheduler(dag, executor, {
      maxConcurrency: config.budget?.maxParallelAgents || workerModels.length,
      failFast: true,
      retryCount: 0,
    })

    const executionResult = await scheduler.execute()

    // Collect results from completed tasks
    const completedResults: SubtaskResult[] = []
    for (const taskId of executionResult.completed) {
      const node = dag.getNode(taskId)
      if (node?.result) {
        completedResults.push({ subtaskId: taskId, artifact: node.result })
      }
    }

    return {
      success: executionResult.success,
      results: completedResults,
      failed: executionResult.failed,
    }
  }

  private async runLeaderIntegration(
    model: string,
    taskContract: TaskContract,
    dag: TaskDAG<WorkArtifact>,
    results: SubtaskResult[]
  ): Promise<WorkArtifact> {
    if (!this.blackboard || !this.costController) {
      throw new Error("Not initialized")
    }

    this.blackboard.postMessage(
      { type: "review-request", artifact: results[0]?.artifact || { taskId: "integration", summary: "", changedFiles: [], patchRef: "", testResults: [], risks: [], assumptions: [] } },
      "system",
      "leader"
    )

    // Create LLM client for leader integration
    const llmClient = createAgentLLMClient({ model })
    llmClient.setCostController(this.costController)
    llmClient.setBlackboard(this.blackboard)

    // Merge all artifacts into final artifact
    const allChangedFiles = [...new Set(results.flatMap((r) => r.artifact.changedFiles))]
    const allRisks = [...new Set(results.flatMap((r) => r.artifact.risks))]
    const allAssumptions = [...new Set(results.flatMap((r) => r.artifact.assumptions))]
    const allTestResults = results.flatMap((r) => r.artifact.testResults)

    const finalArtifact: WorkArtifact = {
      taskId: taskContract.taskId,
      summary: `Integrated ${results.length} subtask results: ${results.map((r) => r.artifact.summary).join("; ")}`,
      changedFiles: allChangedFiles,
      patchRef: `integration-${Date.now()}`,
      testResults: allTestResults,
      risks: allRisks,
      assumptions: allAssumptions,
    }

    this.blackboard.postMessage(
      { type: "review-result", review: { status: "approved", severity: "P3", mustFix: [], suggestions: [] } },
      "leader",
      "system"
    )

    return finalArtifact
  }

  private createDefaultTask(): TaskContract {
    return createDefaultTaskContract(
      `task-${Date.now()}`,
      "Complete the assigned task",
      [],
      ["npm test"]
    )
  }

  private handleTimeout(): void {
    this.state.phase = "failed"
    this.state.error = "Timeout"
    this.blackboard?.emit("status-changed", "timeout", "running")
    this.abortController?.abort()
  }

  getState(): LeaderWorkersState {
    return { ...this.state }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createLeaderWorkersMode(strategy: LeaderWorkersStrategy = "collaborative"): ModeRunner {
  return new LeaderWorkersMode(strategy)
}
