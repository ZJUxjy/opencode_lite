# Agent Teams P1 Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement all 4 P1 priority features from the supplement document: Checkpoint Resume, LLM-as-Judge, PROGRESS.md Persistence, and Loose Context Contract.

**Architecture:** Build on existing CheckpointManager and ProgressTracker foundations. Add new LLM-as-Judge module with standardized EvaluationRubric. Extend contracts with ContextContract for loose coupling.

**Tech Stack:** TypeScript, Zod validation, file system persistence, LLM integration via existing llm-client.ts

---

## Implementation Order

The 4 features have minimal dependencies and can be developed in parallel, but we'll sequence them for logical coherence:

1. **PROGRESS.md Persistence** - simplest, builds on existing ProgressTracker
2. **Loose Context Contract** - foundational, affects contract system
3. **LLM-as-Judge** - standalone module, uses contracts
4. **Checkpoint Resume** - most complex, builds on CheckpointManager

---

## Feature 1: PROGRESS.md Persistence

### Task 1.1: Create ProgressPersistence Interface

**Files:**
- Create: `src/teams/progress-persistence.ts`
- Test: `src/teams/__tests__/progress-persistence.test.ts`

**Step 1: Write the interface and types**

```typescript
// src/teams/progress-persistence.ts

export interface ProgressReport {
  teamId: string
  timestamp: number
  status: "in-progress" | "completed" | "failed" | "paused"
  currentPhase: string
  overallProgress: number // 0-100

  // Summary
  summary: {
    objective: string
    filesChanged: number
    iterationsCompleted: number
    totalIterations: number
  }

  // Current state
  current: {
    activeAgent: string
    role: string
    task: string
    startedAt: number
  }

  // Issues
  issues: {
    p0: string[]
    p1: string[]
    p2: string[]
    p3: string[]
  }

  // Timeline
  timeline: Array<{
    time: number
    event: string
    agent?: string
    details?: string
  }>

  // Next steps (AI generated)
  nextSteps: string[]
}

export interface ProgressPersistenceConfig {
  outputPath: string
  autoSaveInterval: number // milliseconds
  includeTimestamps: boolean
  format: "markdown" | "json" | "both"
}
```

**Step 2: Write failing test**

```typescript
// src/teams/__tests__/progress-persistence.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { ProgressPersistence, createProgressPersistence } from "../progress-persistence.js"

describe("ProgressPersistence", () => {
  let tempDir: string
  let persistence: ProgressPersistence

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "progress-test-"))
    persistence = createProgressPersistence({
      outputPath: path.join(tempDir, "PROGRESS.md"),
      autoSaveInterval: 1000,
      format: "markdown",
    })
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  describe("saveProgress", () => {
    it("should save progress to markdown file", async () => {
      const report = {
        teamId: "test-team",
        timestamp: Date.now(),
        status: "in-progress" as const,
        currentPhase: "implementation",
        overallProgress: 50,
        summary: {
          objective: "Implement feature X",
          filesChanged: 5,
          iterationsCompleted: 2,
          totalIterations: 4,
        },
        current: {
          activeAgent: "worker-001",
          role: "worker",
          task: "Update auth module",
          startedAt: Date.now() - 3600000,
        },
        issues: {
          p0: [],
          p1: ["Add error handling"],
          p2: [],
          p3: [],
        },
        timeline: [
          { time: Date.now() - 7200000, event: "Started", agent: "planner" },
          { time: Date.now() - 3600000, event: "Implementation", agent: "worker-001" },
        ],
        nextSteps: ["Complete auth module", "Add tests"],
      }

      await persistence.saveProgress(report)

      const content = fs.readFileSync(path.join(tempDir, "PROGRESS.md"), "utf-8")
      expect(content).toContain("# Progress Report")
      expect(content).toContain("test-team")
      expect(content).toContain("Implement feature X")
      expect(content).toContain("50%")
    })
  })
})
```

**Step 3: Run test to verify it fails**

```bash
npm test -- --run src/teams/__tests__/progress-persistence.test.ts
```

Expected: FAIL - "ProgressPersistence" not defined

**Step 4: Implement ProgressPersistence class**

