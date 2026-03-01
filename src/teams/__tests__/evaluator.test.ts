import { describe, expect, it } from "vitest"
import { RubricEvaluator } from "../evaluator.js"

describe("RubricEvaluator", () => {
  it("builds judge prompt and parses json result", () => {
    const evaluator = new RubricEvaluator()
    const prompt = evaluator.buildJudgePrompt(
      {
        dimensions: [{ name: "correctness", weight: 1, scale: 5, criteria: ["ok"] }],
        overallThreshold: 3.5,
      },
      "task",
      "output"
    )
    expect(prompt).toContain("Pass threshold")

    const parsed = evaluator.parseJudgeResult(
      '{"scores":[{"dimension":"correctness","score":4,"reasoning":"good"}],"overallScore":4.1,"passed":true,"improvementSuggestions":[]}'
    )
    expect(parsed.passed).toBe(true)
    expect(parsed.overallScore).toBe(4.1)
  })
})
