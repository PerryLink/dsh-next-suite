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
  }
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
