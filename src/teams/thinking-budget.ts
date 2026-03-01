/**
 * Thinking Budget - Extended thinking for complex problem solving
 *
 * Based on Anthropic's "thinking budget" mechanism.
 * Allows agents to use extended reasoning for complex tasks.
 */

import * as fs from "fs"
import * as path from "path"
import type { AgentRole } from "./types.js"

export interface ThinkingBudgetConfig {
  enabled: boolean
  maxThinkingTokens: number
  outputThinkingProcess: boolean
  /** 工作目录 */
  cwd: string
  /** 思考产物目录 */
  thinkingDir: string
  /** 按角色启用 */
  enabledRoles: AgentRole[]
}

export interface ThinkingArtifact {
  taskId: string
  agentId?: string
  role?: AgentRole
  thinkingProcess: string
  analysisSteps: string[]
  considerations: string[]
  conclusion: string
  tokensUsed: number
  timestamp: number
}

/**
 * Default thinking budget config
 */
export const DEFAULT_THINKING_CONFIG: ThinkingBudgetConfig = {
  enabled: false,
  maxThinkingTokens: 10000,
  outputThinkingProcess: true,
  cwd: process.cwd(),
  thinkingDir: ".agent-teams/thinking",
  enabledRoles: ["planner", "leader", "reviewer"],
}

