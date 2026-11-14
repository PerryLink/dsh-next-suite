#!/usr/bin/env node
/**
 * CLI for `cordis-hmr-doctor`.
 *
 * The CLI only parses arguments and performs I/O; all log interpretation lives
 * in `core.js`. Exit codes:
 *   0  report produced (even when the log contains aborted/skipped changes)
 *   1  unused (this diagnostic reader has no business-negative result)
 *   2  usage error, unreadable log, or invalid arguments
 */
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { buildReport, formatReport } from './core.js'

const USAGE = `cordis-hmr-doctor 0.1.3 - explain Cordis HMR logs (unofficial)

Usage:
  cordis-hmr-doctor <log> [--json]
  cordis-hmr-doctor - < hmr.log
  cat hmr.log | cordis-hmr-doctor -

Arguments:
  <log>       Path to a text log, or - to read from stdin.

Options:
  --json        Print a machine-readable JSON report.
  -h, --help    Show this help and exit.
  -V, --version Show version and exit.

Exit codes:
  0  report produced (even with aborted/skipped events)
  1  unused; this diagnostic reader has no business-negative result
  2  usage, input, or IO error
`

let parsed
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'V' },
      json: { type: 'boolean' },
    },
  })
} catch (error) {
  process.stderr.write(`cordis-hmr-doctor: ${error.message}\n\n${USAGE}`)
  process.exit(2)
}

const { values, positionals } = parsed

if (values.help) {
  process.stdout.write(USAGE)
  process.exit(0)
}

if (values.version) {
  process.stdout.write('cordis-hmr-doctor 0.1.3\n')
  process.exit(0)
}

if (positionals.length === 0) {
  process.stderr.write(`cordis-hmr-doctor: missing <log> argument\n\n${USAGE}`)
  process.exit(2)
}

if (positionals.length > 1) {
  process.stderr.write(`cordis-hmr-doctor: expected one <log>, got ${positionals.length}\n\n${USAGE}`)
  process.exit(2)
}

const source = positionals[0]
let text
try {
  text = source === '-' ? await readStdin() : await readFile(source, 'utf8')
} catch (error) {
  process.stderr.write(`cordis-hmr-doctor: cannot read ${source === '-' ? 'stdin' : source}: ${error.message}\n`)
  process.exit(2)
}

const report = buildReport(text)
if (values.json) {
  const payload = JSON.parse(formatReport(report, { json: true }))
  process.stdout.write(`${JSON.stringify({ command: 'report', ok: true, ...payload }, null, 2)}\n`)
} else {
  process.stdout.write(`${formatReport(report)}\n`)
}

/**
 * Read all of stdin as UTF-8. `fs.readFile(0)` is not portable across Node
 * versions, so consume the stream instead.
 * @returns {Promise<string>}
 */
async function readStdin() {
  process.stdin.setEncoding('utf8')
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  return text
}
