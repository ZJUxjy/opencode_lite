/**
 * Thinking Budget - 扩展思考预算
 *
 * 基于 agent-teams-supplement.md 原则 4: Extended Thinking as Scratchpad
 *
 * 允许 Agent 在输出前进行深度思考，将思考过程作为草稿。
 */

import * as fs from "fs"
import * as path from "path"
import type { AgentRole } from "./types.js"

/**
 * 思考预算配置
 */
export interface ThinkingBudgetConfig {
  /** 是否启用 */
  enabled: boolean
  /** 最大思考 token 数 */
  maxThinkingTokens: number
  /** 是否输出思考过程 */
  outputThinkingProcess: boolean
  /** 工作目录 */
  cwd: string
  /** 思考产物目录 */
  thinkingDir: string
  /** 按角色启用 */
  enabledRoles: AgentRole[]
}

/**
 * 默认配置
 */
export const DEFAULT_THINKING_CONFIG: ThinkingBudgetConfig = {
  enabled: true,
  maxThinkingTokens: 10000,
  outputThinkingProcess: true,
  cwd: process.cwd(),
  thinkingDir: ".agent-teams/thinking",
  enabledRoles: ["planner", "leader", "reviewer"],
}

/**
 * 思考产物
 */
export interface ThinkingArtifact {
  /** 任务 ID */
  taskId: string
  /** Agent ID */
  agentId: string
  /** 角色 */
  role: AgentRole
  /** 思考过程 */
  thinkingProcess: string
  /** 分析步骤 */
  analysisSteps: string[]
  /** 考虑因素 */
  considerations: string[]
  /** 结论 */
  conclusion: string
  /** 创建时间 */
  createdAt: number
  /** Token 使用量 */
  tokenUsage?: number
}

/**
 * 思考提示模板
 */
export const THINKING_PROMPT_TEMPLATE = `Before responding, please think through this task carefully.

## Thinking Process

Please analyze the task following these steps:

### 1. Understanding
- What is the core requirement?
- What are the constraints?
- What context is relevant?

### 2. Analysis
- What approaches could work?
- What are the trade-offs?
- What could go wrong?

### 3. Planning
- What steps should I take?
- What order makes sense?
- What should I prioritize?

### 4. Considerations
- Are there edge cases?
- Are there dependencies?
- Are there risks?

### 5. Conclusion
- What is my plan?
- What will I output?

Please output your thinking in this format:

\`\`\`thinking
UNDERSTANDING:
<your understanding>

ANALYSIS:
- Approach 1: <description>
- Approach 2: <description>

PLAN:
1. <step 1>
2. <step 2>

CONSIDERATIONS:
- <consideration 1>
- <consideration 2>

CONCLUSION:
<your conclusion>
\`\`\`

After your thinking block, provide your actual response.
`

/**
 * 思考预算管理器
 */
export class ThinkingBudgetManager {
  private config: ThinkingBudgetConfig

  constructor(config: Partial<ThinkingBudgetConfig> = {}) {
    this.config = { ...DEFAULT_THINKING_CONFIG, ...config }
  }

  /**
   * 检查是否为角色启用
   */
  isEnabledForRole(role: AgentRole): boolean {
    if (!this.config.enabled) return false
    return this.config.enabledRoles.includes(role)
  }

  /**
   * 获取思考提示
   */
  getThinkingPrompt(role: AgentRole): string {
    if (!this.isEnabledForRole(role)) {
      return ""
    }
    return THINKING_PROMPT_TEMPLATE
  }

  /**
   * 解析思考产物
   */
  parseThinkingArtifact(
    response: string,
    taskId: string,
    agentId: string,
    role: AgentRole
  ): ThinkingArtifact | null {
    // 提取思考块
    const thinkingMatch = response.match(/```thinking\n([\s\S]*?)\n```/)
    if (!thinkingMatch) {
      return null
    }

    const thinkingContent = thinkingMatch[1]

    // 解析各个部分
    const sections = {
      understanding: this.extractSection(thinkingContent, "UNDERSTANDING"),
      analysis: this.extractSection(thinkingContent, "ANALYSIS"),
      plan: this.extractSection(thinkingContent, "PLAN"),
      considerations: this.extractSection(thinkingContent, "CONSIDERATIONS"),
      conclusion: this.extractSection(thinkingContent, "CONCLUSION"),
    }

    // 解析分析步骤
    const analysisSteps = sections.analysis
      .split("\n")
      .filter(line => line.trim().startsWith("-"))
      .map(line => line.replace(/^-\s*/, "").trim())
      .filter(line => line.length > 0)

    // 解析考虑因素
    const considerations = sections.considerations
      .split("\n")
      .filter(line => line.trim().startsWith("-"))
      .map(line => line.replace(/^-\s*/, "").trim())
      .filter(line => line.length > 0)

    // 估算 token 使用量
    const tokenUsage = Math.ceil(thinkingContent.length / 4)

    return {
      taskId,
      agentId,
      role,
      thinkingProcess: thinkingContent,
      analysisSteps,
      considerations,
      conclusion: sections.conclusion,
      createdAt: Date.now(),
      tokenUsage,
    }
  }

