/**
 * Agent Teams - LLM Client
 *
 * Specialized LLM client for Agent Teams with structured output support.
 * Wraps the main LLMClient and provides agent-specific functionality.
 */

import { LLMClient } from "../../llm.js"
import type { TaskContract, WorkArtifact, ReviewArtifact } from "../core/contracts.js"
import type { CostController } from "../execution/cost-controller.js"
import type { SharedBlackboard } from "../core/types.js"
import { getErrorMessage } from "../../utils/error.js"

// ============================================================================
// Agent LLM Config
// ============================================================================

export interface AgentLLMConfig {
  /** Main LLMClient instance (supports multiple providers) */
  llmClient: LLMClient
  temperature?: number
  /** Callback for token usage tracking */
  onTokenUsage?: (usage: { inputTokens: number; outputTokens: number }) => void
}

// ============================================================================
// Structured Output Types
// ============================================================================

export interface WorkerOutput {
  summary: string
  changedFiles: string[]
  patchRef: string
  testResults: { command: string; passed: boolean; output?: string }[]
  risks: string[]
  assumptions: string[]
  toolCalls?: Array<{
    tool: string
    params: Record<string, unknown>
    result?: string
  }>
}

export interface ReviewerOutput {
  status: "approved" | "changes_requested"
  severity: "P0" | "P1" | "P2" | "P3"
  mustFix: string[]
  suggestions: string[]
  reviewNotes?: string
}

// ============================================================================
// Agent LLM Client
// ============================================================================

export class AgentLLMClient {
  private llmClient: LLMClient
  private temperature: number
  private costController?: CostController
  private blackboard?: SharedBlackboard
  private onTokenUsage?: (usage: { inputTokens: number; outputTokens: number }) => void

  constructor(config: AgentLLMConfig) {
    this.llmClient = config.llmClient
    this.temperature = config.temperature ?? 0.2
    this.onTokenUsage = config.onTokenUsage
  }

  /**
   * Set cost controller for tracking usage
   */
  setCostController(controller: CostController): void {
    this.costController = controller
  }

  /**
   * Set blackboard for posting messages
   */
  setBlackboard(blackboard: SharedBlackboard): void {
    this.blackboard = blackboard
  }

  /**
   * Execute worker agent with structured output
   */
  async executeWorker(
    taskContract: TaskContract,
    iteration: number,
    previousReview?: ReviewArtifact
  ): Promise<WorkArtifact> {
    const prompt = this.buildWorkerPrompt(taskContract, iteration, previousReview)

    this.postMessage("worker", "started", { iteration, taskId: taskContract.taskId })

    try {
      const result = await this.callLLMWithRetry(prompt)

      // Parse structured output
      const output = this.parseWorkerOutput(result.content)

      // Record cost if controller is set
      if (this.costController && result.usage) {
        this.costController.recordUsage(
          result.usage.inputTokens,
          result.usage.outputTokens,
          this.llmClient.getModelId()
        )
      }

      // Notify token usage callback
      if (this.onTokenUsage && result.usage) {
        this.onTokenUsage(result.usage)
      }

      const artifact: WorkArtifact = {
        taskId: taskContract.taskId,
        summary: output.summary,
        changedFiles: output.changedFiles,
        patchRef: output.patchRef || `iteration-${iteration}`,
        testResults: output.testResults || [],
        risks: output.risks || [],
        assumptions: output.assumptions || [],
      }

      this.postMessage("worker", "completed", { artifact, iteration })

      return artifact
    } catch (error) {
      this.postMessage("worker", "failed", { error: getErrorMessage(error), iteration })
      throw error
    }
  }

