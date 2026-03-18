/** Threshold for character count to trigger placeholder */
export const TEXT_PASTE_CHAR_THRESHOLD = 200

/** Threshold for line count to trigger placeholder */
export const TEXT_PASTE_LINE_THRESHOLD = 3

/** Placeholder regex pattern: [Pasted text #N +M lines] */
const PLACEHOLDER_RE = /\[Pasted text #(\d+)(?: \+(\d+) lines?)?\]/g

/** Pasted text entry stored in memory */
export interface PastedTextEntry {
  id: number
  text: string
  lineCount: number
}

/**
 * PastedTextManager - Manages pasted text placeholders
 *
 * When user pastes large text, create a placeholder instead of displaying
 * the full content. The actual text is stored in memory and resolved
 * when the user submits.
 *
 * Example:
 *   Input:  "Here is the error:\n[500 lines of error log]"
 *   Display: "Here is the error:\n[Pasted text #1 +500 lines]"
 *   Submit:  "Here is the error:\n[500 lines of error log]"
 */
export class PastedTextManager {
  private entries: Map<number, PastedTextEntry> = new Map()
  private nextId = 1

  /**
   * Check if text should be converted to placeholder
   */
  shouldPlaceholderize(text: string): boolean {
    if (text.length > TEXT_PASTE_CHAR_THRESHOLD) {
      return true
    }
    const lineCount = this.countLines(text)
    if (lineCount > TEXT_PASTE_LINE_THRESHOLD) {
      return true
    }
    return false
  }

  /**
   * Create a placeholder and store the actual text
   * @returns The placeholder string to display
   */
  createPlaceholder(text: string): string {
    const id = this.nextId++
    const lineCount = this.countLines(text)

    this.entries.set(id, {
      id,
      text,
      lineCount,
    })

    // Format: [Pasted text #1 +5 lines]
    return `[Pasted text #${id} +${lineCount} lines]`
  }

  /**
   * Resolve placeholders in display text to actual content
   * @param displayText - Text that may contain placeholders
   * @returns Text with placeholders replaced by actual content
   */
  resolvePlaceholder(displayText: string): string {
    // Reset regex lastIndex for global regex
    PLACEHOLDER_RE.lastIndex = 0

    return displayText.replace(PLACEHOLDER_RE, (match, idStr, _linesStr) => {
      const id = parseInt(idStr, 10)
      const entry = this.entries.get(id)

      if (entry) {
        return entry.text
      }

      // Entry not found, return original match
      return match
    })
  }

  /**
   * Count lines in text (handles both \n and \r\n)
   */
  private countLines(text: string): number {
    if (!text) return 0
    return text.split(/\r?\n/).length
  }

  /**
   * Clear all stored entries
   */
  clear(): void {
    this.entries.clear()
    this.nextId = 1
  }

  /**
   * Get entry by ID (for debugging/testing)
   */
  getEntry(id: number): PastedTextEntry | undefined {
    return this.entries.get(id)
  }

  /**
   * Get all entries (for debugging/testing)
   */
  getAllEntries(): PastedTextEntry[] {
    return Array.from(this.entries.values())
  }
}
