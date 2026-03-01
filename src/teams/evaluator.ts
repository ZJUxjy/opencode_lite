import type { EvaluationRubric } from "./types.js"

export interface JudgementResult {
  scores: Array<{
    dimension: string
    score: number
    reasoning: string
  }>
  overallScore: number
  passed: boolean
  improvementSuggestions: string[]
}

export class RubricEvaluator {
  buildJudgePrompt(rubric: EvaluationRubric, task: string, output: string): string {
    const dimensions = rubric.dimensions
      .map((d) => `- ${d.name} (weight=${d.weight}, scale=1-${d.scale})`)
      .join("\n")
    return [
      "You are an evaluation judge. Return JSON only.",
      '{"scores":[{"dimension":"...","score":1,"reasoning":"..."}],"overallScore":0,"passed":false,"improvementSuggestions":["..."]}',
      "Rubric dimensions:",
      dimensions,
      `Pass threshold: overallScore >= ${rubric.overallThreshold}`,
      "Task:",
      task,
      "Candidate output:",
      output,
    ].join("\n")
  }

  parseJudgeResult(output: string): JudgementResult {
    const fallback: JudgementResult = {
      scores: [],
      overallScore: 0,
      passed: false,
      improvementSuggestions: ["Judge output parse failed."],
    }
    const match = output.match(/\{[\s\S]*\}/)
    if (!match) return fallback
    try {
      const parsed = JSON.parse(match[0])
      return {
        scores: Array.isArray(parsed.scores)
          ? parsed.scores.map((s: any) => ({
              dimension: String(s.dimension || "unknown"),
              score: Number(s.score || 0),
              reasoning: String(s.reasoning || ""),
            }))
          : [],
        overallScore: Number(parsed.overallScore || 0),
        passed: Boolean(parsed.passed),
        improvementSuggestions: Array.isArray(parsed.improvementSuggestions)
          ? parsed.improvementSuggestions.map((v: unknown) => String(v))
          : [],
      }
    } catch {
      return fallback
    }
  }
}