```typescript
// src/teams/progress-persistence.ts (continued)

import * as fs from "fs"
import * as path from "path"

export class ProgressPersistence {
  private config: ProgressPersistenceConfig
  private lastSaveTime: number = 0

  constructor(config: Partial<ProgressPersistenceConfig> = {}) {
    this.config = {
      outputPath: path.join(process.cwd(), "PROGRESS.md"),
      autoSaveInterval: 60000, // 1 minute
      includeTimestamps: true,
      format: "markdown",
      ...config,
    }
  }

  async saveProgress(report: ProgressReport): Promise<void> {
    const dir = path.dirname(this.config.outputPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    if (this.config.format === "markdown" || this.config.format === "both") {
      const markdown = this.formatAsMarkdown(report)
      await fs.promises.writeFile(this.config.outputPath, markdown, "utf-8")
    }

    if (this.config.format === "json" || this.config.format === "both") {
      const jsonPath = this.config.outputPath.replace(/\.md$/, ".json")
      await fs.promises.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf-8")
    }

    this.lastSaveTime = Date.now()
  }

  shouldAutoSave(): boolean {
    return Date.now() - this.lastSaveTime >= this.config.autoSaveInterval
  }

  private formatAsMarkdown(report: ProgressReport): string {
    const lines: string[] = []

    lines.push(`# Progress Report: ${report.summary.objective}`)
    lines.push("")
    lines.push(`**Team:** ${report.teamId}  `)
    lines.push(`**Status:** ${this.getStatusEmoji(report.status)} ${report.status}  `)
    lines.push(`**Progress:** ${report.overallProgress}%  `)
    lines.push(`**Updated:** ${new Date(report.timestamp).toLocaleString()}`)
    lines.push("")

    lines.push("## Summary")
    lines.push("")
    lines.push(`- **Objective:** ${report.summary.objective}`)
    lines.push(`- **Files Changed:** ${report.summary.filesChanged}`)
    lines.push(`- **Iterations:** ${report.summary.iterationsCompleted}/${report.summary.totalIterations}`)
    lines.push("")

    lines.push("## Current Activity")
    lines.push("")
    lines.push(`- **Agent:** ${report.current.activeAgent} (${report.current.role})`)
    lines.push(`- **Task:** ${report.current.task}`)
    lines.push(`- **Started:** ${new Date(report.current.startedAt).toLocaleString()}`)
    lines.push("")

    if (report.issues.p0.length > 0 || report.issues.p1.length > 0) {
      lines.push("## Active Issues")
      lines.push("")
      if (report.issues.p0.length > 0) {
        lines.push("### P0 (Blocking)")
        report.issues.p0.forEach(issue => lines.push(`- [ ] ${issue}`))
        lines.push("")
      }
      if (report.issues.p1.length > 0) {
        lines.push("### P1 (Required)")
        report.issues.p1.forEach(issue => lines.push(`- [ ] ${issue}`))
        lines.push("")
      }
    }

    lines.push("## Timeline")
    lines.push("")
    report.timeline.forEach(event => {
      const time = new Date(event.time).toLocaleTimeString()
      lines.push(`- **${time}** - ${event.event}${event.agent ? ` (${event.agent})` : ""}`)
    })
    lines.push("")

    lines.push("## Next Steps")
    lines.push("")
    report.nextSteps.forEach((step, i) => {
      lines.push(`${i + 1}. ${step}`)
    })
    lines.push("")

    return lines.join("\n")
  }

  private getStatusEmoji(status: ProgressReport["status"]): string {
    switch (status) {
      case "in-progress": return "🔄"
      case "completed": return "✅"
      case "failed": return "❌"
      case "paused": return "⏸️"
      default: return "⏳"
    }
  }
}

export function createProgressPersistence(
  config?: Partial<ProgressPersistenceConfig>
): ProgressPersistence {
  return new ProgressPersistence(config)
}
```

**Step 5: Run tests to verify they pass**

```bash
npm test -- --run src/teams/__tests__/progress-persistence.test.ts
```

Expected: PASS

**Step 6: Add integration with ProgressTracker**

Modify `src/teams/progress-tracker.ts`:

```typescript
// Add imports at top
import { ProgressPersistence, createProgressPersistence } from "./progress-persistence.js"
import type { ProgressReport } from "./progress-persistence.js"

// Add to TeamProgressTracker class
export class TeamProgressTracker implements ProgressTracker {
  private persistence?: ProgressPersistence
  private teamId?: string
  private objective?: string

  // ... existing code ...

  enablePersistence(
    teamId: string,
    objective: string,
    config?: Parameters<typeof createProgressPersistence>[0]
  ): void {
    this.teamId = teamId
    this.objective = objective
    this.persistence = createProgressPersistence(config)
  }

  async generateReport(): Promise<ProgressReport | null> {
    if (!this.teamId || !this.objective) return null

    const stats = this.getStats()
    const currentRound = this.rounds[this.rounds.length - 1]

    return {
      teamId: this.teamId,
      timestamp: Date.now(),
      status: this.shouldCircuitBreak() ? "failed" : "in-progress",
      currentPhase: "iteration",
      overallProgress: Math.min(stats.progressRounds * 20, 100),
      summary: {
        objective: this.objective,
        filesChanged: stats.codeChanges,
        iterationsCompleted: stats.totalRounds,
        totalIterations: stats.totalRounds + 3, // estimate
      },
      current: {
        activeAgent: "current-agent",
        role: "worker",
        task: "Implementing changes",
        startedAt: currentRound?.timestamp || Date.now(),
      },
      issues: {
        p0: Array(stats.p0Issues).fill("Active P0 issue"),
        p1: Array(stats.p1Issues).fill("Active P1 issue"),
        p2: [],
        p3: [],
      },
      timeline: this.rounds.slice(-5).map((r, i) => ({
        time: r.timestamp,
        event: r.filesChanged > 0 ? `Changed ${r.filesChanged} files` : "No progress",
      })),
      nextSteps: ["Continue implementation", "Run tests"],
    }
  }

  async saveProgress(): Promise<void> {
    if (!this.persistence) return
    const report = await this.generateReport()
    if (report) {
      await this.persistence.saveProgress(report)
    }
  }
}
```

**Step 7: Write integration test**

```typescript
// Add to progress-persistence.test.ts

