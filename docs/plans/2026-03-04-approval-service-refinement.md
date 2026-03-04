# Approval Service 精细化 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现三层风险等级（低/中/高）的精细化权限控制，支持可配置策略和自动批准低风险操作。

**Architecture:** 扩展现有的 PolicyEngine，添加 RiskLevel 分类和配置化规则系统。保持向后兼容的同时，增加 risk-based 决策流程。

**Tech Stack:** TypeScript, Ink (UI), Zod (配置验证)

---

## Overview

当前 `policy.ts` 已实现基础权限控制，但缺少：
1. 风险等级分类（所有操作都是"ask"或"allow"）
2. 用户可配置的规则
3. 自动批准低风险的批量操作

本计划将添加 RiskLevel 概念和配置系统。

---

## Task 1: Add Risk Level Types and Configuration

**Files:**
- Create: `src/policy/risk.ts`
- Modify: `src/policy.ts:1-50` (add imports)

**Step 1: Create risk level types**

```typescript
// src/policy/risk.ts
export type RiskLevel = "low" | "medium" | "high"

export interface RiskClassification {
  level: RiskLevel
  reason: string
}

export interface RiskConfig {
  autoApprove: RiskLevel[]
  promptApprove: RiskLevel[]
  deny: RiskLevel[]
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  autoApprove: ["low"],
  promptApprove: ["medium", "high"],
  deny: [],
}

export interface ToolRiskRule {
  tool: string
  level: RiskLevel
  conditions?: {
    argPattern?: RegExp
    pathPattern?: RegExp
  }
  description: string
}

// Tool to risk level mapping
export const DEFAULT_TOOL_RISK_RULES: ToolRiskRule[] = [
  // Low risk - read operations
  { tool: "read", level: "low", description: "Read file content" },
  { tool: "glob", level: "low", description: "List files matching pattern" },
  { tool: "grep", level: "low", description: "Search file contents" },
  { tool: "list_skills", level: "low", description: "List available skills" },
  { tool: "show_skill", level: "low", description: "Show skill details" },
  { tool: "get_active_skills_prompt", level: "low", description: "Get active skills prompt" },
  { tool: "web_search", level: "low", description: "Search web" },

  // Medium risk - write operations
  { tool: "write", level: "medium", description: "Write file" },
  { tool: "edit", level: "medium", description: "Edit file" },
  { tool: "activate_skill", level: "medium", description: "Activate skill" },
  { tool: "deactivate_skill", level: "medium", description: "Deactivate skill" },

  // High risk - system operations
  { tool: "bash", level: "high", description: "Execute shell command" },
  { tool: "task", level: "high", description: "Create subagent task" },
  { tool: "get_subagent_result", level: "low", description: "Get subagent result" },
  { tool: "parallel_explore", level: "high", description: "Parallel explore" },
  { tool: "enter_plan_mode", level: "medium", description: "Enter plan mode" },
  { tool: "exit_plan_mode", level: "medium", description: "Exit plan mode" },
  { tool: "mcp_*", level: "high", description: "MCP external tool" },
]

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
      const prefix = rule.tool.slice(0, -1)
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

export function shouldAutoApprove(
  risk: RiskClassification,
  config: RiskConfig
): boolean {
  return config.autoApprove.includes(risk.level)
}
```

**Step 2: Run tests to verify types compile**

Run: `npx tsc --noEmit src/policy/risk.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add src/policy/risk.ts
git commit -m "feat(policy): add risk level types and classification"
```

---

## Task 2: Extend PolicyEngine with Risk-Based Decisions

**Files:**
- Modify: `src/policy.ts:40-80` (PolicyConfig interface)
- Modify: `src/policy.ts:66-80` (constructor)
- Modify: `src/policy.ts:180-290` (check method)

**Step 1: Update PolicyConfig and imports**

```typescript
// src/policy.ts
import type { RiskConfig, RiskClassification } from "./policy/risk.js"
import {
  classifyToolRisk,
  shouldAutoApprove,
  DEFAULT_RISK_CONFIG,
  DEFAULT_TOOL_RISK_RULES
} from "./policy/risk.js"

export interface PolicyConfig {
  defaultDecision: PolicyDecision
  enableLearning: boolean
  learnedRulesPath?: string
  riskConfig?: RiskConfig  // NEW
  customRiskRules?: ToolRiskRule[]  // NEW
}

const DEFAULT_CONFIG: PolicyConfig = {
  defaultDecision: "ask",
  enableLearning: true,
  riskConfig: DEFAULT_RISK_CONFIG,
}
```

**Step 2: Update PolicyEngine class members**

