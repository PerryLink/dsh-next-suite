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

test('RULES contains at least five complete, uniquely named example rules', () => {
  assert.ok(RULES.length >= 5)
  const ids = new Set()
  for (const rule of RULES) {
    for (const key of ['id', 'kind', 'pattern', 'replacement', 'description', 'severity']) {
      assert.ok(key in rule, `missing ${key} on ${rule.id}`)
    }
    assert.ok(rule.pattern instanceof RegExp)
    assert.equal(typeof rule.replacement, 'string')
    assert.match(rule.description, /示例/)
    assert.ok(!ids.has(rule.id), `duplicate rule id ${rule.id}`)
    ids.add(rule.id)
  }
  const kinds = new Set(RULES.map((rule) => rule.kind))
  for (const kind of ['import', 'type-import', 'lifecycle', 'api', 'config']) {
    assert.ok(kinds.has(kind), `missing kind ${kind}`)
  }
  assert.match(RULES_NOTICE, /not an official/i)
  assert.equal(Object.isFrozen(RULES), true)
})

test('scanSource finds all five example rule categories with 1-based positions', () => {
  const matches = scanSource(SAMPLE)
  assert.equal(matches.length, 6)
  assert.deepEqual(
    matches.map((match) => [match.ruleId, match.line, match.column]),
    [
      ['context-type-import', 1, 1],
      ['import-specifier', 2, 15],
      ['ctx-plugin-to-use', 5, 3],
      ['dispose-listener', 6, 3],
      ['config-base-dir', 7, 9],
      ['config-base-dir', 7, 23],
    ],
  )
  assert.deepEqual(Object.keys(matches[0]), ['ruleId', 'line', 'column', 'before', 'after'])
  assert.equal(matches[0].before, "import { Context } from 'cordis'")
  assert.equal(matches[0].after, "import type { Context } from 'cordis'")
  assert.equal(matches[1].before, "from 'cordis/loader'")
  assert.equal(matches[1].after, "from '@cordisjs/loader'")
  assert.equal(matches[3].before, "ctx.on('dispose', cleanup)")
  assert.equal(matches[3].after, 'ctx.effect(() => cleanup)')
  assert.equal(matches[5].before, 'baseDir')
  assert.equal(matches[5].after, 'baseUrl')
})

test('scanSource handles double quotes and CRLF without shifting line numbers', () => {
  const code = 'const a = 1\r\nctx.on("dispose", stop)\r\nctx.plugin(b)\r\n'
  const matches = scanSource(code)
  assert.deepEqual(
    matches.map((match) => [match.ruleId, match.line, match.column]),
    [
      ['dispose-listener', 2, 1],
      ['ctx-plugin-to-use', 3, 1],
    ],
  )
  assert.equal(matches[0].after, 'ctx.effect(() => stop)')
})

test('scanSource returns no matches for already-migrated code', () => {
  assert.deepEqual(scanSource(SAMPLE_MIGRATED), [])
  assert.deepEqual(scanSource('const clean = true\n'), [])
  assert.deepEqual(scanSource(''), [])
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

test('applySource applies every example rule and is idempotent', () => {
  const next = applySource(SAMPLE, scanSource(SAMPLE))
  assert.equal(next, SAMPLE_MIGRATED)
  assert.deepEqual(scanSource(next), [])
  assert.equal(applySource(next, scanSource(next)), next)
  // Replaying stale matches must be a no-op as well.
  assert.equal(applySource(next, scanSource(SAMPLE)), next)
})

test('applySource preserves CRLF, LF and a missing trailing newline', () => {
  const crlf = 'ctx.plugin(a)\r\nctx.plugin(b)\r\n'
  assert.equal(applySource(crlf, scanSource(crlf)), 'ctx.use(a)\r\nctx.use(b)\r\n')

  const noTrailing = 'ctx.plugin(a)'
  assert.equal(applySource(noTrailing, scanSource(noTrailing)), 'ctx.use(a)')

  const mixed = 'ctx.plugin(a)\r\nctx.plugin(b)\nctx.plugin(c)'
  assert.equal(applySource(mixed, scanSource(mixed)), 'ctx.use(a)\r\nctx.use(b)\nctx.use(c)')
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
  const matches = scanSource('ctx.plugin(a)')
  assert.equal(applySource('ctx.use(a)', matches), 'ctx.use(a)')
  assert.equal(applySource('abc', [{ ruleId: 'x', line: 1, column: 2, before: 'zz', after: 'q' }]), 'abc')
  assert.equal(applySource('abc', [{ line: '1', column: 1, before: 'a', after: 'q' }]), 'abc')
  assert.equal(applySource('a\r\nb', []), 'a\r\nb')
})

test('plan reports changes, clean files and binary/invalid skips', () => {
  const files = [
    { path: 'src/a.js', content: SAMPLE },
    { path: 'src/clean.js', content: 'const x = 1\n' },
    { path: 'assets/logo.png', content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1]) },
    { path: 'data/blob.txt', content: Buffer.from('ok\u0000no', 'utf8') },
    { path: 'src/invalid.js', content: Buffer.from([0xff, 0xfe, 0xfd]) },
  ]
  const result = plan(files)
  assert.equal(result.changes.length, 1)
  assert.equal(result.changes[0].path, 'src/a.js')
  assert.equal(result.changes[0].matches.length, 6)
  assert.deepEqual(
    result.skipped.map((item) => [item.path, item.reason]),
    [
      ['assets/logo.png', 'binary-extension'],
      ['data/blob.txt', 'binary-nul'],
      ['src/invalid.js', 'invalid-utf8'],
    ],
  )
  assert.deepEqual(result.summary, { files: 5, changedFiles: 1, matches: 6, skipped: 3 })
})

test('plan decodes valid UTF-8 buffers and preserves BOM', () => {
  const result = plan([{ path: 'src/buf.js', content: Buffer.from('ctx.plugin(a)\n', 'utf8') }])
  assert.equal(result.changes.length, 1)
  assert.equal(result.changes[0].matches[0].ruleId, 'ctx-plugin-to-use')

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
    { path: 'src/a.js', content: SAMPLE },
    { path: 'assets/logo.png', content: Buffer.from([0, 1, 2]) },
  ])
  const text = formatPlan(result)
  assert.match(text, /illustrative examples/)
  assert.match(text, /src\/a\.js/)
  assert.match(text, /dispose-listener/)
  assert.match(text, /assets\/logo\.png/)
  assert.match(text, /binary-extension/)
  assert.match(text, /6 match\(es\)/)

  const parsed = JSON.parse(formatPlan(result, { json: true }))
  assert.match(parsed.notice, /not an official/i)
  assert.equal(parsed.changes[0].path, 'src/a.js')
  assert.equal(parsed.changes[0].matches[0].ruleId, 'context-type-import')
  assert.deepEqual(parsed.summary, { files: 2, changedFiles: 1, matches: 6, skipped: 1 })
  assert.doesNotThrow(() => JSON.stringify(parsed))

  const empty = formatPlan(plan([]))
  assert.match(empty, /No matches found/)
})