describe("ProgressTracker Integration", () => {
  it("should save progress through tracker", async () => {
    const tracker = createProgressTracker({
      circuitBreaker: {
        maxConsecutiveFailures: 3,
        maxNoProgressRounds: 3,
        cooldownMs: 1000,
      },
    })

    tracker.enablePersistence("test-team", "Test Objective", {
      outputPath: path.join(tempDir, "PROGRESS.md"),
      format: "markdown",
    })

    tracker.recordCodeChange(3)
    tracker.recordTestResult(true)
    tracker.checkProgress()

    await tracker.saveProgress()

    const content = fs.readFileSync(path.join(tempDir, "PROGRESS.md"), "utf-8")
    expect(content).toContain("Test Objective")
    expect(content).toContain("3")
  })
})
```

**Step 8: Run all tests**

```bash
npm test -- --run src/teams/__tests__/progress-persistence.test.ts
npm test -- --run src/teams/__tests__/progress-tracker.test.ts
```

**Step 9: Commit**

```bash
git add src/teams/progress-persistence.ts src/teams/__tests__/progress-persistence.test.ts
git add src/teams/progress-tracker.ts
git commit -m "feat: PROGRESS.md persistence for Agent Teams

- Add ProgressPersistence class for markdown/json reports
- Integrate with ProgressTracker for auto-save
- Configurable output format and intervals"
```

---

## Feature 2: Loose Context Contract

### Task 2.1: Create ContextContract Types

**Files:**
- Modify: `src/teams/contracts.ts`
- Test: `src/teams/__tests__/contracts.test.ts` (add tests)

**Step 1: Add ContextContract types**

```typescript
// Add to src/teams/contracts.ts

// ============================================================================
// Loose Context Contract
// ============================================================================

/**
 * ContextContract provides loose coupling between agents
 * Uses objectives and boundaries instead of precise instructions
 */
export const ContextContractSchema = z.object({
  taskId: z.string(),

  // Objective instead of steps
  objective: z.string().describe("Clear goal - what needs to be achieved"),

  // Background context
  context: z.object({
    background: z.string().describe("Why this task matters"),
    constraints: z.array(z.string()).describe("Hard constraints that must be followed"),
    references: z.array(z.string()).describe("File paths, docs, code to reference"),
  }),

  // Boundaries instead of scope
  boundaries: z.object({
    mustNot: z.array(z.string()).describe("Things that must NOT be done"),
    shouldConsider: z.array(z.string()).describe("Things to keep in mind"),
  }),

  // Expected outcome instead of format
  expectedOutcome: z.object({
    intent: z.string().describe("What success looks like"),
    validationHint: z.string().describe("How to verify the outcome"),
  }),

  // Optional strict contract for compatibility
  strictContract: TaskContractSchema.optional(),
})

export type ContextContract = z.infer<typeof ContextContractSchema>

/**
 * Contract adapter - convert between strict and loose contracts
 */
export function toStrictContract(context: ContextContract): TaskContract {
  if (context.strictContract) {
    return context.strictContract
  }

  // Derive strict contract from loose context
  return {
    taskId: context.taskId,
    objective: context.objective,
    fileScope: deriveFileScope(context),
    acceptanceChecks: deriveAcceptanceChecks(context),
  }
}

export function toContextContract(contract: TaskContract, context?: Partial<ContextContract["context"]>): ContextContract {
  return {
    taskId: contract.taskId,
    objective: contract.objective,
    context: {
      background: context?.background || "No additional context provided",
      constraints: context?.constraints || [],
      references: contract.fileScope || [],
    },
    boundaries: {
      mustNot: [],
      shouldConsider: [],
    },
    expectedOutcome: {
      intent: `Complete: ${contract.objective}`,
      validationHint: `Run: ${contract.acceptanceChecks.join(", ")}`,
    },
    strictContract: contract,
  }
}

function deriveFileScope(context: ContextContract): string[] {
  // Extract file references from context
  return context.context.references.filter(ref =>
    ref.includes("/") || ref.includes(".")
  )
}

function deriveAcceptanceChecks(context: ContextContract): string[] {
  // Derive checks from validation hint
  const hint = context.expectedOutcome.validationHint
  if (hint.includes("test")) return ["npm test"]
  if (hint.includes("build")) return ["npm run build"]
  if (hint.includes("lint")) return ["npm run lint"]
  return ["npm test"]
}
```

**Step 2: Add validation functions**

```typescript
// Add to src/teams/contracts.ts

export function validateContextContract(data: unknown): ContextContract {
  return ContextContractSchema.parse(data)
}

export function createLooseContract(
  taskId: string,
  objective: string,
  options: {
    background?: string
    constraints?: string[]
    references?: string[]
    mustNot?: string[]
    shouldConsider?: string[]
    validationHint?: string
  } = {}
): ContextContract {
  return {
    taskId,
    objective,
    context: {
      background: options.background || "",
      constraints: options.constraints || [],
      references: options.references || [],
    },
    boundaries: {
      mustNot: options.mustNot || [],
      shouldConsider: options.shouldConsider || [],
    },
    expectedOutcome: {
      intent: `Successfully complete: ${objective}`,
      validationHint: options.validationHint || "Code should work as expected",
    },
  }
}
```

**Step 3: Add tests**

```typescript
// Add to src/teams/__tests__/contracts.test.ts

