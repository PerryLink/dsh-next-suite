import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  AtlasError,
  KINDS,
  SEVERITIES,
  addEntry,
  createAtlas,
  query,
  renderMarkdown,
  stats,
  validateEntry,
} from '../src/core.js'

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

test('validateEntry accepts a complete entry and normalizes evidence', () => {
  const input = sample({ evidence: 'docs/one.md' })
  const entry = validateEntry(input)

  assert.equal(entry.id, 'node-24-9-minimum')
  assert.equal(entry.package, '@deepseek-ai/dsh')
  assert.equal(entry.from, '0.2.1-rc.2')
  assert.equal(entry.to, '*')
  assert.equal(entry.kind, 'runtime')
  assert.equal(entry.severity, 'P0')
  assert.deepEqual(entry.evidence, ['docs/one.md'])
  assert.notEqual(entry, input)
})

test('validateEntry collects missing required fields', () => {
  assert.throws(
    () => validateEntry({}),
    (error) => {
      assert.equal(error.code, 'INVALID_ENTRY')
      assert.ok(Array.isArray(error.issues))
      for (const field of ['id', 'package', 'from', 'to', 'kind', 'severity', 'summary', 'fix']) {
        assert.ok(
          error.issues.some((issue) => issue.includes(field)),
          `missing issue for ${field}`,
        )
      }
      assert.ok(error.issues.some((issue) => issue.includes('evidence')))
      return true
    },
  )
})

test('validateEntry rejects an invalid id, severity, or kind', () => {
  assert.throws(() => validateEntry(sample({ id: 'Bad_ID' })), {
    code: 'INVALID_ENTRY',
  })
  assert.throws(() => validateEntry(sample({ severity: 'P4' })), {
    code: 'INVALID_ENTRY',
  })
  assert.throws(() => validateEntry(sample({ kind: 'Not A Kind' })), {
    code: 'INVALID_ENTRY',
  })
})

test('validateEntry rejects invalid versions and a reversed range', () => {
  assert.throws(() => validateEntry(sample({ from: 'banana' })), {
    code: 'INVALID_ENTRY',
  })
  assert.throws(
    () => validateEntry(sample({ from: '0.2.2', to: '0.2.1' })),
    (error) => {
      assert.equal(error.code, 'INVALID_ENTRY')
      assert.ok(error.issues.some((issue) => issue.includes('to must be')))
      return true
    },
  )
  assert.throws(() => validateEntry(sample({ from: '*' })), {
    code: 'INVALID_ENTRY',
  })
})

test('validateEntry rejects empty evidence', () => {
  assert.throws(
    () => validateEntry(sample({ evidence: [] })),
    (error) => {
      assert.equal(error.code, 'INVALID_ENTRY')
      assert.ok(error.issues.some((issue) => issue.includes('evidence')))
      return true
    },
  )
})

test('createAtlas validates entries and rejects duplicate ids', () => {
  const atlas = createAtlas([sample()])
  assert.equal(atlas.schemaVersion, 1)
  assert.equal(atlas.entries.length, 1)

  assert.throws(
    () => createAtlas([sample(), sample()]),
    (error) => {
      assert.equal(error.code, 'DUPLICATE_ID')
      assert.equal(error.id, 'node-24-9-minimum')
      return true
    },
  )

  assert.throws(() => createAtlas({}), { code: 'INVALID_ATLAS' })
})

test('addEntry appends to the atlas and rejects a duplicate id', () => {
  const atlas = createAtlas([sample()])
  const returned = addEntry(
    atlas,
    sample({ id: 'second-entry', severity: 'P2' }),
  )

  assert.equal(returned, atlas)
  assert.equal(atlas.entries.length, 2)
  assert.equal(atlas.entries[1].id, 'second-entry')

  assert.throws(() => addEntry(atlas, sample()), (error) => {
    assert.equal(error.code, 'DUPLICATE_ID')
    return true
  })
  assert.equal(atlas.entries.length, 2)

  const list = [sample()]
  assert.equal(addEntry(list, sample({ id: 'array-entry' })), list)
  assert.equal(list.length, 2)
})

