import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALL_RULES_FIXTURE, ALL_RULES_MIGRATED, RULE_CASES, SAMPLE, SAMPLE_MIGRATED } from './fixtures.js'

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url))
const BINARY = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])

/**
 * @param {import('node:test').TestContext} t
 * @param {{allRules?: boolean}} [options]
 * @returns {Promise<string>}
 */
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-migrate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(join(dir, 'src'), { recursive: true })
  await mkdir(join(dir, 'assets'), { recursive: true })
  await writeFile(join(dir, 'src', 'a.js'), options.allRules ? ALL_RULES_FIXTURE : SAMPLE)
  await writeFile(join(dir, 'src', 'clean.js'), 'const untouched = true\n')
  await writeFile(join(dir, 'assets', 'logo.png'), BINARY)
  return dir
}

function run(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 30_000 })
}

test('--help exits 0 and documents scan, apply, rules, dry-run and write', () => {
  const result = run(['--help'])
  assert.equal(result.status, 0)
  assert.equal(result.stderr, '')
  assert.match(result.stdout, /cordis-migrate/)
  assert.match(result.stdout, /scan/)
  assert.match(result.stdout, /apply/)
  assert.match(result.stdout, /rules/)
  assert.match(result.stdout, /--dry-run/)
  assert.match(result.stdout, /--write/)
  assert.match(result.stdout, /community-curated/i)
  assert.match(result.stdout, /not an official migration table/i)
})

test('no arguments and unknown commands fail with usage on stderr and exit 2', () => {
  const noArgs = run([])
  assert.equal(noArgs.status, 2)
  assert.match(noArgs.stderr, /Usage/)

  const unknown = run(['frobnicate'])
  assert.equal(unknown.status, 2)
  assert.match(unknown.stderr, /unknown command/)

  const helpCommand = run(['help'])
  assert.equal(helpCommand.status, 0)
  assert.match(helpCommand.stdout, /Usage/)
})

test('rules lists every built-in rule in text form and never touches a target', () => {
  const result = run(['rules'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  assert.match(result.stdout, new RegExp(`${RULE_CASES.length} rule\\(s\\)`))
  assert.match(result.stdout, /experimental/)
  assert.match(result.stdout, /Sources:/)
  assert.match(result.stdout, /not an official migration table/i)
  for (const entry of RULE_CASES) assert.match(result.stdout, new RegExp(entry.id))
})

test('rules --json is machine-readable and carries evidence plus sources', () => {
  const result = run(['rules', '--json'])
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.command, 'rules')
  assert.equal(output.ok, true)
  assert.ok(output.count >= 20)
  assert.equal(output.count, RULE_CASES.length)
  assert.equal(output.rules.length, output.count)
  assert.equal(output.experimental, 4)
  assert.ok(output.sources.length >= 8)
  assert.match(output.notice, /not an official migration table/i)
  for (const rule of output.rules) {
    for (const key of ['id', 'kind', 'pattern', 'replacement', 'description', 'severity', 'evidence']) {
      assert.equal(typeof rule[key], 'string', `${rule.id}.${key}`)
    }
    for (const key of ['id', 'kind', 'pattern', 'description', 'severity', 'evidence']) {
      assert.ok(rule[key].length > 0, `${rule.id}.${key}`)
    }
    assert.equal(typeof rule.experimental, 'boolean')
  }
  assert.doesNotThrow(() => JSON.stringify(output))
})

test('rules rejects target paths and write flags', () => {
  const withTarget = run(['rules', 'src'])
  assert.equal(withTarget.status, 2)
  assert.match(withTarget.stderr, /no target path/)

  const withWrite = run(['rules', '--write'])
  assert.equal(withWrite.status, 2)
  assert.match(withWrite.stderr, /read-only/)

  const withDryRun = run(['rules', '--dry-run'])
  assert.equal(withDryRun.status, 2)
  assert.match(withDryRun.stderr, /read-only/)
})

test('scan --json reports all built-in matches, paths and binary skips', async (t) => {
  const dir = await fixture(t, { allRules: true })
  const result = run(['scan', dir, '--json'])
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.command, 'scan')
  assert.equal(output.changes.length, 1)
  assert.equal(output.changes[0].path, 'src/a.js')
  assert.equal(output.changes[0].matches.length, RULE_CASES.length)
  assert.equal(output.changes[0].matches[0].ruleId, RULE_CASES[0].id)
  assert.deepEqual(output.skipped, [{ path: 'assets/logo.png', reason: 'binary-extension' }])
  assert.equal(output.summary.files, 3)
  assert.match(output.notice, /not an official migration table/i)
})

