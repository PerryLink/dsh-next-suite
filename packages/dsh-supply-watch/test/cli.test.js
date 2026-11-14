import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url))
const temporaryDirectories = []

after(async () => {
  for (const directory of temporaryDirectories) {
    await rm(directory, { recursive: true, force: true })
  }
})

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: 20_000,
  })
}

async function fixture(content) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-supply-watch-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'names.txt')
  await writeFile(path, content, 'utf8')
  return path
}

test('cli --help exits 0 and documents both commands', () => {
  const result = run(['--help'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Usage:/)
  assert.match(result.stdout, /dsh-supply-watch check/)
  assert.match(result.stdout, /dsh-supply-watch scan/)
})

test('cli check --json reports a high-severity typo', () => {
  const result = run(['check', 'dsh-cora', '--known', 'dsh-core', '--json'])
  assert.equal(result.status, 0)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.command, 'check')
  assert.equal(payload.knownCount, 1)
  assert.equal(payload.findings.length, 1)
  assert.equal(payload.findings[0].kind, 'typosquat')
  assert.equal(payload.findings[0].severity, 'high')
  assert.equal(payload.findings[0].nearest, 'dsh-core')
  assert.match(payload.disclaimer, /not a substitute/)
})

test('cli check --json reports no finding for an exact known name', () => {
  const result = run(['check', 'dsh-core', '--known', 'dsh-core,left-pad', '--json'])
  assert.equal(result.status, 0)
  const payload = JSON.parse(result.stdout)
  assert.deepEqual(payload.findings, [])
})

test('cli check --versions merges and sorts version findings', () => {
  const result = run([
    'check',
    'dsh-core',
    '--known',
    'dsh-core',
    '--versions',
    '0.0.1,99.0.0',
    '--json',
  ])
  assert.equal(result.status, 0)
  const payload = JSON.parse(result.stdout)
  assert.deepEqual(
    payload.findings.map((finding) => finding.code),
    ['implausible-major', 'placeholder-version'],
  )
  assert.deepEqual(
    payload.findings.map((finding) => finding.severity),
    ['high', 'medium'],
  )
})

test('cli scan parses comments, blanks, names, and inline versions', async () => {
  const file = await fixture(
    ['# a comment', '', 'dsh-cora', 'dsh-core 1.0.0,1.2.0', '  # another comment'].join('\n'),
  )
  const result = run(['scan', file, '--known', 'dsh-core', '--json'])
  assert.equal(result.status, 0)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.command, 'scan')
  assert.equal(payload.scanned, 2)
  assert.equal(payload.findings.length, 2)
  assert.equal(payload.findings[0].kind, 'typosquat')
  assert.equal(payload.findings[1].code, 'missing-intermediate')
})

test('cli scan human output includes a severity label and summary', async () => {
  const file = await fixture('dsh-cora\n')
  const result = run(['scan', file, '--known', 'dsh-core'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /\[HIGH\] typosquat "dsh-cora"/)
  assert.match(result.stdout, /1 finding\(s\): 1 high, 0 medium, 0 low/)
})

test('cli scan with no known names still runs version checks', async () => {
  const file = await fixture('dsh-core 0.0.1\n')
  const result = run(['scan', file, '--json'])
  assert.equal(result.status, 0)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.findings.length, 1)
  assert.equal(payload.findings[0].code, 'placeholder-version')
})

test('cli rejects an unknown command', () => {
  const result = run(['frobnicate'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /unknown command/)
})

test('cli rejects check without a name', () => {
  const result = run(['check'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /check requires exactly one package name/)
})

test('cli rejects an unreadable scan file', () => {
  const result = run(['scan', join(tmpdir(), 'dsh-supply-watch-does-not-exist.txt')])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /cannot read/)
})

test('cli exits 2 with no arguments', () => {
  const result = run([])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /Usage:/)
})
