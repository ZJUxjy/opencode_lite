import { ConflictDetector } from "../conflict-detector.js"
import { TaskDagPlanner, type DagTask } from "../task-dag.js"
import type { TeamConfig } from "../types.js"

interface LeaderWorkersCallbacks {
  askLeader: (prompt: string) => Promise<{ output: string; tokensUsed: number }>
  askWorker: (prompt: string, workerIndex: number) => Promise<{ output: string; tokensUsed: number }>
}

export interface LeaderWorkersResult {
  status: "success" | "failure"
  output: string
  reviewRounds: number
  mustFixCount: number
  p0Count: number
  tokensUsed: number
  error?: string
}

export class LeaderWorkersMode {
  private readonly dag = new TaskDagPlanner()
  private readonly conflictDetector = new ConflictDetector()

  constructor(private config: TeamConfig) {}

  async run(task: string, callbacks: LeaderWorkersCallbacks): Promise<LeaderWorkersResult> {
    const strategy = this.config.strategy || "collaborative"
    return strategy === "competitive"
      ? this.runCompetitive(task, callbacks)
      : this.runCollaborative(task, callbacks)
  }

  private async runCollaborative(task: string, callbacks: LeaderWorkersCallbacks): Promise<LeaderWorkersResult> {
    let tokens = 0
    const leaderPlan = await callbacks.askLeader(this.buildDagPrompt(task))
    tokens += leaderPlan.tokensUsed
    const tasks = this.dag.parseOrFallback(leaderPlan.output)
    const layers = this.dag.executionLayers(tasks)

    const outputs: string[] = []
    const changedFileGroups: string[][] = []
    const workerSlots = Math.max(1, this.config.budget?.maxParallelAgents ?? 2)
    let nextWorkerIndex = 0

    for (const layer of layers) {
      const assignments = layer.map((sub) => {
        const assigned = nextWorkerIndex
        nextWorkerIndex = (nextWorkerIndex + 1) % workerSlots
        return { sub, workerIndex: assigned }
      })

      const layerResults = await this.runWithConcurrency(
        assignments,
        this.resolveLayerConcurrency(workerSlots, layer.length),
        async ({ sub, workerIndex }) => {
          const worker = await callbacks.askWorker(
            this.buildSubtaskPrompt(task, sub),
            workerIndex
          )
          return { subtaskId: sub.id, output: worker.output, tokensUsed: worker.tokensUsed }
        }
      )

      for (const result of layerResults) {
        tokens += result.tokensUsed
        outputs.push(`[${result.subtaskId}] ${result.output}`)
        changedFileGroups.push(this.conflictDetector.extractChangedFiles(result.output))
      }
    }

    const conflict = this.conflictDetector.detect(changedFileGroups)
    let integrationInput = outputs.join("\n\n")
    let mustFixCount = 0

    if (conflict.hasConflict) {
      if (this.config.conflictResolution === "auto") {
        const autoMerged = this.conflictDetector.autoMergeByFile(outputs)
        integrationInput = [
          "AUTO_MERGED_OUTPUTS",
          autoMerged.mergedOutput || outputs.join("\n\n"),
          "AUTO_MERGE_DECISIONS",
          ...autoMerged.decisions.map(
            (d) => `file=${d.file}; keptFrom=worker-${d.keptFrom}; replaced=${d.replaced.join(",")}; reason=${d.reason}`
          ),
        ].join("\n")
      } else {
        mustFixCount = conflict.files.length
      }
    }

    const integrationPrompt = [
      this.config.conflictResolution === "auto" ? "CONFLICT_MODE:AUTO" : "CONFLICT_MODE:MANUAL",
      "Integrate worker outputs into one coherent result.",
      conflict.hasConflict ? `Conflicts detected in files: ${conflict.files.join(", ")}` : "No file conflict detected.",
      "Outputs:",
      integrationInput,
    ].join("\n")

    const integrated = await callbacks.askLeader(integrationPrompt)
    tokens += integrated.tokensUsed

    return {
      status: "success",
      output: integrated.output,
      reviewRounds: 1,
      mustFixCount,
      p0Count: 0,
      tokensUsed: tokens,
    }
  }

  private async runCompetitive(task: string, callbacks: LeaderWorkersCallbacks): Promise<LeaderWorkersResult> {
    let tokens = 0
    const candidatePrompts = [
      `${task}\nApproach: prioritize implementation speed and minimal edits.`,
      `${task}\nApproach: prioritize long-term maintainability and testability.`,
      `${task}\nApproach: prioritize performance and scalability trade-offs.`,
    ]

    const candidates: string[] = []
    for (let i = 0; i < candidatePrompts.length; i++) {
      const out = await callbacks.askWorker(candidatePrompts[i], i)
      tokens += out.tokensUsed
      candidates.push(`Candidate ${i + 1}:\n${out.output}`)
    }

    const leaderDecision = await callbacks.askLeader(
      [
        "Choose best candidate and provide final merged output.",
        "Return format: CHOICE:<1|2|3> then FINAL: ...",
        candidates.join("\n\n"),
      ].join("\n")
    )
    tokens += leaderDecision.tokensUsed

    const final = this.extractFinal(leaderDecision.output)
    return {
      status: "success",
      output: final,
      reviewRounds: 1,
      mustFixCount: 0,
      p0Count: 0,
      tokensUsed: tokens,
    }
  }

  private buildDagPrompt(task: string): string {
    return [
      "You are Leader. Decompose task into a DAG JSON array.",
      'Return JSON only: [{"id":"task-1","title":"...","dependsOn":[]}]',
      ...(this.config.thinkingBudget?.enabled
        ? [`Thinking budget: up to ${this.config.thinkingBudget.maxThinkingTokens} tokens for decomposition.`]
        : []),
      "Task:",
      task,
    ].join("\n")
  }

  private buildSubtaskPrompt(task: string, subtask: DagTask): string {
    return [
      `Subtask ${subtask.id}: ${subtask.title}`,
      `Dependencies: ${subtask.dependsOn.join(", ") || "none"}`,
      "Original task:",
      task,
    ].join("\n")
  }

  private async runWithConcurrency<TIn, TOut>(
    items: TIn[],
    concurrency: number,
    run: (item: TIn) => Promise<TOut>
  ): Promise<TOut[]> {
    const results: TOut[] = []
    let index = 0

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (index < items.length) {
        const current = index
        index += 1
        const result = await run(items[current])
        results[current] = result
      }
    })

    await Promise.all(workers)
    return results
  }

  private extractFinal(output: string): string {
    const marker = output.indexOf("FINAL:")
    if (marker >= 0) return output.slice(marker + "FINAL:".length).trim()
    return output
  }

  private resolveLayerConcurrency(workerSlots: number, layerSize: number): number {
    const strategy = this.config.parallelStrategy
    if (!strategy || strategy.mode === "parallel") {
      return Math.min(workerSlots, layerSize)
    }
    if (strategy.mode === "sequential") {
      return 1
    }

    const adaptive = strategy.adaptive
    if (!adaptive) return Math.min(workerSlots, layerSize)
    const scaled = layerSize >= adaptive.scaleUpThreshold ? adaptive.maxParallelism : adaptive.minParallelism
    return Math.max(1, Math.min(workerSlots, layerSize, scaled))
  }
}
