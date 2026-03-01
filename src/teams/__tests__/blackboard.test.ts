import { describe, it, expect } from "vitest"
import { SharedBlackboard } from "../blackboard.js"

describe("SharedBlackboard", () => {
  it("stores and reads values", () => {
    const board = new SharedBlackboard()
    board.set("k", { value: 1 })
    expect(board.get<{ value: number }>("k")?.value).toBe(1)
  })

  it("notifies watchers", () => {
    const board = new SharedBlackboard()
    let observed = ""
    board.watch("status", (value) => {
      observed = String(value)
    })

    board.set("status", "running")
    expect(observed).toBe("running")
  })
})
