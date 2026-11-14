#!/usr/bin/env node
/**
 * Run both Dojo labs' checks sequentially and print PASS / FAIL per lab.
 *
 * Usage (from the repository root or anywhere):
 *   node dojo/run-all.mjs
 *
 * Exit code 0 only when both labs pass. Uses Node's built-in test runner;
 * there is no install step and no third-party dependency.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dojoRoot = fileURLToPath(new URL('.', import.meta.url))

const labs = [
  {
    id: 'lab-01-hello-plugin',
    dir: 'lab-01-hello-plugin',
    check: 'test/check.mjs',
  },
  {
    id: 'lab-02-governance',
    dir: 'lab-02-governance',
    check: 'check.mjs',
  },
]

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 19)) {
  console.error(
    `WARN: Node ${process.version} is older than the lab requirement (^22.19.0 || >=24.9.0).`,
  )
}

/**
 * @param {string} stdout
 * @returns {{ pass: number | null, fail: number | null, total: number | null }}
 */
function parseTap(stdout) {
  const pick = (pattern) => {
    const match = pattern.exec(stdout)
    return match === null ? null : Number(match[1])
  }
  return {
    pass: pick(/^# pass (\d+)$/m),
    fail: pick(/^# fail (\d+)$/m),
    total: pick(/^1\.\.(\d+)$/m),
  }
}

/**
 * @param {string} text
 * @param {number} [maxLines]
 * @returns {string}
 */
function indentTail(text, maxLines = 40) {
  const lines = text.trimEnd().split('\n')
  const omitted = Math.max(0, lines.length - maxLines)
  const shown = lines.slice(-maxLines)
  const prefix = omitted === 0 ? '' : `  ... ${omitted} earlier line(s) omitted\n`
  return `${prefix}${shown.map((line) => `  ${line}`).join('\n')}`
}

let passed = 0
let totalTests = 0

console.log(`Dojo run-all — ${labs.length} labs (Node ${process.version})`)
console.log('')

for (const [index, lab] of labs.entries()) {
  const labDir = join(dojoRoot, lab.dir)
  const checkPath = join(labDir, lab.check)

  if (!existsSync(checkPath)) {
    console.log(`FAIL  [${index + 1}/${labs.length}] ${lab.id} (missing ${lab.check})`)
    continue
  }

  const result = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', lab.check],
    {
      cwd: labDir,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    },
  )

  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  const tap = parseTap(stdout)
  const ok = result.status === 0 && (tap.fail === null || tap.fail === 0)
  const testCount = tap.pass ?? tap.total
  if (typeof testCount === 'number') totalTests += testCount

  if (ok) {
    passed += 1
    const suffix = typeof testCount === 'number' ? ` (${testCount} tests)` : ''
    console.log(`PASS  [${index + 1}/${labs.length}] ${lab.id}${suffix}`)
    continue
  }

  console.log(`FAIL  [${index + 1}/${labs.length}] ${lab.id} (exit ${result.status ?? 'spawn-error'})`)
  if (result.error !== undefined) {
    console.error(`  spawn error: ${result.error.message}`)
  }
  if (stdout.trim() !== '') {
    console.error('  --- stdout (tail) ---')
    console.error(indentTail(stdout))
  }
  if (stderr.trim() !== '') {
    console.error('  --- stderr (tail) ---')
    console.error(indentTail(stderr))
  }
}

console.log('')
console.log(
  `Summary: ${passed}/${labs.length} labs passed; ${totalTests} tests reported.`,
)
process.exitCode = passed === labs.length ? 0 : 1