```typescript
export class PolicyEngine {
  private config: PolicyConfig
  private rules: PolicyRule[] = []
  private learnedRules: Map<string, PolicyDecision> = new Map()
  private yoloMode: boolean = false
  private planMode: boolean = false
  private riskRules: ToolRiskRule[]  // NEW

  constructor(config: Partial<PolicyConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.riskRules = config.customRiskRules || DEFAULT_TOOL_RISK_RULES
    this.initializeDefaultRules()
  }
```

**Step 3: Add risk-based check logic in check() method**

After line 230 (after YOLO and Plan Mode checks), add:

```typescript
// 2.5. Risk-based decision (NEW)
if (!this.yoloMode && !this.planMode) {
  const riskClassification = classifyToolRisk(toolName, args, this.riskRules)
  const riskDecision = this.makeRiskBasedDecision(riskClassification, toolName)
  if (riskDecision) {
    return riskDecision
  }
}
```

Add new method:

```typescript
/**
 * Make decision based on risk classification
 */
private makeRiskBasedDecision(
  risk: RiskClassification,
  toolName: string
): PolicyResult | null {
  const riskConfig = this.config.riskConfig || DEFAULT_RISK_CONFIG

  // Check if this risk level should be auto-approved
  if (riskConfig.autoApprove.includes(risk.level)) {
    return {
      decision: "allow",
      reason: `Auto-approved: ${risk.reason} (${risk.level} risk)`,
    }
  }

  // Check if this risk level should be denied
  if (riskConfig.deny.includes(risk.level)) {
    return {
      decision: "deny",
      reason: `Denied: ${risk.reason} (${risk.level} risk)`,
    }
  }

  // Continue to normal rule checking for medium/high risk
  return null
}
```

**Step 4: Run tests**

Run: `npm test -- --run src/policy.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/policy.ts
git commit -m "feat(policy): integrate risk-based decision making"
```

---

## Task 3: Add Risk Level Display to PermissionPrompt

**Files:**
- Modify: `src/commands/types.ts:20-40` (PermissionRequest interface)
- Modify: `src/components/PermissionPrompt.tsx:30-50` (add risk display)

**Step 1: Update PermissionRequest type**

```typescript
// src/commands/types.ts
import type { RiskLevel, RiskClassification } from "../policy/risk.js"

export interface PermissionRequest {
  id: string
  toolName: string
  description?: string
  args: Record<string, unknown>
  risk?: RiskClassification  // NEW
}
```

**Step 2: Update PermissionPrompt to show risk level**

```typescript
// src/components/PermissionPrompt.tsx
import type { RiskLevel } from "../policy/risk.js"

// Risk level styling
const RISK_STYLES: Record<RiskLevel, { color: string; icon: string; label: string }> = {
  low: { color: "green", icon: "✓", label: "LOW RISK" },
  medium: { color: "yellow", icon: "!", label: "MEDIUM RISK" },
  high: { color: "red", icon: "⚠", label: "HIGH RISK" },
}

// In the component, add risk display:
// After the tool info box (around line 160), add:
{request.risk && (
  <Box marginTop={1}>
    <Text color={RISK_STYLES[request.risk.level].color}>
      {RISK_STYLES[request.risk.level].icon}{" "}
      {RISK_STYLES[request.risk.level].label}: {request.risk.reason}
    </Text>
  </Box>
)}

// If it's low risk, show a hint that it's auto-approved:
{request.risk?.level === "low" && (
  <Box marginTop={1}>
    <Text dimColor>
      This is a low-risk operation and has been auto-approved.
    </Text>
  </Box>
)}
```

**Step 3: Update App.tsx to pass risk info**

In `handlePolicyAsk` callback:

```typescript
const handlePolicyAsk = useCallback((toolCall: ToolCall, risk?: RiskClassification): Promise<PolicyDecision> => {
  return new Promise((resolve) => {
    permissionResolveRef.current = resolve
    setPermissionRequest({
      id: toolCall.id,
      toolName: toolCall.name,
      description: getToolDescription(toolCall),
      args: toolCall.arguments,
      risk,  // NEW: pass risk classification
    })
  })
}, [])
```

**Step 4: Commit**

```bash
git add src/commands/types.ts src/components/PermissionPrompt.tsx src/App.tsx
git commit -m "feat(ui): display risk level in permission prompt"
```

---

## Task 4: Load Risk Config from settings.json

**Files:**
- Modify: `src/mcp/config.ts` (or create `src/config/settings.ts`)
- Modify: `src/agent.ts:100-150` (Agent initialization)

**Step 1: Add risk config to settings schema**