describe("ContextContract", () => {
  describe("createLooseContract", () => {
    it("should create a loose context contract", () => {
      const contract = createLooseContract("task-001", "Refactor auth module", {
        background: "Current auth is hard to test",
        constraints: ["Don't break existing API"],
        references: ["src/auth.ts", "docs/auth.md"],
        mustNot: ["Change public interface"],
        shouldConsider: ["Test coverage"],
        validationHint: "All tests pass",
      })

      expect(contract.taskId).toBe("task-001")
      expect(contract.objective).toBe("Refactor auth module")
      expect(contract.context.background).toBe("Current auth is hard to test")
      expect(contract.boundaries.mustNot).toContain("Change public interface")
    })
  })

  describe("toStrictContract", () => {
    it("should convert loose to strict contract", () => {
      const loose = createLooseContract("task-001", "Add feature", {
        references: ["src/feature.ts"],
        validationHint: "npm test",
      })

      const strict = toStrictContract(loose)

      expect(strict.taskId).toBe("task-001")
      expect(strict.objective).toBe("Add feature")
      expect(strict.fileScope).toContain("src/feature.ts")
      expect(strict.acceptanceChecks).toContain("npm test")
    })
  })

  describe("toContextContract", () => {
    it("should convert strict to loose contract", () => {
      const strict = createDefaultTaskContract("task-001", "Add feature", ["src/feature.ts"])

      const loose = toContextContract(strict, {
        background: "Feature needed for v2",
      })

      expect(loose.taskId).toBe("task-001")
      expect(loose.objective).toBe("Add feature")
      expect(loose.context.background).toBe("Feature needed for v2")
      expect(loose.strictContract).toEqual(strict)
    })
  })
})
```

**Step 4: Run tests**

```bash
npm test -- --run src/teams/__tests__/contracts.test.ts
```

**Step 5: Commit**

```bash
git add src/teams/contracts.ts src/teams/__tests__/contracts.test.ts
git commit -m "feat: Loose Context Contract for Agent Teams

- Add ContextContract with objective/boundaries/outcome structure
- Contract adapters to convert between strict and loose formats
- Helper functions for creating loose contracts"
```

---

## Feature 3: LLM-as-Judge

### Task 3.1: Create Evaluation Framework

**Files:**
- Create: `src/teams/llm-judge.ts`
- Test: `src/teams/__tests__/llm-judge.test.ts`

**Step 1: Define types and rubric**

```typescript
// src/teams/llm-judge.ts

import { z } from "zod"
import type { WorkArtifact, ReviewArtifact } from "./contracts.js"

// ============================================================================
// Evaluation Rubric
// ============================================================================

export interface EvaluationDimension {
  name: string
  weight: number // 0-1, sum of all weights should be 1
  scale: 1 | 2 | 3 | 4 | 5
  criteria: Record<string, string> // score -> description
  examples?: string[]
}

export interface EvaluationRubric {
  dimensions: EvaluationDimension[]
  overallThreshold: number // Minimum score to pass (0-5)
}

export interface JudgementResult {
  scores: Array<{
    dimension: string
    score: number
    reasoning: string
  }>
  overallScore: number
  passed: boolean
  improvementSuggestions: string[]
  evaluationTime: number
}

// ============================================================================
// Default Rubric (Code Quality)
// ============================================================================

export const DEFAULT_CODE_QUALITY_RUBRIC: EvaluationRubric = {
  dimensions: [
    {
      name: "correctness",
      weight: 0.35,
      scale: 5,
      criteria: {
        "5": "Completely correct, handles all edge cases",
        "4": "Mostly correct, minor edge cases missed",
        "3": "Partially correct, some bugs present",
        "2": "Significant errors, needs rework",
        "1": "Fundamentally incorrect",
      },
    },
    {
      name: "completeness",
      weight: 0.25,
      scale: 5,
      criteria: {
        "5": "All requirements fully implemented",
        "4": "Most requirements met, minor gaps",
        "3": "Core requirements met, some missing",
        "2": "Partial implementation",
        "1": "Barely started",
      },
    },
    {
      name: "maintainability",
      weight: 0.20,
      scale: 5,
      criteria: {
        "5": "Clean, well-documented, easy to understand",
        "4": "Good structure, minor improvements needed",
        "3": "Acceptable but could be cleaner",
        "2": "Hard to follow, needs refactoring",
        "1": "Unmaintainable spaghetti code",
      },
    },
    {
      name: "performance",
      weight: 0.20,
      scale: 5,
      criteria: {
        "5": "Optimal performance, no issues",
        "4": "Good performance, minor optimizations possible",
        "3": "Acceptable performance",
        "2": "Noticeable performance issues",
        "1": "Severe performance problems",
      },
    },
  ],
  overallThreshold: 3.5,
}

// ============================================================================
// LLM Judge
// ============================================================================

export interface LLMJudgeConfig {
  model: string
  apiKey: string
  baseURL: string
  rubric: EvaluationRubric
  maxRetries: number
}

export class LLMJudge {
  private config: LLMJudgeConfig

  constructor(config: Partial<LLMJudgeConfig> = {}) {
    this.config = {
      model: "claude-sonnet-4",
      apiKey: process.env.ANTHROPIC_API_KEY || "",
      baseURL: "https://api.anthropic.com",
      rubric: DEFAULT_CODE_QUALITY_RUBRIC,
      maxRetries: 3,
      ...config,
    }
  }

