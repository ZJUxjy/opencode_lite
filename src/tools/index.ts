import type { Tool } from "../types.js"
import { bashTool } from "./bash.js"
import { readTool } from "./read.js"
import { writeTool } from "./write.js"
import { editTool } from "./edit.js"
import { grepTool } from "./grep.js"
import { globTool } from "./glob.js"
import { enterPlanModeTool } from "./enter-plan-mode.js"
import { exitPlanModeTool } from "./exit-plan-mode.js"

export class ToolRegistry {
  private tools = new Map<string, Tool>()

  constructor() {
    // 注册内置工具
    ;[
      bashTool,
      readTool,
      writeTool,
      editTool,
      grepTool,
      globTool,
      enterPlanModeTool,
      exitPlanModeTool,
    ].forEach((tool) => this.register(tool))
  }

  register(tool: Tool) {
    this.tools.set(tool.name, tool)
  }

  get(name: string) {
    return this.tools.get(name)
  }

  getAll() {
    return Array.from(this.tools.values())
  }

  getDefinitions() {
    return this.getAll().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }))
  }
}

// 导出所有工具
export * from "./bash.js"
export * from "./read.js"
export * from "./write.js"
export * from "./edit.js"
export * from "./grep.js"
export * from "./glob.js"
export * from "./enter-plan-mode.js"
export * from "./exit-plan-mode.js"
