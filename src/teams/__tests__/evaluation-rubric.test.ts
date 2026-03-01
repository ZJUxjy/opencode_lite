import { describe, it, expect } from "vitest"
import {
  RubricEvaluator,
  DEFAULT_CODE_RUBRIC,
  createDefaultEvaluator,
  type WorkArtifact,
} from "../index.js"

describe("RubricEvaluator", () => {
  const evaluator = createDefaultEvaluator()

  describe("getRubric", () => {
    it("should return the current rubric", () => {
      const rubric = evaluator.getRubric()
      expect(rubric.name).toBe("Code Quality Rubric")
      expect(rubric.dimensions).toHaveLength(4)
      expect(rubric.overallThreshold).toBe(3.5)
    })
  })

  describe("generateEvaluationPrompt", () => {
    it("should generate a valid evaluation prompt", () => {
      const artifact: WorkArtifact = {
        taskId: "task-001",
        agentId: "worker-1",
        agentRole: "worker",
        summary: "Added a helloWorld function",
        changedFiles: ["src/utils.ts"],
        patchRef: "abc123",
        testResults: [{ command: "npm test", passed: true }],
        risks: [],
        assumptions: ["Assumed function should return string"],
        createdAt: Date.now(),
      }

      const prompt = evaluator.generateEvaluationPrompt(artifact)

      expect(prompt).toContain("task-001")
      expect(prompt).toContain("worker-1")
      expect(prompt).toContain("Added a helloWorld function")
      expect(prompt).toContain("正确性")
      expect(prompt).toContain("完整性")
      expect(prompt).toContain("可维护性")
      expect(prompt).toContain("性能")
      expect(prompt).toContain("EVALUATION_RESULT:")
    })
  })

  describe("parseEvaluationResult", () => {
    it("should parse a valid evaluation response", () => {
      const response = `
EVALUATION_RESULT:
正确性_SCORE: 4
正确性_REASONING: 代码基本正确实现了需求，但有一个小边界情况没处理
正确性_ISSUES: 边界情况处理不完整
完整性_SCORE: 3
完整性_REASONING: 修改了主要文件，但没有添加测试
完整性_ISSUES: 缺少单元测试
可维护性_SCORE: 5
可维护性_REASONING: 代码清晰，命名规范
可维护性_ISSUES: 无
性能_SCORE: 4
性能_REASONING: 性能良好，没有明显问题
性能_ISSUES:
IMPROVEMENT_SUGGESTIONS:
- 添加边界情况的测试
- 考虑添加输入验证
OVERALL_ASSESSMENT: 通过
`

      const result = evaluator.parseEvaluationResult(response, "artifact-001")

      expect(result.artifactId).toBe("artifact-001")
      expect(result.scores).toHaveLength(4)
      expect(result.scores[0].dimension).toBe("正确性")
      expect(result.scores[0].score).toBe(4)
      expect(result.scores[1].score).toBe(3)
      expect(result.scores[2].score).toBe(5)
      expect(result.scores[3].score).toBe(4)
      expect(result.improvementSuggestions).toHaveLength(2)
      expect(result.passed).toBe(true)
    })

    it("should handle missing scores with defaults", () => {
      const response = `
EVALUATION_RESULT:
正确性_SCORE: 2
正确性_REASONING: 有问题
IMPROVEMENT_SUGGESTIONS: None
OVERALL_ASSESSMENT: 不通过
`

      const result = evaluator.parseEvaluationResult(response, "artifact-002")

      expect(result.scores).toHaveLength(4)
      expect(result.scores[0].score).toBe(2)
      // Missing scores default to 3
      expect(result.scores[1].score).toBe(3)
      expect(result.scores[2].score).toBe(3)
      expect(result.scores[3].score).toBe(3)
    })
  })

  describe("toReviewArtifact", () => {
    it("should convert judgement result to review artifact", () => {
      const judgement = evaluator.parseEvaluationResult(
        `
正确性_SCORE: 1
正确性_REASONING: 有重大错误
正确性_ISSUES: 逻辑错误; 缺少错误处理
完整性_SCORE: 2
完整性_REASONING: 严重缺失
可维护性_SCORE: 2
可维护性_REASONING: 较差
性能_SCORE: 3
性能_REASONING: 一般
IMPROVEMENT_SUGGESTIONS:
- 修复逻辑错误
OVERALL_ASSESSMENT: 不通过
`,
        "artifact-003"
      )

      const workArtifact: WorkArtifact = {
        taskId: "task-003",
        agentId: "worker-1",
        agentRole: "worker",
        summary: "Test",
        changedFiles: [],
        patchRef: "",
        testResults: [],
        risks: [],
        assumptions: [],
        createdAt: Date.now(),
      }

      const review = evaluator.toReviewArtifact(judgement, workArtifact, "reviewer-1")

      expect(review.workArtifactId).toBe("task-003")
      expect(review.reviewerId).toBe("reviewer-1")
      expect(review.status).toBe("changes_requested")
      // Overall: 1*0.35 + 2*0.25 + 2*0.20 + 3*0.20 = 0.35 + 0.5 + 0.4 + 0.6 = 1.85 -> P0
      expect(review.severity).toBe("P0")
      expect(review.mustFix.length).toBeGreaterThan(0)
      expect(review.suggestions).toHaveLength(1)
    })

    it("should generate approved review for passed judgement", () => {
      const judgement = evaluator.parseEvaluationResult(
        `
正确性_SCORE: 5
正确性_REASONING: 完美
完整性_SCORE: 5
完整性_REASONING: 完美
可维护性_SCORE: 5
可维护性_REASONING: 完美
性能_SCORE: 5
性能_REASONING: 完美
IMPROVEMENT_SUGGESTIONS:
OVERALL_ASSESSMENT: 通过
`,
        "artifact-004"
      )

      const workArtifact: WorkArtifact = {
        taskId: "task-004",
        agentId: "worker-1",
        agentRole: "worker",
        summary: "Test",
        changedFiles: [],
        patchRef: "",
        testResults: [],
        risks: [],
        assumptions: [],
        createdAt: Date.now(),
      }

      const review = evaluator.toReviewArtifact(judgement, workArtifact, "reviewer-1")

      expect(review.status).toBe("approved")
      expect(review.severity).toBe("P3")
      expect(review.mustFix).toHaveLength(0)
    })
  })

  describe("formatJudgementResult", () => {
    it("should format judgement result as markdown", () => {
      const judgement = evaluator.parseEvaluationResult(
        `
正确性_SCORE: 4
正确性_REASONING: 良好
完整性_SCORE: 4
完整性_REASONING: 良好
可维护性_SCORE: 4
可维护性_REASONING: 良好
性能_SCORE: 4
性能_REASONING: 良好
IMPROVEMENT_SUGGESTIONS:
- 建议1
OVERALL_ASSESSMENT: 通过
`,
        "artifact-005"
      )

      const formatted = evaluator.formatJudgementResult(judgement)

      expect(formatted).toContain("# Evaluation Result")
      expect(formatted).toContain("artifact-005")
      expect(formatted).toContain("Code Quality Rubric")
      expect(formatted).toContain("PASSED")
      expect(formatted).toContain("正确性")
      expect(formatted).toContain("建议1")
    })
  })
})

describe("DEFAULT_CODE_RUBRIC", () => {
  it("should have correct structure", () => {
    expect(DEFAULT_CODE_RUBRIC.name).toBe("Code Quality Rubric")
    expect(DEFAULT_CODE_RUBRIC.version).toBe("1.0.0")
    expect(DEFAULT_CODE_RUBRIC.dimensions).toHaveLength(4)

    // Check weights sum to 1
    const totalWeight = DEFAULT_CODE_RUBRIC.dimensions.reduce((sum, d) => sum + d.weight, 0)
    expect(totalWeight).toBeCloseTo(1.0, 2)
  })

  it("should have valid criteria for all score levels", () => {
    for (const dimension of DEFAULT_CODE_RUBRIC.dimensions) {
      expect(dimension.criteria[1]).toBeDefined()
      expect(dimension.criteria[2]).toBeDefined()
      expect(dimension.criteria[3]).toBeDefined()
      expect(dimension.criteria[4]).toBeDefined()
      expect(dimension.criteria[5]).toBeDefined()
    }
  })
})
