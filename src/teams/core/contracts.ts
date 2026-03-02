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

export type TestResult = z.infer<typeof TestResultSchema>
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
// Additional Exports
// ============================================================================

export type TestResult = z.infer<typeof TestResultSchema>

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

// ============================================================================
// Context Contract (Loose Coupling)
// ============================================================================

/**
 * ContextContract defines a looser agreement between agents
 * Used for exploration, research, and tasks with fluid boundaries
 */
export const ContextContractSchema = z.object({
  taskId: z.string(),

  objective: z.string().describe("Clear goal - what needs to be achieved"),

  context: z.object({
    background: z.string().describe("Why this task matters"),
    constraints: z.array(z.string()).describe("Hard constraints that must be followed"),
    references: z.array(z.string()).describe("File paths, docs, code to reference"),
  }),

  boundaries: z.object({
    mustNot: z.array(z.string()).describe("Things that must NOT be done"),
    shouldConsider: z.array(z.string()).describe("Things to keep in mind"),
  }),

  expectedOutcome: z.object({
    intent: z.string().describe("What success looks like"),
    validationHint: z.string().describe("How to verify the outcome"),
  }),

  strictContract: TaskContractSchema.optional(),
})

export type ContextContract = z.infer<typeof ContextContractSchema>

// ============================================================================
// Context Contract Functions
// ============================================================================

export function validateContextContract(data: unknown): ContextContract {
  return ContextContractSchema.parse(data)
}

export function createLooseContract(
  taskId: string,
  objective: string,
  options: {
    background?: string
    constraints?: string[]
    references?: string[]
    mustNot?: string[]
    shouldConsider?: string[]
    validationHint?: string
  } = {}
): ContextContract {
  return {
    taskId,
    objective,
    context: {
      background: options.background || "",
      constraints: options.constraints || [],
      references: options.references || [],
    },
    boundaries: {
      mustNot: options.mustNot || [],
      shouldConsider: options.shouldConsider || [],
    },
    expectedOutcome: {
      intent: `Successfully complete: ${objective}`,
      validationHint: options.validationHint || "Code should work as expected",
    },
  }
}

/**
 * Convert a context contract to a strict task contract
 */
export function promoteToStrictContract(
  contract: ContextContract,
  fileScope: string[],
  acceptanceChecks: string[]
): TaskContract {
  return {
    taskId: contract.taskId,
    objective: contract.objective,
    fileScope,
    apiContracts: contract.context.constraints,
    acceptanceChecks,
  }
}

// ============================================================================
// Contract Adapters (from kimi branch)
// ============================================================================

/**
 * Contract adapter - convert loose ContextContract to strict TaskContract
 */
export function toStrictContract(context: ContextContract): TaskContract {
  if (context.strictContract) {
    return context.strictContract
  }

  // Derive strict contract from loose context
  return {
    taskId: context.taskId,
    objective: context.objective,
    fileScope: deriveFileScope(context),
    apiContracts: context.context.constraints,
    acceptanceChecks: deriveAcceptanceChecks(context),
  }
}

/**
 * Contract adapter - convert strict TaskContract to loose ContextContract
 */
export function toContextContract(
  contract: TaskContract,
  context?: Partial<ContextContract["context"]>
): ContextContract {
  return {
    taskId: contract.taskId,
    objective: contract.objective,
    context: {
      background: context?.background || "No additional context provided",
      constraints: context?.constraints || [],
      references: contract.fileScope || [],
    },
    boundaries: {
      mustNot: [],
      shouldConsider: [],
    },
    expectedOutcome: {
      intent: `Complete: ${contract.objective}`,
      validationHint: `Run: ${contract.acceptanceChecks.join(", ")}`,
    },
    strictContract: contract,
  }
}

/**
 * Derive file scope from context references
 */
function deriveFileScope(context: ContextContract): string[] {
  // Extract file references from context
  return context.context.references.filter(ref =>
    ref.includes("/") || ref.includes(".")
  )
}

/**
 * Derive acceptance checks from validation hint
 */
function deriveAcceptanceChecks(context: ContextContract): string[] {
  // Derive checks from validation hint
  const hint = context.expectedOutcome.validationHint.toLowerCase()
  if (hint.includes("test")) return ["npm test"]
  if (hint.includes("build")) return ["npm run build"]
  if (hint.includes("lint")) return ["npm run lint"]
  return ["npm test"]
}
