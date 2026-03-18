import { describe, it, expect, beforeEach } from "vitest"
import {
  PastedTextManager,
  TEXT_PASTE_CHAR_THRESHOLD,
  TEXT_PASTE_LINE_THRESHOLD,
} from "../pastedText.js"

describe("PastedTextManager", () => {
  let manager: PastedTextManager

  beforeEach(() => {
    manager = new PastedTextManager()
  })

  describe("shouldPlaceholderize", () => {
    it("should return false for short text with few lines", () => {
      expect(manager.shouldPlaceholderize("short text")).toBe(false)
    })

    it("should return true for text exceeding character threshold", () => {
      const longText = "a".repeat(TEXT_PASTE_CHAR_THRESHOLD + 1)
      expect(manager.shouldPlaceholderize(longText)).toBe(true)
    })

    it("should return false for text at exactly character threshold", () => {
      const exactText = "a".repeat(TEXT_PASTE_CHAR_THRESHOLD)
      expect(manager.shouldPlaceholderize(exactText)).toBe(false)
    })

    it("should return true for text exceeding line threshold", () => {
      const multilineText = "line1\nline2\nline3\nline4" // 4 lines
      expect(manager.shouldPlaceholderize(multilineText)).toBe(true)
    })

    it("should return false for text at exactly line threshold", () => {
      const exactLines = "line1\nline2\nline3" // 3 lines
      expect(manager.shouldPlaceholderize(exactLines)).toBe(false)
    })

    it("should handle CRLF line endings", () => {
      const crlfText = "line1\r\nline2\r\nline3\r\nline4" // 4 lines
      expect(manager.shouldPlaceholderize(crlfText)).toBe(true)
    })
  })

  describe("createPlaceholder", () => {
    it("should create placeholder with correct format", () => {
      const text = "line1\nline2\nline3\nline4\nline5"
      const placeholder = manager.createPlaceholder(text)

      expect(placeholder).toBe("[Pasted text #1 +5 lines]")
    })

    it("should increment ID for multiple placeholders", () => {
      const text1 = "line1\nline2\nline3\nline4"
      const text2 = "lineA\nlineB\nlineC\nlineD\nlineE"

      const placeholder1 = manager.createPlaceholder(text1)
      const placeholder2 = manager.createPlaceholder(text2)

      expect(placeholder1).toBe("[Pasted text #1 +4 lines]")
      expect(placeholder2).toBe("[Pasted text #2 +5 lines]")
    })

    it("should store entry with correct data", () => {
      const text = "line1\nline2\nline3\nline4"
      manager.createPlaceholder(text)

      const entry = manager.getEntry(1)
      expect(entry).toBeDefined()
      expect(entry?.text).toBe(text)
      expect(entry?.lineCount).toBe(4)
    })
  })

  describe("resolvePlaceholder", () => {
    it("should resolve single placeholder", () => {
      const originalText = "line1\nline2\nline3\nline4\nline5"
      const placeholder = manager.createPlaceholder(originalText)

      const resolved = manager.resolvePlaceholder(placeholder)
      expect(resolved).toBe(originalText)
    })

    it("should resolve placeholder with surrounding text", () => {
      const originalText = "line1\nline2\nline3\nline4"
      const placeholder = manager.createPlaceholder(originalText)

      const displayText = `Please check this:\n${placeholder}\nThanks!`
      const resolved = manager.resolvePlaceholder(displayText)

      expect(resolved).toBe(`Please check this:\n${originalText}\nThanks!`)
    })

    it("should resolve multiple placeholders", () => {
      const text1 = "error\nlog\nline1\nline2"
      const text2 = "debug\ninfo\nlineA\nlineB\nlineC"

      const placeholder1 = manager.createPlaceholder(text1)
      const placeholder2 = manager.createPlaceholder(text2)

      const displayText = `First error:\n${placeholder1}\n\nDebug info:\n${placeholder2}`
      const resolved = manager.resolvePlaceholder(displayText)

      expect(resolved).toBe(`First error:\n${text1}\n\nDebug info:\n${text2}`)
    })

    it("should return original text if placeholder ID not found", () => {
      const resolved = manager.resolvePlaceholder("[Pasted text #999 +5 lines]")
      expect(resolved).toBe("[Pasted text #999 +5 lines]")
    })

    it("should return original text if no placeholders present", () => {
      const text = "Just some regular text without placeholders"
      const resolved = manager.resolvePlaceholder(text)
      expect(resolved).toBe(text)
    })

    it("should handle partial placeholder match (not a real placeholder)", () => {
      const text = "Some text [Pasted text but not a valid placeholder]"
      const resolved = manager.resolvePlaceholder(text)
      expect(resolved).toBe(text)
    })
  })

  describe("clear", () => {
    it("should clear all entries", () => {
      manager.createPlaceholder("line1\nline2\nline3\nline4")
      manager.createPlaceholder("lineA\nlineB\nlineC\nlineD\nlineE")

      expect(manager.getAllEntries().length).toBe(2)

      manager.clear()

      expect(manager.getAllEntries().length).toBe(0)
      expect(manager.getEntry(1)).toBeUndefined()
    })

    it("should reset ID counter after clear", () => {
      manager.createPlaceholder("line1\nline2\nline3\nline4")
      manager.clear()

      const placeholder = manager.createPlaceholder("lineA\nlineB\nlineC\nlineD")
      expect(placeholder).toBe("[Pasted text #1 +4 lines]")
    })
  })

  describe("getAllEntries", () => {
    it("should return empty array when no entries", () => {
      expect(manager.getAllEntries()).toEqual([])
    })

    it("should return all entries", () => {
      manager.createPlaceholder("line1\nline2\nline3\nline4")
      manager.createPlaceholder("lineA\nlineB\nlineC\nlineD\nlineE")

      const entries = manager.getAllEntries()
      expect(entries.length).toBe(2)
      expect(entries[0].id).toBe(1)
      expect(entries[1].id).toBe(2)
    })
  })
})
