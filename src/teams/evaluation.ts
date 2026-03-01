import type { WorkArtifact, ReviewArtifact } from "./contracts.js"

// ============================================================================
// Evaluation - LLM-as-Judge 评估系统
// ============================================================================

/**
 * Evaluation - 标准化评估系统
 *
 * 职责：
 * - 提供评估Rubric
 * - 生成评估报告
 * - 支持多维度评分
 */

/**
 * 评估维度
 */
export interface EvaluationDimension {
  name: string
  weight: number
  criteria: Record<number, string> // 1-5分的标准
}

/**
 * 默认评估维度
 */
export const DEFAULT_EVALUATION_DIMENSIONS: EvaluationDimension[] = [
  {
    name: "正确性",
    weight: 0.35,
    criteria: {
      5: "完全正确，逻辑严谨，无需任何修改",
      4: "基本正确，有小问题但不影响功能",
      3: "部分正确，需要调整部分实现",
      2: "有重大错误，需要大幅修改",
      1: "完全错误，无法运行",
    },
  },
  {
    name: "完整性",
    weight: 0.25,
    criteria: {
      5: "完整覆盖所有需求，无遗漏",
      4: "基本完整，有小的遗漏",
      3: "部分完整，有明显遗漏",
      2: "严重不完整",
      1: "几乎未完成",
    },
  },
  {
    name: "可维护性",
    weight: 0.20,
    criteria: {
      5: "代码清晰，架构合理，易于维护",
      4: "代码质量良好，有少量改进空间",
      3: "代码质量一般，存在一些坏味道",
      2: "代码质量差，难以维护",
      1: "无法维护",
    },
  },
  {
    name: "性能",
    weight: 0.20,
    criteria: {
      5: "性能优秀，无优化空间",
      4: "性能良好，有小优化空间",
      3: "性能一般，有明显优化空间",
      2: "性能较差",
      1: "性能严重问题",
    },
  },
]

/**
 * 评估Rubric
 */
export interface EvaluationRubric {
  dimensions: EvaluationDimension[]
  overallThreshold: number
}

/**
 * 评估结果
 */
export interface EvaluationResult {
  scores: DimensionScore[]
  overallScore: number
  passed: boolean
  improvementSuggestions: string[]
}

/**
 * 维度评分
 */
export interface DimensionScore {
  dimension: string
  score: number
  reasoning: string
}

/**
 * 评估器
 */
export class Evaluator {
  private rubric: EvaluationRubric

  constructor(rubric?: Partial<EvaluationRubric>) {
    this.rubric = {
      dimensions: rubric?.dimensions || DEFAULT_EVALUATION_DIMENSIONS,
      overallThreshold: rubric?.overallThreshold ?? 3.5,
    }
  }

  /**
   * 评估WorkArtifact
   */
  evaluate(artifact: WorkArtifact, review: ReviewArtifact): EvaluationResult {
    const scores: DimensionScore[] = []

    // 1. 正确性评估
    const correctnessScore = this.evaluateCorrectness(artifact, review)
    scores.push(correctnessScore)

    // 2. 完整性评估
    const completenessScore = this.evaluateCompleteness(artifact, review)
    scores.push(completenessScore)

    // 3. 可维护性评估
    const maintainabilityScore = this.evaluateMaintainability(artifact, review)
    scores.push(maintainabilityScore)

    // 4. 性能评估
    const performanceScore = this.evaluatePerformance(artifact, review)
    scores.push(performanceScore)

    // 计算总分
    const overallScore = this.calculateOverallScore(scores)

    // 生成改进建议
    const improvementSuggestions = this.generateSuggestions(scores)

    return {
      scores,
      overallScore,
      passed: overallScore >= this.rubric.overallThreshold,
      improvementSuggestions,
    }
  }

  /**
   * 评估正确性
   */
  private evaluateCorrectness(artifact: WorkArtifact, review: ReviewArtifact): DimensionScore {
    let score = 3 // 默认中等

    if (review.status === "approved") {
      score = 4
      if (review.mustFix.length === 0) {
        score = 5
      }
    } else {
      // 有mustFix，根据严重程度降分
      if (review.severity === "P0") {
        score = 1
      } else if (review.severity === "P1") {
        score = 2
      } else if (review.severity === "P2") {
        score = 3
      }
    }

    const dimension = this.rubric.dimensions.find((d) => d.name === "正确性")!
    return {
      dimension: "正确性",
      score,
      reasoning: dimension.criteria[score as keyof typeof dimension.criteria] || "",
    }
  }

