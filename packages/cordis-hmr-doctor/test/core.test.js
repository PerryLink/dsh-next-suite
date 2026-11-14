import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildReport,
  diagnose,
  formatReport,
  parseHmrLog,
  summarize,
} from '../src/core.js'

test('parses a settled line and removes ANSI/log decorations', () => {
  const raw = '\u001b[36m[2026-11-14T10:00:00.000Z]\u001b[0m [INFO] [hmr] settled src/routes/index.ts'
  const events = parseHmrLog(raw)
  assert.equal(events.length, 1)
  assert.deepEqual(
    { status: events[0].status, module: events[0].module, reason: events[0].reason, line: events[0].line },
    { status: 'settled', module: 'src/routes/index.ts', reason: null, line: 1 },
  )
  assert.equal(events[0].raw, raw)
})

test('parses an aborted line with a missing-module reason', () => {
  const events = parseHmrLog("[hmr] aborted src/services/db.ts: Error: Cannot find module 'pg'")
  assert.equal(events.length, 1)
  assert.equal(events[0].status, 'aborted')
  assert.equal(events[0].module, 'src/services/db.ts')
  assert.equal(events[0].reason, "Cannot find module 'pg'")
})

test('parses an inline skipped line with a parenthesised reason', () => {
  const [event] = parseHmrLog('[WARN] [hmr] skipped src/main.ts (host-module)')
  assert.equal(event.status, 'skipped')
  assert.equal(event.module, 'src/main.ts')
  assert.equal(event.reason, 'host-module')
})

test('parses the official skipped-changes block', () => {
  const text = [
    '[WARN] skipped changes, which apply after a restart:',
    '- src/main.ts (host-module)',
    '- src/native/addon.node (native-addon)',
  ].join('\n')
  const events = parseHmrLog(text)
  assert.equal(events.length, 2)
  assert.deepEqual(
    events.map(({ status, module, reason, line }) => ({ status, module, reason, line })),
    [
      { status: 'skipped', module: 'src/main.ts', reason: 'host-module', line: 2 },
      { status: 'skipped', module: 'src/native/addon.node', reason: 'native-addon', line: 3 },
    ],
  )
})

test('parses skip-block bullets whose module path contains spaces', () => {
  const [event] = parseHmrLog('skipped changes, which apply after a restart:\n- src/my plugin/main.ts (host-module)')
  assert.equal(event.module, 'src/my plugin/main.ts')
  assert.equal(event.reason, 'host-module')
})

test('parses reload, failed reload, and dispose logger lines', () => {
  const text = [
    'reload plugin at src/plugins/logger.ts',
    'failed to reload plugin at src/plugins/broken.ts',
    'failed to dispose plugin at src/plugins/old.ts',
  ].join('\n')
  const events = parseHmrLog(text)
  assert.equal(events.length, 3)
  assert.deepEqual(
    events.map(({ status, module, reason, failed }) => ({ status, module, reason, failed })),
    [
      { status: 'reload', module: 'src/plugins/logger.ts', reason: null, failed: undefined },
      { status: 'reload', module: 'src/plugins/broken.ts', reason: 'failed to reload', failed: true },
      { status: 'dispose', module: 'src/plugins/old.ts', reason: 'failed to dispose', failed: true },
    ],
  )
})

test('recognises a failed config reload as a reload event', () => {
  const [event] = parseHmrLog('config reload at cordis.yml failed')
  assert.equal(event.status, 'reload')
  assert.equal(event.module, 'cordis.yml')
  assert.equal(event.reason, 'config reload failed')
  assert.equal(event.failed, true)
})

test('parses key/value status lines', () => {
  const [event] = parseHmrLog('status=aborted module=src/server.ts reason="listen EADDRINUSE :::3000"')
  assert.equal(event.status, 'aborted')
  assert.equal(event.module, 'src/server.ts')
  assert.equal(event.reason, 'listen EADDRINUSE :::3000')
})

test('parses a status line that has a reason but no module', () => {
  const [event] = parseHmrLog('aborted Error: E_GREMLIN')
  assert.equal(event.status, 'aborted')
  assert.equal(event.module, null)
  assert.equal(event.reason, 'Error: E_GREMLIN')
})

test('ignores unrelated and empty lines', () => {
  const text = [
    '[INFO] watching ["src"]',
    'change detected at src/routes/index.ts',
    '[hmr] change detected at src/routes/index.ts',
    '',
    'the matter settled the dispute',
    '   ',
  ].join('\n')
  assert.deepEqual(parseHmrLog(text), [])
})

test('keeps line numbers and raw text in a mixed log', () => {
  const text = [
    'noise',
    '[hmr] settled src/a.ts',
    '[hmr] aborted src/b.ts: boom',
    '[hmr] skipped src/c.ts (native-addon)',
  ].join('\n')
  const events = parseHmrLog(text)
  assert.equal(events.length, 3)
  assert.deepEqual(events.map((event) => event.line), [2, 3, 4])
  assert.equal(events[2].raw, '[hmr] skipped src/c.ts (native-addon)')
})

