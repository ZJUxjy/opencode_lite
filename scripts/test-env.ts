import { parseDumpOption } from '../src/cli/dump-option.js'

console.log('Testing parseDumpOption with env variable')
console.log('DUMP_PROMPT env:', process.env.DUMP_PROMPT)
console.log('parseDumpOption(undefined):', parseDumpOption(undefined))
console.log('parseDumpOption(true):', parseDumpOption(true))
console.log('parseDumpOption("false"):', parseDumpOption("false"))