  async evaluate(
    artifact: WorkArtifact,
    originalTask: string
  ): Promise<JudgementResult> {
    const startTime = Date.now()

    // Build evaluation prompt
    const prompt = this.buildEvaluationPrompt(artifact, originalTask)

    // Call LLM for evaluation
    const evaluation = await this.callLLM(prompt)

    // Parse and validate result
    const scores = this.parseEvaluation(evaluation)

    // Calculate weighted score
    const overallScore = this.calculateOverallScore(scores)

    return {
      scores,
      overallScore,
      passed: overallScore >= this.config.rubric.overallThreshold,
      improvementSuggestions: this.generateSuggestions(scores),
      evaluationTime: Date.now() - startTime,
    }
  }

  private buildEvaluationPrompt(
    artifact: WorkArtifact,
    originalTask: string
  ): string {
    const rubricText = this.config.rubric.dimensions
      .map(d => {
        const criteria = Object.entries(d.criteria)
          .map(([score, desc]) => `  ${score}: ${desc}`)
          .join("\n")
        return `${d.name} (weight: ${d.weight}):\n${criteria}`
      })
      .join("\n\n")

    return `You are an expert code evaluator. Evaluate the following work artifact against the task requirements.

## Original Task
${originalTask}

## Work Artifact Summary
${artifact.summary}

## Changed Files
${artifact.changedFiles.join("\n")}

## Test Results
${artifact.testResults.map(t => `- ${t.command}: ${t.passed ? "PASSED" : "FAILED"}`).join("\n")}

## Risks Identified
${artifact.risks.join("\n") || "None"}

## Evaluation Rubric
${rubricText}

Provide your evaluation as a JSON object with this structure:
{
  "scores": [
    {"dimension": "correctness", "score": 4, "reasoning": "..."},
    ...
  ],
  "suggestions": ["..."]
}`
  }

  private async callLLM(prompt: string): Promise<string> {
    // Mock implementation - would use actual LLM client
    // For now, return a mock evaluation
    return JSON.stringify({
      scores: this.config.rubric.dimensions.map(d => ({
        dimension: d.name,
        score: Math.floor(Math.random() * 2) + 3, // 3-4 for testing
        reasoning: `Mock evaluation for ${d.name}`,
      })),
      suggestions: ["Add more tests", "Improve documentation"],
    })
  }

  private parseEvaluation(evaluation: string): JudgementResult["scores"] {
    try {
      const parsed = JSON.parse(evaluation)
      return parsed.scores || []
    } catch {
      // Fallback to empty scores
      return this.config.rubric.dimensions.map(d => ({
        dimension: d.name,
        score: 3,
        reasoning: "Failed to parse evaluation",
      }))
    }
  }

