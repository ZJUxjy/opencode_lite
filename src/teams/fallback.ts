import type { TeamFailureReport } from "./types.js"

export class TeamFallbackService {
  createFailureReport(
    teamId: string,
    reason: TeamFailureReport["reason"],
    completedTasks: string[],
    pendingTasks: string[],
    details: string
  ): TeamFailureReport {
    return {
      teamId,
      reason,
      completedTasks,
      pendingTasks,
      recoveryPrompt: this.buildRecoveryPrompt(reason, details),
    }
  }

  private buildRecoveryPrompt(reason: string, details: string): string {
    return [
      "Team execution failed and has been downgraded to single-agent mode.",
      `Reason: ${reason}`,
      "Please continue the task from current state and prioritize completion.",
      `Failure details: ${details}`,
    ].join("\n")
  }
}
