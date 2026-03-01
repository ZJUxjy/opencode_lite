import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { TeamMode, TeamStatus } from "./types.js"

export interface TeamRunArtifactInput {
  runId: string
  mode: TeamMode
  task: string
  status: TeamStatus
  fallbackUsed: boolean
  failureReason?: string
  output: string
  reviewRounds: number
  mustFixCount: number
  p0Count: number
  tokensUsed: number
  estimatedCostUsd: number
  durationMs: number
  createdAt: number
}

export class ArtifactStore {
  constructor(private readonly baseDir = ".agent-teams/artifacts") {}

  writeRunArtifact(input: TeamRunArtifactInput): { runDir: string; metadataPath: string; outputPath: string } {
    const runDir = join(this.baseDir, input.runId)
    mkdirSync(runDir, { recursive: true })

    const metadataPath = join(runDir, "metadata.json")
    const outputPath = join(runDir, "output.md")

    writeFileSync(
      metadataPath,
      JSON.stringify(
        {
          runId: input.runId,
          mode: input.mode,
          task: input.task,
          status: input.status,
          fallbackUsed: input.fallbackUsed,
          failureReason: input.failureReason,
          metrics: {
            reviewRounds: input.reviewRounds,
            mustFixCount: input.mustFixCount,
            p0Count: input.p0Count,
            tokensUsed: input.tokensUsed,
            estimatedCostUsd: input.estimatedCostUsd,
            durationMs: input.durationMs,
          },
          createdAt: input.createdAt,
        },
        null,
        2
      ),
      "utf8"
    )

    writeFileSync(outputPath, input.output, "utf8")
    return { runDir, metadataPath, outputPath }
  }
}
