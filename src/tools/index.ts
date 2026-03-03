import type { Tool } from "../types.js"
import { bashTool } from "./bash.js"
import { readTool } from "./read.js"
import { writeTool } from "./write.js"
import { editTool } from "./edit.js"
import { grepTool } from "./grep.js"
import { globTool } from "./glob.js"
import { enterPlanModeTool } from "./enter-plan-mode.js"
import { exitPlanModeTool } from "./exit-plan-mode.js"
import { taskTool, getSubagentResultTool, parallelExploreTool } from "./task.js"
import {
  listSkillsTool,
  activateSkillTool,
  deactivateSkillTool,
  showSkillTool,
  getActiveSkillsPromptTool,
} from "./skill.js"
import { webSearchTool } from "./web-search.js"
import type { MCPManager } from "../mcp/manager.js"
import { createMCPToolWrapper } from "../mcp/tools.js"

/**
 * Subagent 工具名称列表
 * 这些工具在 subagent 中被禁用，以防止递归调用
 */
const SUBAGENT_TOOLS = [
  "task",
  "get_subagent_result",
  "parallel_explore",
  "enter_plan_mode",
  "exit_plan_mode",
]

/**
 * ToolRegistry 配置
 */
export interface ToolRegistryConfig {
  /**
   * 是否作为 subagent 运行
   * 如果为 true，将禁用 subagent 相关工具以防止递归
   */
  isSubagent?: boolean
}

export class ToolRegistry {
  private tools = new Map<string, Tool>()
  private mcpManager?: MCPManager
  private isSubagent: boolean

  constructor(config: ToolRegistryConfig = {}) {
    this.isSubagent = config.isSubagent ?? false

    // 所有内置工具
    const allTools = [
      bashTool,
      readTool,
      writeTool,
      editTool,
      grepTool,
      globTool,
      enterPlanModeTool,
      exitPlanModeTool,
      taskTool,
      getSubagentResultTool,
      parallelExploreTool,
      listSkillsTool,
      activateSkillTool,
      deactivateSkillTool,
      showSkillTool,
      getActiveSkillsPromptTool,
      webSearchTool,
    ]

    // 如果是 subagent，过滤掉 subagent 工具以防止递归
    const toolsToRegister = this.isSubagent
      ? allTools.filter((tool) => !SUBAGENT_TOOLS.includes(tool.name))
      : allTools

    toolsToRegister.forEach((tool) => this.register(tool))
  }

  /**
   * 设置 MCP Manager 并监听工具变更
   */
  setMCPManager(manager: MCPManager): void {
    this.mcpManager = manager

    // 注册现有 MCP 工具
    for (const toolInfo of manager.getAllTools()) {
      this.register(createMCPToolWrapper(toolInfo, manager))
    }

    // 监听服务器连接事件
    manager.on("server-connected", (_, tools) => {
      for (const toolInfo of tools) {
        this.register(createMCPToolWrapper(toolInfo, manager))
      }
    })

    // 监听工具变更事件
    manager.on("tools-changed", (_, tools) => {
      // 重新注册该服务器的所有工具
      for (const toolInfo of tools) {
        // 删除旧工具
        this.tools.delete(toolInfo.name)
        // 注册新工具
        this.register(createMCPToolWrapper(toolInfo, manager))
      }
    })

    // 监听服务器断开事件
    manager.on("server-disconnected", (serverName) => {
      // 移除该服务器的所有工具（通过 mcpServer 标记识别）
      for (const [name, tool] of this.tools.entries()) {
        if (tool.mcpServer === serverName) {
          this.tools.delete(name)
        }
      }
    })
  }

  /**
   * 获取 MCP Manager
   */
  getMCPManager(): MCPManager | undefined {
    return this.mcpManager
  }

  register(tool: Tool) {
    this.tools.set(tool.name, tool)
  }

  get(name: string) {
    // 首先尝试精确匹配
    const tool = this.tools.get(name)
    if (tool) return tool

    // 如果工具名不是 mcp_ 前缀，尝试查找对应的 MCP 工具
    // 例如：用户调用 "web_search"，我们查找 "mcp_*_web_search"
    if (!name.startsWith("mcp_") && this.mcpManager) {
      // 遍历所有 MCP 工具，查找原始名称匹配的
      for (const [toolName, t] of this.tools) {
        if (toolName.startsWith("mcp_") && t.mcpServer) {
          // 解析 MCP 工具名：mcp_server_tool -> tool
          const parts = toolName.split("_")
          if (parts.length >= 3) {
            const originalName = parts.slice(2).join("_").replace(/_\d+$/, "")
            if (originalName === name) {
              return t
            }
          }
        }
      }
    }

    return undefined
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
export * from "./task.js"
export * from "./skill.js"
