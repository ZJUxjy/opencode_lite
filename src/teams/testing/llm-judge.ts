import { z } from "zod"
import type { WorkArtifact } from "../core/contracts.js"

// Evaluation Rubric Types
export interface EvaluationDimension {
  name: string
  weight: number // 0-1
  scale: 1 | 2 | 3 | 4 | 5
  criteria: Record<string, string>
  examples?: string[]
}

export interface EvaluationRubric {
  dimensions: EvaluationDimension[]
  overallThreshold: number
}

export interface JudgementResult {
  scores: Array<{
    dimension: string
    score: number
    reasoning: string
  }>
  overallScore: number
  passed: boolean
  improvementSuggestions: string[]
  evaluationTime: number
}

// Default Code Quality Rubric
export const DEFAULT_CODE_QUALITY_RUBRIC: EvaluationRubric = {
  dimensions: [
    {
      name: "correctness",
      weight: 0.35,
      scale: 5,
      criteria: {
        "5": "Completely correct, handles all edge cases",
        "4": "Mostly correct, minor edge cases missed",
        "3": "Partially correct, some bugs present",
        "2": "Significant errors, needs rework",
        "1": "Fundamentally incorrect",
      },
    },
    {
      name: "completeness",
      weight: 0.25,
      scale: 5,
      criteria: {
        "5": "All requirements fully implemented",
        "4": "Most requirements met, minor gaps",
        "3": "Core requirements met, some missing",
        "2": "Partial implementation",
        "1": "Barely started",
      },
    },
    {
      name: "maintainability",
      weight: 0.20,
      scale: 5,
      criteria: {
        "5": "Clean, well-documented, easy to understand",
        "4": "Good structure, minor improvements needed",
        "3": "Acceptable but could be cleaner",
        "2": "Hard to follow, needs refactoring",
        "1": "Unmaintainable spaghetti code",
      },
    },
    {
      name: "performance",
      weight: 0.20,
      scale: 5,
      criteria: {
        "5": "Optimal performance, no issues",
        "4": "Good performance, minor optimizations possible",
        "3": "Acceptable performance",
        "2": "Noticeable performance issues",
        "1": "Severe performance problems",
      },
    },
  ],
  overallThreshold: 3.5,
}

// LLM Judge Config
export interface LLMJudgeConfig {
  model: string
  apiKey: string
  baseURL: string
  rubric: EvaluationRubric
  maxRetries: number
}

// LLM Judge Class
export class LLMJudge {
  private config: LLMJudgeConfig

  constructor(config: Partial<LLMJudgeConfig> = {}) {
    this.config = {
      model: "claude-sonnet-4",
      apiKey: process.env.ANTHROPIC_API_KEY || "",
      baseURL: "https://api.anthropic.com",
      rubric: DEFAULT_CODE_QUALITY_RUBRIC,
      maxRetries: 3,
      ...config,
    }
  }

  async evaluate(
    artifact: WorkArtifact,
    originalTask: string
  ): Promise<JudgementResult> {
    const startTime = Date.now()

    // Build evaluation prompt
    const prompt = this.buildEvaluationPrompt(artifact, originalTask)

    // Call LLM for evaluation (mock for now)
    const evaluation = await this.callLLM(prompt)

    // Parse result
    const scores = this.parseEvaluation(evaluation)
    const overallScore = this.calculateOverallScore(scores)

    return {
      scores,
      overallScore,
      passed: overallScore >= this.config.rubric.overallThreshold,
      improvementSuggestions: this.generateSuggestions(scores),
      evaluationTime: Date.now() - startTime,
    }
  }

  private buildEvaluationPrompt(
    artifact: WorkArtifact,
    originalTask: string
  ): string {
    const rubricText = this.config.rubric.dimensions
      .map(d => {
        const criteria = Object.entries(d.criteria)
          .map(([score, desc]) => `  ${score}: ${desc}`)
          .join("\n")
        return `${d.name} (weight: ${d.weight}):\n${criteria}`
      })
      .join("\n\n")

    return `Evaluate this work artifact against the task requirements.\n\n` +
      `## Original Task\n${originalTask}\n\n` +
      `## Work Summary\n${artifact.summary}\n\n` +
      `## Changed Files\n${artifact.changedFiles.join("\n")}\n\n` +
      `## Test Results\n${artifact.testResults.map(t =>
        `- ${t.command}: ${t.passed ? "PASSED" : "FAILED"}`
      ).join("\n")}\n\n` +
      `## Rubric\n${rubricText}\n\n` +
      `Return JSON: {"scores": [{"dimension": "...", "score": 4, "reasoning": "..."}], "suggestions": ["..."]}`
  }

  private async callLLM(prompt: string): Promise<string> {
    // Mock implementation - would use actual LLM client
    return JSON.stringify({
      scores: this.config.rubric.dimensions.map(d => ({
        dimension: d.name,
        score: Math.floor(Math.random() * 2) + 3,
        reasoning: `Mock evaluation for ${d.name}`,
      })),
      suggestions: ["Add more tests", "Improve documentation"],
    })
  }

  private parseEvaluation(evaluation: string): JudgementResult["scores"] {
    try {
      const parsed = JSON.parse(evaluation)
      return parsed.scores || []
    } catch {
      return this.config.rubric.dimensions.map(d => ({
        dimension: d.name,
        score: 3,
        reasoning: "Failed to parse evaluation",
      }))
    }
  }

  private calculateOverallScore(
    scores: JudgementResult["scores"]
  ): number {
    let totalWeight = 0
    let weightedSum = 0

    for (const dimension of this.config.rubric.dimensions) {
      const score = scores.find(s => s.dimension === dimension.name)?.score || 0
      weightedSum += score * dimension.weight
      totalWeight += dimension.weight
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0
  }

  private generateSuggestions(
    scores: JudgementResult["scores"]
  ): string[] {
    return scores
      .filter(s => s.score < 4)
      .map(s => `${s.dimension}: ${s.reasoning}`)
  }
}

export function createLLMJudge(config?: Partial<LLMJudgeConfig>): LLMJudge {
  return new LLMJudge(config)
}
