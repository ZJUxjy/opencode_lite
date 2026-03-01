/**
 * Evaluation Rubric - LLM-as-Judge 评估标准
 *
 * 基于 agent-teams-supplement.md 原则 3: LLM-as-Judge Evaluation
 *
 * 提供标准化的评估框架，使 Reviewer 的评估可复现、可比较。
 */

import type { WorkArtifact, ReviewArtifact, ReviewComment } from "./contracts.js"

/**
 * 评分等级
 */
export type ScoreLevel = 1 | 2 | 3 | 4 | 5

/**
 * 评估维度
 */
export interface EvaluationDimension {
  /** 维度名称 */
  name: string
  /** 维度描述 */
  description: string
  /** 权重 (0-1) */
  weight: number
  /** 评分等级 (1-5) */
  scale: readonly [1, 2, 3, 4, 5]
  /** 每个等级的标准描述 */
  criteria: Record<ScoreLevel, string>
  /** 评估示例 */
  examples?: string[]
}

/**
 * 评估 Rubric
 */
export interface EvaluationRubric {
  /** Rubric 名称 */
  name: string
  /** Rubric 描述 */
  description: string
  /** 评估维度 */
  dimensions: EvaluationDimension[]
  /** 整体通过阈值 */
  overallThreshold: number
  /** 版本号 */
  version: string
}

/**
 * 维度评分
 */
export interface DimensionScore {
  /** 维度名称 */
  dimension: string
  /** 评分 (1-5) */
  score: ScoreLevel
  /** 评分理由 */
  reasoning: string
  /** 具体问题 */
  issues?: string[]
}

/**
 * 评估结果
 */
export interface JudgementResult {
  /** 产物 ID */
  artifactId: string
  /** 各维度评分 */
  scores: DimensionScore[]
  /** 加权总分 */
  overallScore: number
  /** 是否通过 */
  passed: boolean
  /** 改进建议 */
  improvementSuggestions: string[]
  /** 评估时间 */
  timestamp: number
  /** 使用的 Rubric */
  rubricName: string
}

/**
 * 默认代码评估 Rubric
 */
export const DEFAULT_CODE_RUBRIC: EvaluationRubric = {
  name: "Code Quality Rubric",
  description: "Standard rubric for evaluating code changes",
  version: "1.0.0",
  overallThreshold: 3.5,
  dimensions: [
    {
      name: "正确性",
      description: "代码是否正确实现了需求",
      weight: 0.35,
      scale: [1, 2, 3, 4, 5],
      criteria: {
        1: "完全错误，与需求无关",
        2: "有重大错误，需要大量修改",
        3: "部分正确，需要调整",
        4: "基本正确，有小问题",
        5: "完全正确，无需修改",
      },
      examples: [
        "5: 代码完全符合需求描述，所有边界情况都处理了",
        "3: 实现了主要功能，但遗漏了一些边界情况",
        "1: 代码与需求完全不符",
      ],
    },
    {
      name: "完整性",
      description: "是否完成了所有必要的工作",
      weight: 0.25,
      scale: [1, 2, 3, 4, 5],
      criteria: {
        1: "严重缺失，大量必要工作未完成",
        2: "缺失较多，许多必要工作未完成",
        3: "基本完整，有少量遗漏",
        4: "完整，只有极小的遗漏",
        5: "完全完整，没有任何遗漏",
      },
      examples: [
        "5: 所有文件都已修改，测试已添加，文档已更新",
        "3: 修改了主要文件，但没有添加测试",
        "1: 只修改了一个文件，其他必要修改都没有",
      ],
    },
    {
      name: "可维护性",
      description: "代码是否易于理解和维护",
      weight: 0.20,
      scale: [1, 2, 3, 4, 5],
      criteria: {
        1: "代码混乱，几乎无法维护",
        2: "代码结构差，难以维护",
        3: "代码一般，可维护性一般",
        4: "代码结构良好，易于维护",
        5: "代码结构优秀，非常易于维护",
      },
      examples: [
        "5: 代码清晰、命名规范、有适当注释、遵循最佳实践",
        "3: 代码可读但命名不够清晰",
        "1: 代码混乱、命名随意、没有注释",
      ],
    },
    {
      name: "性能",
      description: "代码的性能是否合理",
      weight: 0.20,
      scale: [1, 2, 3, 4, 5],
      criteria: {
        1: "性能极差，有明显性能问题",
        2: "性能较差，需要优化",
        3: "性能一般，可接受",
        4: "性能良好，没有明显问题",
        5: "性能优秀，经过优化",
      },
      examples: [
        "5: 使用了最优算法，考虑了性能优化",
        "3: 使用了普通实现，性能可接受",
        "1: 使用了低效算法，有明显性能瓶颈",
      ],
    },
  ],
}

