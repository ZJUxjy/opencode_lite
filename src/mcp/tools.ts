/**
 * MCP (Model Context Protocol) 工具包装器
 *
 * 将 MCP 工具转换为 Lite OpenCode 的 Tool 接口
 */

import { z } from "zod"
import type { Tool } from "../types.js"
import type { MCPManager } from "./manager.js"
import type { MCPToolInfo } from "./types.js"
import { formatMCPError } from "./errors.js"
import { mcpLog } from "./logger.js"

/**
 * 将 JSON Schema 转换为 Zod Schema
 *
 * 这是一个简化实现，支持常见的 JSON Schema 类型
 */
function jsonSchemaToZod(schema: any): z.ZodTypeAny {
  if (!schema || typeof schema !== "object") {
    return z.any()
  }

  // 处理基本类型
  switch (schema.type) {
    case "string":
      // 如果有 enum，直接返回 enum schema
      if (schema.enum && Array.isArray(schema.enum)) {
        return z.enum(schema.enum as [string, ...string[]])
      }

      let stringSchema = z.string()
      if (schema.minLength !== undefined) {
        stringSchema = stringSchema.min(schema.minLength)
      }
      if (schema.maxLength !== undefined) {
        stringSchema = stringSchema.max(schema.maxLength)
      }
      if (schema.pattern) {
        stringSchema = stringSchema.regex(new RegExp(schema.pattern))
      }
      return stringSchema

    case "number":
    case "integer":
      let numberSchema = schema.type === "integer" ? z.number().int() : z.number()
      if (schema.minimum !== undefined) {
        numberSchema = numberSchema.min(schema.minimum)
      }
      if (schema.maximum !== undefined) {
        numberSchema = numberSchema.max(schema.maximum)
      }
      return numberSchema

    case "boolean":
      return z.boolean()

    case "array":
      const itemSchema = schema.items
        ? jsonSchemaToZod(schema.items)
        : z.any()
      return z.array(itemSchema)

    case "object":
      const shape: Record<string, z.ZodTypeAny> = {}
      const required = new Set(schema.required || [])

      for (const [key, propSchema] of Object.entries(schema.properties || {})) {
        let zodSchema = jsonSchemaToZod(propSchema)

        // 如果不是 required，包装为 optional
        if (!required.has(key)) {
          zodSchema = zodSchema.optional()
        }

        shape[key] = zodSchema
      }

      // 处理 additionalProperties
      if (schema.additionalProperties === false) {
        return z.object(shape).strict()
      }

      return z.object(shape).passthrough()

    default:
      // 处理 anyOf, oneOf
      if (schema.anyOf || schema.oneOf) {
        const schemas = schema.anyOf || schema.oneOf
        if (schemas.length > 0) {
          // 记录警告：复杂 anyOf/oneOf 只使用第一个选项
          if (schema.anyOf?.length > 1 || schema.oneOf?.length > 1) {
            mcpLog.warn(
              `Complex anyOf/oneOf with multiple options detected. Using first option only.`,
              schema
            )
          }
          return jsonSchemaToZod(schemas[0])
        }
      }

      // 处理 allOf（组合模式）- 记录警告并使用第一个
      if (schema.allOf) {
        mcpLog.warn(
          `allOf is not fully supported. Using first schema only.`,
          schema
        )
        if (schema.allOf.length > 0) {
          return jsonSchemaToZod(schema.allOf[0])
        }
      }

      // 处理 $ref 引用 - 记录警告并返回 any
      if (schema.$ref) {
        mcpLog.warn(
          `$ref references are not supported: ${schema.$ref}. Using z.any()`,
          schema
        )
        return z.any()
      }

      // 如果没有 type，但有 properties，视为 object
      if (schema.properties) {
        return jsonSchemaToZod({ type: "object", ...schema })
      }

      return z.any()
  }
}

/**
 * 为 MCP 工具创建 Zod Schema
 */