test('scan text output is read-only and accepts a single file', async (t) => {
  const dir = await fixture(t)

  const dirScan = run(['scan', dir])
  assert.equal(dirScan.status, 0)
  assert.match(dirScan.stdout, /src\/a\.js/)
  assert.match(dirScan.stdout, /Read-only scan: no files were written/)

  const fileScan = run(['scan', join(dir, 'src', 'a.js'), '--json'])
  assert.equal(fileScan.status, 0)
  const output = JSON.parse(fileScan.stdout)
  assert.equal(output.changes[0].path, 'a.js')
  assert.equal(output.summary.files, 1)
  assert.equal(output.changes[0].matches.length, 5)

  assert.equal(await readFile(join(dir, 'src', 'a.js'), 'utf8'), SAMPLE)
})

test('apply defaults to dry-run and does not write any rule output', async (t) => {
  const dir = await fixture(t, { allRules: true })
  const before = await readFile(join(dir, 'src', 'a.js'), 'utf8')

  const result = run(['apply', dir])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Dry run: no files were written/)
  assert.match(result.stdout, /src\/a\.js/)
  assert.equal(await readFile(join(dir, 'src', 'a.js'), 'utf8'), before)
  assert.equal(before, ALL_RULES_FIXTURE)
})

test('apply --dry-run is explicit and still does not write', async (t) => {
  const dir = await fixture(t, { allRules: true })
  const before = await readFile(join(dir, 'src', 'a.js'), 'utf8')

  const result = run(['apply', dir, '--dry-run'])
  assert.equal(result.status, 0)
  assert.equal(await readFile(join(dir, 'src', 'a.js'), 'utf8'), before)
})

test('apply --write migrates every rule, skips binary and is idempotent', async (t) => {
  const dir = await fixture(t, { allRules: true })
  const cleanBefore = await readFile(join(dir, 'src', 'clean.js'), 'utf8')
  const binaryBefore = await readFile(join(dir, 'assets', 'logo.png'))

  const first = run(['apply', dir, '--write'])
  assert.equal(first.status, 0, first.stderr)
  assert.match(first.stdout, /Wrote 1 file\(s\)/)
  assert.match(first.stdout, /src\/a\.js/)
  assert.equal(await readFile(join(dir, 'src', 'a.js'), 'utf8'), ALL_RULES_MIGRATED)
  assert.equal(await readFile(join(dir, 'src', 'clean.js'), 'utf8'), cleanBefore)
  assert.deepEqual(await readFile(join(dir, 'assets', 'logo.png')), binaryBefore)

  const second = run(['apply', dir, '--write'])
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /No files written/)
  assert.equal(await readFile(join(dir, 'src', 'a.js'), 'utf8'), ALL_RULES_MIGRATED)
})

test('apply --write --json reports written paths and keeps JSON parseable', async (t) => {
  const dir = await fixture(t)
  const result = run(['apply', dir, '--write', '--json'])
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.command, 'apply')
  assert.equal(output.ok, true)
  assert.deepEqual(output.write.written, ['src/a.js'])
  assert.deepEqual(output.write.failures, [])
  assert.equal(output.changes[0].path, 'src/a.js')
  assert.equal(await readFile(join(dir, 'src', 'a.js'), 'utf8'), SAMPLE_MIGRATED)
})

test('apply rejects conflicting flags and scan rejects write flags', async (t) => {
  const dir = await fixture(t)
  const original = await readFile(join(dir, 'src', 'a.js'), 'utf8')

  const conflict = run(['apply', dir, '--write', '--dry-run'])
  assert.equal(conflict.status, 2)
  assert.match(conflict.stderr, /mutually exclusive/)
  assert.equal(await readFile(join(dir, 'src', 'a.js'), 'utf8'), original)

  const scanWrite = run(['scan', dir, '--write'])
  assert.equal(scanWrite.status, 2)
  assert.match(scanWrite.stderr, /scan is read-only/)
  assert.equal(await readFile(join(dir, 'src', 'a.js'), 'utf8'), original)
})

test('missing target and missing path arguments fail cleanly', async (t) => {
  const dir = await fixture(t)

  const missing = run(['scan', join(dir, 'does-not-exist')])
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /cordis-migrate:/)

  const noTarget = run(['apply'])
  assert.equal(noTarget.status, 2)
  assert.match(noTarget.stderr, /missing <dir\|file>/)

  const extra = run(['scan', dir, join(dir, 'src')])
  assert.equal(extra.status, 2)
  assert.match(extra.stderr, /expected one target path/)
})

test('apply --help exits 0 without touching files', async (t) => {
  const dir = await fixture(t)
  const original = await readFile(join(dir, 'src', 'a.js'), 'utf8')
  const result = run(['apply', '--help'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /cordis-migrate/)
  assert.equal(await readFile(join(dir, 'src', 'a.js'), 'utf8'), original)
})

test('--version reports the package version without scanning', () => {
  const result = run(['--version'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /cordis-migrate 0\.2\.3/)
})
