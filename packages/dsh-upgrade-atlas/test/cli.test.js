import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url))

/**
 * @param {Record<string, unknown>} [overrides]
 * @returns {Record<string, unknown>}
 */
function sample(overrides = {}) {
  return {
    id: 'node-24-9-minimum',
    package: '@deepseek-ai/dsh',
    from: '0.2.1-rc.2',
    to: '*',
    kind: 'runtime',
    severity: 'P0',
    summary: 'DSH requires Node.js 24.9 or newer.',
    fix: 'Upgrade Node.js and CI pins.',
    evidence: ['docs/upgrade-guide/v0.2.1-rc.2/node-24/guide.md'],
    ...overrides,
  }
}

/**
 * @param {string[]} args
 * @param {import('node:child_process').SpawnSyncOptions} [options]
 */
function run(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    ...options,
  })
}

/**
 * @param {import('node:test').TestContext} t
 * @returns {string}
 */
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-upgrade-atlas-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('--help exits 0 and documents commands and --json', () => {
  const result = run(['--help'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /dsh-upgrade-atlas/)
  assert.match(result.stdout, /list\s+List entries/)
  assert.match(result.stdout, /query\s+Query entries/)
  assert.match(result.stdout, /render\s+Render Markdown/)
  assert.match(result.stdout, /add\s+Add one entry/)
  assert.match(result.stdout, /--json/)
  assert.match(result.stdout, /unofficial/i)
})

test('command help exits 0', () => {
  const result = run(['list', '--help'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Usage: dsh-upgrade-atlas list/)
})

test('--version prints the package version', () => {
  const result = run(['--version'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /^dsh-upgrade-atlas \d+\.\d+\.\d+/)
})

test('list --json prints the bundled atlas', () => {
  const result = run(['list', '--json'])
  assert.equal(result.status, 0)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.command, 'list')
  assert.equal(payload.ok, true)
  assert.equal(payload.count, payload.entries.length)
  assert.ok(payload.entries.length >= 10)
  assert.equal(payload.entries[0].severity, 'P0')
  for (const entry of payload.entries) {
    assert.ok(entry.id)
    assert.ok(entry.evidence.length > 0)
  }
})

test('query applies severity and version-window filters', () => {
  const p0 = run(['query', '--severity', 'P0', '--json'])
  assert.equal(p0.status, 0)
  const p0Payload = JSON.parse(p0.stdout)
  assert.equal(p0Payload.command, 'query')
  assert.ok(p0Payload.entries.length >= 1)
  assert.ok(p0Payload.entries.every((entry) => entry.severity === 'P0'))

  const ranged = run([
    'query',
    '--kind',
    'tool',
    '--from',
    '0.2.2',
    '--to',
    '0.2.2',
    '--json',
  ])
  assert.equal(ranged.status, 0)
  const rangedPayload = JSON.parse(ranged.stdout)
  assert.equal(rangedPayload.count, rangedPayload.entries.length)
  assert.ok(rangedPayload.entries.some((entry) => entry.id === 'office-operation-skills-removed'))
  assert.ok(rangedPayload.entries.every((entry) => entry.kind === 'tool'))
})

test('render --json returns Markdown grouped by severity', () => {
  const result = run(['render', '--json'])
  assert.equal(result.status, 0)
  const payload = JSON.parse(result.stdout)
  assert.match(payload.markdown, /^# DSH Upgrade Atlas/)
  assert.match(payload.markdown, /## P0/)
  assert.match(payload.markdown, /\| package \| from → to \| kind \| summary \| fix \|/)
  assert.ok(payload.total >= 10)
})

test('render --out writes a Markdown file', (t) => {
  const dir = tempDir(t)
  const out = join(dir, 'UPGRADE.md')
  const result = run(['render', '--out', out])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /wrote /)
  const markdown = readFileSync(out, 'utf8')
  assert.match(markdown, /^# DSH Upgrade Atlas/)
  assert.ok(markdown.length > 100)
})

test('stats --json counts entries and includes zero buckets', () => {
  const result = run(['stats', '--json'])
  assert.equal(result.status, 0)
  const stats = JSON.parse(result.stdout)
  assert.ok(stats.total >= 10)
  assert.equal(typeof stats.bySeverity.P0, 'number')
  assert.equal(typeof stats.byKind.ui, 'number')
})

test('add writes one entry and rejects a duplicate', (t) => {
  const dir = tempDir(t)
  const data = join(dir, 'atlas.json')
  const entryFile = join(dir, 'entry.json')
  writeFileSync(data, JSON.stringify({ schemaVersion: 1, entries: [] }))
  writeFileSync(entryFile, JSON.stringify(sample()))

  const added = run(['add', '--data', data, '--file', entryFile, '--json'])
  assert.equal(added.status, 0, added.stderr)
  const payload = JSON.parse(added.stdout)
  assert.equal(payload.added, 'node-24-9-minimum')
  assert.equal(payload.total, 1)

  const saved = JSON.parse(readFileSync(data, 'utf8'))
  assert.equal(saved.schemaVersion, 1)
  assert.equal(saved.entries.length, 1)

  const duplicate = run(['add', '--data', data, '--file', entryFile, '--json'])
  assert.equal(duplicate.status, 2)
  assert.match(duplicate.stderr, /duplicate/i)
  assert.equal(JSON.parse(readFileSync(data, 'utf8')).entries.length, 1)
})

test('add reads one entry from stdin', (t) => {
  const dir = tempDir(t)
  const data = join(dir, 'atlas.json')
  const result = run(['add', '--data', data, '--json'], {
    input: JSON.stringify(sample({ id: 'stdin-entry' })),
  })
  assert.equal(result.status, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  assert.equal(payload.added, 'stdin-entry')
  assert.equal(JSON.parse(readFileSync(data, 'utf8')).entries[0].id, 'stdin-entry')
})

test('add validates before touching the atlas file', (t) => {
  const dir = tempDir(t)
  const data = join(dir, 'atlas.json')
  const entryFile = join(dir, 'bad.json')
  const original = JSON.stringify({ schemaVersion: 1, entries: [] }, null, 2)
  writeFileSync(data, original)
  writeFileSync(entryFile, JSON.stringify({ id: 'incomplete' }))

  const result = run(['add', '--data', data, '--file', entryFile])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /invalid entry/i)
  assert.equal(readFileSync(data, 'utf8'), original)
})

test('unknown command exits 2', () => {
  const result = run(['nope'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /unknown command/i)
})

test('missing command exits 2 with help', () => {
  const result = run([])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /Usage:/)
})
