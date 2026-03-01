import { describe, expect, it } from "vitest"
import { mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { CheckpointStore } from "../checkpoint-store.js"

describe("CheckpointStore", () => {
  it("creates and retrieves checkpoints", () => {
    const store = new CheckpointStore()
    const created = store.create({
      description: "after worker round 1",
      baseRef: "abc123",
      patchRefs: ["p1.diff"],
      artifactRefs: ["work-1"],
      blackboardSnapshotRef: "bb-1",
    })

    const fetched = store.get(created.id)
    expect(fetched?.description).toBe("after worker round 1")
  })

  it("builds rollback plan with reverse patches", () => {
    const store = new CheckpointStore()
    const created = store.create({
      description: "checkpoint",
      baseRef: "base-ref",
      patchRefs: ["p1", "p2", "p3"],
      artifactRefs: [],
      blackboardSnapshotRef: "bb",
    })

    const plan = store.buildRollbackPlan(created.id)
    expect(plan.baseRef).toBe("base-ref")
    expect(plan.reversePatchRefs).toEqual(["p3", "p2", "p1"])
  })

  it("prunes old checkpoints and keeps latest N", () => {
    const store = new CheckpointStore()
    store.create({
      description: "cp1",
      baseRef: "base",
      patchRefs: [],
      artifactRefs: [],
      blackboardSnapshotRef: "bb1",
    })
    store.create({
      description: "cp2",
      baseRef: "base",
      patchRefs: [],
      artifactRefs: [],
      blackboardSnapshotRef: "bb2",
    })
    store.create({
      description: "cp3",
      baseRef: "base",
      patchRefs: [],
      artifactRefs: [],
      blackboardSnapshotRef: "bb3",
    })

    const removed = store.prune({ keepLatest: 2 })
    expect(removed).toBe(1)
    expect(store.list()).toHaveLength(2)
  })

  it("persists checkpoints to disk and reloads in a new instance", () => {
    const dir = mkdtempSync(join(tmpdir(), "teams-checkpoint-"))
    const filePath = join(dir, "checkpoints.json")

    const first = new CheckpointStore({ filePath })
    const created = first.create({
      description: "persisted checkpoint",
      baseRef: "base-ref",
      patchRefs: ["p1"],
      artifactRefs: ["a1"],
      blackboardSnapshotRef: "bb1",
      context: {
        task: "task-a",
        mode: "worker-reviewer",
      },
    })

    const second = new CheckpointStore({ filePath })
    const loaded = second.get(created.id)
    expect(loaded?.description).toBe("persisted checkpoint")
    expect(loaded?.context?.task).toBe("task-a")
    expect(second.list()).toHaveLength(1)
  })

  it("builds resume context with strategy", () => {
    const store = new CheckpointStore()
    const created = store.create({
      description: "resume",
      baseRef: "base",
      patchRefs: ["p1"],
      artifactRefs: [],
      blackboardSnapshotRef: "bb",
      context: {
        task: "main task",
        mode: "worker-reviewer",
        reviewRounds: 2,
        pendingTasks: ["todo-1", "todo-2"],
      },
    })

    const ctx = store.getResumeContext(created.id, "skip-completed")
    expect(ctx.pendingTasks).toEqual(["todo-1", "todo-2"])
    expect(ctx.reviewRounds).toBe(2)
  })
})