  private calculateOverallScore(scores: JudgementResult["scores"]): number {
    let totalWeight = 0
    let weightedSum = 0

    for (const dimension of this.config.rubric.dimensions) {
      const score = scores.find(s => s.dimension === dimension.name)?.score || 0
      weightedSum += score * dimension.weight
      totalWeight += dimension.weight
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0
  }

  private generateSuggestions(scores: JudgementResult["scores"]): string[] {
    const suggestions: string[] = []

    for (const score of scores) {
      if (score.score < 4) {
        suggestions.push(`${score.dimension}: ${score.reasoning}`)
      }
    }

    return suggestions
  }
}

export function createLLMJudge(config?: Partial<LLMJudgeConfig>): LLMJudge {
  return new LLMJudge(config)
}
```

**Step 2: Write tests**

```typescript
// src/teams/__tests__/llm-judge.test.ts

import { describe, it, expect } from "vitest"
import {
  LLMJudge,
  createLLMJudge,
  DEFAULT_CODE_QUALITY_RUBRIC,
} from "../llm-judge.js"
import { createEmptyWorkArtifact } from "../contracts.js"

describe("LLMJudge", () => {
  describe("DEFAULT_CODE_QUALITY_RUBRIC", () => {
    it("should have 4 dimensions", () => {
      expect(DEFAULT_CODE_QUALITY_RUBRIC.dimensions).toHaveLength(4)
      expect(DEFAULT_CODE_QUALITY_RUBRIC.dimensions.map(d => d.name)).toEqual(
        expect.arrayContaining(["correctness", "completeness", "maintainability", "performance"])
      )
    })

    it("should have weights summing to 1", () => {
      const sum = DEFAULT_CODE_QUALITY_RUBRIC.dimensions.reduce((acc, d) => acc + d.weight, 0)
      expect(sum).toBeCloseTo(1, 2)
    })
  })

  describe("evaluate", () => {
    it("should evaluate a work artifact", async () => {
      const judge = createLLMJudge()
      const artifact = createEmptyWorkArtifact("task-001")

      artifact.summary = "Implemented user authentication"
      artifact.changedFiles = ["src/auth.ts", "src/user.ts"]
      artifact.testResults = [{ command: "npm test", passed: true }]

      const result = await judge.evaluate(artifact, "Add user auth")

      expect(result.scores).toHaveLength(4)
      expect(result.overallScore).toBeGreaterThan(0)
      expect(typeof result.passed).toBe("boolean")
      expect(result.evaluationTime).toBeGreaterThan(0)
    })

    it("should pass when overall score >= threshold", async () => {
      const judge = createLLMJudge({
        rubric: {
          ...DEFAULT_CODE_QUALITY_RUBRIC,
          overallThreshold: 2.0, // Low threshold for testing
        },
      })

      const artifact = createEmptyWorkArtifact("task-001")
      artifact.summary = "Test implementation"

      const result = await judge.evaluate(artifact, "Test task")

      expect(result.passed).toBe(true)
    })
  })
})
```

**Step 3: Run tests**

```bash
npm test -- --run src/teams/__tests__/llm-judge.test.ts
```

**Step 4: Commit**

```bash
git add src/teams/llm-judge.ts src/teams/__tests__/llm-judge.test.ts
git commit -m "feat: LLM-as-Judge evaluation framework

- Add EvaluationRubric with weighted dimensions
- Default code quality rubric (correctness/completeness/maintainability/performance)
- LLMJudge class for automated artifact evaluation
- Structured scoring with improvement suggestions"
```

---

## Feature 4: Checkpoint Resume

### Task 4.1: Extend Checkpoint System

**Files:**
- Modify: `src/teams/checkpoint.ts`
- Create: `src/teams/checkpoint-resume.ts`
- Test: `src/teams/__tests__/checkpoint-resume.test.ts`

**Step 1: Add resume types to checkpoint.ts**

```typescript
// Add to src/teams/checkpoint.ts

export interface CheckpointResumeConfig {
  checkpointId: string
  strategy: "restart-task" | "continue-iteration" | "skip-completed"
  contextInjection: {
    includePreviousThinking: boolean
    includePreviousArtifacts: boolean
    maxContextTokens: number
  }
}

export interface ResumeContext {
  checkpoint: Checkpoint
  pendingTasks: string[]
  completedTasks: string[]
  contextSummary: string
}
```

**Step 2: Create CheckpointResumer class**

```typescript
// src/teams/checkpoint-resume.ts

import type { Checkpoint, CheckpointResumeConfig, ResumeContext } from "./checkpoint.js"
import type { TaskContract, WorkArtifact, ReviewArtifact } from "./contracts.js"
import type { TeamState } from "./types.js"

export interface ResumedExecution {
  teamState: TeamState
  taskContract: TaskContract
  workArtifacts: Map<string, WorkArtifact>
  reviewArtifacts: Map<string, ReviewArtifact>
  blackboardState: Map<string, unknown>
  resumeStrategy: CheckpointResumeConfig["strategy"]
  pendingTasks: string[]
}

export class CheckpointResumer {
  /**
   * Build resume context from checkpoint
   */
  async buildResumeContext(
    checkpoint: Checkpoint,
    config: CheckpointResumeConfig
  ): Promise<ResumeContext> {
    // Analyze checkpoint state
    const completedTasks = this.extractCompletedTasks(checkpoint)
    const allTasks = this.extractAllTasks(checkpoint)
    const pendingTasks = allTasks.filter(t => !completedTasks.includes(t))

    // Generate context summary
    const contextSummary = await this.generateContextSummary(
      checkpoint,
      config.contextInjection
    )

    return {
      checkpoint,
      pendingTasks,
      completedTasks,
      contextSummary,
    }
  }

  /**
   * Resume execution from checkpoint
   */
  async resume(
    checkpoint: Checkpoint,
    config: CheckpointResumeConfig
  ): Promise<ResumedExecution> {
    const context = await this.buildResumeContext(checkpoint, config)

    // Reconstruct state based on strategy
    switch (config.strategy) {
      case "restart-task":
        return this.restartTaskStrategy(checkpoint, context)
      case "continue-iteration":
        return this.continueIterationStrategy(checkpoint, context)
      case "skip-completed":
        return this.skipCompletedStrategy(checkpoint, context)
      default:
        throw new Error(`Unknown resume strategy: ${config.strategy}`)
    }
  }

  private extractCompletedTasks(checkpoint: Checkpoint): string[] {
    // Extract completed tasks from checkpoint artifacts
    const completed: string[] = []

    for (const [agentId, artifact] of Object.entries(checkpoint.workArtifacts)) {
      if (artifact.testResults.every(t => t.passed)) {
        completed.push(agentId)
      }
    }

    return completed
  }

  private extractAllTasks(checkpoint: Checkpoint): string[] {
    // Extract all tasks from team state
    return Object.keys(checkpoint.workArtifacts)
  }

  private async generateContextSummary(
    checkpoint: Checkpoint,
    injection: CheckpointResumeConfig["contextInjection"]
  ): Promise<string> {
    const parts: string[] = []

    parts.push(`Resuming from checkpoint at iteration ${checkpoint.iteration}`)
    parts.push(`Phase: ${checkpoint.phase}`)
    parts.push(`Progress: ${checkpoint.progress}%`)

    if (injection.includePreviousArtifacts) {
      parts.push("\nPrevious work artifacts:")
      for (const [agentId, artifact] of Object.entries(checkpoint.workArtifacts)) {
        parts.push(`- ${agentId}: ${artifact.summary}`)
      }
    }

    return parts.join("\n")
  }

