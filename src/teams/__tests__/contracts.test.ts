import { describe, it, expect } from "vitest"
import {
  TaskContractSchema,
  WorkArtifactSchema,
  ReviewArtifactSchema,
  ContextContractSchema,
  validateTaskContract,
  validateWorkArtifact,
  validateReviewArtifact,
  validateContextContract,
  meetsQualityGate,
  createDefaultTaskContract,
  createEmptyWorkArtifact,
  createApprovalReview,
  createRejectionReview,
  createLooseContract,
  promoteToStrictContract,
} from "../core/contracts.js"

describe("Contracts", () => {
  describe("TaskContractSchema", () => {
    it("should validate a valid task contract", () => {
      const contract = {
        taskId: "task-1",
        objective: "Add feature X",
        fileScope: ["src/feature.ts"],
        acceptanceChecks: ["npm test"],
      }
      const result = TaskContractSchema.safeParse(contract)
      expect(result.success).toBe(true)
    })

    it("should reject invalid task contract", () => {
      const contract = {
        taskId: "task-1",
        // missing objective
        fileScope: ["src/feature.ts"],
        acceptanceChecks: ["npm test"],
      }
      const result = TaskContractSchema.safeParse(contract)
      expect(result.success).toBe(false)
    })
  })

  describe("WorkArtifactSchema", () => {
    it("should validate a valid work artifact", () => {
      const artifact = {
        taskId: "task-1",
        summary: "Implemented feature X",
        changedFiles: ["src/feature.ts"],
        patchRef: "abc123",
        testResults: [{ command: "npm test", passed: true }],
        risks: [],
        assumptions: [],
      }
      const result = WorkArtifactSchema.safeParse(artifact)
      expect(result.success).toBe(true)
    })
  })

  describe("ReviewArtifactSchema", () => {
    it("should validate approved review", () => {
      const review = {
        status: "approved",
        severity: "P3",
        mustFix: [],
        suggestions: ["Consider using const instead of let"],
      }
      const result = ReviewArtifactSchema.safeParse(review)
      expect(result.success).toBe(true)
    })

    it("should validate changes_requested review", () => {
      const review = {
        status: "changes_requested",
        severity: "P1",
        mustFix: ["Fix bug in line 10"],
        suggestions: [],
      }
      const result = ReviewArtifactSchema.safeParse(review)
      expect(result.success).toBe(true)
    })
  })

  describe("ContextContractSchema", () => {
    it("should validate a valid context contract", () => {
      const contract = {
        taskId: "task-1",
        objective: "Add feature X",
        context: {
          background: "User requested this feature",
          constraints: [],
          references: ["docs/api.md"],
        },
        boundaries: {
          mustNot: ["Don't break existing API"],
          shouldConsider: ["Use existing patterns"],
        },
        expectedOutcome: {
          intent: "Feature X works correctly",
          validationHint: "Run npm test",
        },
      }
      const result = ContextContractSchema.safeParse(contract)
      expect(result.success).toBe(true)
    })
  })

  describe("Helper functions", () => {
    it("should create default task contract", () => {
      const contract = createDefaultTaskContract(
        "task-1",
        "Add feature",
        ["src/file.ts"],
        ["npm test"]
      )
      expect(contract.taskId).toBe("task-1")
      expect(contract.objective).toBe("Add feature")
      expect(contract.fileScope).toEqual(["src/file.ts"])
    })

    it("should create empty work artifact", () => {
      const artifact = createEmptyWorkArtifact("task-1")
      expect(artifact.taskId).toBe("task-1")
      expect(artifact.changedFiles).toEqual([])
      expect(artifact.testResults).toEqual([])
    })

    it("should create approval review", () => {
      const review = createApprovalReview(["Minor suggestion"])
      expect(review.status).toBe("approved")
      expect(review.severity).toBe("P3")
      expect(review.mustFix).toEqual([])
    })

    it("should create rejection review", () => {
      const review = createRejectionReview(["Must fix this"], "P1")
      expect(review.status).toBe("changes_requested")
      expect(review.severity).toBe("P1")
      expect(review.mustFix).toEqual(["Must fix this"])
    })

    it("should create loose contract", () => {
      const contract = createLooseContract("task-1", "Explore options", {
        background: "Need to evaluate approaches",
        constraints: ["Keep it simple"],
        references: ["docs/guide.md"],
      })
      expect(contract.taskId).toBe("task-1")
      expect(contract.objective).toBe("Explore options")
      expect(contract.context.background).toBe("Need to evaluate approaches")
    })

    it("should promote to strict contract", () => {
      const looseContract = createLooseContract("task-1", "Add feature")
      const strictContract = promoteToStrictContract(
        looseContract,
        ["src/file.ts"],
        ["npm test"]
      )
      expect(strictContract.fileScope).toEqual(["src/file.ts"])
      expect(strictContract.acceptanceChecks).toEqual(["npm test"])
    })
  })

  describe("meetsQualityGate", () => {
    it("should pass for approved review with no P0 issues", () => {
      const review = createApprovalReview()
      const result = meetsQualityGate(review, {
        testsMustPass: true,
        noP0Issues: true,
      })
      expect(result.passed).toBe(true)
      expect(result.reasons).toEqual([])
    })

    it("should fail for changes_requested review", () => {
      const review = createRejectionReview(["Fix this"])
      const result = meetsQualityGate(review, {
        testsMustPass: true,
        noP0Issues: true,
      })
      expect(result.passed).toBe(false)
      expect(result.reasons).toContain("Review requires changes")
    })

    it("should fail for P0 severity", () => {
      const review: ReturnType<typeof createRejectionReview> = {
        status: "approved",
        severity: "P0",
        mustFix: [],
        suggestions: [],
      }
      const result = meetsQualityGate(review, {
        testsMustPass: true,
        noP0Issues: true,
      })
      expect(result.passed).toBe(false)
      expect(result.reasons).toContain("P0 issues must be resolved")
    })
  })

  describe("Validation functions", () => {
    it("should validate task contract", () => {
      const contract = createDefaultTaskContract("task-1", "Add feature")
      const validated = validateTaskContract(contract)
      expect(validated.taskId).toBe("task-1")
    })

    it("should throw on invalid task contract", () => {
      expect(() => validateTaskContract({})).toThrow()
    })

    it("should validate work artifact", () => {
      const artifact = createEmptyWorkArtifact("task-1")
      const validated = validateWorkArtifact(artifact)
      expect(validated.taskId).toBe("task-1")
    })

    it("should validate review artifact", () => {
      const review = createApprovalReview()
      const validated = validateReviewArtifact(review)
      expect(validated.status).toBe("approved")
    })

    it("should validate context contract", () => {
      const contract = createLooseContract("task-1", "Add feature")
      const validated = validateContextContract(contract)
      expect(validated.taskId).toBe("task-1")
    })
  })
})
