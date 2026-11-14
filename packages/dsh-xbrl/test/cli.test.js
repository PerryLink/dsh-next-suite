import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url))
const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url))

/**
 * @param {string} name
 * @returns {string}
 */
function fixture(name) {
  return path.join(fixtures, name)
}

/**
 * @param {string[]} args
 */
function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
}

test('CLI --help exits 0 and documents both commands', () => {
  const result = run(['--help'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Usage:/)
  assert.match(result.stdout, /dsh-xbrl check <facts\.json> \[--json\]/)
  assert.match(result.stdout, /dsh-xbrl diff <a\.json> <b\.json> \[--json\]/)
  assert.equal(result.stderr, '')
})

test('CLI check --help and missing command are handled', () => {
  const help = run(['check', '--help'])
  assert.equal(help.status, 0)
  assert.match(help.stdout, /Usage:/)

  const missing = run([])
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /missing command/)
})

test('CLI check --json passes a balanced report', () => {
  const result = run(['check', fixture('balanced-2024.json'), '--json'])
  assert.equal(result.status, 0)
  assert.equal(result.stderr, '')

  const payload = JSON.parse(result.stdout)
  assert.equal(payload.ok, true)
  assert.equal(payload.entity, 'Example Manufacturing Co., Ltd.')
  assert.equal(payload.period, '2024-12-31')
  assert.equal(payload.statements.length, 2)
  assert.equal(payload.statements[0].kind, 'balance-sheet')
  assert.equal(payload.statements[0].ok, true)
  assert.equal(payload.statements[1].kind, 'income-statement')
  assert.equal(payload.statements[1].ok, true)
  assert.deepEqual(payload.skipped, [])
})

test('CLI check fails with exit 1 on an unbalanced report', () => {
  const result = run(['check', fixture('unbalanced-2024.json'), '--json'])
  assert.equal(result.status, 1)

  const payload = JSON.parse(result.stdout)
  assert.equal(payload.ok, false)
  assert.deepEqual(payload.skipped, ['income-statement'])
  assert.equal(payload.statements[0].ok, false)
  assert.equal(payload.statements[0].diff, 10)
  assert.deepEqual(payload.statements[0].missing, [])
})

test('CLI check text output shows pass, skip, and incomplete status', () => {
  const balanced = run(['check', fixture('balanced-2024.json')])
  assert.equal(balanced.status, 0)
  assert.match(balanced.stdout, /Balance sheet \[PASS\]/)
  assert.match(balanced.stdout, /Income statement \[PASS\]/)

  const partial = run(['check', fixture('unbalanced-2024.json')])
  assert.equal(partial.status, 1)
  assert.match(partial.stdout, /Balance sheet \[FAIL\]/)
  assert.match(partial.stdout, /Income statement \[SKIPPED\]/)
})

test('CLI diff --json reports added, removed, and changed concepts', () => {
  const result = run([
    'diff',
    fixture('original-2023.json'),
    fixture('restated-2023.json'),
    '--json',
  ])
  assert.equal(result.status, 0)
  assert.equal(result.stderr, '')

  const payload = JSON.parse(result.stdout)
  assert.deepEqual(payload.added, ['NewLeaseLiability'])
  assert.deepEqual(payload.removed, ['LegacyFee'])
  assert.equal(payload.changed.length, 5)
  assert.deepEqual(payload.changed[0], {
    concept: 'Assets',
    before: 1000000,
    after: 1010000,
    delta: 10000,
    pct: 1,
  })
  assert.equal(payload.hasChanges, true)
})

test('CLI diff text output is readable', () => {
  const result = run([
    'diff',
    fixture('original-2023.json'),
    fixture('restated-2023.json'),
  ])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Restatement diff \[CHANGED\]/)
  assert.match(result.stdout, /\+ NewLeaseLiability/)
  assert.match(result.stdout, /- LegacyFee/)
  assert.match(result.stdout, /~ Assets: 1000000 -> 1010000/)
})

test('CLI rejects unknown commands and unreadable files with exit 2', () => {
  const unknown = run(['frobnicate'])
  assert.equal(unknown.status, 2)
  assert.match(unknown.stderr, /unknown command "frobnicate"/)
  assert.match(unknown.stderr, /Usage:/)

  const missing = run(['check', fixture('does-not-exist.json')])
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /cannot read/)
  assert.match(missing.stderr, /file not found/)
})
