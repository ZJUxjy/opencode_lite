/**
 * Thinking Budget - Extended thinking for complex problem solving
 *
 * Based on Anthropic's "thinking budget" mechanism.
 * Allows agents to use extended reasoning for complex tasks.
 */

export interface ThinkingBudgetConfig {
  enabled: boolean
  maxThinkingTokens: number
  outputThinkingProcess: boolean
}

export interface ThinkingArtifact {
  taskId: string
  thinkingProcess: string
  analysisSteps: string[]
  considerations: string[]
  conclusion: string
  tokensUsed: number
  timestamp: number
}

export class ThinkingBudgetManager {
  private config: ThinkingBudgetConfig
  private artifacts: Map<string, ThinkingArtifact> = new Map()

  constructor(config: Partial<ThinkingBudgetConfig> = {}) {
    this.config = {
      enabled: false,
      maxThinkingTokens: 10000,
      outputThinkingProcess: true,
      ...config,
    }
  }

  /**
   * Check if thinking budget is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled
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
