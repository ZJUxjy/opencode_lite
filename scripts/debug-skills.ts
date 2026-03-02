import { SkillLoader } from '../src/skills/loader.js'
import { SkillRegistry, getSkillRegistry } from '../src/skills/index.js'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'

console.log("=".repeat(80))
console.log("Debug Skills Loading")
console.log("=".repeat(80))

// 直接使用 SkillLoader
const loader = new SkillLoader()
const absolutePath = path.resolve(process.cwd(), "./skills")

console.log(`\n从 ${absolutePath} 发现 skills...`)

const skills = await loader.discover({
  searchPaths: ["./skills"],
  recursive: false,
})

console.log(`\n发现了 ${skills.length} 个 skills:\n`)

skills.forEach((skill, i) => {
  const meta = skill.metadata
  console.log(`${i + 1}. ${meta.name} (${meta.id})`)
  console.log(`   描述: ${meta.description}`)
  console.log(`   激活方式: ${meta.activation}`)
  console.log(`   内容长度: ${skill.content.length} 字符`)
  console.log("")
})

// 显示 git skill 的完整内容
const gitSkill = skills.find(s => s.metadata.id === "builtin:git")
if (gitSkill) {
  console.log("=".repeat(80))
  console.log("Git Skill 完整内容")
  console.log("=".repeat(80))
  console.log(gitSkill.content)
}

// 激活 skill 并生成 prompt injection
console.log("\n" + "=".repeat(80))
console.log("激活 Skill 并生成 Prompt Injection")
console.log("=".repeat(80))

const registry = new SkillRegistry()
skills.forEach(s => registry.register(s))

// 激活 git 和 tdd skills
registry.activate("builtin:git")
const tddSkill = skills.find(s => s.metadata.id?.includes("tdd"))
if (tddSkill) {
  registry.activate(tddSkill.metadata.id!)
}

const activeSkills = registry.getActive()
console.log(`\n激活了 ${activeSkills.length} 个 skills:`)
activeSkills.forEach(s => console.log(`  - ${s.metadata.name}`))

// 获取 prompt injection
const promptInjection = registry.getActivePromptInjection()
console.log("\n" + "-".repeat(80))
console.log("Prompt Injection 内容:")
console.log("-".repeat(80))
console.log(promptInjection)
console.log("-".repeat(80))
console.log(`\nPrompt Injection 长度: ${promptInjection.length} 字符 (~${Math.round(promptInjection.length / 4)} tokens)`)
