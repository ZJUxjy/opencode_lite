import { z } from "zod"
import { writeFile, mkdir, rename, unlink } from "fs/promises"
import { dirname, resolve } from "path"
import type { Tool } from "../types.js"

export const writeTool: Tool = {
  name: "write",
  description: `Write content to a file.
- Creates the file if it doesn't exist.
- Overwrites existing content.
- Creates parent directories if needed.`,

  parameters: z.object({
    path: z.string().describe("Path to the file"),
    content: z.string().describe("Content to write"),
  }),

  async execute({ path, content }, ctx) {
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
      // 确保目录存在
      await mkdir(dirname(fullPath), { recursive: true })
      // Atomic write: write to temp file, then rename
      await writeFile(tmpPath, content, "utf-8")
      await rename(tmpPath, fullPath)
      return `Successfully wrote ${content.length} characters to ${fullPath}`
    } catch (error: any) {
      // Clean up temp file on failure
      await unlink(tmpPath).catch(() => {})
      return `Error: ${error.message}`
    }
  },
}