test('query filters by package prefix and sorts by severity', () => {
  const atlas = createAtlas([
    sample({
      id: 'alpha-config',
      package: '@deepseek-ai/dsh-alpha',
      from: '0.2.0',
      to: '0.2.1',
      kind: 'config',
      severity: 'P2',
    }),
    sample({
      id: 'beta-runtime',
      package: '@deepseek-ai/dsh-beta',
      from: '0.2.1-rc.1',
      kind: 'runtime',
      severity: 'P0',
    }),
    sample({
      id: 'alpha-api',
      package: '@deepseek-ai/dsh-alpha-extra',
      from: '0.2.2',
      kind: 'api',
      severity: 'P1',
    }),
  ])

  assert.deepEqual(
    query(atlas, { package: '@deepseek-ai/dsh-alpha' }).map((entry) => entry.id),
    ['alpha-api', 'alpha-config'],
  )
  assert.deepEqual(
    query(atlas, { severity: 'P0' }).map((entry) => entry.id),
    ['beta-runtime'],
  )
  assert.deepEqual(
    query(atlas, { kind: 'api' }).map((entry) => entry.id),
    ['alpha-api'],
  )
  assert.deepEqual(
    query(atlas, { severity: 'p', kind: 'r' }).map((entry) => entry.id),
    ['beta-runtime'],
  )
})

test('query matches entries overlapping a version window', () => {
  const atlas = createAtlas([
    sample({
      id: 'alpha-config',
      package: '@deepseek-ai/dsh-alpha',
      from: '0.2.0',
      to: '0.2.1',
      kind: 'config',
      severity: 'P2',
    }),
    sample({
      id: 'beta-runtime',
      package: '@deepseek-ai/dsh-beta',
      from: '0.2.1-rc.1',
      kind: 'runtime',
      severity: 'P0',
    }),
    sample({
      id: 'alpha-api',
      package: '@deepseek-ai/dsh-alpha-extra',
      from: '0.2.2',
      kind: 'api',
      severity: 'P1',
    }),
  ])

  assert.deepEqual(
    query(atlas, { from: '0.2.1', to: '0.2.1' }).map((entry) => entry.id),
    ['beta-runtime', 'alpha-config'],
  )
  assert.deepEqual(
    query(atlas, { from: '0.2.2' }).map((entry) => entry.id),
    ['beta-runtime', 'alpha-api'],
  )
  assert.deepEqual(
    query(atlas, { to: '0.2.0' }).map((entry) => entry.id),
    ['alpha-config'],
  )
  assert.deepEqual(
    query(atlas, { from: '0.3.0' }).map((entry) => entry.id),
    ['beta-runtime', 'alpha-api'],
  )
})

test('query supports prefix versions and rejects an empty window', () => {
  const atlas = createAtlas([
    sample({
      id: 'rc-break',
      from: '0.2.1-rc.1',
      to: '0.2.1-rc.9',
      severity: 'P1',
      kind: 'api',
    }),
  ])

  assert.equal(query(atlas, { from: '0.2', to: '0.2.1' }).length, 1)
  assert.throws(
    () => query(atlas, { from: '0.2.2', to: '0.2.1' }),
    (error) => {
      assert.equal(error.code, 'INVALID_QUERY')
      return true
    },
  )
  assert.throws(() => query(atlas, { severity: 'P9' }), {
    code: 'INVALID_QUERY',
  })
  assert.throws(() => query(atlas, { unknown: 'x' }), {
    code: 'INVALID_QUERY',
  })
})

test('query returns an empty array for no matches', () => {
  const atlas = createAtlas([sample()])
  assert.deepEqual(query(atlas, { package: '@example/none' }), [])
})