/**
 * Rubric 评估器
 */
export class RubricEvaluator {
  private rubric: EvaluationRubric

  constructor(rubric: EvaluationRubric = DEFAULT_CODE_RUBRIC) {
    this.rubric = rubric
  }

  /**
   * 获取当前 Rubric
   */
  getRubric(): EvaluationRubric {
    return this.rubric
  }

  /**
   * 生成评估提示
   */
  generateEvaluationPrompt(artifact: WorkArtifact): string {
    const dimensionDescriptions = this.rubric.dimensions
      .map(d => {
        const criteriaList = Object.entries(d.criteria)
          .map(([level, desc]) => `  ${level}: ${desc}`)
          .join("\n")
        return `### ${d.name} (权重: ${(d.weight * 100).toFixed(0)}%)
${d.description}

评分标准:
${criteriaList}
${d.examples ? `\n示例:\n${d.examples.map(e => `  - ${e}`).join("\n")}` : ""}`
      })
      .join("\n\n")

    return `你是一个代码审查专家。请评估以下工作产物。

## 工作产物信息
- 任务 ID: ${artifact.taskId}
- Agent: ${artifact.agentId} (${artifact.agentRole})
- 摘要: ${artifact.summary}
- 修改文件: ${artifact.changedFiles.join(", ")}
- 测试结果: ${artifact.testResults.length > 0 ? artifact.testResults.map(t => `${t.command}: ${t.passed ? "通过" : "失败"}`).join(", ") : "无"}
- 风险: ${artifact.risks.length > 0 ? artifact.risks.join("; ") : "无"}
- 假设: ${artifact.assumptions.length > 0 ? artifact.assumptions.join("; ") : "无"}

## 评估维度
${dimensionDescriptions}

## 评估要求
1. 对每个维度给出 1-5 分的评分
2. 为每个评分提供理由
3. 列出发现的具体问题
4. 给出改进建议
5. 总分低于 ${this.rubric.overallThreshold} 分视为不通过

## 输出格式
请按以下格式输出评估结果:

\`\`\`
EVALUATION_RESULT:
${this.rubric.dimensions.map(d => `${d.name.toUpperCase()}_SCORE: <1-5>`).join("\n")}
${this.rubric.dimensions.map(d => `${d.name.toUpperCase()}_REASONING: <理由>`).join("\n")}
${this.rubric.dimensions.map(d => `${d.name.toUpperCase()}_ISSUES: <问题列表，用分号分隔>`).join("\n")}
IMPROVEMENT_SUGGESTIONS:
- 建议1
- 建议2
OVERALL_ASSESSMENT: <通过/不通过>
\`\`\`
`
  }

  /**
   * 解析评估结果
   */
  parseEvaluationResult(response: string, artifactId: string): JudgementResult {
    const scores: DimensionScore[] = []
    let overallScore = 0

    for (const dimension of this.rubric.dimensions) {
      const scoreMatch = response.match(
        new RegExp(`${dimension.name.toUpperCase()}_SCORE:\\s*([1-5])`, "i")
      )
      const reasoningMatch = response.match(
        new RegExp(`${dimension.name.toUpperCase()}_REASONING:\\s*(.+?)(?=${this.rubric.dimensions.map(d => d.name.toUpperCase()).join("|")}_|IMPROVEMENT|OVERALL|$)`, "is")
      )
      const issuesMatch = response.match(
        new RegExp(`${dimension.name.toUpperCase()}_ISSUES:\\s*(.+?)(?=${this.rubric.dimensions.map(d => d.name.toUpperCase()).join("|")}_|IMPROVEMENT|OVERALL|$)`, "is")
      )

      const score = (parseInt(scoreMatch?.[1] || "3") as ScoreLevel) || 3
      const reasoning = reasoningMatch?.[1]?.trim() || ""
      const issuesText = issuesMatch?.[1]?.trim() || ""
      const issues = issuesText
        .split(/[;；\n]/)
        .map(s => s.trim())
        .filter(s => s.length > 0 && s !== "无" && s !== "None")

      scores.push({
        dimension: dimension.name,
        score,
        reasoning,
        issues: issues.length > 0 ? issues : undefined,
      })

      overallScore += score * dimension.weight
    }

    // 解析改进建议
    const suggestionsMatch = response.match(/IMPROVEMENT_SUGGESTIONS:\s*([\s\S]+?)(?=OVERALL_ASSESSMENT|$)/i)
    const suggestionsText = suggestionsMatch?.[1] || ""
    const improvementSuggestions = suggestionsText
      .split(/[\n-]/)
      .map(s => s.trim())
      .filter(s => s.length > 0)

    // 判断是否通过
    const passed = overallScore >= this.rubric.overallThreshold

    return {
      artifactId,
      scores,
      overallScore,
      passed,
      improvementSuggestions,
      timestamp: Date.now(),
      rubricName: this.rubric.name,
    }
  }