  /**
   * Execute reviewer agent with structured output
   */
  async executeReviewer(
    taskContract: TaskContract,
    workArtifact: WorkArtifact
  ): Promise<ReviewArtifact> {
    const prompt = this.buildReviewerPrompt(taskContract, workArtifact)

    this.postMessage("reviewer", "started", { taskId: workArtifact.taskId })

    try {
      const result = await this.callLLMWithRetry(prompt)

      // Parse structured output
      const output = this.parseReviewerOutput(result.content)

      // Record cost if controller is set
      if (this.costController && result.usage) {
        this.costController.recordUsage(
          result.usage.inputTokens,
          result.usage.outputTokens,
          this.llmClient.getModelId()
        )
      }

      // Notify token usage callback
      if (this.onTokenUsage && result.usage) {
        this.onTokenUsage(result.usage)
      }

      const review: ReviewArtifact = {
        status: output.status,
        severity: output.severity,
        mustFix: output.mustFix || [],
        suggestions: output.suggestions || [],
      }

      this.postMessage("reviewer", "completed", { review, taskId: workArtifact.taskId })

      return review
    } catch (error) {
      this.postMessage("reviewer", "failed", { error: getErrorMessage(error), taskId: workArtifact.taskId })
      throw error
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Call LLM with retry mechanism
   */
  private async callLLMWithRetry(
    prompt: string,
    maxRetries: number = 3
  ): Promise<{ content: string; usage?: { inputTokens: number; outputTokens: number } }> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.callLLM(prompt)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(getErrorMessage(error))

        // Don't retry on non-retryable errors
        if (this.isNonRetryableError(error)) {
          throw error
        }

        // Exponential backoff
        if (attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000 // 1s, 2s, 4s
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }

    throw lastError
  }

  /**
   * Check if error should not be retried
   */
  private isNonRetryableError(error: unknown): boolean {
    const message = getErrorMessage(error)
    return message.includes("401") || message.includes("403") || message.includes("timed out")
  }

  /**
   * Call LLM using the main LLMClient's generateTextForCompression method
   * which supports multiple providers
   */
  private async callLLM(
    prompt: string
  ): Promise<{ content: string; usage?: { inputTokens: number; outputTokens: number } }> {
    // Use LLMClient's method that works with any configured provider
    const content = await this.llmClient.generateTextForCompression(prompt, 16000)

    return {
      content,
      usage: undefined, // generateTextForCompression doesn't return usage
    }
  }

  private buildWorkerPrompt(
    contract: TaskContract,
    iteration: number,
    previousReview?: ReviewArtifact
  ): string {
    let prompt = `You are a software development agent working on a task.

## Task Contract

**Objective**: ${contract.objective}
**Task ID**: ${contract.taskId}
**File Scope**: ${contract.fileScope.length > 0 ? contract.fileScope.join(", ") : "Not specified"}
**Acceptance Checks**: ${contract.acceptanceChecks.join(", ")}
${contract.apiContracts ? `**API Contracts**: ${contract.apiContracts.join(", ")}` : ""}

## Your Role

You are the WORKER agent. Your job is to analyze the objective and provide a plan.
${iteration > 1 ? `\nThis is iteration ${iteration}. You are refining based on previous review feedback.` : ""}

## CRITICAL INSTRUCTIONS

1. DO NOT use any tool calls or function calls
2. DO NOT write code in XML tags like <tool_call > or <invoke>
3. ONLY return a JSON object in a markdown code block
4. Describe what changes you would make and why

## Response Format

Return ONLY a JSON object in a markdown code block. No other text:

\`\`\`json
{
  "summary": "Brief description of what you plan to implement",
  "changedFiles": ["file1.ts", "file2.ts"],
  "patchRef": "unique-reference-for-this-change",
  "testResults": [
    { "command": "npm test", "passed": true, "output": "optional output" }
  ],
  "risks": ["Risk 1", "Risk 2"],
  "assumptions": ["Assumption 1"]
}
\`\`\`

Important:
- Describe your implementation plan in the summary
- List the files that would need to be changed
- Report any risks or assumptions
- Return ONLY the JSON object, no other text`

    if (previousReview) {
      prompt += `

## Previous Review Feedback (Address These)

**Status**: ${previousReview.status}
**Severity**: ${previousReview.severity}

**Must Fix**:
${previousReview.mustFix.map((item) => `- ${item}`).join("\n")}

**Suggestions**:
${previousReview.suggestions.map((item) => `- ${item}`).join("\n")}`
    }

    return prompt
  }

  private buildReviewerPrompt(contract: TaskContract, artifact: WorkArtifact): string {
    return `You are a code review agent reviewing a work plan.

## Task Contract

**Objective**: ${contract.objective}
**File Scope**: ${contract.fileScope.length > 0 ? contract.fileScope.join(", ") : "Not specified"}
**Acceptance Checks**: ${contract.acceptanceChecks.join(", ")}

## Work Artifact to Review

**Summary**: ${artifact.summary}
**Changed Files**: ${artifact.changedFiles.join(", ")}
**Patch Reference**: ${artifact.patchRef}

**Test Results**:
${artifact.testResults.length > 0
  ? artifact.testResults.map((t) => `- ${t.command}: ${t.passed ? "PASSED" : "FAILED"}`).join("\n")
  : "No tests reported"}

**Risks Identified by Worker**:
${artifact.risks.length > 0 ? artifact.risks.map((r) => `- ${r}`).join("\n") : "None"}

**Assumptions Made by Worker**:
${artifact.assumptions.length > 0 ? artifact.assumptions.map((a) => `- ${a}`).join("\n") : "None"}

## Your Role

You are the REVIEWER agent. Your job is to evaluate the work plan against the task contract.

## CRITICAL INSTRUCTIONS

1. DO NOT use any tool calls or function calls
2. DO NOT write code in XML tags like <tool_call > or <invoke>
3. ONLY return a JSON object in a markdown code block
4. Approve if the plan is reasonable

## Review Criteria

1. **P0 (Critical)**: Security issues, data loss, crashes
2. **P1 (Major)**: Feature not working, tests failing, API contract violations
3. **P2 (Minor)**: Code quality, missing edge cases
4. **P3 (Nice to have)**: Style suggestions, refactoring ideas

## Response Format

Return ONLY a JSON object in a markdown code block. No other text:

\`\`\`json
{
  "status": "approved" | "changes_requested",
  "severity": "P0" | "P1" | "P2" | "P3",
  "mustFix": ["Issue 1 that must be fixed", "Issue 2"],
  "suggestions": ["Suggestion 1", "Suggestion 2"],
  "reviewNotes": "Optional detailed review notes"
}
\`\`\`

Important:
- "approved" only if all acceptance checks are met and no P0/P1 issues
- "changes_requested" if there are any P0 or P1 issues
- Return ONLY the JSON object, no other text`
  }

  private parseWorkerOutput(content: string): WorkerOutput {
    try {
      // Extract JSON from markdown code blocks or plain text
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/)
      const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : content

      const parsed = JSON.parse(jsonStr.trim())

      // Validate required fields
      if (!parsed.summary) {
        throw new Error("Missing required field: summary")
      }

      return {
        summary: parsed.summary,
        changedFiles: parsed.changedFiles || [],
        patchRef: parsed.patchRef || "",
        testResults: parsed.testResults || [],
        risks: parsed.risks || [],
        assumptions: parsed.assumptions || [],
      }
    } catch (error) {
      // Fallback: create basic output from raw content
      return {
        summary: `Worker output parsing failed: ${getErrorMessage(error)}. Raw content: ${content.slice(0, 500)}`,
        changedFiles: [],
        patchRef: "",
        testResults: [],
        risks: ["Output parsing failed - manual review required"],
        assumptions: [],
      }
    }
  }

