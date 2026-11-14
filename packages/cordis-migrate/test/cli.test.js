import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url))

const SAMPLE = [
  "import { Context } from 'cordis'",
  "import Loader from 'cordis/loader'",
  '',
  'export function apply(ctx) {',
  '  ctx.plugin(foo)',
  "  ctx.on('dispose', cleanup)",
  '  const baseDir = ctx.baseDir',
  '}',
].join('\n')

const SAMPLE_MIGRATED = [
  "import type { Context } from 'cordis'",
  "import Loader from '@cordisjs/loader'",
  '',
  'export function apply(ctx) {',
  '  ctx.use(foo)',
  '  ctx.effect(() => cleanup)',
  '  const baseUrl = ctx.baseUrl',
  '}',
].join('\n')

const BINARY = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])

/**
 * @param {import('node:test').TestContext} t
 * @returns {Promise<string>}
 */
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-migrate-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(join(dir, 'src'), { recursive: true })
  await mkdir(join(dir, 'assets'), { recursive: true })
  await writeFile(join(dir, 'src', 'a.js'), SAMPLE)
  await writeFile(join(dir, 'src', 'clean.js'), 'const untouched = true\n')
  await writeFile(join(dir, 'assets', 'logo.png'), BINARY)
  return dir
}

function run(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 30_000 })
}

test('--help exits 0 and documents scan, apply, dry-run and write', () => {
  const result = run(['--help'])
  assert.equal(result.status, 0)
  assert.equal(result.stderr, '')
  assert.match(result.stdout, /cordis-migrate/)
  assert.match(result.stdout, /scan/)
  assert.match(result.stdout, /apply/)
  assert.match(result.stdout, /--dry-run/)
  assert.match(result.stdout, /--write/)
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

test('scan --json reports matches, paths and binary skips', async (t) => {
  const dir = await fixture(t)
  const result = run(['scan', dir, '--json'])
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.changes.length, 1)
  assert.equal(output.changes[0].path, 'src/a.js')
  assert.equal(output.changes[0].matches.length, 6)
  assert.equal(output.changes[0].matches[0].ruleId, 'context-type-import')
  assert.deepEqual(output.skipped, [{ path: 'assets/logo.png', reason: 'binary-extension' }])
  assert.equal(output.summary.files, 3)
  assert.match(output.notice, /not an official/i)
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

  assert.equal(await readFile(join(dir, 'src', 'a.js'), 'utf8'), SAMPLE)
})

test('apply defaults to dry-run and does not write', async (t) => {
  const dir = await fixture(t)
  const original = await readFile(join(dir, 'src', 'a.js'), 'utf8')

  const result = run(['apply', dir])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Dry run: no files were written/)
  assert.match(result.stdout, /src\/a\.js/)
  assert.equal(await readFile(join(dir, 'src', 'a.js'), 'utf8'), original)
})

test('apply --dry-run is explicit and still does not write', async (t) => {
  const dir = await fixture(t)
  const original = await readFile(join(dir, 'src', 'a.js'), 'utf8')

  const result = run(['apply', dir, '--dry-run'])
  assert.equal(result.status, 0)
  assert.equal(await readFile(join(dir, 'src', 'a.js'), 'utf8'), original)
})

test('apply --write changes text files, skips binary and cleans up idempotently', async (t) => {
  const dir = await fixture(t)
  const cleanBefore = await readFile(join(dir, 'src', 'clean.js'), 'utf8')
  const binaryBefore = await readFile(join(dir, 'assets', 'logo.png'))

  const first = run(['apply', dir, '--write'])
  assert.equal(first.status, 0, first.stderr)
  assert.match(first.stdout, /Wrote 1 file\(s\)/)
  assert.match(first.stdout, /src\/a\.js/)
  assert.equal(await readFile(join(dir, 'src', 'a.js'), 'utf8'), SAMPLE_MIGRATED)
  assert.equal(await readFile(join(dir, 'src', 'clean.js'), 'utf8'), cleanBefore)
  assert.deepEqual(await readFile(join(dir, 'assets', 'logo.png')), binaryBefore)

  const second = run(['apply', dir, '--write'])
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /No files written/)
  assert.equal(await readFile(join(dir, 'src', 'a.js'), 'utf8'), SAMPLE_MIGRATED)
})

test('apply --write --json reports written paths and keeps JSON parseable', async (t) => {
  const dir = await fixture(t)
  const result = run(['apply', dir, '--write', '--json'])
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
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
