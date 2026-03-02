import { describe, it, expect } from "vitest"
import { parseDumpOption } from "../dump-option.js"

describe("parseDumpOption", () => {
  it("should return false for undefined", () => {
    expect(parseDumpOption(undefined)).toBe(false)
  })

  it("should return true for boolean true", () => {
    expect(parseDumpOption(true)).toBe(true)
  })

  it("should return false for boolean false", () => {
    expect(parseDumpOption(false)).toBe(false)
  })

  it("should return true for string 'true'", () => {
    expect(parseDumpOption("true")).toBe(true)
  })

  it("should return false for string 'false'", () => {
    expect(parseDumpOption("false")).toBe(false)
  })

  it("should return true for any non-'false' string (commander optional value behavior)", () => {
    // When --dump-prompt is used without value, commander may pass empty string or the option name
    expect(parseDumpOption("")).toBe(true)
    expect(parseDumpOption("anything")).toBe(true)
  })
})
