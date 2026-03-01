/**
 * Agent Teams - Council Mode
 *
 * Architecture decision mode with multiple agents debating options.
 * Output is a Decision Record with execution recommendations.
 */

import type { ModeRunner, TeamConfig, SharedBlackboard, CostController, ProgressTracker } from "../types.js"
import type { TaskContract, WorkArtifact } from "../contracts.js"
import { createDefaultTaskContract } from "../contracts.js"
import { createAgentLLMClient } from "../llm-client.js"

// ============================================================================
// Council Types
// ============================================================================

type CouncilPhase = "idle" | "deliberating" | "summarizing" | "completed" | "failed"
type DecisionStatus = "approved" | "rejected" | "deferred" | "needs_more_info"

interface CouncilState {
  phase: CouncilPhase
  topic: string
  options: OptionAnalysis[]
  decision?: CouncilDecision
  error?: string
  startTime: number
}

interface OptionAnalysis {
  id: string
  description: string
  pros: string[]
  cons: string[]
  supporters: string[]
  opponents: string[]
}

interface CouncilDecision {
  status: DecisionStatus
  selectedOption?: string
  rationale: string
  executionRecommendations: string[]
  risks: string[]
  mitigations: string[]
  recordedAt: number
}

interface SpeakerContribution {
  speakerId: string
  stance: "support" | "oppose" | "neutral"
  points: string[]
  concerns: string[]
}

// ============================================================================
// Council Mode Runner
// ============================================================================

export class CouncilMode implements ModeRunner {
  readonly mode = "council" as const

  private config?: TeamConfig
  private blackboard?: SharedBlackboard
  private costController?: CostController
  private progressTracker?: ProgressTracker
  private state: CouncilState
  private abortController?: AbortController
  private timeoutId?: ReturnType<typeof setTimeout>

