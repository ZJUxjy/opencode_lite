import { z } from "zod"

export interface TaskContract {
  taskId: string
  objective: string
  fileScope: string[]
  apiContracts?: string[]
  acceptanceChecks: string[]
}

export interface WorkArtifact {
  taskId: string
  summary: string
  changedFiles: string[]
  patchRef: string
  testResults: Array<{ command: string; passed: boolean; outputRef?: string }>
  risks: string[]
  assumptions: string[]
}

export interface ReviewArtifact {
  status: "approved" | "changes_requested"
  severity: "P0" | "P1" | "P2" | "P3"
  mustFix: string[]
  suggestions: string[]
}

export type AgentMessage =
  | { type: "task-assign"; task: TaskContract }
  | { type: "task-result"; artifact: WorkArtifact }
  | { type: "review-request"; artifact: WorkArtifact }
  | { type: "review-result"; review: ReviewArtifact }
  | { type: "conflict-detected"; files: string[] }

export interface ContextContract {
  objective: string
  context: {
    background: string
    constraints: string[]
    references: string[]
  }
  boundaries: {
    mustNot: string[]
    shouldConsider: string[]
  }
  expectedOutcome: {
    intent: string
    validationHint: string
  }
}

export const TaskContractSchema = z.object({
  taskId: z.string(),
  objective: z.string(),
  fileScope: z.array(z.string()),
  apiContracts: z.array(z.string()).optional(),
  acceptanceChecks: z.array(z.string()),
})

export const WorkArtifactSchema = z.object({
  taskId: z.string(),
  summary: z.string(),
  changedFiles: z.array(z.string()),
  patchRef: z.string(),
  testResults: z.array(
    z.object({
      command: z.string(),
      passed: z.boolean(),
      outputRef: z.string().optional(),
    })
  ),
  risks: z.array(z.string()),
  assumptions: z.array(z.string()),
})

export const ReviewArtifactSchema = z.object({
  status: z.union([z.literal("approved"), z.literal("changes_requested")]),
  severity: z.union([z.literal("P0"), z.literal("P1"), z.literal("P2"), z.literal("P3")]),
  mustFix: z.array(z.string()),
  suggestions: z.array(z.string()),
})

export const ContextContractSchema = z.object({
  objective: z.string(),
  context: z.object({
    background: z.string(),
    constraints: z.array(z.string()),
    references: z.array(z.string()),
  }),
  boundaries: z.object({
    mustNot: z.array(z.string()),
    shouldConsider: z.array(z.string()),
  }),
  expectedOutcome: z.object({
    intent: z.string(),
    validationHint: z.string(),
  }),
})

export const AgentMessageSchema = z.union([
  z.object({ type: z.literal("task-assign"), task: TaskContractSchema }),
  z.object({ type: z.literal("task-result"), artifact: WorkArtifactSchema }),
  z.object({ type: z.literal("review-request"), artifact: WorkArtifactSchema }),
  z.object({ type: z.literal("review-result"), review: ReviewArtifactSchema }),
  z.object({ type: z.literal("conflict-detected"), files: z.array(z.string()) }),
])
