import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RULES,
  RULES_NOTICE,
  applySource,
  decodeTextContent,
  formatPlan,
  isBinaryPath,
  plan,
  scanSource,
} from '../src/core.js'
import { SAMPLE, SAMPLE_MIGRATED } from './fixtures.js'

const CUSTOM_RULES = [
  {
    id: 'plugin',
    kind: 'api',
    pattern: /ctx\.plugin\(/g,
    replacement: 'ctx.use(',
    description: 'test only',
    severity: 'warning',
  },
  {
    id: 'dispose',
    kind: 'lifecycle',
    pattern: /ctx\.on\(\s*(['"])dispose\1\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g,
    replacement: 'ctx.effect(() => $2)',
    description: 'test only',
    severity: 'warning',
  },
  {
    id: 'base-dir',
    kind: 'api',
    pattern: /\.baseDir\b/g,
    replacement: '.baseUrl',
    description: 'test only',
    severity: 'warning',
  },
]

const CUSTOM_SAMPLE = [
  "import x from 'y'",
  'ctx.plugin(foo)',
  "ctx.on('dispose', stop)",
  'ctx.baseDir',
].join('\n')

const CUSTOM_MIGRATED = [
  "import x from 'y'",
  'ctx.use(foo)',
  'ctx.effect(() => stop)',
  'ctx.baseUrl',
].join('\n')

/** @param {Partial<import('../src/core.js').Rule>} overrides */
function testRule(overrides) {
  return {
    id: 'test-rule',
    kind: 'test',
    pattern: /foo/g,
    replacement: 'bar',
    description: 'test only',
    severity: 'info',
    ...overrides,
  }
}

test('scanSource finds custom matches with 1-based positions and stable keys', () => {
  const matches = scanSource(CUSTOM_SAMPLE, CUSTOM_RULES)
  assert.deepEqual(
    matches.map((match) => [match.ruleId, match.line, match.column]),
    [
      ['plugin', 2, 1],
      ['dispose', 3, 1],
      ['base-dir', 4, 4],
    ],
  )
  assert.deepEqual(Object.keys(matches[0]), ['ruleId', 'line', 'column', 'before', 'after'])
  assert.equal(matches[1].before, "ctx.on('dispose', stop)")
  assert.equal(matches[1].after, 'ctx.effect(() => stop)')
})

test('scanSource handles double quotes and CRLF without shifting line numbers', () => {
  const code = 'const a = 1\r\nctx.on("dispose", stop)\r\nctx.plugin(b)\r\n'
  const matches = scanSource(code, CUSTOM_RULES)
  assert.deepEqual(
    matches.map((match) => [match.ruleId, match.line, match.column]),
    [
      ['dispose', 2, 1],
      ['plugin', 3, 1],
    ],
  )
  assert.equal(matches[0].after, 'ctx.effect(() => stop)')
})

test('scanSource returns no matches for already-migrated or empty code', () => {
  assert.deepEqual(scanSource(CUSTOM_MIGRATED, CUSTOM_RULES), [])
  assert.deepEqual(scanSource('const clean = true\n', CUSTOM_RULES), [])
  assert.deepEqual(scanSource('', CUSTOM_RULES), [])
})

test('scanSource supports capture replacements and function replacements', () => {
  const capture = testRule({ pattern: /timeout:\s*(\d+)/g, replacement: 'timeoutMs: $1' })
  const functional = testRule({
    id: 'functional',
    pattern: /retry:\s*(\d+)/g,
    replacement: (match, count) => `retries: ${count}`,
  })
  const matches = scanSource('timeout: 3000\nretry: 5\n', [capture, functional])
  assert.equal(matches[0].after, 'timeoutMs: 3000')
  assert.equal(matches[1].after, 'retries: 5')
})

test('applySource applies custom rules and is idempotent', () => {
  const matches = scanSource(CUSTOM_SAMPLE, CUSTOM_RULES)
  const next = applySource(CUSTOM_SAMPLE, matches)
  assert.equal(next, CUSTOM_MIGRATED)
  assert.deepEqual(scanSource(next, CUSTOM_RULES), [])
  assert.equal(applySource(next, scanSource(next, CUSTOM_RULES)), next)
  // Replaying the original (now stale) matches must be a no-op.
  assert.equal(applySource(next, matches), next)
})

test('applySource preserves CRLF, LF and a missing trailing newline', () => {
  const crlf = 'ctx.plugin(a)\r\nctx.plugin(b)\r\n'
  assert.equal(applySource(crlf, scanSource(crlf, CUSTOM_RULES)), 'ctx.use(a)\r\nctx.use(b)\r\n')

  const noTrailing = 'ctx.plugin(a)'
  assert.equal(applySource(noTrailing, scanSource(noTrailing, CUSTOM_RULES)), 'ctx.use(a)')

  const mixed = 'ctx.plugin(a)\r\nctx.plugin(b)\nctx.plugin(c)'
  assert.equal(
    applySource(mixed, scanSource(mixed, CUSTOM_RULES)),
    'ctx.use(a)\r\nctx.use(b)\nctx.use(c)',
  )
})

test('applySource handles several matches on one line, right-to-left', () => {
  const rule = testRule({ pattern: /foo/g, replacement: 'bar' })
  const code = 'foo foo\n'
  const matches = scanSource(code, [rule])
  assert.deepEqual(matches.map((match) => match.column), [1, 5])
  assert.equal(applySource(code, matches), 'bar bar\n')
})

test('applySource resolves overlapping matches leftmost-first', () => {
  const outer = testRule({ id: 'outer', pattern: /abcd/g, replacement: 'X' })
  const inner = testRule({ id: 'inner', pattern: /bc/g, replacement: 'Y' })
  const matches = scanSource('abcd', [outer, inner])
  assert.equal(matches.length, 2)
  assert.equal(applySource('abcd', matches), 'X')
})

test('applySource skips stale or malformed matches and keeps exact input', () => {
  const matches = scanSource('ctx.plugin(a)', CUSTOM_RULES)
  assert.equal(applySource('ctx.use(a)', matches), 'ctx.use(a)')
  assert.equal(applySource('abc', [{ ruleId: 'x', line: 1, column: 2, before: 'zz', after: 'q' }]), 'abc')
  assert.equal(applySource('abc', [{ line: '1', column: 1, before: 'a', after: 'q' }]), 'abc')
  assert.equal(applySource('a\r\nb', []), 'a\r\nb')
})

test('plan reports changes, clean files and binary/invalid skips', () => {
  const files = [
    { path: 'src/a.js', content: CUSTOM_SAMPLE },
    { path: 'src/clean.js', content: 'const x = 1\n' },
    { path: 'assets/logo.png', content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1]) },
    { path: 'data/blob.txt', content: Buffer.from('ok\u0000no', 'utf8') },
    { path: 'src/invalid.js', content: Buffer.from([0xff, 0xfe, 0xfd]) },
  ]
  const result = plan(files, CUSTOM_RULES)
  assert.equal(result.changes.length, 1)
  assert.equal(result.changes[0].path, 'src/a.js')
  assert.equal(result.changes[0].matches.length, 3)
  assert.deepEqual(
    result.skipped.map((item) => [item.path, item.reason]),
    [
      ['assets/logo.png', 'binary-extension'],
      ['data/blob.txt', 'binary-nul'],
      ['src/invalid.js', 'invalid-utf8'],
    ],
  )
  assert.deepEqual(result.summary, { files: 5, changedFiles: 1, matches: 3, skipped: 3 })
})

test('plan decodes valid UTF-8 buffers and preserves BOM', () => {
  const result = plan([{ path: 'src/buf.js', content: Buffer.from('ctx.plugin(a)\n', 'utf8') }])
  assert.equal(result.changes.length, 1)
  assert.equal(result.changes[0].matches[0].ruleId, 'context-plugin-use')

  const bom = Buffer.from([0xef, 0xbb, 0xbf, 0x63, 0x74, 0x78])
  const decoded = decodeTextContent('src/bom.js', bom)
  assert.equal(decoded.ok, true)
  assert.equal(decoded.text, '\ufeffctx')
})

test('plan supports custom rules, invalid entries and empty input', () => {
  const rule = testRule({ pattern: /foo/g, replacement: 'bar' })
  const custom = plan([{ path: 'x.txt', content: 'foo foo' }], [rule])
  assert.equal(custom.changes[0].matches.length, 2)
  assert.equal(custom.summary.matches, 2)

  const invalid = plan([{ path: '', content: 'foo' }, null])
  assert.deepEqual(
    invalid.skipped.map((item) => item.reason),
    ['invalid-file', 'invalid-file'],
  )
  assert.equal(invalid.summary.files, 2)

  assert.deepEqual(plan([]), {
    changes: [],
    skipped: [],
    summary: { files: 0, changedFiles: 0, matches: 0, skipped: 0 },
  })
})

test('isBinaryPath and decodeTextContent agree on binary detection', () => {
  assert.equal(isBinaryPath('logo.PNG'), true)
  assert.equal(isBinaryPath('archive.tar.gz'), true)
  assert.equal(isBinaryPath('src/a.js'), false)
  assert.equal(isBinaryPath('Makefile'), false)
  assert.deepEqual(decodeTextContent('x.bin', 'text'), { ok: false, reason: 'binary-extension' })
  assert.deepEqual(decodeTextContent('x.txt', 'a\u0000b'), { ok: false, reason: 'binary-nul' })
  assert.deepEqual(decodeTextContent('x.txt', 42), { ok: false, reason: 'unsupported-content' })
})

test('formatPlan renders text and JSON without leaking RegExp objects', () => {
  const result = plan([
    { path: 'src/a.js', content: CUSTOM_SAMPLE },
    { path: 'assets/logo.png', content: Buffer.from([0, 1, 2]) },
  ], CUSTOM_RULES)
  const text = formatPlan(result)
  assert.match(text, /not an official migration table/)
  assert.match(text, /src\/a\.js/)
  assert.match(text, /dispose/)
  assert.match(text, /assets\/logo\.png/)
  assert.match(text, /binary-extension/)
  assert.match(text, /3 match\(es\)/)

  const parsed = JSON.parse(formatPlan(result, { json: true }))
  assert.match(parsed.notice, /not an official migration table/i)
  assert.equal(parsed.changes[0].path, 'src/a.js')
  assert.equal(parsed.changes[0].matches[0].ruleId, 'plugin')
  assert.deepEqual(parsed.summary, { files: 2, changedFiles: 1, matches: 3, skipped: 1 })
  assert.doesNotThrow(() => JSON.stringify(parsed))

  const empty = formatPlan(plan([]))
  assert.match(empty, /No matches found/)
})

test('core.js re-exports the rules.js inventory and uses it by default', () => {
  assert.ok(RULES.length >= 20)
  assert.match(RULES_NOTICE, /not an official migration table/i)

  assert.deepEqual(
    scanSource('ctx.plugin(foo)\n').map((match) => match.ruleId),
    ['context-plugin-use'],
  )

  // A realistic file exercising four rules at once; one pass must reach the
  // already-migrated fixture and leave no matches behind.
  const next = applySource(SAMPLE, scanSource(SAMPLE))
  assert.equal(next, SAMPLE_MIGRATED)
  assert.deepEqual(scanSource(next), [])
  assert.equal(applySource(next, scanSource(next)), next)
})

test('validateRule rejects malformed evidence and experimental fields', () => {
  assert.throws(() => scanSource('x', [testRule({ evidence: '' })]), /evidence/)
  assert.throws(() => scanSource('x', [testRule({ evidence: 42 })]), /evidence/)
  assert.throws(() => scanSource('x', [testRule({ experimental: 'yes' })]), /experimental/)
})