  /**
   * 提取章节内容
   */
  private extractSection(content: string, sectionName: string): string {
    const regex = new RegExp(`${sectionName}:\\s*\\n([\\s\\S]*?)(?=\\n[A-Z]+:|$)`, "i")
    const match = content.match(regex)
    return match ? match[1].trim() : ""
  }

  /**
   * 保存思考产物
   */
  saveThinkingArtifact(artifact: ThinkingArtifact): string {
    const thinkingDir = path.resolve(this.config.cwd, this.config.thinkingDir)

    if (!fs.existsSync(thinkingDir)) {
      fs.mkdirSync(thinkingDir, { recursive: true })
    }

    const filename = `${artifact.taskId}-${artifact.agentId}-thinking.md`
    const filePath = path.join(thinkingDir, filename)

    const content = this.formatThinkingArtifact(artifact)
    fs.writeFileSync(filePath, content, "utf-8")

    return filePath
  }

  /**
   * 格式化思考产物为 Markdown
   */
  private formatThinkingArtifact(artifact: ThinkingArtifact): string {
    const lines = [
      `# Thinking Artifact`,
      ``,
      `**Task**: ${artifact.taskId}`,
      `**Agent**: ${artifact.agentId} (${artifact.role})`,
      `**Created**: ${new Date(artifact.createdAt).toISOString()}`,
      `**Tokens**: ~${artifact.tokenUsage || "N/A"}`,
      ``,
      `## Thinking Process`,
      ``,
      "```",
      artifact.thinkingProcess,
      "```",
      ``,
    ]

    if (artifact.analysisSteps.length > 0) {
      lines.push(`## Analysis Steps`)
      lines.push("")
      for (const step of artifact.analysisSteps) {
        lines.push(`- ${step}`)
      }
      lines.push("")
    }

    if (artifact.considerations.length > 0) {
      lines.push(`## Considerations`)
      lines.push("")
      for (const c of artifact.considerations) {
        lines.push(`- ${c}`)
      }
      lines.push("")
    }

    lines.push(`## Conclusion`)
    lines.push("")
    lines.push(artifact.conclusion)
    lines.push("")

    return lines.join("\n")
  }

  /**
   * 读取思考产物
   */
  readThinkingArtifact(taskId: string, agentId: string): string | null {
    const filename = `${taskId}-${agentId}-thinking.md`
    const filePath = path.join(this.config.cwd, this.config.thinkingDir, filename)

    if (!fs.existsSync(filePath)) {
      return null
    }

    return fs.readFileSync(filePath, "utf-8")
  }

  /**
   * 获取配置
   */
  getConfig(): ThinkingBudgetConfig {
    return { ...this.config }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ThinkingBudgetConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * 从响应中移除思考块
   */
  removeThinkingBlock(response: string): string {
    return response.replace(/```thinking\n[\s\S]*?\n```\n*/g, "")
  }

  /**
   * 检查响应是否包含思考块
   */
  hasThinkingBlock(response: string): boolean {
    return /```thinking\n[\s\S]*?\n```/.test(response)
  }

  /**
   * 估算思考 token 使用量
   */
  estimateThinkingTokens(content: string): number {
    const thinkingMatch = content.match(/```thinking\n([\s\S]*?)\n```/)
    if (!thinkingMatch) return 0
    return Math.ceil(thinkingMatch[1].length / 4)
  }
}

/**
 * 创建思考预算管理器
 */
export function createThinkingBudgetManager(config?: Partial<ThinkingBudgetConfig>): ThinkingBudgetManager {
  return new ThinkingBudgetManager(config)
}

/**
 * 为提示添加思考引导
 */
export function prependThinkingPrompt(prompt: string, role: AgentRole, config?: Partial<ThinkingBudgetConfig>): string {
  const manager = new ThinkingBudgetManager(config)

  if (!manager.isEnabledForRole(role)) {
    return prompt
  }

  return `${THINKING_PROMPT_TEMPLATE}\n\n---\n\n${prompt}`
}
