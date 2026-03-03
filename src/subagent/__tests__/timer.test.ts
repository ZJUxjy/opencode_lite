import { describe, it, expect, vi } from "vitest"
import { DeadlineTimer } from "../timer.js"

describe("DeadlineTimer", () => {
  it("should track remaining time", () => {
    const timer = new DeadlineTimer({ timeoutMs: 1000 })
    timer.start()

    expect(timer.getRemainingMs()).toBeGreaterThan(900)
    expect(timer.getRemainingMs()).toBeLessThanOrEqual(1000)
    timer.destroy()
  })

  it("should pause and resume", async () => {
    const timer = new DeadlineTimer({ timeoutMs: 1000 })
    timer.start()

    await new Promise((r) => setTimeout(r, 100))
    timer.pause()
    const remainingWhenPaused = timer.getRemainingMs()

    await new Promise((r) => setTimeout(r, 100))
    expect(timer.getRemainingMs()).toBe(remainingWhenPaused)

    timer.resume()
    expect(timer.isPaused()).toBe(false)
    timer.destroy()
  })

  it("should call onTimeout when expired", async () => {
    const onTimeout = vi.fn()
    const timer = new DeadlineTimer({ timeoutMs: 50, onTimeout })
    timer.start()

    await new Promise((r) => setTimeout(r, 100))
    expect(onTimeout).toHaveBeenCalled()
    timer.destroy()
  })

  it("should report expired status correctly", async () => {
    const timer = new DeadlineTimer({ timeoutMs: 50 })
    timer.start()

    expect(timer.isExpired()).toBe(false)
    await new Promise((r) => setTimeout(r, 100))
    expect(timer.isExpired()).toBe(true)
    timer.destroy()
  })

  it("should handle destroy correctly", () => {
    const onTimeout = vi.fn()
    const timer = new DeadlineTimer({ timeoutMs: 1000, onTimeout })
    timer.start()
    timer.destroy()

    // After destroy, should not trigger onTimeout
    expect(timer.isExpired()).toBe(false)
  })
})
