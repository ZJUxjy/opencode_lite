import { describe, expect, it } from "vitest"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { ArtifactStore } from "../artifact-store.js"

describe("ArtifactStore", () => {
  it("writes run metadata and output files", () => {
    const dir = mkdtempSync(join(tmpdir(), "artifact-store-"))
    const store = new ArtifactStore(dir)
    const run = store.writeRunArtifact({
      runId: "run-1",
      mode: "worker-reviewer",
      task: "task",
      status: "completed",
      fallbackUsed: false,
      output: "final output",
      reviewRounds: 1,
      mustFixCount: 0,
      p0Count: 0,
      tokensUsed: 100,
      estimatedCostUsd: 0.01,
      durationMs: 1200,
      createdAt: Date.now(),
    })

    expect(existsSync(run.metadataPath)).toBe(true)
    expect(existsSync(run.outputPath)).toBe(true)
    expect(readFileSync(run.outputPath, "utf8")).toBe("final output")
  })
})
