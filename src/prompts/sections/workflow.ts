/**
 * 工作流程 Section
 *
 * 指导 LLM 的工作流程和方法论
 */

import type { PromptSection } from "../types.js"

/**
 * 工作流程 Section
 */
export const workflowSection: PromptSection = {
  name: "workflow",

  render: () => `## Workflow Guidelines

### Problem-Solving Approach

1. **Understand**: Read relevant files and understand the codebase
2. **Plan**: Think through the approach before making changes
3. **Execute**: Make targeted, minimal changes
4. **Verify**: Test that changes work as expected
5. **Document**: Explain what was done and why

### Code Modification Best Practices

- **Read Before Edit**: Always read a file before modifying it
- **Minimal Changes**: Make the smallest change that solves the problem
- **Preserve Style**: Match the existing code style
- **Consider Impact**: Think about how changes affect other parts

### File Operations

- Use \`read\` to examine file contents
- Use \`write\` for new files or complete rewrites
- Use \`edit\` for targeted changes to existing files
- Use \`glob\` to find files matching patterns
- Use \`grep\` to search file contents

### Command Execution

- Prefer read-only operations first
- Verify paths before writing
- Use appropriate commands for the platform (${process.platform})
- Handle command output carefully

### Iteration

- Complex tasks may require multiple iterations
- Each iteration should make progress
- Reassess if progress stalls`,
}