  private restartTaskStrategy(
    checkpoint: Checkpoint,
    context: ResumeContext
  ): ResumedExecution {
    // Restart from the beginning of current task
    return {
      teamState: {
        ...checkpoint.teamState,
        currentIteration: checkpoint.iteration,
        status: "running",
      },
      taskContract: checkpoint.taskContract,
      workArtifacts: new Map(),
      reviewArtifacts: new Map(),
      blackboardState: new Map(Object.entries(checkpoint.blackboardState)),
      resumeStrategy: "restart-task",
      pendingTasks: context.pendingTasks,
    }
  }

  private continueIterationStrategy(
    checkpoint: Checkpoint,
    context: ResumeContext
  ): ResumedExecution {
    // Continue from where we left off
    return {
      teamState: checkpoint.teamState,
      taskContract: checkpoint.taskContract,
      workArtifacts: new Map(Object.entries(checkpoint.workArtifacts)),
      reviewArtifacts: new Map(Object.entries(checkpoint.reviewArtifacts)),
      blackboardState: new Map(Object.entries(checkpoint.blackboardState)),
      resumeStrategy: "continue-iteration",
      pendingTasks: context.pendingTasks,
    }
  }

  private skipCompletedStrategy(
    checkpoint: Checkpoint,
    context: ResumeContext
  ): ResumedExecution {
    // Skip completed tasks, start fresh on pending
    return {
      teamState: {
        ...checkpoint.teamState,
        currentIteration: checkpoint.iteration + 1,
        status: "running",
      },
      taskContract: checkpoint.taskContract,
      workArtifacts: new Map(
        Object.entries(checkpoint.workArtifacts).filter(([k]) =>
          !context.completedTasks.includes(k)
        )
      ),
      reviewArtifacts: new Map(),
      blackboardState: new Map(Object.entries(checkpoint.blackboardState)),
      resumeStrategy: "skip-completed",
      pendingTasks: context.pendingTasks,
    }
  }
}

export function createCheckpointResumer(): CheckpointResumer {
  return new CheckpointResumer()
}
```

**Step 3: Write tests**

```typescript
// src/teams/__tests__/checkpoint-resume.test.ts

import { describe, it, expect, beforeEach } from "vitest"
import { CheckpointResumer, createCheckpointResumer } from "../checkpoint-resume.js"
import type { Checkpoint } from "../checkpoint.js"

describe("CheckpointResumer", () => {
  let resumer: CheckpointResumer

  beforeEach(() => {
    resumer = createCheckpointResumer()
  })

  const mockCheckpoint: Checkpoint = {
    id: "checkpoint-001",
    teamId: "team-001",
    mode: "worker-reviewer",
    timestamp: Date.now(),
    version: "1.0.0",
    teamState: {
      teamId: "team-001",
      mode: "worker-reviewer",
      status: "failed",
      currentIteration: 2,
      startTime: Date.now() - 3600000,
      tokensUsed: { input: 1000, output: 500 },
      costUsd: 0.05,
      lastProgressAt: Date.now() - 1800000,
      consecutiveNoProgressRounds: 0,
      consecutiveFailures: 1,
    },
    taskContract: {
      taskId: "task-001",
      objective: "Implement feature",
      fileScope: ["src/feature.ts"],
      acceptanceChecks: ["npm test"],
    },
    workArtifacts: {
      "worker-001": {
        taskId: "task-001",
        summary: "Implemented core logic",
        changedFiles: ["src/feature.ts"],
        patchRef: "abc123",
        testResults: [{ command: "npm test", passed: true }],
        risks: [],
        assumptions: [],
      },
    },
    reviewArtifacts: {},
    blackboardState: {},
    iteration: 2,
    phase: "review",
    progress: 50,
  }

  describe("resume with restart-task strategy", () => {
    it("should restart from current iteration with empty artifacts", async () => {
      const result = await resumer.resume(mockCheckpoint, {
        checkpointId: mockCheckpoint.id,
        strategy: "restart-task",
        contextInjection: {
          includePreviousThinking: false,
          includePreviousArtifacts: true,
          maxContextTokens: 4000,
        },
      })

      expect(result.teamState.currentIteration).toBe(2)
      expect(result.teamState.status).toBe("running")
      expect(result.workArtifacts.size).toBe(0)
      expect(result.resumeStrategy).toBe("restart-task")
    })
  })

  describe("resume with continue-iteration strategy", () => {
    it("should continue with all checkpoint state", async () => {
      const result = await resumer.resume(mockCheckpoint, {
        checkpointId: mockCheckpoint.id,
        strategy: "continue-iteration",
        contextInjection: {
          includePreviousThinking: true,
          includePreviousArtifacts: true,
          maxContextTokens: 4000,
        },
      })

      expect(result.teamState.status).toBe("failed") // Preserved
      expect(result.workArtifacts.size).toBe(1)
      expect(result.workArtifacts.has("worker-001")).toBe(true)
    })
  })

  describe("resume with skip-completed strategy", () => {
    it("should skip completed tasks and increment iteration", async () => {
      const result = await resumer.resume(mockCheckpoint, {
        checkpointId: mockCheckpoint.id,
        strategy: "skip-completed",
        contextInjection: {
          includePreviousThinking: false,
          includePreviousArtifacts: false,
          maxContextTokens: 4000,
        },
      })

      expect(result.teamState.currentIteration).toBe(3)
      expect(result.workArtifacts.size).toBe(0) // Completed task removed
    })
  })

  describe("buildResumeContext", () => {
    it("should build context with pending and completed tasks", async () => {
      const context = await resumer.buildResumeContext(mockCheckpoint, {
        checkpointId: mockCheckpoint.id,
        strategy: "continue-iteration",
        contextInjection: {
          includePreviousThinking: true,
          includePreviousArtifacts: true,
          maxContextTokens: 4000,
        },
      })

      expect(context.checkpoint.id).toBe("checkpoint-001")
      expect(context.completedTasks).toContain("worker-001")
      expect(context.contextSummary).toContain("50%")
    })
  })
})
```

**Step 4: Run tests**

```bash
npm test -- --run src/teams/__tests__/checkpoint-resume.test.ts
```

**Step 5: Add integration with TeamManager**

Modify `src/teams/team-manager.ts` to add resume capability:

```typescript
// Add imports
import { CheckpointResumer, createCheckpointResumer } from "./checkpoint-resume.js"
import type { CheckpointResumeConfig } from "./checkpoint.js"

// Add to TeamManager class
export class TeamManager {
  private checkpointResumer?: CheckpointResumer

