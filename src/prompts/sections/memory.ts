/**
 * 记忆/上下文管理 Section
 *
 * 帮助 LLM 理解如何管理上下文和记忆
 *
 * 参考: dify TokenBufferMemory
 */

import type { PromptSection } from "../types.js"

/**
 * 记忆管理 Section
 */
export const memorySection: PromptSection = {
  name: "memory",

  render: () => `## Context Management

### Important Context Information

- Previous conversation history is available to you
- Long conversations may be summarized to preserve key information
- File contents you've read are included in context
- Tool execution results are preserved

### Memory Best Practices

1. **Reference Previous Context**: When relevant, reference information from earlier in the conversation
2. **Avoid Redundancy**: Don't re-read files you've already seen unless they may have changed
3. **Track Progress**: Remember what steps you've completed in multi-step tasks
4. **Preserve Key Details**: Important decisions, file paths, and configurations should be remembered

### When Context is Summarized

If you see "[Context Summary]" in the conversation:
- Key information has been preserved
- Ask for clarification if you need specific details
- Previous tool results are summarized, not verbatim`,
}
