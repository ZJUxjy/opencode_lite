import { appendFileSync, mkdirSync, existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import type { Message } from "../types.js"
import type { ChatResponse } from "../llm.js"

/**
 * PromptDumper - Logs LLM requests and responses to a Markdown file for debugging
 *
 * Output format:
 * - Location: ~/.lite-opencode/dumps/session-{id}.md
 * - Append mode: Each request/response appends to the same file
 */
export class PromptDumper {
  private sessionId: string
  private enabled: boolean
  private dumpPath: string
  private requestCount: number = 0
  private initialized: boolean = false
  private startTime: Date

  constructor(sessionId: string, enabled: boolean = false) {
    this.sessionId = sessionId
    this.enabled = enabled
    this.startTime = new Date()
    this.dumpPath = join(
      homedir(),
      ".lite-opencode",
      "dumps",
      `session-${sessionId}.md`
    )
  }

  /**
   * Check if dumping is enabled
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Enable or disable dumping
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  /**
   * Get the path to the dump file
   */
  getDumpPath(): string {
    return this.dumpPath
  }

  /**
   * Dump the request (system prompt and messages) to the file
   */
  dumpRequest(systemPrompt: string, messages: Message[]): void {
    if (!this.enabled) return

    this.requestCount++

    // Initialize file with header on first dump
    if (!this.initialized) {
      this.initializeFile()
      this.initialized = true
    }

    const timestamp = new Date().toLocaleTimeString()
    const tokens = this.estimateTokens(systemPrompt)

    let content = `\n---\n\n## Request #${this.requestCount} @ ${timestamp}\n\n`

    // System Prompt section
    content += `### System Prompt (${tokens} tokens)\n\n`
    content += "```\n"
    content += systemPrompt
    content += "\n```\n\n"

    // Messages section
    content += `### Messages (${messages.length} messages)\n\n`
    content += "```\n"
    content += this.formatMessages(messages)
    content += "\n```\n"

    this.append(content)
  }

  /**
   * Dump the LLM response to the file
   */
  dumpResponse(response: ChatResponse): void {
    if (!this.enabled) return

    let content = "\n### LLM Response\n\n"

    // Add reasoning if present
    if (response.reasoning) {
      content += "**Reasoning:**\n\n```\n"
      content += response.reasoning
      content += "\n```\n\n"
    }

    // Add tool calls if present
    if (response.toolCalls && response.toolCalls.length > 0) {
      content += "**Tool Calls:**\n\n```\n"
      for (const tc of response.toolCalls) {
        content += `- ${tc.name}(${JSON.stringify(tc.arguments, null, 2)})\n`
      }
      content += "```\n\n"
    }

    // Add main content
    content += "**Content:**\n\n```\n"
    content += response.content
    content += "\n```\n"

    // Add finish reason if present
    if (response.finishReason) {
      content += `\n_Finish Reason: ${response.finishReason}_\n`
    }

    this.append(content)
  }

  /**
   * Initialize the dump file with session header
   */
  private initializeFile(): void {
    // Ensure directory exists
    const dir = join(homedir(), ".lite-opencode", "dumps")
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const timestamp = this.startTime.toLocaleString()

    let content = `# Session: ${this.sessionId}\n`
    content += `# Started: ${timestamp}\n`

    this.append(content)
  }

  /**
   * Append content to the dump file
   */
  private append(content: string): void {
    try {
      appendFileSync(this.dumpPath, content, "utf-8")
    } catch (error) {
      console.error(`[PromptDumper] Failed to write to dump file: ${error}`)
    }
  }

  /**
   * Format messages for display
   */
  private formatMessages(messages: Message[]): string {
    const lines: string[] = []

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      const role = msg.role.toUpperCase()

      if (msg.toolResults && msg.toolResults.length > 0) {
        // Tool result message
        const results = msg.toolResults
          .map((r) => `[tool result: ${r.content.slice(0, 100)}...]`)
          .join(", ")
        lines.push(`[${i}] USER: ${results}`)
      } else if (msg.toolCalls && msg.toolCalls.length > 0) {
        // Assistant message with tool calls
        const calls = msg.toolCalls
          .map((tc) => `[tool: ${tc.name}(${JSON.stringify(tc.arguments)})]`)
          .join(", ")
        lines.push(`[${i}] ASSISTANT: ${msg.content || ""} ${calls}`)
      } else {
        // Regular message
        lines.push(`[${i}] ${role}: ${msg.content}`)
      }
    }

    return lines.join("\n")
  }

  /**
   * Estimate tokens for a string (1 token ~= 4 characters)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }
}
