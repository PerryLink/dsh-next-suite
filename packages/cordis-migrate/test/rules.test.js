import test from 'node:test'
import assert from 'node:assert/strict'
import { RULES, RULES_NOTICE, RULE_SOURCES, formatRules, serializeRule } from '../src/rules.js'
import { applySource, plan, scanSource } from '../src/core.js'
import { ALL_RULES_FIXTURE, ALL_RULES_MIGRATED, RULE_CASES } from './fixtures.js'

const EXPECTED_KINDS = ['api', 'config', 'hmr', 'import', 'lifecycle', 'package', 'service']

test('RULES is a frozen, uniquely identified, evidence-bearing rule set', () => {
  assert.ok(RULES.length >= 20, `expected >= 20 rules, got ${RULES.length}`)
  assert.equal(Object.isFrozen(RULES), true)

  const ids = new Set()
  for (const rule of RULES) {
    assert.equal(Object.isFrozen(rule), true, `${rule.id} must be frozen`)
    for (const key of ['id', 'kind', 'description', 'severity', 'evidence']) {
      assert.equal(typeof rule[key], 'string', `${rule.id}.${key}`)
      assert.ok(rule[key].trim() !== '', `${rule.id}.${key} must not be empty`)
    }
    assert.ok(rule.pattern instanceof RegExp, `${rule.id}.pattern must be a RegExp`)
    assert.match(rule.pattern.flags, /g/, `${rule.id}.pattern must be global`)
    assert.ok(
      typeof rule.replacement === 'string' || typeof rule.replacement === 'function',
      `${rule.id}.replacement must be a string or function`,
    )
    assert.ok(['error', 'warning', 'info'].includes(rule.severity), `${rule.id}.severity`)
    if ('experimental' in rule) {
      assert.equal(typeof rule.experimental, 'boolean', `${rule.id}.experimental must be boolean`)
    }
    assert.ok(!ids.has(rule.id), `duplicate rule id ${rule.id}`)
    ids.add(rule.id)
  }

  assert.equal(ids.size, RULES.length)
  assert.match(RULES_NOTICE, /not an official migration table/i)
  assert.match(RULES_NOTICE, /community-curated/i)
  assert.match(RULES_NOTICE, /experimental/i)
})

test('RULES covers every documented category and marks the uncertain rules experimental', () => {
  const kinds = new Set(RULES.map((rule) => rule.kind))
  for (const kind of EXPECTED_KINDS) assert.ok(kinds.has(kind), `missing kind ${kind}`)

  const experimental = new Set(RULES.filter((rule) => rule.experimental).map((rule) => rule.id))
  for (const id of [
    'context-root',
    'context-config',
    'context-lifecycle',
    'lifecycle-internal-event-rename',
    'service-setup-init',
    'service-set-provide',
    'service-start-init',
    'service-provide-builtin',
    'config-plugin-legacy-flags',
    'package-cordis-peer',
  ]) {
    assert.ok(experimental.has(id), `${id} must be marked experimental`)
  }
  assert.ok(experimental.size >= 8)
})

test('every built-in rule has exactly one positive/negative fixture case', () => {
  const ruleIds = RULES.map((rule) => rule.id).sort()
  const caseIds = RULE_CASES.map((entry) => entry.id).sort()
  assert.equal(new Set(caseIds).size, caseIds.length, 'duplicate fixture case id')
  assert.deepEqual(caseIds, ruleIds)

  // The per-kind requirement is explicit: each category has at least one rule,
  // and each of those rules has a positive and a negative fixture.
  for (const kind of EXPECTED_KINDS) {
    const kindRules = RULES.filter((rule) => rule.kind === kind)
    assert.ok(kindRules.length > 0, `kind ${kind} has no rule`)
    for (const rule of kindRules) {
      const entry = RULE_CASES.find((candidate) => candidate.id === rule.id)
      assert.ok(entry.positive.length > 0, `${rule.id} positive`)
      assert.ok(entry.negative.length > 0, `${rule.id} negative`)
    }
  }
})

for (const entry of RULE_CASES) {
  test(`rule ${entry.id}: positive applies exactly, negative does not match, result is a fixed point`, () => {
    const rule = RULES.find((candidate) => candidate.id === entry.id)
    assert.ok(rule, `missing rule ${entry.id}`)

    const matches = scanSource(entry.positive, [rule])
    assert.equal(matches.length, 1, `${entry.id} must match once`)
    assert.equal(matches[0].ruleId, rule.id)

    const output = applySource(entry.positive, matches)
    assert.equal(output, entry.expected)
    assert.notEqual(output, entry.positive)
    assert.deepEqual(scanSource(output, [rule]), [], `${entry.id} must not re-match its own output`)
    assert.equal(applySource(output, scanSource(output, [rule])), output)

    assert.deepEqual(scanSource(entry.negative, [rule]), [])
  })
}

