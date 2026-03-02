import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { parseDumpOption } from "../dump-option.js"

describe("parseDumpOption", () => {
  const originalEnv = process.env.DUMP_PROMPT

  beforeEach(() => {
    // Clear env before each test
    delete process.env.DUMP_PROMPT
  })

  afterEach(() => {
    // Restore original env
    if (originalEnv !== undefined) {
      process.env.DUMP_PROMPT = originalEnv
    } else {
      delete process.env.DUMP_PROMPT
    }
  })

  describe("CLI option", () => {
    it("should return false for undefined when no env set", () => {
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
      expect(parseDumpOption("")).toBe(true)
      expect(parseDumpOption("anything")).toBe(true)
    })
  })

  describe("environment variable fallback", () => {
    it("should use DUMP_PROMPT=1 from env when CLI option is undefined", () => {
      process.env.DUMP_PROMPT = "1"
      expect(parseDumpOption(undefined)).toBe(true)
    })

    it("should use DUMP_PROMPT=true from env when CLI option is undefined", () => {
      process.env.DUMP_PROMPT = "true"
      expect(parseDumpOption(undefined)).toBe(true)
    })

    it("should use DUMP_PROMPT=yes from env when CLI option is undefined", () => {
      process.env.DUMP_PROMPT = "yes"
      expect(parseDumpOption(undefined)).toBe(true)
    })

    it("should return false for DUMP_PROMPT=0 from env", () => {
      process.env.DUMP_PROMPT = "0"
      expect(parseDumpOption(undefined)).toBe(false)
    })

    it("should return false for DUMP_PROMPT=false from env", () => {
      process.env.DUMP_PROMPT = "false"
      expect(parseDumpOption(undefined)).toBe(false)
    })

    it("should be case-insensitive for env values", () => {
      process.env.DUMP_PROMPT = "TRUE"
      expect(parseDumpOption(undefined)).toBe(true)

      process.env.DUMP_PROMPT = "True"
      expect(parseDumpOption(undefined)).toBe(true)
    })
  })

  describe("CLI option overrides env", () => {
    it("CLI false should override DUMP_PROMPT=true env", () => {
      process.env.DUMP_PROMPT = "true"
      expect(parseDumpOption(false)).toBe(false)
    })

    it("CLI true should override DUMP_PROMPT=false env", () => {
      process.env.DUMP_PROMPT = "false"
      expect(parseDumpOption(true)).toBe(true)
    })
  })
})
