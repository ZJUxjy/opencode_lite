import { PromptDumper } from '../src/utils/promptDumper.js'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'

async function testDumpFeature() {
  const sessionId = `test-dump-${Date.now()}`
  const dumpDir = path.join(os.homedir(), '.lite-opencode', 'dumps')
  const dumpFile = path.join(dumpDir, `session-${sessionId}.md`)

  console.log('='.repeat(60))
  console.log('Testing Prompt Dump Feature')
  console.log('='.repeat(60))
  console.log(`Session ID: ${sessionId}`)
  console.log(`Expected dump file: ${dumpFile}`)

  // Create dumper enabled
  const dumper = new PromptDumper(sessionId, true)

  // Check dump is enabled
  console.log(`\nDump enabled: ${dumper.isEnabled()}`)
  console.log(`Dump path: ${dumper.getDumpPath()}`)
  
  // Test dumpRequest
  console.log('\nTesting dumpRequest...')
  dumper.dumpRequest(
    "You are a helpful assistant for testing.",
    [
      { role: "user", content: "Hello, this is a test message." }
    ]
  )

  // Test dumpResponse
  console.log('Testing dumpResponse...')
  dumper.dumpResponse({
    content: "Hello! This is a test response.",
    finishReason: "end_turn"
  })

  // Check if dump file was created
  if (fs.existsSync(dumpFile)) {
    console.log('\n✅ Dump file created successfully!')
    
    const content = fs.readFileSync(dumpFile, 'utf-8')
    console.log('\n--- Dump File Content ---')
    console.log(content)
    console.log('--- End of Dump File ---')
  } else {
    console.log('\n❌ Dump file NOT created!')
    process.exit(1)
  }

  // Test toggle
  dumper.setEnabled(false)
  console.log(`\nAfter toggle: Dump enabled: ${dumper.isEnabled()}`)

  // Cleanup
  if (fs.existsSync(dumpFile)) {
    fs.unlinkSync(dumpFile)
    console.log('\n🧹 Cleaned up test dump file')
  }

  console.log('\n✅ All tests passed!')
}

testDumpFeature().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})