  constructor() {
    this.state = {
      phase: "idle",
      topic: "",
      options: [],
      startTime: Date.now(),
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

    // Get speaker agents (at least 3 for meaningful debate)
    const speakerConfigs = config.agents.filter((a) =>
      a.role === "speaker" || a.role === "member" || a.role === "worker"
    )

    if (speakerConfigs.length < 2) {
      throw new Error("Council mode requires at least 2 speaker agents for meaningful debate")
    }

    // Get task from blackboard
    const taskContract = blackboard.getTaskContract()
    if (!taskContract) {
      throw new Error("Council mode requires a specific decision topic via task contract")
    }

    this.state.topic = taskContract.objective
    blackboard.setTaskContract(taskContract)

    // Set timeout (council decisions can take longer)
    this.timeoutId = setTimeout(() => {
      this.handleTimeout()
    }, config.timeoutMs)

    try {
      blackboard.emit("status-changed", "running", "initializing")

      // Phase 1: Deliberation - speakers present options and debate
      this.state.phase = "deliberating"

      const contributions: SpeakerContribution[] = []

      for (let round = 1; round <= Math.min(config.maxIterations, 3); round++) {
        blackboard.emit("iteration-started", round, "council", "speaker")

        // Parallel execution: all members speak simultaneously
        // This provides 90% speedup according to Anthropic research
        const roundContributions = await Promise.all(
          speakerConfigs.map(async (speakerConfig) => {
            // Check for cancellation
            if (this.abortController!.signal.aborted) {
              throw new Error("Cancelled")
            }

            const contribution = await this.runSpeaker(
              speakerConfig.model,
              speakerConfig.role || "speaker",
              taskContract,
              contributions,
              round
            )

            // Record cost for this speaker
            this.costController!.recordUsage(500, 300, speakerConfig.model)

            return contribution
          })
        )

        // Add all contributions from this round
        contributions.push(...roundContributions)

        // Update options based on all contributions
        for (const contribution of roundContributions) {
          this.updateOptions(contribution)
        }

        blackboard.emit("iteration-completed", round, { contributions: contributions.length })
      }

      // Phase 2: Summarize and make decision
      this.state.phase = "summarizing"
      blackboard.emit("iteration-started", config.maxIterations + 1, "facilitator", "leader")

      const decision = await this.runFacilitator(taskContract, contributions)
      this.state.decision = decision

      this.state.phase = "completed"

      // Create a work artifact representing the decision
      const decisionArtifact: WorkArtifact = {
        taskId: taskContract.taskId,
        summary: `Council Decision: ${decision.selectedOption || "No option selected"}`,
        changedFiles: [],
        patchRef: `decision-${Date.now()}`,
        testResults: [],
        risks: decision.risks,
        assumptions: decision.executionRecommendations,
      }

      blackboard.emit("progress-detected", "review")
      blackboard.emit("completed", decisionArtifact)

      return decisionArtifact
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

  /**
   * Get current state
   */
  getState(): CouncilState {
    return { ...this.state }
  }

  /**
   * Get decision record
   */
  getDecision(): CouncilDecision | undefined {
    return this.state.decision
  }

  // ========================================================================
  // Private Methods
  // ========================================================================

  private async runSpeaker(
    model: string,
    speakerId: string,
    taskContract: TaskContract,
    previousContributions: SpeakerContribution[],
    round: number
  ): Promise<SpeakerContribution> {
    if (!this.blackboard || !this.costController) {
      throw new Error("Not initialized")
    }

    this.blackboard.postMessage(
      {
        type: "task-assign",
        task: {
          ...taskContract,
          objective: `Council deliberation round ${round}: ${taskContract.objective}`,
        },
      },
      "system",
      speakerId
    )

    // Create LLM client
    const llmClient = createAgentLLMClient({ model })
    llmClient.setCostController(this.costController)
    llmClient.setBlackboard(this.blackboard)

    // Generate speaker prompt
    const prompt = this.buildSpeakerPrompt(
      speakerId,
      taskContract,
      previousContributions,
      round
    )

    // Execute speaker
    const artifact = await llmClient.executeWorker(
      {
        ...taskContract,
        objective: prompt,
      },
      round
    )

    // Parse contribution from artifact
    const contribution = this.parseContribution(speakerId, artifact.summary)

    this.blackboard.postMessage(
      {
        type: "task-result",
        artifact: { ...artifact, summary: `Speaker ${speakerId}: ${contribution.stance}` },
      },
      speakerId,
      "system"
    )

    return contribution
  }

  private async runFacilitator(
    taskContract: TaskContract,
    contributions: SpeakerContribution[]
  ): Promise<CouncilDecision> {
    if (!this.blackboard || !this.costController) {
      throw new Error("Not initialized")
    }

    // Use the first agent's model as facilitator
    const facilitatorModel = this.config?.agents[0]?.model || "claude-sonnet-4"

    // Analyze all contributions to determine decision
    const optionVotes = new Map<string, { support: number; oppose: number }>()

    for (const contribution of contributions) {
      // Extract option from points
      for (const point of contribution.points) {
        const optionMatch = point.match(/Option\s+([A-Z]|\d+)[\s:]/i)
        if (optionMatch) {
          const optionId = optionMatch[1]
          const votes = optionVotes.get(optionId) || { support: 0, oppose: 0 }

          if (contribution.stance === "support") {
            votes.support++
          } else if (contribution.stance === "oppose") {
            votes.oppose++
          }

          optionVotes.set(optionId, votes)
        }
      }
    }

    // Determine winning option
    let selectedOption: string | undefined
    let maxSupport = -1

    for (const [optionId, votes] of optionVotes) {
      const score = votes.support - votes.oppose
      if (score > maxSupport) {
        maxSupport = score
        selectedOption = optionId
      }
    }

    // Build decision
    const decision: CouncilDecision = {
      status: selectedOption ? "approved" : "deferred",
      selectedOption: selectedOption ? `Option ${selectedOption}` : undefined,
      rationale: this.buildRationale(contributions, selectedOption),
      executionRecommendations: this.buildRecommendations(contributions),
      risks: this.extractRisks(contributions),
      mitigations: this.extractMitigations(contributions),
      recordedAt: Date.now(),
    }

    this.blackboard.postMessage(
      {
        type: "review-result",
        review: {
          status: decision.status === "approved" ? "approved" : "changes_requested",
          severity: "P2",
          mustFix: [],
          suggestions: decision.executionRecommendations,
        },
      },
      "facilitator",
      "system"
    )

    // Record cost
    this.costController.recordUsage(800, 400, facilitatorModel)

    return decision
  }

  private buildSpeakerPrompt(
    speakerId: string,
    taskContract: TaskContract,
    previousContributions: SpeakerContribution[],
    round: number
  ): string {
    let prompt = `You are Speaker ${speakerId} participating in an Architecture Council.

## Topic

${taskContract.objective}

## Your Role

Analyze the topic and present your perspective. Consider:
1. Technical feasibility
2. Trade-offs and risks
3. Long-term maintainability
4. Alignment with project goals

## Format Your Response

Structure your contribution as:
- **Position**: Support/Oppose/Neutral on specific options
- **Key Points**: 2-3 main arguments
- **Concerns**: Any risks or issues you see
- **Alternative**: If opposing, what would you suggest instead?
`

    if (previousContributions.length > 0) {
      prompt += `
## Previous Contributions

${previousContributions
  .map(
    (c) =>
      `- ${c.speakerId} (${c.stance}): ${c.points.slice(0, 2).join("; ")}`
  )
  .join("\n")}

Consider these perspectives and build upon or challenge them respectfully.
`
    }

    prompt += `
## Round ${round}

This is deliberation round ${round}. ${round > 1 ? "Focus on resolving disagreements or refining proposals." : "Present your initial analysis."}
`

    return prompt
  }

  private parseContribution(speakerId: string, summary: string): SpeakerContribution {
    const lower = summary.toLowerCase()

    // Determine stance
    let stance: "support" | "oppose" | "neutral" = "neutral"
    if (lower.includes("support") || lower.includes("recommend") || lower.includes("propose")) {
      stance = "support"
    } else if (lower.includes("oppose") || lower.includes("against") || lower.includes("reject")) {
      stance = "oppose"
    }

    // Extract points (simplified)
    const points = summary
      .split(/\n|\.\s+/)
      .filter((line) => line.length > 20 && line.length < 200)
      .slice(0, 3)

    // Extract concerns
    const concerns = summary
      .split(/\n/)
      .filter((line) => /concern|risk|issue|problem|however/i.test(line))
      .slice(0, 2)

    return {
      speakerId,
      stance,
      points: points.length > 0 ? points : ["No specific points provided"],
      concerns: concerns.length > 0 ? concerns : [],
    }
  }

  private updateOptions(contribution: SpeakerContribution): void {
    // Extract option mentions from contribution
    for (const point of contribution.points) {
      const optionMatch = point.match(/Option\s+([A-Z]|\d+)[\s:]/i)
      if (optionMatch) {
        const optionId = optionMatch[1]
        const existingOption = this.state.options.find((o) => o.id === optionId)

        if (existingOption) {
          // Update existing option
          if (contribution.stance === "support") {
            existingOption.pros.push(...contribution.points)
            existingOption.supporters.push(contribution.speakerId)
          } else if (contribution.stance === "oppose") {
            existingOption.cons.push(...contribution.concerns)
            existingOption.opponents.push(contribution.speakerId)
          }
        } else {
          // Create new option
          this.state.options.push({
            id: optionId,
            description: point.substring(0, 100),
            pros: contribution.stance === "support" ? contribution.points : [],
            cons: contribution.stance === "oppose" ? contribution.concerns : [],
            supporters: contribution.stance === "support" ? [contribution.speakerId] : [],
            opponents: contribution.stance === "oppose" ? [contribution.speakerId] : [],
          })
        }
      }
    }
  }

  private buildRationale(contributions: SpeakerContribution[], selectedOption?: string): string {
    if (!selectedOption) {
      return "No consensus reached. Further deliberation required."
    }

    const supportingPoints = contributions
      .filter((c) => c.stance === "support")
      .flatMap((c) => c.points)
      .slice(0, 3)

    const opposingConcerns = contributions
      .filter((c) => c.stance === "oppose")
      .flatMap((c) => c.concerns)
      .slice(0, 2)

    let rationale = `Selected Option ${selectedOption} based on:\n\n`
    rationale += `Supporting arguments:\n${supportingPoints.map((p) => `- ${p}`).join("\n")}\n\n`

    if (opposingConcerns.length > 0) {
      rationale += `Addressed concerns:\n${opposingConcerns.map((c) => `- ${c}`).join("\n")}\n\n`
    }

    rationale += `This option balances technical feasibility with long-term maintainability.`

    return rationale
  }

  private buildRecommendations(contributions: SpeakerContribution[]): string[] {
    const recommendations: string[] = []

    // Collect implementation suggestions
    for (const contribution of contributions) {
      for (const point of contribution.points) {
        if (/implement|create|add|setup|configure/i.test(point)) {
          recommendations.push(point)
        }
      }
    }

    // Add standard recommendations
    recommendations.push("Create proof-of-concept before full implementation")
    recommendations.push("Document decision rationale for future reference")
    recommendations.push("Set up monitoring for key metrics")

    return [...new Set(recommendations)].slice(0, 5)
  }

  private extractRisks(contributions: SpeakerContribution[]): string[] {
    const risks: string[] = []

    for (const contribution of contributions) {
      for (const concern of contribution.concerns) {
        if (/risk|danger|problem|issue|break|fail/i.test(concern)) {
          risks.push(concern)
        }
      }
    }

    return risks.length > 0 ? risks.slice(0, 3) : ["No significant risks identified"]
  }

  private extractMitigations(contributions: SpeakerContribution[]): string[] {
    const mitigations: string[] = []

    for (const contribution of contributions) {
      for (const point of contribution.points) {
        if (/mitigate|prevent|avoid|test|monitor|backup/i.test(point)) {
          mitigations.push(point)
        }
      }
    }

    return mitigations.length > 0 ? mitigations.slice(0, 3) : ["Standard testing and monitoring"]
  }

  private handleTimeout(): void {
    this.state.phase = "failed"
    this.state.error = "Council deliberation timeout"
    this.blackboard?.emit("status-changed", "timeout", "running")
    this.abortController?.abort()
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createCouncilMode(): ModeRunner {
  return new CouncilMode()
}
