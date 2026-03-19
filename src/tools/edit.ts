import { z } from "zod"
import { readFile, writeFile, rename, unlink } from "fs/promises"
import { resolve } from "path"
import type { Tool } from "../types.js"

export const editTool: Tool = {
  name: "edit",
  description: `Edit a file by replacing specific text.
- Performs exact string replacement.
- The old_string must match exactly (including whitespace).
- Returns error if old_string is not found or appears multiple times.`,

  parameters: z.object({
    path: z.string().describe("Path to the file"),
    old_string: z.string().describe("Text to replace (must match exactly)"),
    new_string: z.string().describe("Replacement text"),
  }),

  async execute({ path, old_string, new_string }, ctx) {
    const fullPath = path.startsWith("/") ? resolve(path) : resolve(ctx.cwd, path)

    // Prevent relative-path traversal outside cwd
    if (!path.startsWith("/")) {
      const resolvedCwd = resolve(ctx.cwd)
      if (!fullPath.startsWith(resolvedCwd + "/") && fullPath !== resolvedCwd) {
        return `Error: Path traversal outside working directory is not allowed`
      }
    }

    const tmpPath = `${fullPath}.tmp.${process.pid}`

    try {
      const content = await readFile(fullPath, "utf-8")

      // 检查唯一性
      const occurrences = content.split(old_string).length - 1
      if (occurrences === 0) {
        return `Error: old_string not found in file`
      }
      if (occurrences > 1) {
        return `Error: old_string appears ${occurrences} times, must be unique`
      }

      const newContent = content.replace(old_string, new_string)
      // Atomic write: write to temp file, then rename
      await writeFile(tmpPath, newContent, "utf-8")
      await rename(tmpPath, fullPath)

      return `Successfully edited ${fullPath}`
    } catch (error: any) {
      // Clean up temp file on failure
      await unlink(tmpPath).catch(() => {})
      return `Error: ${error.message}`
    }
  },
}