test('summarizes statuses and the top reason', () => {
  const events = parseHmrLog([
    'skipped src/a.ts (host-module)',
    'skipped src/b.ts (host-module)',
    "aborted src/c.ts: Cannot find module 'x'",
  ].join('\n'))
  assert.deepEqual(summarize(events), {
    total: 3,
    settled: 0,
    aborted: 1,
    skipped: 2,
    topReason: 'host-module',
  })
})

test('summarizes an empty log', () => {
  assert.deepEqual(summarize(parseHmrLog('')), {
    total: 0,
    settled: 0,
    aborted: 0,
    skipped: 0,
    topReason: null,
  })
})

test('diagnoses a missing dependency and suggests installing it', () => {
  const result = diagnose(parseHmrLog("aborted src/db.ts: Cannot find module 'pg'"))
  assert.equal(result.counts.total, 1)
  assert.equal(result.counts['dependency-missing'], 1)
  assert.equal(result.causes[0].cause, 'dependency-missing')
  assert.ok(result.suggestions.some((line) => /install|missing module/i.test(line)))
})

test('classifies circular dependency reasons', () => {
  const result = diagnose(parseHmrLog('aborted src/a.ts: Circular dependency between a.ts and b.ts'))
  assert.equal(result.counts.circular, 1)
  assert.equal(result.causes[0].cause, 'circular')
})

test('classifies port-in-use reasons', () => {
  const result = diagnose(parseHmrLog('aborted src/server.ts: listen EADDRINUSE :::3000'))
  assert.equal(result.counts['port-in-use'], 1)
  assert.equal(result.causes[0].cause, 'port-in-use')
})

test('classifies configuration and plugin errors', () => {
  const events = parseHmrLog([
    "aborted src/plugin.ts: Invalid config: unknown option 'hot'",
    'aborted src/plugin.ts: expected a plugin, received number',
  ].join('\n'))
  const result = diagnose(events)
  assert.equal(result.counts['config-error'], 2)
  assert.equal(result.causes[0].cause, 'config-error')
})

test('classifies timeouts', () => {
  const result = diagnose(parseHmrLog('aborted src/a.ts: timed out after 5000ms'))
  assert.equal(result.counts.timeout, 1)
  assert.equal(result.causes[0].cause, 'timeout')
})

test('falls back to unknown for an unmapped reason', () => {
  const result = diagnose(parseHmrLog('aborted src/a.ts: E_GREMLIN'))
  assert.equal(result.counts.total, 1)
  assert.equal(result.counts.unknown, 1)
  assert.equal(result.causes[0].cause, 'unknown')
  assert.ok(result.suggestions.some((line) => /raw lines/i.test(line)))
})

test('ignores successful settled events in diagnosis', () => {
  const result = diagnose(parseHmrLog('settled src/a.ts\nsettled src/b.ts (12ms)'))
  assert.equal(result.counts.total, 0)
  assert.deepEqual(result.causes, [])
  assert.deepEqual(result.suggestions, [])
})

test('adds a restart suggestion for skipped changes', () => {
  const result = diagnose(parseHmrLog('skipped src/main.ts (host-module)'))
  assert.equal(result.counts.total, 1)
  assert.ok(result.suggestions.some((line) => /restart/i.test(line)))
})

test('diagnoses an empty event list without throwing', () => {
  const result = diagnose([])
  assert.equal(result.counts.total, 0)
  assert.deepEqual(result.causes, [])
  assert.deepEqual(result.suggestions, [])
  for (const key of ['dependency-missing', 'circular', 'port-in-use', 'config-error', 'timeout', 'unknown']) {
    assert.equal(result.counts[key], 0)
  }
})

test('formats a human-readable report', () => {
  const report = buildReport([
    'settled src/a.ts',
    "aborted src/b.ts: Cannot find module 'pg'",
    'failed to dispose plugin at src/c.ts',
  ].join('\n'))
  const text = formatReport(report)
  assert.match(text, /Cordis HMR Doctor/)
  assert.match(text, /settled 1/)
  assert.match(text, /dependency-missing/)
  assert.match(text, /Suggestions:/)
  assert.match(text, /not an official/)
})

test('formats stable JSON including summary, causes, and events', () => {
  const report = buildReport("aborted src/b.ts: Cannot find module 'pg'")
  const parsed = JSON.parse(formatReport(report, { json: true }))
  assert.equal(parsed.summary.total, 1)
  assert.equal(parsed.summary.aborted, 1)
  assert.equal(parsed.counts['dependency-missing'], 1)
  assert.equal(parsed.causes[0].cause, 'dependency-missing')
  assert.equal(parsed.events.length, 1)
  assert.deepEqual(JSON.parse(formatReport(report, { json: true })), parsed)
})

test('accepts an event array or a diagnosis object in formatReport', () => {
  const events = parseHmrLog('aborted src/a.ts: listen EADDRINUSE :::3000')
  assert.match(formatReport(events), /Events: 1 total/)
  assert.match(formatReport(diagnose(events)), /Events diagnosed: 1/)
})

test('formats an empty report with a helpful note', () => {
  const text = formatReport(buildReport(''))
  assert.match(text, /Events: 0 total/)
  assert.match(text, /No HMR events were found/)
})

test('rejects an unsupported formatReport input', () => {
  assert.throws(() => formatReport({ nonsense: true }), TypeError)
})
