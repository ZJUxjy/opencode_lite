/**
 * Collaboration modes index
 * 
 * Mode implementations require full integration with storage/execution modules.
 * This is a placeholder for now.
 */

export type TeamMode =
  | "council"
  | "leader-workers"
  | "worker-reviewer"
  | "planner-executor-reviewer"
  | "hotfix-guardrail"

export const TEAM_MODES: TeamMode[] = [
  "council",
  "leader-workers",
  "worker-reviewer",
  "planner-executor-reviewer",
  "hotfix-guardrail",
]

export function getDefaultMode(taskType: string): TeamMode {
  switch (taskType) {
    case "bugfix": return "hotfix-guardrail"
    case "feature": return "leader-workers"
    case "refactor": return "planner-executor-reviewer"
    case "review": return "worker-reviewer"
    default: return "council"
  }
}
