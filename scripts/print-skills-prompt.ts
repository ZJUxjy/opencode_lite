import { PromptProvider } from '../src/prompts/index.js'
import { getSkillRegistry } from '../src/skills/index.js'
import { ToolRegistry } from '../src/tools/index.js'

// 1. 获取 SkillRegistry
const skillRegistry = getSkillRegistry({
  searchPaths: ["./skills", "~/.lite-opencode/skills"],
  includeBuiltins: true,
  recursive: false,
})

// 2. 查看可用的 skills
console.log("=".repeat(80))
console.log("可用的 Skills")
console.log("=".repeat(80))

const allSkills = skillRegistry.getAll()
console.log(`共 ${allSkills.length} 个 skills:\n`)

allSkills.forEach((skill, i) => {
  const status = skill.isActive ? "🟢 已激活" : "⚪ 未激活"
  console.log(`${i + 1}. ${skill.name} (${skill.id})`)
  console.log(`   状态: ${status}`)
  console.log(`   描述: ${skill.description}`)
  console.log(`   激活方式: ${skill.activation}`)
  console.log("")
})

// 3. 激活一个 skill
console.log("=".repeat(80))
console.log("激活 git skill")
console.log("=".repeat(80))

skillRegistry.activate("builtin:git")
const gitSkill = skillRegistry.get("builtin:git")
console.log(`\n激活后状态: ${gitSkill?.isActive ? "🟢 已激活" : "⚪ 未激活"}`)

// 4. 获取 skill 的 prompt injection
console.log("\n" + "=".repeat(80))
console.log("Skill Prompt Injection 内容")
console.log("=".repeat(80))

const skillPrompt = skillRegistry.getActivePromptInjection()
console.log(skillPrompt)

// 5. 组装完整的 system prompt
console.log("\n" + "=".repeat(80))
console.log("完整 System Prompt (包含 Skills)")
console.log("=".repeat(80))

const promptProvider = new PromptProvider()
const tools = new ToolRegistry()

const systemPrompt = promptProvider.getSystemPrompt({
  model: "claude-sonnet-4-20250514",
  cwd: "/home/user/project",
  platform: "linux",
  tools: tools.getDefinitions(),
  date: new Date(),
  skills: skillPrompt,
})

// 找到 skills section 在 prompt 中的位置
const skillsIndex = systemPrompt.indexOf("# Active Skills")
if (skillsIndex !== -1) {
  console.log("\nSkills Section 在 System Prompt 中的位置:")
  console.log("-".repeat(80))
  console.log(systemPrompt.substring(Math.max(0, skillsIndex - 100), skillsIndex + 1500))
}

console.log("\n" + "=".repeat(80))
console.log("统计")
console.log("=".repeat(80))
console.log(`激活的 Skills: ${skillRegistry.getActive().length}`)
console.log(`Skills Prompt 长度: ${skillPrompt.length} 字符 (~${Math.round(skillPrompt.length / 4)} tokens)`)
console.log(`完整 System Prompt 长度: ${systemPrompt.length} 字符 (~${Math.round(systemPrompt.length / 4)} tokens)`)
