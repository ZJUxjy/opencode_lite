import { z } from "zod"
import { exec } from "child_process"
import { promisify } from "util"
import type { Tool } from "../types.js"

const execAsync = promisify(exec)

export const grepTool: Tool = {
  name: "grep",
  description: `Search for patterns in files using ripgrep.
- Supports regex patterns.
- Use glob to filter file types.
- Returns matching lines with file paths and line numbers.`,

  parameters: z.object({
    pattern: z.string().describe("Regex pattern to search for"),
    path: z.string().optional().describe("Directory or file to search"),
    glob: z.string().optional().describe("File pattern (e.g., *.ts, **/*.js)"),
    "ignore-case": z.boolean().optional().describe("Case insensitive search"),
  }),

  async execute({ pattern, path, glob, "ignore-case": ignoreCase }, ctx) {
    const searchPath = path || ctx.cwd
    const args = ["rg", "--line-number", "--with-filename"]

    if (ignoreCase) args.push("-i")
    if (glob) args.push("-g", glob)

    args.push(pattern, searchPath)

    try {
      const { stdout } = await execAsync(args.join(" "), {
        cwd: ctx.cwd,
        maxBuffer: 10 * 1024 * 1024,
      })
      return stdout || "No matches found"
    } catch (error: any) {
      // ripgrep returns exit code 1 when no matches
      if (error.code === 1) {
        return "No matches found"
      }
      return `Error: ${error.message}`
    }
  },
}
