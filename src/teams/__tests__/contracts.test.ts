/**
 * Contracts Tests
 */

import { describe, it, expect } from "vitest"
import {
  TaskContractSchema,
  WorkArtifactSchema,
  ReviewArtifactSchema,
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
  toStrictContract,
  toContextContract,
} from "../contracts.js"

describe("Contracts", () => {
  describe("TaskContractSchema", () => {
    it("should validate valid task contract", () => {
      const contract = {
        taskId: "task-1",
        objective: "Implement feature",
        fileScope: ["src/feature.ts"],
        acceptanceChecks: ["npm test"],
      }

      const result = TaskContractSchema.safeParse(contract)
      expect(result.success).toBe(true)
    })

    it("should reject missing required fields", () => {
      const contract = {
        taskId: "task-1",
        // missing objective
        fileScope: ["src/feature.ts"],
        acceptanceChecks: ["npm test"],
      }

      const result = TaskContractSchema.safeParse(contract)
      expect(result.success).toBe(false)
    })

    it("should validate with optional apiContracts", () => {
      const contract = {
        taskId: "task-1",
        objective: "Implement API",
        fileScope: ["src/api.ts"],
        apiContracts: ["RESTful API"],
        acceptanceChecks: ["npm test"],
      }

      const result = TaskContractSchema.safeParse(contract)
      expect(result.success).toBe(true)
    })
  })

  describe("WorkArtifactSchema", () => {
    it("should validate valid work artifact", () => {
      const artifact = {
        taskId: "task-1",
        summary: "Implemented feature",
        changedFiles: ["src/feature.ts"],
        patchRef: "abc123",
        testResults: [{ command: "npm test", passed: true }],
        risks: ["Potential breaking change"],
        assumptions: ["User has Node.js 18+"],
      }

      const result = WorkArtifactSchema.safeParse(artifact)
      expect(result.success).toBe(true)
    })

    it("should reject invalid test result", () => {
      const artifact = {
        taskId: "task-1",
        summary: "Implemented feature",
        changedFiles: ["src/feature.ts"],
        patchRef: "abc123",
        testResults: [{ command: "npm test" /* missing passed */ }],
        risks: [],
        assumptions: [],
      }

      const result = WorkArtifactSchema.safeParse(artifact)
      expect(result.success).toBe(false)
    })
  })

  describe("ReviewArtifactSchema", () => {
    it("should validate approved review", () => {
      const review = {
        status: "approved",
        severity: "P3",
        mustFix: [],
        suggestions: ["Consider adding more comments"],
      }

      const result = ReviewArtifactSchema.safeParse(review)
      expect(result.success).toBe(true)
    })

    it("should validate changes requested review", () => {
      const review = {
        status: "changes_requested",
        severity: "P0",
        mustFix: ["Fix null pointer exception"],
        suggestions: [],
      }

      const result = ReviewArtifactSchema.safeParse(review)
      expect(result.success).toBe(true)
    })

    it("should reject invalid severity", () => {
      const review = {
        status: "approved",
        severity: "P5", // Invalid
        mustFix: [],
        suggestions: [],
      }

      const result = ReviewArtifactSchema.safeParse(review)
      expect(result.success).toBe(false)
    })
  })

  describe("meetsQualityGate", () => {
    it("should pass with approved and no P0", () => {
      const review = {
        status: "approved" as const,
        severity: "P1" as const,
        mustFix: [],
        suggestions: [],
      }

      const result = meetsQualityGate(review, {
        testsMustPass: true,
        noP0Issues: true,
      })

      expect(result.passed).toBe(true)
    })

    it("should fail with P0 issue", () => {
      const review = {
        status: "approved" as const,
        severity: "P0" as const,
        mustFix: ["Critical bug"],
        suggestions: [],
      }

      const result = meetsQualityGate(review, {
        testsMustPass: true,
        noP0Issues: true,
      })

      expect(result.passed).toBe(false)
      expect(result.reasons).toContain("P0 issues must be resolved")
    })

    it("should fail with changes requested", () => {
      const review = {
        status: "changes_requested" as const,
        severity: "P1" as const,
        mustFix: ["Fix this"],
        suggestions: [],
      }

      const result = meetsQualityGate(review, {
        testsMustPass: true,
        noP0Issues: true,
      })

      expect(result.passed).toBe(false)
      expect(result.reasons).toContain("Review requires changes")
    })
  })

  describe("helper functions", () => {
    it("createDefaultTaskContract should create valid contract", () => {
      const contract = createDefaultTaskContract("task-1", "Test objective", ["src/test.ts"])

      expect(contract.taskId).toBe("task-1")
      expect(contract.objective).toBe("Test objective")
      expect(contract.fileScope).toEqual(["src/test.ts"])
      expect(contract.acceptanceChecks).toContain("npm test")
    })

    it("createEmptyWorkArtifact should create empty artifact", () => {
      const artifact = createEmptyWorkArtifact("task-1")

      expect(artifact.taskId).toBe("task-1")
      expect(artifact.changedFiles).toEqual([])
      expect(artifact.testResults).toEqual([])
    })

    it("createApprovalReview should create approved review", () => {
      const review = createApprovalReview(["Nice work"])

      expect(review.status).toBe("approved")
      expect(review.severity).toBe("P3")
      expect(review.suggestions).toContain("Nice work")
    })

    it("createRejectionReview should create rejection review", () => {
      const review = createRejectionReview(["Fix bug"], "P0", ["Also refactor"])

      expect(review.status).toBe("changes_requested")
      expect(review.severity).toBe("P0")
      expect(review.mustFix).toContain("Fix bug")
      expect(review.suggestions).toContain("Also refactor")
    })
  })

  describe("validate functions", () => {
    it("validateTaskContract should parse valid contract", () => {
      const data = {
        taskId: "task-1",
        objective: "Test",
        fileScope: [],
        acceptanceChecks: [],
      }

      const result = validateTaskContract(data)
      expect(result.taskId).toBe("task-1")
    })

    it("validateTaskContract should throw on invalid data", () => {
      const data = { invalid: true }

      expect(() => validateTaskContract(data)).toThrow()
    })

    it("validateWorkArtifact should parse valid artifact", () => {
      const data = {
        taskId: "task-1",
        summary: "Test",
        changedFiles: [],
        patchRef: "ref",
        testResults: [],
        risks: [],
        assumptions: [],
      }

      const result = validateWorkArtifact(data)
      expect(result.taskId).toBe("task-1")
    })

    it("validateReviewArtifact should parse valid review", () => {
      const data = {
        status: "approved",
        severity: "P3",
        mustFix: [],
        suggestions: [],
      }

      const result = validateReviewArtifact(data)
      expect(result.status).toBe("approved")
    })
  })

  describe("ContextContract", () => {
    describe("createLooseContract", () => {
      it("should create a loose context contract", () => {
        const contract = createLooseContract("task-001", "Refactor auth module", {
          background: "Current auth is hard to test",
          constraints: ["Don't break existing API"],
          references: ["src/auth.ts", "docs/auth.md"],
          mustNot: ["Change public interface"],
          shouldConsider: ["Test coverage"],
          validationHint: "All tests pass",
        })

        expect(contract.taskId).toBe("task-001")
        expect(contract.objective).toBe("Refactor auth module")
        expect(contract.context.background).toBe("Current auth is hard to test")
        expect(contract.boundaries.mustNot).toContain("Change public interface")
      })

      it("should use defaults for optional fields", () => {
        const contract = createLooseContract("task-001", "Simple task")

        expect(contract.context.background).toBe("")
        expect(contract.context.constraints).toEqual([])
        expect(contract.boundaries.mustNot).toEqual([])
      })
    })

    describe("validateContextContract", () => {
      it("should validate a valid context contract", () => {
        const contract = createLooseContract("task-001", "Test")
        const validated = validateContextContract(contract)
        expect(validated.taskId).toBe("task-001")
      })

      it("should throw on invalid data", () => {
        expect(() => validateContextContract({ invalid: true })).toThrow()
      })
    })
  })

  describe("Contract Adapters", () => {
    describe("toStrictContract", () => {
      it("should convert loose to strict contract", () => {
        const loose = createLooseContract("task-001", "Add feature", {
          references: ["src/feature.ts"],
          validationHint: "npm test",
        })

        const strict = toStrictContract(loose)

        expect(strict.taskId).toBe("task-001")
        expect(strict.objective).toBe("Add feature")
        expect(strict.fileScope).toContain("src/feature.ts")
        expect(strict.acceptanceChecks).toContain("npm test")
      })

      it("should use embedded strict contract if present", () => {
        const embeddedStrict = createDefaultTaskContract("task-001", "Test", ["src/a.ts"])
        const loose = createLooseContract("task-001", "Different", {
          references: ["src/b.ts"],
        })
        loose.strictContract = embeddedStrict

        const strict = toStrictContract(loose)

        expect(strict.fileScope).toContain("src/a.ts") // From embedded, not derived
      })
    })

    describe("toContextContract", () => {
      it("should convert strict to loose contract", () => {
        const strict = createDefaultTaskContract("task-001", "Add feature", ["src/feature.ts"])

        const loose = toContextContract(strict, {
          background: "Feature needed for v2",
        })

        expect(loose.taskId).toBe("task-001")
        expect(loose.objective).toBe("Add feature")
        expect(loose.context.background).toBe("Feature needed for v2")
        expect(loose.strictContract).toEqual(strict)
      })

      it("should use defaults when context not provided", () => {
        const strict = createDefaultTaskContract("task-001", "Test")

        const loose = toContextContract(strict)

        expect(loose.context.background).toBe("No additional context provided")
        expect(loose.context.constraints).toEqual([])
      })
    })
  })
})