function createMCPToolSchema(inputSchema: any): z.ZodObject<any> {
  // 默认空对象
  if (!inputSchema || typeof inputSchema !== "object") {
    return z.object({})
  }

  // 确保是 object 类型
  if (inputSchema.type !== "object" && !inputSchema.properties) {
    return z.object({})
  }

  const schema = jsonSchemaToZod(inputSchema)

  // 确保返回的是对象类型
  if (schema instanceof z.ZodObject) {
    return schema
  }

  return z.object({})
}

/**
 * 创建 MCP 工具包装器
 *
 * 将 MCP 工具转换为 Lite OpenCode 的 Tool 接口
 */
export function createMCPToolWrapper(
  toolInfo: MCPToolInfo,
  manager: MCPManager
): Tool {
  const fullName = toolInfo.name
  // 使用 parseMCPToolName 统一解析工具名
  const parsed = parseMCPToolName(toolInfo.name)
  const originalName = parsed?.tool ?? toolInfo.name

  // 生成描述
  const description = formatToolDescription(toolInfo)

  // 创建 Zod Schema
  const parameters = createMCPToolSchema(toolInfo.inputSchema)

  return {
    name: fullName,
    description,
    parameters,
    mcpServer: toolInfo.server, // 标记来源服务器，用于断开时清理
    execute: async (params, ctx) => {
      try {
        // 调用 MCP 工具
        const result = await manager.callTool(fullName, params)

        // 处理结果
        const textParts: string[] = []
        for (const item of result.content) {
          if (item.type === "text") {
            textParts.push(item.text)
          } else if (item.type === "image") {
            textParts.push(`[Image: ${item.mimeType}]`)
          } else if (item.type === "resource") {
            if (item.resource.text) {
              textParts.push(item.resource.text)
            } else {
              textParts.push(`[Resource: ${item.resource.uri}]`)
            }
          }
        }

        const output = textParts.join("\n")

        // 如果是错误结果，添加前缀
        if (result.isError) {
          return `Error from ${fullName}: ${output}`
        }

        return output || "(empty result)"
      } catch (error) {
        return `Error calling ${fullName}: ${formatMCPError(error)}`
      }
    },
  }
}

/**
 * 格式化工具描述
 *
 * 将 MCP 工具信息转换为 Lite OpenCode 工具描述
 */
function formatToolDescription(toolInfo: MCPToolInfo): string {
  const parts: string[] = []

  // 添加服务器来源标识
  parts.push(`[MCP:${toolInfo.server}]`)

  // 添加原始描述
  if (toolInfo.description) {
    parts.push(toolInfo.description)
  } else {
    parts.push(`MCP tool: ${toolInfo.name}`)
  }

  // 添加参数说明
  if (toolInfo.inputSchema?.properties) {
    const params = Object.entries(toolInfo.inputSchema.properties)
      .map(([name, schema]: [string, any]) => {
        const desc = schema.description ? ` - ${schema.description}` : ""
        return `  - ${name}${desc}`
      })
      .join("\n")

    if (params) {
      parts.push(`\nParameters:\n${params}`)
    }
  }

  return parts.join(" ")
}

/**
 * 检查工具是否是 MCP 工具
 */
export function isMCPToolName(toolName: string): boolean {
  return toolName.startsWith("mcp_")
}

/**
 * 提取服务器名称和原始工具名
 */
export function parseMCPToolName(
  toolName: string
): { server: string; tool: string } | null {
  if (!isMCPToolName(toolName)) {
    return null
  }

  // 格式: mcp_server_tool 或 mcp_server_tool_1
  const parts = toolName.split("_")
  if (parts.length < 3) {
    return null
  }

  // 移除 "mcp" 前缀和数字后缀
  const server = parts[1]
  const tool = parts.slice(2).join("_").replace(/_\d+$/, "")

  return { server, tool }
}