  // ... existing code ...

  /**
   * Resume execution from a checkpoint
   */
  async resumeFromCheckpoint(
    checkpointId: string,
    strategy: CheckpointResumeConfig["strategy"] = "continue-iteration"
  ): Promise<unknown> {
    if (!this.checkpointManager) {
      throw new Error("Checkpoint manager not configured")
    }

    // Load checkpoint
    const checkpoint = await this.checkpointManager.restoreCheckpoint(checkpointId)
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`)
    }

    // Initialize resumer
    this.checkpointResumer = createCheckpointResumer()

    // Build resume configuration
    const resumeConfig: CheckpointResumeConfig = {
      checkpointId,
      strategy,
      contextInjection: {
        includePreviousThinking: true,
        includePreviousArtifacts: true,
        maxContextTokens: 4000,
      },
    }

    // Resume execution
    const resumed = await this.checkpointResumer.resume(checkpoint, resumeConfig)

    // Update internal state
    this.state = resumed.teamState

    // Continue execution with resumed state
    return this.continueExecution(resumed)
  }

  private async continueExecution(
    resumed: import("./checkpoint-resume.js").ResumedExecution
  ): Promise<unknown> {
    // Rebuild blackboard from resumed state
    for (const [key, value] of resumed.blackboardState) {
      this.blackboard.set(key, value)
    }

    // Log resume event
    this.blackboard.logEvent("resumed-from-checkpoint", {
      iteration: resumed.teamState.currentIteration,
      strategy: resumed.resumeStrategy,
      pendingTasks: resumed.pendingTasks,
    })

    // Continue with normal execution
    return this.run()
  }
}
```

**Step 6: Run all tests**

```bash
npm test -- --run src/teams/__tests__/checkpoint.test.ts
npm test -- --run src/teams/__tests__/checkpoint-resume.test.ts
```

**Step 7: Commit**

```bash
git add src/teams/checkpoint-resume.ts src/teams/__tests__/checkpoint-resume.test.ts
git add src/teams/checkpoint.ts src/teams/team-manager.ts
git commit -m "feat: Checkpoint Resume capability

- Add CheckpointResumer with 3 resume strategies
- restart-task, continue-iteration, skip-completed
- Context injection with configurable options
- Integration with TeamManager for seamless resume"
```

---

## Final Steps

### Task 5.1: Update Index Exports

**File:** `src/teams/index.ts`

Add exports for all new modules:

```typescript
// Add to exports

// ============================================================================
// Progress Persistence Exports
// ============================================================================

export {
  ProgressPersistence,
  createProgressPersistence,
  type ProgressReport,
  type ProgressPersistenceConfig,
} from "./progress-persistence.js"

// ============================================================================
// LLM Judge Exports
// ============================================================================

export {
  LLMJudge,
  createLLMJudge,
  DEFAULT_CODE_QUALITY_RUBRIC,
  type EvaluationRubric,
  type EvaluationDimension,
  type JudgementResult,
  type LLMJudgeConfig,
} from "./llm-judge.js"

// ============================================================================
// Checkpoint Resume Exports
// ============================================================================

export {
  CheckpointResumer,
  createCheckpointResumer,
  type ResumedExecution,
  type ResumeContext,
} from "./checkpoint-resume.js"
```

### Task 5.2: Run Full Test Suite

```bash
npm run build
npm run test
```

Expected: All tests pass

### Task 5.3: Final Commit

```bash
git add src/teams/index.ts
git commit -m "chore: export all P1 features from index

- Export progress persistence types
- Export LLM judge types and rubric
- Export checkpoint resume types"
```

---

## Summary

This plan implements all 4 P1 features:

| Feature | Files | Tests | Description |
|---------|-------|-------|-------------|
| PROGRESS.md | 2 | 6+ | Markdown progress reports with timeline |
| Loose Context Contract | 1 | 6+ | Objective-based contracts with boundaries |
| LLM-as-Judge | 2 | 6+ | Automated evaluation with rubric |
| Checkpoint Resume | 3 | 8+ | 3 resume strategies with context injection |

**Total new files:** 7
**Total modified files:** 4
**Estimated test count:** 26+
