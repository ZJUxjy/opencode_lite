import { Agent } from '../src/agent.js'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'

async function testDumpE2E() {
  const sessionId = `e2e-dump-test-${Date.now()}`
  const dumpDir = path.join(os.homedir(), '.lite-opencode', 'dumps')
  const dumpFile = path.join(dumpDir, `session-${sessionId}.md`)

  console.log('='.repeat(60))
  console.log('E2E Test: Prompt Dump Feature')
  console.log('='.repeat(60))
  console.log(`Session ID: ${sessionId}`)
  console.log(`Dump file: ${dumpFile}`)

  // Clean up any existing dump file
  if (fs.existsSync(dumpFile)) {
    fs.unlinkSync(dumpFile)
  }

  // 1. Test with dumpPrompt enabled via config
  console.log('\n[1] Testing Agent with dumpPrompt: true...')
  
  const agent = new Agent(sessionId, {
    cwd: process.cwd(),
    dbPath: path.join(os.homedir(), '.lite-opencode', 'history.db'),
    dumpPrompt: true,
  })

  console.log(`  Dump enabled: ${agent.isDumpPromptEnabled()}`)
  
  if (!agent.isDumpPromptEnabled()) {
    console.log('  ❌ FAIL: Dump should be enabled!')
    process.exit(1)
  }
  console.log('  ✅ PASS: Dump is enabled')

  // 2. Test toggle off
  console.log('\n[2] Testing toggle off...')
  agent.setDumpPrompt(false)
  
  if (agent.isDumpPromptEnabled()) {
    console.log('  ❌ FAIL: Dump should be disabled!')
    process.exit(1)
  }
  console.log('  ✅ PASS: Dump is disabled')

  // 3. Test toggle on
  console.log('\n[3] Testing toggle on...')
  agent.setDumpPrompt(true)
  
  if (!agent.isDumpPromptEnabled()) {
    console.log('  ❌ FAIL: Dump should be enabled!')
    process.exit(1)
  }
  console.log('  ✅ PASS: Dump is enabled')

  // 4. Test dumpRequest
  console.log('\n[4] Testing dumpRequest...')
  const dumper = agent.getPromptDumper()
  
  dumper.dumpRequest(
    "You are a test assistant.",
    [
      { role: "user", content: "Test message 1" },
      { role: "assistant", content: "Test response 1" },
      { role: "user", content: "Test message 2" }
    ]
  )
  console.log('  ✅ PASS: dumpRequest completed')

  // 5. Test dumpResponse
  console.log('\n[5] Testing dumpResponse...')
  dumper.dumpResponse({
    content: "This is a test response from LLM.",
    toolCalls: [
      { id: "call_1", name: "read", arguments: { file_path: "/test/file.txt" } }
    ],
    finishReason: "tool_use"
  })
  console.log('  ✅ PASS: dumpResponse completed')

  // 6. Verify dump file content
  console.log('\n[6] Verifying dump file content...')
  
  if (!fs.existsSync(dumpFile)) {
    console.log('  ❌ FAIL: Dump file not created!')
    process.exit(1)
  }

  const content = fs.readFileSync(dumpFile, 'utf-8')
  
  const checks = [
    { name: 'Session header', test: content.includes(`# Session: ${sessionId}`) },
    { name: 'System prompt', test: content.includes('test assistant') },
    { name: 'User message', test: content.includes('Test message 1') },
    { name: 'Assistant message', test: content.includes('Test response 1') },
    { name: 'LLM response', test: content.includes('test response from LLM') },
    { name: 'Tool call', test: content.includes('read') && content.includes('file.txt') },
  ]

  let allPassed = true
  for (const check of checks) {
    if (check.test) {
      console.log(`  ✅ ${check.name}`)
    } else {
      console.log(`  ❌ ${check.name}`)
      allPassed = false
    }
  }

  if (!allPassed) {
    console.log('\nDump file content:')
    console.log(content)
    process.exit(1)
  }

  // 7. Cleanup
  console.log('\n[7] Cleanup...')
  if (fs.existsSync(dumpFile)) {
    fs.unlinkSync(dumpFile)
    console.log('  ✅ Dump file cleaned up')
  }

  console.log('\n' + '='.repeat(60))
  console.log('✅ All E2E tests passed!')
  console.log('='.repeat(60))
}

testDumpE2E().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})