  /**
   * 评估完整性
   */
  private evaluateCompleteness(artifact: WorkArtifact, review: ReviewArtifact): DimensionScore {
    let score = 3

    // 检查测试覆盖率
    const testPassed = artifact.testResults.filter((r) => r.passed).length
    const testTotal = artifact.testResults.length

    if (testTotal === 0) {
      score = 2
    } else if (testPassed === testTotal) {
      score = 4
      if (testTotal >= 5) {
        score = 5
      }
    } else if (testPassed / testTotal > 0.7) {
      score = 3
    } else {
      score = 2
    }

    const dimension = this.rubric.dimensions.find((d) => d.name === "完整性")!
    return {
      dimension: "完整性",
      score,
      reasoning: dimension.criteria[score as keyof typeof dimension.criteria] || "",
    }
  }

  /**
   * 评估可维护性
   */
  private evaluateMaintainability(_artifact: WorkArtifact, review: ReviewArtifact): DimensionScore {
    let score = 3

    // 根据suggestions数量评估
    if (review.suggestions.length <= 2) {
      score = 4
    } else if (review.suggestions.length > 5) {
      score = 2
    }

    const dimension = this.rubric.dimensions.find((d) => d.name === "可维护性")!
    return {
      dimension: "可维护性",
      score,
      reasoning: dimension.criteria[score as keyof typeof dimension.criteria] || "",
    }
  }

  /**
   * 评估性能
   */
  private evaluatePerformance(_artifact: WorkArtifact, _review: ReviewArtifact): DimensionScore {
    let score = 3

    // 简化处理：假设无性能问题为4分
    if (_review.performanceConcerns && _review.performanceConcerns.length === 0) {
      score = 4
    }

    const dimension = this.rubric.dimensions.find((d) => d.name === "性能")!
    return {
      dimension: "性能",
      score,
      reasoning: dimension.criteria[score as keyof typeof dimension.criteria] || "",
    }
  }

  /**
   * 计算总分
   */
  private calculateOverallScore(scores: DimensionScore[]): number {
    let total = 0

    for (const score of scores) {
      const dimension = this.rubric.dimensions.find((d) => d.name === score.dimension)
      if (dimension) {
        total += score.score * dimension.weight
      }
    }

    return Math.round(total * 10) / 10
  }

  /**
   * 生成改进建议
   */
  private generateSuggestions(scores: DimensionScore[]): string[] {
    const suggestions: string[] = []

    for (const score of scores) {
      if (score.score < 4) {
        const dimension = this.rubric.dimensions.find((d) => d.name === score.dimension)
        if (dimension && dimension.criteria[(score.score + 1) as keyof typeof dimension.criteria]) {
          suggestions.push(
            `${score.dimension}: ${dimension.criteria[(score.score + 1) as keyof typeof dimension.criteria]}`
          )
        }
      }
    }

    return suggestions
  }

  /**
   * 格式化评估报告
   */
  formatReport(result: EvaluationResult): string {
    const lines: string[] = []

    lines.push("# Evaluation Report")
    lines.push("")
    lines.push(`**Overall Score**: ${result.overallScore} / 5`)
    lines.push(`**Passed**: ${result.passed ? "✅" : "❌"}`)
    lines.push("")

    lines.push("## Dimension Scores")
    lines.push("")
    for (const score of result.scores) {
      const stars = "★".repeat(score.score) + "☆".repeat(5 - score.score)
      lines.push(`- ${score.dimension}: ${stars} (${score.score})`)
      lines.push(`  ${score.reasoning}`)
    }

    if (result.improvementSuggestions.length > 0) {
      lines.push("")
      lines.push("## Improvement Suggestions")
      lines.push("")
      for (const suggestion of result.improvementSuggestions) {
        lines.push(`- ${suggestion}`)
      }
    }

    return lines.join("\n")
  }
}

// ============================================================================
// 便捷函数
// ============================================================================

/**
 * 快速评估
 */
export function quickEvaluate(artifact: WorkArtifact, review: ReviewArtifact): EvaluationResult {
  const evaluator = new Evaluator()
  return evaluator.evaluate(artifact, review)
}
