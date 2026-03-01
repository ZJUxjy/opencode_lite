import { describe, expect, it } from "vitest"
import { ConflictDetector } from "../conflict-detector.js"

describe("ConflictDetector", () => {
  it("extracts changed files from FILE markers", () => {
    const detector = new ConflictDetector()
    const files = detector.extractChangedFiles("done\nFILE: src/a.ts\nFILE: src/b.ts")
    expect(files).toEqual(["src/a.ts", "src/b.ts"])
  })

  it("detects overlapping file conflicts", () => {
    const detector = new ConflictDetector()
    const report = detector.detect([
      ["src/a.ts", "src/b.ts"],
      ["src/c.ts"],
      ["src/b.ts"],
    ])

    expect(report.hasConflict).toBe(true)
    expect(report.files).toEqual(["src/b.ts"])
  })

  it("extracts file edits with content blocks", () => {
    const detector = new ConflictDetector()
    const edits = detector.extractFileEdits(
      [
        "some header",
        "FILE: src/a.ts",
        "const a = 1",
        "FILE: src/b.ts",
        "const b = 2",
      ].join("\n")
    )

    expect(edits).toEqual([
      { file: "src/a.ts", content: "const a = 1" },
      { file: "src/b.ts", content: "const b = 2" },
    ])
  })

  it("auto-merges conflicts by deterministic file strategy", () => {
    const detector = new ConflictDetector()
    const merged = detector.autoMergeByFile([
      "FILE: src/a.ts\nshort",
      "FILE: src/a.ts\nlonger-content",
      "FILE: src/b.ts\nonly-one",
    ])

    expect(merged.conflicts).toEqual(["src/a.ts"])
    expect(merged.decisions).toHaveLength(1)
    expect(merged.decisions[0].keptFrom).toBe(1)
    expect(merged.mergedOutput).toContain("FILE: src/a.ts")
    expect(merged.mergedOutput).toContain("longer-content")
    expect(merged.mergedOutput).toContain("FILE: src/b.ts")
  })
})