test('import rewrites preserve quoting and handle aliases/default/type imports', () => {
  const cases = [
    {
      rule: 'import-cordis-loader',
      before: 'import Loader from "cordis/loader"\n',
      after: 'import Loader from "@cordisjs/loader"\n',
    },
    {
      rule: 'import-cordis-group',
      before: 'import Group from "cordis/group"\n',
      after: 'import Group from "@cordisjs/group"\n',
    },
    {
      rule: 'import-cordis-schema',
      before: "import { z as zz } from '@cordisjs/schema'\n",
      after: "import zz from 'schemastery'\n",
    },
    {
      rule: 'import-cordisjs-logger',
      before: "import LoggerService from '@cordisjs/logger'\n",
      after: "import { LoggerService } from 'cordis'\n",
    },
    {
      rule: 'import-cordisjs-logger',
      before: "import type { Logger } from '@cordisjs/logger'\n",
      after: "import type { Logger } from 'cordis'\n",
    },
  ]

  for (const entry of cases) {
    const rule = RULES.find((candidate) => candidate.id === entry.rule)
    const matches = scanSource(entry.before, [rule])
    assert.ok(matches.length > 0, `${entry.rule} must match ${entry.before.trim()}`)
    assert.equal(applySource(entry.before, matches), entry.after)
    assert.deepEqual(scanSource(entry.after, [rule]), [])
  }
})

test('event, service and package rewrites cover the documented variants', () => {
  const cases = [
    {
      rule: 'lifecycle-dispose-listener',
      before: 'ctx.once("dispose", stop)\n',
      after: 'ctx.effect(() => stop)\n',
    },
    {
      rule: 'lifecycle-internal-event-rename',
      before: "ctx.once('internal/fork', (entry) => {})\n",
      after: "ctx.once('internal/plugin', (entry) => {})\n",
    },
    {
      rule: 'lifecycle-internal-event-rename',
      before: "ctx.on('internal/before-update', fn)\n",
      after: "ctx.on('internal/update', fn)\n",
    },
    {
      rule: 'lifecycle-internal-event-rename',
      before: "ctx.on('internal/event', fn)\n",
      after: "ctx.on('internal/dispatch', fn)\n",
    },
    {
      rule: 'service-start-init',
      before: '    start() {\n',
      after: '    [Service.init]() {\n',
    },
    {
      rule: 'config-base-dir',
      before: '"baseDir": "./src"\n',
      after: '"baseUrl": "./src"\n',
    },
    {
      rule: 'package-config-entry-name',
      before: '"name": "@cordisjs/plugin-loader"\n',
      after: '"name": "@cordisjs/loader"\n',
    },
    {
      rule: 'package-config-entry-name',
      before: "name: '@cordisjs/plugin-hmr'\n",
      after: "name: '@cordisjs/hmr'\n",
    },
    {
      rule: 'package-cordis-peer',
      before: "'cordis': '^3.18.1'\n",
      after: "'cordis': '^4.0.0-rc.13'\n",
    },
  ]

  for (const entry of cases) {
    const rule = RULES.find((candidate) => candidate.id === entry.rule)
    const matches = scanSource(entry.before, [rule])
    assert.ok(matches.length > 0, `${entry.rule} must match ${entry.before.trim()}`)
    assert.equal(applySource(entry.before, matches), entry.after)
    assert.deepEqual(scanSource(entry.after, [rule]), [])
  }
})

test('the aggregate fixture matches and migrates every rule in one idempotent pass', () => {
  const matches = scanSource(ALL_RULES_FIXTURE)
  const matchedIds = new Set(matches.map((match) => match.ruleId))
  for (const rule of RULES) assert.ok(matchedIds.has(rule.id), `aggregate fixture misses ${rule.id}`)
  assert.equal(matches.length, RULE_CASES.length)

  const output = applySource(ALL_RULES_FIXTURE, matches)
  assert.equal(output, ALL_RULES_MIGRATED)
  assert.deepEqual(scanSource(output), [])
  assert.equal(applySource(output, scanSource(output)), output)

  const result = plan([{ path: 'all.js', content: ALL_RULES_FIXTURE }])
  assert.equal(result.changes.length, 1)
  assert.equal(result.changes[0].matches.length, RULE_CASES.length)
  assert.deepEqual(result.summary, {
    files: 1,
    changedFiles: 1,
    matches: RULE_CASES.length,
    skipped: 0,
  })
})

test('formatRules renders text and JSON without leaking RegExp objects', () => {
  const text = formatRules()
  assert.match(text, new RegExp(`${RULES.length} rule\\(s\\)`))
  assert.match(text, /experimental/)
  assert.match(text, /Sources:/)
  for (const rule of RULES) assert.match(text, new RegExp(rule.id))

  const parsed = JSON.parse(formatRules(RULES, { json: true }))
  assert.match(parsed.notice, /not an official migration table/i)
  assert.equal(parsed.count, RULES.length)
  assert.equal(parsed.rules.length, RULES.length)
  assert.ok(parsed.experimental >= 8)
  assert.ok(parsed.sources.length >= 8)
  assert.equal(typeof parsed.rules[0].pattern, 'string')
  assert.equal(typeof parsed.rules[0].evidence, 'string')
  assert.ok(parsed.rules[0].evidence.length > 0)
  assert.doesNotThrow(() => JSON.stringify(parsed))

  const serialized = serializeRule(RULES[0])
  assert.equal(typeof serialized.pattern, 'string')
  assert.equal(serialized.experimental, false)
})

test('RULE_SOURCES is frozen and points at public evidence URLs', () => {
  assert.ok(RULE_SOURCES.length >= 8)
  assert.equal(Object.isFrozen(RULE_SOURCES), true)
  for (const source of RULE_SOURCES) {
    assert.equal(Object.isFrozen(source), true)
    for (const key of ['id', 'title', 'url', 'note']) {
      assert.ok(typeof source[key] === 'string' && source[key].length > 0, `${source.id}.${key}`)
    }
    assert.match(source.url, /^https:\/\//)
  }
})
