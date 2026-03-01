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
