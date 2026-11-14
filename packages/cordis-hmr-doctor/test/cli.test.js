import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url))

/**
 * @param {string[]} args
 * @param {string} [input]
 */
function run(args, input) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    input,
    timeout: 10_000,
  })
}

test('cli --help prints usage and exits 0', () => {
  const result = run(['--help'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Usage:/)
  assert.match(result.stdout, /--json/)
  assert.match(result.stdout, /unofficial/)
})

test('cli with no argument prints usage and exits 2', () => {
  const result = run([])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /missing <log>/)
  assert.match(result.stderr, /Usage:/)
})

test('cli reads a log from stdin with - and emits JSON', () => {
  const result = run(['-', '--json'], "aborted src/db.ts: Cannot find module 'pg'\n")
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.summary.total, 1)
  assert.equal(report.summary.aborted, 1)
  assert.equal(report.counts['dependency-missing'], 1)
  assert.equal(report.events[0].module, 'src/db.ts')
})

test('cli reads a file and prints a human report', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'hmr-doctor-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'hmr.log')
  writeFileSync(
    file,
    [
      'settled src/a.ts',
      'skipped changes, which apply after a restart:',
      '- src/main.ts (host-module)',
    ].join('\n'),
  )

  const result = run([file])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Events: 2 total/)
  assert.match(result.stdout, /skipped 1/)
  assert.match(result.stdout, /host-module/)
  assert.match(result.stdout, /restart/i)
})

test('cli reports an unreadable log with exit 2', () => {
  const missing = join(tmpdir(), `hmr-doctor-missing-${process.pid}.log`)
  const result = run([missing])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /cannot read/)
})

test('cli rejects an unknown option with exit 2', () => {
  const result = run(['--nope', '-'], 'settled src/a.ts\n')
  assert.equal(result.status, 2)
  assert.match(result.stderr, /Unknown option/i)
})

test('cli handles empty stdin without throwing', () => {
  const result = run(['-', '--json'], '')
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.summary.total, 0)
  assert.deepEqual(report.causes, [])
})
