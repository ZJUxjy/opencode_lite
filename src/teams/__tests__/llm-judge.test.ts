import { describe, it, expect } from "vitest"
import {
  LLMJudge,
  createLLMJudge,
  DEFAULT_CODE_QUALITY_RUBRIC,
} from "../llm-judge.js"
import { createEmptyWorkArtifact } from "../contracts.js"

describe("LLMJudge", () => {
  describe("DEFAULT_CODE_QUALITY_RUBRIC", () => {
    it("should have 4 dimensions", () => {
      expect(DEFAULT_CODE_QUALITY_RUBRIC.dimensions).toHaveLength(4)
      expect(DEFAULT_CODE_QUALITY_RUBRIC.dimensions.map(d => d.name)).toEqual(
        expect.arrayContaining(["correctness", "completeness", "maintainability", "performance"])
      )
    })

    it("should have weights summing to 1", () => {
      const sum = DEFAULT_CODE_QUALITY_RUBRIC.dimensions.reduce((acc, d) => acc + d.weight, 0)
      expect(sum).toBeCloseTo(1, 2)
    })
  })

  describe("evaluate", () => {
    it("should evaluate a work artifact", async () => {
      const judge = createLLMJudge()
      const artifact = createEmptyWorkArtifact("task-001")
      artifact.summary = "Implemented user authentication"
      artifact.changedFiles = ["src/auth.ts"]
      artifact.testResults = [{ command: "npm test", passed: true }]

      const result = await judge.evaluate(artifact, "Add user auth")

      expect(result.scores).toHaveLength(4)
      expect(result.overallScore).toBeGreaterThan(0)
      expect(typeof result.passed).toBe("boolean")
      expect(result.evaluationTime).toBeGreaterThanOrEqual(0)
    })

    it("should pass when score >= threshold", async () => {
      const judge = createLLMJudge({
        rubric: { ...DEFAULT_CODE_QUALITY_RUBRIC, overallThreshold: 2.0 }
      })
      const artifact = createEmptyWorkArtifact("task-001")
      artifact.summary = "Test"

      const result = await judge.evaluate(artifact, "Test task")
      expect(result.passed).toBe(true)
    })
  })
})
