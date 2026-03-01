import type { Checkpoint } from "./checkpoint.js"
import type { TaskContract, WorkArtifact, ReviewArtifact } from "./contracts.js"
import type { TeamState } from "./types.js"

export interface CheckpointResumeConfig {
  checkpointId: string
  strategy: "restart-task" | "continue-iteration" | "skip-completed"
  contextInjection: {
    includePreviousThinking: boolean
    includePreviousArtifacts: boolean
    maxContextTokens: number
  }
}

export interface ResumeContext {
  checkpoint: Checkpoint
  pendingTasks: string[]
  completedTasks: string[]
  contextSummary: string
}

export interface ResumedExecution {
  teamState: TeamState
  taskContract: TaskContract
  workArtifacts: Map<string, WorkArtifact>
  reviewArtifacts: Map<string, ReviewArtifact>
  blackboardState: Map<string, unknown>
  resumeStrategy: CheckpointResumeConfig["strategy"]
  pendingTasks: string[]
}

export class CheckpointResumer {
  async buildResumeContext(
    checkpoint: Checkpoint,
    config: CheckpointResumeConfig
  ): Promise<ResumeContext> {
    const completedTasks = this.extractCompletedTasks(checkpoint)
    const allTasks = this.extractAllTasks(checkpoint)
    const pendingTasks = allTasks.filter(t => !completedTasks.includes(t))

    const contextSummary = await this.generateContextSummary(
      checkpoint,
      config.contextInjection
    )

    return {
      checkpoint,
      pendingTasks,
      completedTasks,
      contextSummary,
    }
  }

  async resume(
    checkpoint: Checkpoint,
    config: CheckpointResumeConfig
  ): Promise<ResumedExecution> {
    const context = await this.buildResumeContext(checkpoint, config)

    switch (config.strategy) {
      case "restart-task":
        return this.restartTaskStrategy(checkpoint, context)
      case "continue-iteration":
        return this.continueIterationStrategy(checkpoint, context)
      case "skip-completed":
        return this.skipCompletedStrategy(checkpoint, context)
      default:
        throw new Error(`Unknown resume strategy: ${config.strategy}`)
    }
  }

  private extractCompletedTasks(checkpoint: Checkpoint): string[] {
    const completed: string[] = []
    for (const [agentId, artifact] of Object.entries(checkpoint.workArtifacts)) {
      if (artifact.testResults.every(t => t.passed)) {
        completed.push(agentId)
      }
    }
    return completed
  }

  private extractAllTasks(checkpoint: Checkpoint): string[] {
    return Object.keys(checkpoint.workArtifacts)
  }

  private async generateContextSummary(
    checkpoint: Checkpoint,
    injection: CheckpointResumeConfig["contextInjection"]
  ): Promise<string> {
    const parts: string[] = []
    parts.push(`Resuming from checkpoint at iteration ${checkpoint.iteration}`)
    parts.push(`Phase: ${checkpoint.phase}`)
    parts.push(`Progress: ${checkpoint.progress}%`)

    if (injection.includePreviousArtifacts) {
      parts.push("\nPrevious work artifacts:")
      for (const [agentId, artifact] of Object.entries(checkpoint.workArtifacts)) {
        parts.push(`- ${agentId}: ${artifact.summary}`)
      }
    }

    return parts.join("\n")
  }

  private restartTaskStrategy(
    checkpoint: Checkpoint,
    context: ResumeContext
  ): ResumedExecution {
    return {
      teamState: {
        ...checkpoint.teamState,
        currentIteration: checkpoint.iteration,
        status: "running",
      },
      taskContract: checkpoint.taskContract,
      workArtifacts: new Map(),
      reviewArtifacts: new Map(),
      blackboardState: new Map(Object.entries(checkpoint.blackboardState)),
      resumeStrategy: "restart-task",
      pendingTasks: context.pendingTasks,
    }
  }

  private continueIterationStrategy(
    checkpoint: Checkpoint,
    context: ResumeContext
  ): ResumedExecution {
    return {
      teamState: checkpoint.teamState,
      taskContract: checkpoint.taskContract,
      workArtifacts: new Map(Object.entries(checkpoint.workArtifacts)),
      reviewArtifacts: new Map(Object.entries(checkpoint.reviewArtifacts)),
      blackboardState: new Map(Object.entries(checkpoint.blackboardState)),
      resumeStrategy: "continue-iteration",
      pendingTasks: context.pendingTasks,
    }
  }

  private skipCompletedStrategy(
    checkpoint: Checkpoint,
    context: ResumeContext
  ): ResumedExecution {
    return {
      teamState: {
        ...checkpoint.teamState,
        currentIteration: checkpoint.iteration + 1,
        status: "running",
      },
      taskContract: checkpoint.taskContract,
      workArtifacts: new Map(
        Object.entries(checkpoint.workArtifacts).filter(([k]) =>
          !context.completedTasks.includes(k)
        )
      ),
      reviewArtifacts: new Map(),
      blackboardState: new Map(Object.entries(checkpoint.blackboardState)),
      resumeStrategy: "skip-completed",
      pendingTasks: context.pendingTasks,
    }
  }
}

export function createCheckpointResumer(): CheckpointResumer {
  return new CheckpointResumer()
}