```typescript
// src/config/types.ts (new file)
import { z } from "zod"

export const RiskLevelSchema = z.enum(["low", "medium", "high"])

export const RiskConfigSchema = z.object({
  autoApprove: z.array(RiskLevelSchema).default(["low"]),
  promptApprove: z.array(RiskLevelSchema).default(["medium", "high"]),
  deny: z.array(RiskLevelSchema).default([]),
})

export const SettingsSchema = z.object({
  env: z.record(z.string()).optional(),
  mcp: z.object({
    servers: z.record(z.any()),
  }).optional(),
  policy: z.object({
    risk: RiskConfigSchema.optional(),
    yoloMode: z.boolean().default(false),
  }).optional(),
})

export type Settings = z.infer<typeof SettingsSchema>
```

**Step 2: Update Agent to load risk config**

```typescript
// In src/agent.ts constructor
constructor(options: AgentOptions = {}) {
  // ... existing code ...

  // Load risk config from settings
  const riskConfig = options.settings?.policy?.risk
  if (riskConfig) {
    this.policyEngine = new PolicyEngine({
      riskConfig,
    })
  } else {
    this.policyEngine = new PolicyEngine()
  }
}
```

**Step 3: Commit**

```bash
git add src/config/types.ts src/agent.ts
git commit -m "feat(config): load risk config from settings.json"
```

---

## Task 5: Add Tests for Risk Classification

**Files:**
- Create: `src/policy/__tests__/risk.test.ts`

**Step 1: Write comprehensive tests**

```typescript
import { describe, it, expect } from "vitest"
import {
  classifyToolRisk,
  shouldAutoApprove,
  DEFAULT_TOOL_RISK_RULES,
  type RiskConfig
} from "../risk.js"

describe("Risk Classification", () => {
  describe("classifyToolRisk", () => {
    it("should classify read as low risk", () => {
      const result = classifyToolRisk("read", { path: "/test.txt" })
      expect(result.level).toBe("low")
    })

    it("should classify write as medium risk", () => {
      const result = classifyToolRisk("write", { path: "/test.txt", content: "hello" })
      expect(result.level).toBe("medium")
    })

    it("should classify bash as high risk", () => {
      const result = classifyToolRisk("bash", { command: "ls -la" })
      expect(result.level).toBe("high")
    })

    it("should handle mcp_* wildcard", () => {
      const result = classifyToolRisk("mcp_web_search", { query: "test" })
      expect(result.level).toBe("high")
    })

    it("should default to high risk for unknown tools", () => {
      const result = classifyToolRisk("unknown_tool", {})
      expect(result.level).toBe("high")
      expect(result.reason).toContain("Unknown tool")
    })
  })

  describe("shouldAutoApprove", () => {
    const config: RiskConfig = {
      autoApprove: ["low"],
      promptApprove: ["medium", "high"],
      deny: [],
    }

    it("should auto-approve low risk", () => {
      expect(shouldAutoApprove({ level: "low", reason: "" }, config)).toBe(true)
    })

    it("should not auto-approve medium risk", () => {
      expect(shouldAutoApprove({ level: "medium", reason: "" }, config)).toBe(false)
    })

    it("should not auto-approve high risk", () => {
      expect(shouldAutoApprove({ level: "high", reason: "" }, config)).toBe(false)
    })
  })
})
```

**Step 2: Run tests**

Run: `npm test -- --run src/policy/__tests__/risk.test.ts`
Expected: All tests pass

**Step 3: Commit**

```bash
git add src/policy/__tests__/risk.test.ts
git commit -m "test(policy): add risk classification tests"
```

---

## Task 6: Update Documentation

**Files:**
- Modify: `CLAUDE.md:200-250` (Policy section)

**Step 1: Add risk level documentation**

```markdown
### Risk-Based Approval

The policy engine supports three risk levels for tool operations:

| Risk Level | Tools | Behavior |
|------------|-------|----------|
| **Low** | read, glob, grep, list_skills, web_search | Auto-approved by default |
| **Medium** | write, edit, activate_skill, enter_plan_mode | Prompts for approval |
| **High** | bash, task, mcp_* | Prompts for approval |

Configure in `settings.json`:

```json
{
  "policy": {
    "risk": {
      "autoApprove": ["low"],
      "promptApprove": ["medium", "high"],
      "deny": []
    }
  }
}
```
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add risk-based approval documentation"
```

---

## Summary

This implementation adds:

1. **Risk Level System**: Low/Medium/High classification for all tools
2. **Configurable Rules**: Users can customize which risk levels are auto-approved
3. **UI Integration**: Risk level displayed in permission prompts
4. **Settings Integration**: Risk config loaded from settings.json
5. **Test Coverage**: Comprehensive unit tests

**Total estimated time**: 1-2 days
**Breaking changes**: None (fully backward compatible)