test('renderMarkdown groups by severity and includes the required columns', () => {
  const markdown = renderMarkdown([
    sample({ id: 'p2', severity: 'P2', summary: 'Second group' }),
    sample({ id: 'p0', severity: 'P0', summary: 'First group' }),
  ])

  assert.match(markdown, /^# DSH Upgrade Atlas/)
  assert.match(markdown, /\| package \| from → to \| kind \| summary \| fix \|/)
  assert.ok(markdown.indexOf('## P0') < markdown.indexOf('## P2'))
  assert.match(markdown, /First group/)
  assert.match(markdown, /Second group/)
  assert.match(markdown, /@deepseek-ai\/dsh/)
})

test('renderMarkdown escapes pipes and newlines in cells', () => {
  const markdown = renderMarkdown([
    sample({ summary: 'left | right', fix: 'line one\nline two' }),
  ])

  assert.match(markdown, /left \\\| right/)
  assert.match(markdown, /line one<br>line two/)
})

test('renderMarkdown handles an empty atlas', () => {
  const markdown = renderMarkdown([])
  assert.match(markdown, /^# DSH Upgrade Atlas/)
  assert.match(markdown, /_No entries\._/)
  assert.doesNotMatch(markdown, /## P0/)
})

test('stats counts severity and kind with zero-filled buckets', () => {
  const atlas = createAtlas([
    sample({ id: 'one', severity: 'P0', kind: 'runtime' }),
    sample({ id: 'two', severity: 'P1', kind: 'api' }),
    sample({ id: 'three', severity: 'P1', kind: 'api' }),
  ])
  const result = stats(atlas)

  assert.equal(result.total, 3)
  assert.equal(result.bySeverity.P0, 1)
  assert.equal(result.bySeverity.P1, 2)
  assert.equal(result.bySeverity.P2, 0)
  assert.equal(result.bySeverity.P3, 0)
  assert.equal(result.byKind.api, 2)
  assert.equal(result.byKind.runtime, 1)
  for (const kind of KINDS) {
    assert.equal(typeof result.byKind[kind], 'number')
  }
  for (const severity of SEVERITIES) {
    assert.equal(typeof result.bySeverity[severity], 'number')
  }
})

test('stats on an empty atlas returns zeros', () => {
  const result = stats(createAtlas([]))
  assert.equal(result.total, 0)
  assert.equal(result.bySeverity.P0, 0)
  assert.equal(result.byKind.ui, 0)
})

test('custom kind slugs are accepted, queryable, and counted', () => {
  const atlas = createAtlas([
    sample({ id: 'custom-kind', kind: 'custom-kind', severity: 'P2' }),
  ])
  assert.equal(validateEntry(sample({ id: 'custom', kind: 'custom-kind' })).kind, 'custom-kind')
  assert.deepEqual(
    query(atlas, { kind: 'custom' }).map((entry) => entry.id),
    ['custom-kind'],
  )
  assert.equal(stats(atlas).byKind['custom-kind'], 1)
})

test('bundled atlas contains at least ten real, sourced breakpoints', () => {
  const data = JSON.parse(
    readFileSync(new URL('../data/atlas.json', import.meta.url), 'utf8'),
  )

  assert.equal(data.schemaVersion, 1)
  assert.equal(data.unofficial, true)
  assert.ok(Array.isArray(data.entries))
  assert.ok(data.entries.length >= 10, `expected >=10 entries, got ${data.entries.length}`)

  const atlas = createAtlas(data.entries)
  assert.equal(atlas.entries.length, data.entries.length)
  for (const entry of atlas.entries) {
    assert.ok(entry.evidence.length > 0)
    assert.ok(entry.summary.length > 0)
    assert.ok(entry.fix.length > 0)
  }

  assert.ok(atlas.entries.some((entry) => entry.id === 'node-24-9-minimum'))
  assert.ok(atlas.entries.some((entry) => entry.kind === 'tool'))
  assert.ok(atlas.entries.some((entry) => entry.kind === 'ui'))
  assert.ok(
    atlas.entries.some((entry) => entry.summary.includes('subagent_oar')),
  )
})

test('AtlasError carries code and issues', () => {
  const error = new AtlasError('INVALID_ENTRY', 'bad', { issues: ['a', 'b'] })
  assert.equal(error.name, 'AtlasError')
  assert.equal(error.code, 'INVALID_ENTRY')
  assert.deepEqual(error.issues, ['a', 'b'])
  assert.ok(error instanceof Error)
})
