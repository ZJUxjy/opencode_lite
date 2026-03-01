import { describe, expect, it } from "vitest"
import { mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { TeamRunStore } from "../team-run-store.js"

describe("TeamRunStore", () => {
  it("persists and lists team run records", () => {
    const dir = mkdtempSync(join(tmpdir(), "team-run-store-"))
    const dbPath = join(dir, "team-runs.db")
    const store = new TeamRunStore(dbPath)

    store.add({
      id: "run-1",
      mode: "worker-reviewer",
      task: "task",
      status: "completed",
      fallbackUsed: false,
      reviewRounds: 1,
      mustFixCount: 0,
      p0Count: 0,
      tokensUsed: 100,
      estimatedCostUsd: 0.01,
      durationMs: 1200,
      createdAt: Date.now(),
    })

    const items = store.list()
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe("run-1")
    store.close()
  })
})
