/**
 * Risk Level Types and Classification
 *
 * This module provides risk-based permission control for tool operations.
 * Tools are classified into three risk levels: low, medium, and high.
 */

/**
 * Risk level classification
 */
export type RiskLevel = "low" | "medium" | "high"

/**
 * Result of risk classification for a tool call
 */
export interface RiskClassification {
  level: RiskLevel
  reason: string
}

/**
 * Configuration for risk-based decisions
 */
export interface RiskConfig {
  /** Risk levels that should be automatically approved */
  autoApprove: RiskLevel[]
  /** Risk levels that should prompt for user approval */
  promptApprove: RiskLevel[]
  /** Risk levels that should be denied */
  deny: RiskLevel[]
}

/**
 * Default risk configuration
 * - Low risk: auto-approved
 * - Medium/High risk: prompt for approval
 */
export const DEFAULT_RISK_CONFIG: RiskConfig = {
  autoApprove: ["low"],
  promptApprove: ["medium", "high"],
  deny: [],
}

/**
 * Rule for classifying a tool's risk level
 */
export interface ToolRiskRule {
  /** Tool name, supports wildcards like "mcp_*" */
  tool: string
  /** Risk level for this tool */
  level: RiskLevel
  /** Optional conditions for more granular classification */
  conditions?: {
    /** Pattern to match against arguments */
    argPattern?: RegExp
    /** Pattern to match against path argument */
    pathPattern?: RegExp
  }
  /** Human-readable description */
  description: string
}

/**
 * Default tool risk classification rules
 *
 * Risk levels:
 * - Low: Read-only operations that don't modify state
 * - Medium: Write operations that modify files or state
 * - High: System operations that can have significant impact
 */
export const DEFAULT_TOOL_RISK_RULES: ToolRiskRule[] = [
  // Low risk - read operations
  { tool: "read", level: "low", description: "Read file content" },
  { tool: "glob", level: "low", description: "List files matching pattern" },
  { tool: "grep", level: "low", description: "Search file contents" },
  { tool: "list_skills", level: "low", description: "List available skills" },
  { tool: "show_skill", level: "low", description: "Show skill details" },
  { tool: "get_active_skills_prompt", level: "low", description: "Get active skills prompt" },
  { tool: "web_search", level: "low", description: "Search web" },
  { tool: "get_subagent_result", level: "low", description: "Get subagent result" },

  // Medium risk - write operations
  { tool: "write", level: "medium", description: "Write file" },
  { tool: "edit", level: "medium", description: "Edit file" },
  { tool: "activate_skill", level: "medium", description: "Activate skill" },
  { tool: "deactivate_skill", level: "medium", description: "Deactivate skill" },
  { tool: "enter_plan_mode", level: "medium", description: "Enter plan mode" },
  { tool: "exit_plan_mode", level: "medium", description: "Exit plan mode" },

  // High risk - system operations
  { tool: "bash", level: "high", description: "Execute shell command" },
  { tool: "task", level: "high", description: "Create subagent task" },
  { tool: "parallel_explore", level: "high", description: "Parallel explore" },
  { tool: "mcp_*", level: "high", description: "MCP external tool" },
]

/**
 * Classify the risk level of a tool call
 *
 * @param toolName - Name of the tool being called
 * @param args - Arguments passed to the tool
 * @param rules - Risk classification rules to use (defaults to DEFAULT_TOOL_RISK_RULES)
 * @returns Risk classification result
 */
export function classifyToolRisk(
  toolName: string,
  args: Record<string, unknown>,
  rules: ToolRiskRule[] = DEFAULT_TOOL_RISK_RULES
): RiskClassification {
  // Find matching rule
  for (const rule of rules) {
    // Check tool name match
    let toolMatches = false
    if (rule.tool === toolName) {
      toolMatches = true
    } else if (rule.tool.endsWith("_*")) {
      const prefix = rule.tool.slice(0, -1) // Remove "*", keep the prefix including "_"
      if (toolName.startsWith(prefix)) {
        toolMatches = true
      }
    }

    if (!toolMatches) continue

    // Check conditions
    if (rule.conditions) {
      if (rule.conditions.argPattern) {
        const argsStr = JSON.stringify(args)
        if (!rule.conditions.argPattern.test(argsStr)) {
          continue
        }
      }
      if (rule.conditions.pathPattern && args.path) {
        if (!rule.conditions.pathPattern.test(String(args.path))) {
          continue
        }
      }
    }

    return {
      level: rule.level,
      reason: rule.description,
    }
  }

  // Default to high risk if no rule matches
  return {
    level: "high",
    reason: "Unknown tool - defaulting to high risk",
  }
}

/**
 * Check if a risk classification should be auto-approved
 *
 * @param risk - Risk classification result
 * @param config - Risk configuration
 * @returns true if the operation should be auto-approved
 */
export function shouldAutoApprove(
  risk: RiskClassification,
  config: RiskConfig
): boolean {
  return config.autoApprove.includes(risk.level)
}

/**
 * Check if a risk classification should be denied
 *
 * @param risk - Risk classification result
 * @param config - Risk configuration
 * @returns true if the operation should be denied
 */
export function shouldDeny(
  risk: RiskClassification,
  config: RiskConfig
): boolean {
  return config.deny.includes(risk.level)
}
