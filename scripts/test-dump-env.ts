import { Agent } from '../src/agent.js'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'

// 设置环境变量
process.env.DUMP_PROMPT = '1'

async function test() {
  const sessionId = `test-dump-env-${Date.now()}`
  
  console.log('Testing with DUMP_PROMPT=1')
  console.log(`Session: ${sessionId}`)
  
  const agent = new Agent(sessionId, {
    cwd: process.cwd(),
    dbPath: path.join(os.homedir(), '.lite-opencode', 'history.db'),
  })
  
  // 直接检查 PromptDumper 状态
  const dumper = agent.getPromptDumper()
  
  console.log(`Dump enabled: ${dumper.isEnabled()}`)
  console.log(`Dump path: ${dumper.getDumpPath()}`)
  
  if (!dumper.isEnabled()) {
    console.log('ERROR: Dump should be enabled when DUMP_PROMPT=1')
    process.exit(1)
  }
  
  console.log('SUCCESS: Dump is enabled via environment variable!')
}

test().catch(console.error)
