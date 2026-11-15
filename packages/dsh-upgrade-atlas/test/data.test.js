import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { SEVERITIES, createAtlas } from '../src/core.js'

const data = JSON.parse(
  readFileSync(new URL('../data/atlas.json', import.meta.url), 'utf8'),
)
const entries = data.entries
const REQUIRED_FIELDS = [
  'id',
  'package',
  'from',
  'to',
  'kind',
  'severity',
  'summary',
  'fix',
]

test('bundled atlas is unofficial and carries at least 40 breakpoints', () => {
  assert.equal(data.schemaVersion, 1)
  assert.equal(data.unofficial, true)
  assert.ok(Array.isArray(entries))
  assert.ok(
    entries.length >= 40,
    `expected at least 40 entries, got ${entries.length}`,
  )
})

test('bundled atlas has unique ids', () => {
  const ids = entries.map((entry) => entry.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const id of ids) {
    assert.match(id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  }
})

test('every bundled entry has the required fields and a valid severity', () => {
  for (const entry of entries) {
    for (const field of REQUIRED_FIELDS) {
      assert.equal(
        typeof entry[field],
        'string',
        `${entry.id}: ${field} must be a string`,
      )
      assert.ok(
        entry[field].trim().length > 0,
        `${entry.id}: ${field} must not be empty`,
      )
    }

    assert.ok(
      SEVERITIES.includes(entry.severity),
      `${entry.id}: severity must be one of ${SEVERITIES.join(', ')}`,
    )
    assert.ok(Array.isArray(entry.evidence), `${entry.id}: evidence must be an array`)
    assert.ok(entry.evidence.length > 0, `${entry.id}: evidence must not be empty`)
    for (const item of entry.evidence) {
      assert.equal(
        typeof item,
        'string',
        `${entry.id}: evidence entries must be strings`,
      )
      assert.ok(item.trim().length > 0, `${entry.id}: evidence entries must not be empty`)
    }
  }
})

test('every open-ended entry explains why `to` stays `*`', () => {
  for (const entry of entries) {
    if (entry.to !== '*') continue
    assert.match(
      entry.summary,
      /still (current|applies)/i,
      `${entry.id}: an open-ended entry must say it is still current in its summary`,
    )
    assert.match(
      entry.summary,
      /target unknown/i,
      `${entry.id}: an open-ended entry must mark the target as unknown in its summary`,
    )
  }
})

test('most entries pin a concrete target release', () => {
  const concrete = entries.filter((entry) => entry.to !== '*')
  assert.ok(
    concrete.length >= 20,
    `expected at least 20 entries with a concrete target release, got ${concrete.length}`,
  )
  for (const entry of concrete) {
    assert.match(
      entry.to,
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
      `${entry.id}: to must be a concrete DSH version, got ${JSON.stringify(entry.to)}`,
    )
  }
})

test('guide-backed entries pin the guide release as their target', () => {
  const pinned = entries.filter((entry) => {
    const source = Array.isArray(entry.evidence)
      ? entry.evidence.join(' ')
      : entry.evidence
    const guide = source.match(/docs\/upgrade-guide\/v([0-9A-Za-z.-]+)\//)
    return guide !== null && entry.to === guide[1]
  })
  assert.ok(
    pinned.length >= 20,
    `expected at least 20 guide-backed entries with to = guide release, got ${pinned.length}`,
  )
})

test('bundled atlas validates and covers the documented breakpoint categories', () => {
  const atlas = createAtlas(entries)
  assert.equal(atlas.entries.length, entries.length)

  const kinds = new Set(atlas.entries.map((entry) => entry.kind))
  for (const kind of [
    'runtime',
    'package',
    'api',
    'config',
    'protocol',
    'tool',
    'agent',
    'ui',
  ]) {
    assert.ok(kinds.has(kind), `expected at least one ${kind} entry`)
  }

  const corpus = atlas.entries
    .map((entry) => `${entry.id} ${entry.package} ${entry.summary} ${entry.fix}`)
    .join(' ')
    .toLowerCase()
  for (const keyword of [
    'node',
    'plugin',
    'subagent',
    'office',
    'cordis',
    'ptc',
    'session',
    'windows',
    'slot',
    'sandbox',
  ]) {
    assert.ok(corpus.includes(keyword), `expected coverage for ${keyword}`)
  }
})