  private parseReviewerOutput(content: string): ReviewerOutput {
    try {
      // Extract JSON from markdown code blocks or plain text
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || content.match(/\{[\s\S]*\}/)
      const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : content

      const parsed = JSON.parse(jsonStr.trim())

      // Validate required fields
      if (!parsed.status || !parsed.severity) {
        throw new Error("Missing required fields: status and/or severity")
      }

      return {
        status: parsed.status,
        severity: parsed.severity,
        mustFix: parsed.mustFix || [],
        suggestions: parsed.suggestions || [],
        reviewNotes: parsed.reviewNotes,
      }
    } catch (error) {
      // Fallback: request changes with parsing error
      return {
        status: "changes_requested",
        severity: "P1",
        mustFix: [
          `Review output parsing failed: ${getErrorMessage(error)}. Raw content: ${content.slice(0, 500)}`,
        ],
        suggestions: ["Please ensure response is valid JSON"],
      }
    }
  }

  private postMessage(agent: string, event: string, data: Record<string, unknown>): void {
    if (this.blackboard) {
      const details = JSON.stringify({ agent, event, ...data })
      this.blackboard.postMessage(
        {
          type: "progress",
          category: event === "failed" ? "code" : event === "completed" ? "review" : "code",
          details,
        },
        agent,
        "system"
      )
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createAgentLLMClient(config: AgentLLMConfig): AgentLLMClient {
  return new AgentLLMClient(config)
}
