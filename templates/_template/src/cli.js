#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { lines } from './core.js'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: 'boolean', short: 'h' },
    json: { type: 'boolean' },
  },
})

if (values.help || positionals.length === 0) {
  console.log('Usage: NAME <file> [--json]')
  process.exit(values.help ? 0 : 1)
}

const text = await import('node:fs/promises').then((fs) => fs.readFile(positionals[0], 'utf8'))
const result = { lines: lines(text).length }
console.log(values.json ? JSON.stringify(result, null, 2) : `lines: ${result.lines}`)
