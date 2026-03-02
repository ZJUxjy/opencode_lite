import { PromptProvider } from '../src/prompts/index.js'
import { getSkillRegistry } from '../src/skills/index.js'
import { ToolRegistry } from '../src/tools/index.js'

const promptProvider = new PromptProvider()
const skillRegistry = getSkillRegistry({
  searchPaths: ["./skills", "~/.lite-opencode/skills"],
  includeBuiltins: true,
  recursive: false,
})

const tools = new ToolRegistry()

const systemPrompt = promptProvider.getSystemPrompt({
  model: "claude-sonnet-4-20250514",
  cwd: "/home/user/project",
  platform: "linux",
  tools: tools.getDefinitions(),
  date: new Date(),
  skills: skillRegistry.getActivePromptInjection(),
})

console.log("=".repeat(80))
console.log("完整 System Prompt 示例")
console.log("=".repeat(80))
console.log(systemPrompt)
console.log("=".repeat(80))
console.log(`\n总字符数: ${systemPrompt.length}`)
console.log(`估算 Token 数: ~${Math.round(systemPrompt.length / 4)}`)
