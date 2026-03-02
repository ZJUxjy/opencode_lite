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

// 模拟一个完整的对话
const messages = [
  // 系统提示词
  { role: "system", content: systemPrompt },
  
  // 历史消息（模拟）
  { role: "user", content: "读取 package.json 文件" },
  { 
    role: "assistant", 
    content: null,
    toolCalls: [{
      id: "call_1",
      name: "read",
      arguments: { file_path: "/home/user/project/package.json" }
    }]
  },
  {
    role: "user",
    content: "",
    toolResults: [{
      toolCallId: "call_1",
      content: `{
  "name": "my-project",
  "version": "1.0.0",
  "description": "A sample project",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "test": "jest"
  }
}`
    }]
  },
  { 
    role: "assistant", 
    content: "package.json 文件内容如下：\n\n- **项目名称**: my-project\n- **版本**: 1.0.0\n- **描述**: A sample project\n- **入口文件**: index.js\n\n可用的 npm 脚本：\n- `npm start` - 启动项目\n- `npm test` - 运行测试"
  },
  
  // 当前用户输入
  { role: "user", content: "添加一个新的脚本 build，使用 esbuild 打包" },
]

console.log("=".repeat(80))
console.log("完整消息数组示例（发送给 LLM）")
console.log("=".repeat(80))

messages.forEach((msg, i) => {
  console.log(`\n${"─".repeat(80)}`)
  console.log(`[${i}] ${msg.role.toUpperCase()}`)
  console.log(`${"─".repeat(80)}`)
  
  if (msg.content) {
    console.log(msg.content.substring(0, 500) + (msg.content.length > 500 ? "...\n" : ""))
  }
  
  if ((msg as any).toolCalls) {
    console.log("Tool Calls:")
    ;(msg as any).toolCalls.forEach((tc: any) => {
      console.log(`  - ${tc.name}(${JSON.stringify(tc.arguments)})`)
    })
  }
  
  if ((msg as any).toolResults) {
    console.log("Tool Results:")
    ;(msg as any).toolResults.forEach((tr: any) => {
      console.log(`  - ${tr.content.substring(0, 200)}...`)
    })
  }
})

console.log("\n" + "=".repeat(80))
console.log("统计信息")
console.log("=".repeat(80))

const totalChars = messages.reduce((sum, m) => {
  let len = (m.content?.length || 0)
  if ((m as any).toolCalls) {
    len += JSON.stringify((m as any).toolCalls).length
  }
  if ((m as any).toolResults) {
    len += JSON.stringify((m as any).toolResults).length
  }
  return sum + len
}, 0)

console.log(`消息数量: ${messages.length}`)
console.log(`总字符数: ${totalChars}`)
console.log(`估算 Token 数: ~${Math.round(totalChars / 4)}`)
console.log(`\nSystem Prompt 长度: ${systemPrompt.length} 字符 (~${Math.round(systemPrompt.length / 4)} tokens)`)
