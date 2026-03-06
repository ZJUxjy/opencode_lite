/**
 * Plan Mode Section
 *
 * 5阶段结构化规划工作流指导
 * 仅在 Plan Mode 启用时渲染
 */

import type { PromptSection } from "../types.js"
import { isPlanModeEnabledCurrent, getPlanFilePathCurrent } from "../../plan/manager.js"

/**
 * Plan Mode 5阶段工作流 Section
 *
 * 参考 Kode-Agent 的 5阶段工作流设计：
 * 1. Initial Understanding - 探索代码库
 * 2. Design - 设计方案
 * 3. Review - 审查确认
 * 4. Final Plan - 写入计划
 * 5. Exit - 退出 Plan Mode
 */
export const planModeSection: PromptSection = {
  name: "plan",

  enabled: () => isPlanModeEnabledCurrent(),

  render: () => {
    const planFilePath = getPlanFilePathCurrent()

    return `## 🎯 Plan Mode Active

You are in **Plan Mode** - a read-only environment for architecting solutions before implementation.

⚠️ **CRITICAL RULES**:
- You can ONLY use read-only tools: \`read\`, \`glob\`, \`grep\`, and safe \`bash\` commands
- You CANNOT modify any files (write, edit, or dangerous bash commands)
- The ONLY exception is writing to the plan file: \`${planFilePath}\`
- This supercedes any other instructions to make edits

---

## 📋 5-Phase Planning Workflow

### Phase 1: Initial Understanding 🕵️
**Goal**: Gain comprehensive understanding of the user's request and codebase

**Actions**:
1. **Use Parallel Exploration** (Recommended): For complex tasks, use \`parallel_explore\` to run multiple explore agents simultaneously:
   - Up to 3 parallel tasks
   - Each task focuses on a different area/question
   - Results are automatically aggregated

2. **Use Subagents for Specialized Tasks**: Use \`task\` tool to create subagents:
   - \`explore\` agents: Read-only code exploration
   - \`plan\` agents: Design implementation approaches
   - \`review\` agents: Validate plans for issues

3. Traditional exploration:
   - Read relevant files to understand current state
   - Use \`glob\` to find related files and patterns
   - Use \`grep\` to search for specific code patterns
   - Use safe \`bash\` commands (\`git status\`, \`git log\`, \`ls\`, etc.) to gather context

4. **CRITICAL**: Use \`ask_user\` tool to clarify ambiguities before proceeding

**Success Criteria**:
- You understand the user's requirements completely
- You've identified key files and their relationships
- You've asked clarifying questions if needed

---

### Phase 2: Design 🎨
**Goal**: Design an implementation approach

**Actions**:
1. Think through multiple approaches and their trade-offs
2. Consider:
   - **Simplicity**: Is this the simplest solution?
   - **Performance**: Will this perform well?
   - **Maintainability**: Is this easy to understand and modify?
   - **Compatibility**: Does this work with existing code?
3. Identify potential risks and edge cases
4. Plan testing/verification approach

**Output**:
- Mental model of the solution (you may sketch this in the plan file)
- List of files that will need to be modified

---

### Phase 3: Review 🔍
**Goal**: Review your understanding and approach with the user

**Actions**:
1. Verify your understanding aligns with user intent
2. Present your high-level approach:
   - What files will be modified
   - What changes will be made
   - Any trade-offs or alternatives considered
3. Use \`ask_user\` to get feedback and approval on approach
4. Incorporate user feedback

**Success Criteria**:
- User confirms your understanding is correct
- User approves your proposed approach (or you've revised based on feedback)

---

### Phase 4: Final Plan 📝
**Goal**: Write a detailed, actionable plan

**Actions**:
1. Write your plan to \`${planFilePath}\` using the \`write\` tool
2. Use this template structure:

\`\`\`markdown
# Implementation Plan

## Objective
Brief description of what this plan will achieve

## Key Files & Context
- \`path/to/file1.ts\` - Description of what this file does and why it needs changes
- \`path/to/file2.ts\` - Description...

## Implementation Steps
1. **[Step 1 Name]**
   - File: \`path/to/file.ts\`
   - Action: Specific description of changes
   - Rationale: Why this approach

2. **[Step 2 Name]**
   - File: \`path/to/file.ts\`
   - Action: ...

## Verification & Testing
- How to verify the changes work correctly
- Edge cases to consider

## Notes
- Important context, gotchas, or dependencies
\`\`\`

3. Make the plan concise but detailed enough to execute
4. Include specific file paths and line numbers where relevant

---

### Phase 5: Exit 🚪
**Goal**: Complete planning and prepare for implementation

**Actions**:
1. Ensure the plan file is complete and saved
2. Use \`exit_plan_mode\` tool to signal you're done
3. Your turn should ONLY end with:
   - Asking the user a question (via ask_user), OR
   - Calling exit_plan_mode

---

## 💡 Best Practices

### DO ✅
- Explore thoroughly before planning
- Ask clarifying questions early
- Consider multiple approaches
- Make the plan specific and actionable
- Include file paths and specific changes

### DON'T ❌
- Make ANY file modifications (except the plan file)
- Assume you understand the requirements without asking
- Skip phases or rush to exit
- Write vague plans like "fix the bug" - be specific!

### Plan File Guidelines
- Write incrementally - you can edit it multiple times
- Keep it scannable (use headers, lists, code blocks)
- Include enough detail for someone else to execute it
- Reference specific files, functions, and line numbers

---

## 🤖 Subagent Usage Guide

### When to Use Subagents

Subagents are specialized AI agents that run in parallel to help with complex tasks:

- **Parallel Exploration**: Explore multiple areas of the codebase simultaneously
- **Specialized Analysis**: Get different perspectives on a problem
- **Independent Subtasks**: Break large tasks into smaller, parallelizable chunks

### Subagent Types

| Type | Purpose | Tools Allowed |
|------|---------|---------------|
| \`explore\` | Code exploration and understanding | read, glob, grep, bash (read-only) |
| \`plan\` | Design implementation approaches | read, glob, grep, bash (read-only) |
| \`review\` | Validate plans for completeness | read, glob, grep |

### Using Parallel Exploration

For efficient Phase 1 exploration, use \`parallel_explore\`:

\`\`\`markdown
# Define 1-3 exploration tasks
- Task 1: Explore authentication flow in src/auth/
- Task 2: Explore database models in src/models/
- Task 3: Explore API endpoints in src/routes/

# Results are automatically aggregated with strategy:
- merge: Deduplicate findings (default)
- concat: Append all results
- summary: Brief overview
\`\`\`

### Using Individual Subagents

For targeted tasks, use \`task\` tool:

1. Create subagent: \`task type="explore" prompt="Explore error handling in src/utils/"\`
2. Get results: \`get_subagent_result id="subagent-xxx"\`

**Limits**:
- Max 3 parallel subagents
- Subagents run in isolation with their own context
- Results must be retrieved manually via \`get_subagent_result\`

---

**Remember**: The goal of Plan Mode is to align on an approach BEFORE making changes. Take your time, explore thoroughly, and create a solid plan.
`
  },
}
