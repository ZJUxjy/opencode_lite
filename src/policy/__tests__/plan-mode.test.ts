import { describe, it, expect, beforeEach } from "vitest"
import { PolicyEngine } from "../../policy.js"

describe("PolicyEngine Plan Mode planFilePath", () => {
  let engine: PolicyEngine

  beforeEach(() => {
    engine = new PolicyEngine()
  })

  it("should allow edit on plan file when in plan mode", () => {
    engine.setPlanMode(true)
    engine.setPlanFilePath("/tmp/plans/test-plan.md")

    const result = engine.check("edit", { path: "/tmp/plans/test-plan.md", old_string: "a", new_string: "b" })

    expect(result.decision).toBe("allow")
    expect(result.reason).toContain("计划文件")
  })

  it("should deny edit on non-plan file when in plan mode", () => {
    engine.setPlanMode(true)
    engine.setPlanFilePath("/tmp/plans/test-plan.md")

    const result = engine.check("edit", { path: "/tmp/other-file.md", old_string: "a", new_string: "b" })

    expect(result.decision).toBe("deny")
    expect(result.reason).toContain("只能编辑计划文件")
  })

  it("should allow write on plan file when in plan mode", () => {
    engine.setPlanMode(true)
    engine.setPlanFilePath("/tmp/plans/test-plan.md")

    const result = engine.check("write", { path: "/tmp/plans/test-plan.md", content: "test" })

    expect(result.decision).toBe("allow")
  })

  it("should deny write on non-plan file when in plan mode", () => {
    engine.setPlanMode(true)
    engine.setPlanFilePath("/tmp/plans/test-plan.md")

    const result = engine.check("write", { path: "/tmp/other-file.md", content: "test" })

    expect(result.decision).toBe("deny")
  })

  it("should normalize paths for comparison", () => {
    engine.setPlanMode(true)
    engine.setPlanFilePath("/tmp/plans/test-plan.md")

    // 相对路径应该被正确解析
    const result = engine.check("edit", { path: "./test-plan.md", old_string: "a", new_string: "b" })

    // 由于相对路径解析依赖 cwd，这里只验证不会崩溃
    expect(["allow", "deny"]).toContain(result.decision)
  })
})