/**
 * Thinking prompt template
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

export class ThinkingBudgetManager {
  private config: ThinkingBudgetConfig
  private artifacts: Map<string, ThinkingArtifact> = new Map()

  constructor(config: Partial<ThinkingBudgetConfig> = {}) {
    this.config = { ...DEFAULT_THINKING_CONFIG, ...config }
  }

  /**
   * Check if thinking budget is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled
  }

  /**
   * Check if enabled for a specific role
   */
  isEnabledForRole(role: AgentRole): boolean {
    if (!this.config.enabled) return false
    return this.config.enabledRoles.includes(role)
  }

  /**
   * Get thinking prompt for a role
   */
  getThinkingPrompt(role: AgentRole): string {
    if (!this.isEnabledForRole(role)) return ""
    return THINKING_PROMPT_TEMPLATE
  }

  /**
   * Prepend thinking prompt to a prompt
   */
  prependThinkingPrompt(prompt: string, role: AgentRole): string {
    if (!this.isEnabledForRole(role)) return prompt
    return `${THINKING_PROMPT_TEMPLATE}\n\n---\n\n${prompt}`
  }

  /**
   * Parse thinking artifact from response
   */
  parseThinkingArtifact(
    response: string,
    taskId: string,
    agentId?: string,
    role?: AgentRole
  ): ThinkingArtifact | null {
    const match = response.match(/```thinking\n([\s\S]*?)\n```/)
    if (!match) return null

    const content = match[1]
    const sections = {
      understanding: this.extractSection(content, "UNDERSTANDING"),
      analysis: this.extractSection(content, "ANALYSIS"),
      plan: this.extractSection(content, "PLAN"),
      considerations: this.extractSection(content, "CONSIDERATIONS"),
      conclusion: this.extractSection(content, "CONCLUSION"),
    }

    const analysisSteps = sections.analysis
      .split("\n")
      .filter(line => line.trim().startsWith("-"))
      .map(line => line.replace(/^-\s*/, "").trim())
      .filter(line => line.length > 0)

    const considerations = sections.considerations
      .split("\n")
      .filter(line => line.trim().startsWith("-"))
      .map(line => line.replace(/^-\s*/, "").trim())
      .filter(line => line.length > 0)

    return {
      taskId,
      agentId,
      role,
      thinkingProcess: content,
      analysisSteps,
      considerations,
      conclusion: sections.conclusion,
      tokensUsed: Math.ceil(content.length / 4),
      timestamp: Date.now(),
    }
  }

  /**
   * Extract section from thinking content
   */
  private extractSection(content: string, sectionName: string): string {
    const regex = new RegExp(`${sectionName}:\\s*\\n([\\s\\S]*?)(?=\\n[A-Z]+:|$)`, "i")
    const match = content.match(regex)
    return match ? match[1].trim() : ""
  }

  /**
   * Save thinking artifact to file
   */
  saveThinkingArtifact(artifact: ThinkingArtifact): string {
    const dir = path.resolve(this.config.cwd, this.config.thinkingDir)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const filename = `${artifact.taskId}${artifact.agentId ? `-${artifact.agentId}` : ""}-thinking.md`
    const filePath = path.join(dir, filename)

    const content = this.formatArtifactAsMarkdown(artifact)
    fs.writeFileSync(filePath, content, "utf-8")

    return filePath
  }

  /**
   * Read thinking artifact from file
   */
  readThinkingArtifact(taskId: string, agentId?: string): string | null {
    const filename = `${taskId}${agentId ? `-${agentId}` : ""}-thinking.md`
    const filePath = path.join(this.config.cwd, this.config.thinkingDir, filename)

    if (!fs.existsSync(filePath)) return null
    return fs.readFileSync(filePath, "utf-8")
  }

  /**
   * Format artifact as markdown
   */
  private formatArtifactAsMarkdown(artifact: ThinkingArtifact): string {
    const lines = [
      "# Thinking Artifact",
      "",
      `**Task**: ${artifact.taskId}`,
      artifact.agentId ? `**Agent**: ${artifact.agentId}` : "",
      artifact.role ? `**Role**: ${artifact.role}` : "",
      `**Created**: ${new Date(artifact.timestamp).toISOString()}`,
      `**Tokens**: ~${artifact.tokensUsed}`,
      "",
      "## Thinking Process",
      "",
      "```",
      artifact.thinkingProcess,
      "```",
      "",
    ]

    if (artifact.analysisSteps.length > 0) {
      lines.push("## Analysis Steps", "")
      artifact.analysisSteps.forEach(step => lines.push(`- ${step}`))
      lines.push("")
    }

    if (artifact.considerations.length > 0) {
      lines.push("## Considerations", "")
      artifact.considerations.forEach(c => lines.push(`- ${c}`))
      lines.push("")
    }

    lines.push("## Conclusion", "", artifact.conclusion, "")
    return lines.filter(Boolean).join("\n")
  }

  /**
   * Remove thinking block from response
   */
  removeThinkingBlock(response: string): string {
    return response.replace(/```thinking\n[\s\S]*?\n```\n*/g, "")
  }

  /**
   * Check if response has thinking block
   */
  hasThinkingBlock(response: string): boolean {
    return /```thinking\n[\s\S]*?\n```/.test(response)
  }

  /**
   * Estimate thinking tokens in response
   */
  estimateThinkingTokens(response: string): number {
    const match = response.match(/```thinking\n([\s\S]*?)\n```/)
    return match ? Math.ceil(match[1].length / 4) : 0
  }

  /**
   * Get max thinking tokens
   */
  getMaxTokens(): number {
    return this.config.maxThinkingTokens
  }

  /**
   * Check if thinking process should be output
   */
  shouldOutputThinking(): boolean {
    return this.config.outputThinkingProcess
  }

  /**
   * Record a thinking artifact
   */
  recordThinking(taskId: string, thinking: Omit<ThinkingArtifact, 'taskId' | 'timestamp'>): void {
    if (!this.config.enabled) {
      return
    }

    const artifact: ThinkingArtifact = {
      taskId,
      ...thinking,
      timestamp: Date.now(),
    }

    this.artifacts.set(taskId, artifact)
  }

  /**
   * Get thinking artifact for a task
   */
  getThinking(taskId: string): ThinkingArtifact | undefined {
    return this.artifacts.get(taskId)
  }

  /**
   * Get all thinking artifacts
   */
  getAllThinking(): ThinkingArtifact[] {
    return Array.from(this.artifacts.values())
  }

  /**
   * Format thinking for output
   */
  formatThinking(artifact: ThinkingArtifact): string {
    const lines: string[] = []

    lines.push(`## Thinking Process (${artifact.tokensUsed} tokens)`)
    lines.push('')
    lines.push(artifact.thinkingProcess)
    lines.push('')

    if (artifact.analysisSteps.length > 0) {
      lines.push('### Analysis Steps')
      artifact.analysisSteps.forEach((step, i) => {
        lines.push(`${i + 1}. ${step}`)
      })
      lines.push('')
    }

    if (artifact.considerations.length > 0) {
      lines.push('### Considerations')
      artifact.considerations.forEach(c => {
        lines.push(`- ${c}`)
      })
      lines.push('')
    }

    lines.push(`### Conclusion`)
    lines.push(artifact.conclusion)

    return lines.join('\n')
  }

  /**
   * Check if thinking budget is exceeded for a task
   */
  isBudgetExceeded(taskId: string): boolean {
    const artifact = this.artifacts.get(taskId)
    if (!artifact) return false
    return artifact.tokensUsed > this.config.maxThinkingTokens
  }

  /**
   * Get total tokens used across all thinking
   */
  getTotalTokensUsed(): number {
    return Array.from(this.artifacts.values())
      .reduce((sum, a) => sum + a.tokensUsed, 0)
  }

  /**
   * Clear all thinking artifacts
   */
  clear(): void {
    this.artifacts.clear()
  }
}

export function createThinkingBudgetManager(
  config?: Partial<ThinkingBudgetConfig>
): ThinkingBudgetManager {
  return new ThinkingBudgetManager(config)
}
