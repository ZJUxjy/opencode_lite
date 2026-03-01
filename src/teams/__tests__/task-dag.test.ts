import { describe, expect, it } from "vitest"
import { TaskDagPlanner } from "../task-dag.js"

describe("TaskDagPlanner", () => {
  it("parses valid JSON DAG and returns topological order", () => {
    const planner = new TaskDagPlanner()
    const tasks = planner.parseOrFallback(
      '[{"id":"a","title":"A","dependsOn":[]},{"id":"b","title":"B","dependsOn":["a"]}]'
    )

    const ordered = planner.topologicalOrder(tasks)
    expect(ordered.map((t) => t.id)).toEqual(["a", "b"])
  })

  it("falls back when planner output is not valid JSON", () => {
    const planner = new TaskDagPlanner()
    const tasks = planner.parseOrFallback("not-json")
    expect(tasks).toHaveLength(2)
    expect(tasks[0].id).toBe("task-1")
  })

  it("throws for cyclic dependencies", () => {
    const planner = new TaskDagPlanner()
    expect(() =>
      planner.topologicalOrder([
        { id: "a", title: "A", dependsOn: ["b"] },
        { id: "b", title: "B", dependsOn: ["a"] },
      ])
    ).toThrow("Cyclic dependency")
  })

  it("builds execution layers for parallel scheduling", () => {
    const planner = new TaskDagPlanner()
    const layers = planner.executionLayers([
      { id: "a", title: "A", dependsOn: [] },
      { id: "b", title: "B", dependsOn: [] },
      { id: "c", title: "C", dependsOn: ["a", "b"] },
    ])

    expect(layers).toHaveLength(2)
    expect(layers[0].map((t) => t.id)).toEqual(["a", "b"])
    expect(layers[1].map((t) => t.id)).toEqual(["c"])
  })
})