  /**
   * 将评估结果转换为 ReviewArtifact
   */
  toReviewArtifact(
    judgement: JudgementResult,
    workArtifact: WorkArtifact,
    reviewerId: string
  ): ReviewArtifact {
    const mustFix: ReviewComment[] = []
    const suggestions: ReviewComment[] = []

    // 映射维度名称到 category
    const dimensionToCategory = (dimension: string): ReviewComment["category"] => {
      const mapping: Record<string, ReviewComment["category"]> = {
        "正确性": "bug",
        "性能": "performance",
        "可维护性": "style",
        "安全性": "security",
      }
      return mapping[dimension] || "other"
    }

    // 收集必须修复的问题
    for (const score of judgement.scores) {
      if (score.score <= 2 && score.issues) {
        for (const issue of score.issues) {
          mustFix.push({
            message: `[${score.dimension}] ${issue}`,
            category: dimensionToCategory(score.dimension),
          })
        }
      }
    }

    // 收集改进建议
    for (const suggestion of judgement.improvementSuggestions) {
      suggestions.push({
        message: suggestion,
        category: "other",
      })
    }

    // 如果总分低但没收集到必须修复的问题，添加一个通用问题
    if (!judgement.passed && mustFix.length === 0) {
      mustFix.push({
        message: `整体评分 ${judgement.overallScore.toFixed(2)} 低于阈值 ${this.rubric.overallThreshold}`,
        category: "other",
      })
    }

    // 确定严重级别
    let severity: ReviewArtifact["severity"] = "P3"
    if (!judgement.passed) {
      if (judgement.overallScore < 2.0) {
        severity = "P0"
      } else if (judgement.overallScore < 2.5) {
        severity = "P1"
      } else if (judgement.overallScore < 3.0) {
        severity = "P2"
      }
    }

    return {
      workArtifactId: workArtifact.taskId,
      reviewerId,
      status: judgement.passed ? "approved" : "changes_requested",
      severity,
      mustFix,
      suggestions,
      createdAt: Date.now(),
    }
  }

  /**
   * 格式化评估结果为 Markdown
   */
  formatJudgementResult(judgement: JudgementResult): string {
    const lines = [
      `# Evaluation Result`,
      ``,
      `**Artifact**: ${judgement.artifactId}`,
      `**Rubric**: ${judgement.rubricName}`,
      `**Overall Score**: ${judgement.overallScore.toFixed(2)} / 5.00`,
      `**Status**: ${judgement.passed ? "✅ PASSED" : "❌ NEEDS REVISION"}`,
      `**Evaluated**: ${new Date(judgement.timestamp).toISOString()}`,
      ``,
      `## Dimension Scores`,
      ``,
    ]

    for (const score of judgement.scores) {
      const dimension = this.rubric.dimensions.find(d => d.name === score.dimension)
      const weight = dimension ? (dimension.weight * 100).toFixed(0) : "0"
      const scoreBar = "█".repeat(score.score) + "░".repeat(5 - score.score)

      lines.push(`### ${score.dimension} (${weight}%)`)
      lines.push(`Score: ${score.score}/5 [${scoreBar}]`)
      lines.push(``)
      lines.push(`**Reasoning**: ${score.reasoning}`)
      if (score.issues && score.issues.length > 0) {
        lines.push(``)
        lines.push(`**Issues**:`)
        for (const issue of score.issues) {
          lines.push(`- ${issue}`)
        }
      }
      lines.push(``)
    }

    if (judgement.improvementSuggestions.length > 0) {
      lines.push(`## Improvement Suggestions`)
      lines.push(``)
      for (const suggestion of judgement.improvementSuggestions) {
        lines.push(`- ${suggestion}`)
      }
      lines.push(``)
    }

    return lines.join("\n")
  }
}

/**
 * 创建默认评估器
 */
export function createDefaultEvaluator(): RubricEvaluator {
  return new RubricEvaluator(DEFAULT_CODE_RUBRIC)
}
