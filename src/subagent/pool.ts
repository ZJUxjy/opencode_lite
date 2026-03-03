import { SubagentRunner, SubagentRunnerResult } from "./runner.js"

export interface SubagentPoolConfig {
  maxConcurrent: number
  workingDir: string
  parentSessionId: string
}

export interface SubagentTask {
  id: string
  objective: string
}

export class SubagentPool {
  private config: SubagentPoolConfig
  private runner: SubagentRunner

  constructor(config: SubagentPoolConfig) {
    this.config = config
    this.runner = new SubagentRunner({
      workingDir: config.workingDir,
      parentSessionId: config.parentSessionId,
    })
  }

  getMaxConcurrent(): number {
    return this.config.maxConcurrent
  }

  async executeParallel(tasks: SubagentTask[]): Promise<SubagentRunnerResult[]> {
    const results: SubagentRunnerResult[] = []

    // Execute in batches based on maxConcurrent
    for (let i = 0; i < tasks.length; i += this.config.maxConcurrent) {
      const batch = tasks.slice(i, i + this.config.maxConcurrent)
      const batchPromises = batch.map((task) =>
        this.runner.execute(task.id, task.objective)
      )

      const batchResults = await Promise.all(batchPromises)
      results.push(...batchResults)
    }

    return results
  }

  async executeWithRace(tasks: SubagentTask[]): Promise<SubagentRunnerResult> {
    const promises = tasks.map((task) =>
      this.runner.execute(task.id, task.objective)
    )

    return Promise.race(promises)
  }
}
