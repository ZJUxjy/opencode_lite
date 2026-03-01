/**
 * Agent Teams - Contracts
 *
 * Artifact contracts for multi-agent collaboration
 * These define the structure of work products passed between agents
 */

import { z } from "zod"

// ============================================================================
// Task Contract
// ============================================================================

/**
 * TaskContract defines the agreement between planner and executor
 * It specifies what needs to be done, boundaries, and acceptance criteria
 */
export const TaskContractSchema = z.object({
  taskId: z.string(),
  objective: z.string().describe("Clear description of what needs to be done"),
  fileScope: z
    .array(z.string())
    .describe("List of files that can be modified"),
  apiContracts: z
    .array(z.string())
    .optional()
    .describe("API or schema constraints that must be followed"),
  acceptanceChecks: z
    .array(z.string())
    .describe("Commands that must pass (e.g., npm test, npm run build)"),
})

export type TaskContract = z.infer<typeof TaskContractSchema>

// ============================================================================
// Work Artifact
// ============================================================================

/**
 * WorkArtifact represents the output of a worker/executor
 * It includes the changes made, test results, and risk assessment
 */
export const TestResultSchema = z.object({
  command: z.string(),
  passed: z.boolean(),
  outputRef: z.string().optional(), // Reference to full output
})

export const WorkArtifactSchema = z.object({
  taskId: z.string(),
  summary: z.string().describe("Summary of changes made"),
  changedFiles: z.array(z.string()),
  patchRef: z
    .string()
    .describe("Git patch or commit reference containing the changes"),
  testResults: z.array(TestResultSchema),
  risks: z.array(z.string()).describe("Identified risks or concerns"),
  assumptions: z.array(z.string()).describe("Assumptions made during implementation"),
})

export type WorkArtifact = z.infer<typeof WorkArtifactSchema>

// ============================================================================
// Review Artifact
// ============================================================================

/**
 * ReviewArtifact represents the output of a reviewer
 * It includes approval status and required changes
 */
export const ReviewArtifactSchema = z.object({
  status: z.enum(["approved", "changes_requested"]),
  severity: z.enum(["P0", "P1", "P2", "P3"]).describe("P0 = blocking, P3 = minor"),
  mustFix: z.array(z.string()).describe("Issues that must be fixed"),
  suggestions: z.array(z.string()).describe("Optional improvements"),
})

export type ReviewArtifact = z.infer<typeof ReviewArtifactSchema>

// ============================================================================
// Validation Functions
// ============================================================================

export function validateTaskContract(data: unknown): TaskContract {
  return TaskContractSchema.parse(data)
}

export function validateWorkArtifact(data: unknown): WorkArtifact {
  return WorkArtifactSchema.parse(data)
}

export function validateReviewArtifact(data: unknown): ReviewArtifact {
  return ReviewArtifactSchema.parse(data)
}

// ============================================================================
// Contract Helpers
// ============================================================================

/**
 * Check if a review meets quality gate requirements
 */
export function meetsQualityGate(
  review: ReviewArtifact,
  gate: { testsMustPass: boolean; noP0Issues: boolean }
): { passed: boolean; reasons: string[] } {
  const reasons: string[] = []

  if (gate.noP0Issues && review.severity === "P0") {
    reasons.push("P0 issues must be resolved")
  }

  if (review.status !== "approved") {
    reasons.push("Review requires changes")
  }

  return {
    passed: reasons.length === 0,
    reasons,
  }
}

/**
 * Create a default task contract for simple tasks
 */
export function createDefaultTaskContract(
  taskId: string,
  objective: string,
  fileScope: string[] = [],
  acceptanceChecks: string[] = ["npm test"]
): TaskContract {
  return {
    taskId,
    objective,
    fileScope,
    acceptanceChecks,
  }
}

/**
 * Create an empty work artifact
 */
export function createEmptyWorkArtifact(taskId: string): WorkArtifact {
  return {
    taskId,
    summary: "",
    changedFiles: [],
    patchRef: "",
    testResults: [],
    risks: [],
    assumptions: [],
  }
}

/**
 * Create an approval review
 */
export function createApprovalReview(
  suggestions: string[] = []
): ReviewArtifact {
  return {
    status: "approved",
    severity: "P3",
    mustFix: [],
    suggestions,
  }
}

/**
 * Create a rejection review
 */
export function createRejectionReview(
  mustFix: string[],
  severity: "P0" | "P1" | "P2" = "P1",
  suggestions: string[] = []
): ReviewArtifact {
  return {
    status: "changes_requested",
    severity,
    mustFix,
    suggestions,
  }
}
