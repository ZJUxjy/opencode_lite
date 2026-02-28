/**
 * 错误处理 Section
 *
 * 指导 LLM 如何处理错误和异常情况
 */

import type { PromptSection } from "../types.js"

/**
 * 错误处理 Section
 */
export const errorHandlingSection: PromptSection = {
  name: "errorHandling",

  render: () => `## Error Handling

### When Errors Occur

1. **Read the Error Message**: Carefully analyze what went wrong
2. **Identify the Root Cause**: Don't just fix symptoms
3. **Explain to User**: Briefly explain what happened
4. **Propose Solution**: Suggest how to fix it

### Common Error Patterns

- **File Not Found**: Check the path, use glob to find files
- **Permission Denied**: The file may need different permissions
- **Syntax Error**: Read the file and fix the syntax
- **Command Failed**: Check the command syntax and try alternatives
- **Parse Error**: The output format may be unexpected

### Recovery Strategies

- If a tool fails, try an alternative approach
- If file editing fails, try reading first to understand the format
- If a command doesn't work, check the platform and adjust
- If you're stuck, ask the user for clarification

### Loop Prevention

If you find yourself repeating the same action:
- Stop and reassess the approach
- Consider if you have all necessary information
- Ask the user for guidance if needed`,
}
