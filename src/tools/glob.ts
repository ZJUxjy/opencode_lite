import { z } from "zod"
import { glob as globSync } from "glob"
import type { Tool } from "../types.js"

export const globTool: Tool = {
  name: "glob",
  description: `Find files matching a pattern.
- Supports glob patterns like **/*.ts, src/**/*.js
- Returns file paths relative to the project directory.
- Useful for discovering files in the codebase.`,

  parameters: z.object({
    pattern: z.string().describe("Glob pattern (e.g., **/*.ts)"),
    path: z.string().optional().describe("Directory to search"),
  }),

  async execute({ pattern, path }, ctx) {
    const searchPath = path || ctx.cwd

    try {
      const files = await globSync(pattern, {
        cwd: searchPath,
        nodir: true,
        ignore: ["node_modules/**", ".git/**", "dist/**"],
      })

      if (files.length === 0) {
        return "No files found matching pattern"
      }

      return files.join("\n")
    } catch (error: any) {
      return `Error: ${error.message}`
    }
  },
}
