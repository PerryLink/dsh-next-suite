import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CAPABILITY_MAP,
  analyzeSource,
  buildFindings,
  capabilityForSpecifier,
  diffCapabilities,
  extractImports,
  lineOfIndex,
  mapCapabilities,
  normalizeCapability,
  parseDeclared,
  toSarif,
} from '../src/core.js'

test('extractImports finds static imports, named imports and side-effect imports', () => {
  const code = [
    "import fs from 'node:fs'",
    'import { readFile } from "fs/promises"',
    "import './side-effect.js'",
    "import * as path from 'node:path'",
  ].join('\n')

  const imports = extractImports(code)
  assert.deepEqual(
    imports.map(({ specifier, kind }) => ({ specifier, kind })),
    [
      { specifier: 'node:fs', kind: 'static' },
      { specifier: 'fs/promises', kind: 'static' },
      { specifier: './side-effect.js', kind: 'static' },
      { specifier: 'node:path', kind: 'static' },
    ],
  )
  assert.ok(imports.every((item) => Number.isInteger(item.index) && item.index >= 0))
  assert.deepEqual(
    imports.map((item) => item.index),
    [...imports.map((item) => item.index)].sort((a, b) => a - b),
  )
})

test('extractImports finds dynamic imports, require and re-exports', () => {
  const code = [
    "const net = await import('node:net')",
    'const cp = require("node:child_process")',
    "export { one } from './one.js'",
    "export * from './two.js'",
  ].join('\n')

  const imports = extractImports(code)
  assert.deepEqual(
    imports.map(({ specifier, kind }) => ({ specifier, kind })),
    [
      { specifier: 'node:net', kind: 'dynamic' },
      { specifier: 'node:child_process', kind: 'require' },
      { specifier: './one.js', kind: 're-export' },
      { specifier: './two.js', kind: 're-export' },
    ],
  )
})

test('extractImports ignores commented-out and quoted import examples', () => {
  const code = [
    "// import fs from 'node:fs'",
    "/* require('node:child_process') */",
    'const example = "import http from \'node:http\'"',
    "const real = require('node:crypto')",
  ].join('\n')

  const imports = extractImports(code)
  assert.deepEqual(
    imports.map(({ specifier, kind }) => ({ specifier, kind })),
    [{ specifier: 'node:crypto', kind: 'require' }],
  )
  assert.equal(imports[0].index, code.lastIndexOf('require'))
})

test('CAPABILITY_MAP covers the required module families', () => {
  assert.equal(CAPABILITY_MAP['node:fs'], 'filesystem')
  assert.equal(CAPABILITY_MAP.fs, 'filesystem')
  assert.equal(CAPABILITY_MAP['node:net'], 'network')
  assert.equal(CAPABILITY_MAP.http, 'network')
  assert.equal(CAPABILITY_MAP.https, 'network')
  assert.equal(CAPABILITY_MAP.fetch, 'network')
  assert.equal(CAPABILITY_MAP['node:child_process'], 'process')
  assert.equal(CAPABILITY_MAP['node:crypto'], 'crypto')
  assert.equal(CAPABILITY_MAP['process.env'], 'env')
  assert.equal(CAPABILITY_MAP.eval, 'eval')
  assert.equal(CAPABILITY_MAP['new Function'], 'eval')
})

test('capabilityForSpecifier handles node: prefixes, subpaths and unknown imports', () => {
  assert.equal(capabilityForSpecifier('node:fs'), 'filesystem')
  assert.equal(capabilityForSpecifier('fs/promises'), 'filesystem')
  assert.equal(capabilityForSpecifier('node:fs/promises'), 'filesystem')
  assert.equal(capabilityForSpecifier('node:https'), 'network')
  assert.equal(capabilityForSpecifier('node:child_process'), 'process')
  assert.equal(capabilityForSpecifier('node:path'), 'unknown')
  assert.equal(capabilityForSpecifier('@scope/package'), 'unknown')
  assert.equal(capabilityForSpecifier('./local.js'), 'unknown')
  assert.equal(capabilityForSpecifier(''), 'unknown')
})

test('mapCapabilities deduplicates imports and includes env/eval from code', () => {
  const code = [
    "import fs from 'node:fs'",
    "import http from 'node:http'",
    "import fsAgain from 'fs'",
    'const home = process.env.HOME',
    "eval('2 + 2')",
    "new Function('return 1')",
  ].join('\n')

  assert.deepEqual(mapCapabilities(extractImports(code), code), [
    'filesystem',
    'network',
    'env',
    'eval',
  ])
})

test('mapCapabilities ignores strings, comments and property calls named eval', () => {
  const code = [
    "const text = 'process.env'",
    "// eval('nope')",
    "const obj = { run() { return 1 } }",
    "obj.eval('nope')",
  ].join('\n')

  assert.deepEqual(mapCapabilities([], code), [])
})

test('mapCapabilities detects process["env"] and new Function', () => {
  const code = "const home = process['env'].HOME\nconst fn = new Function('return 1')"
  assert.deepEqual(mapCapabilities([], code), ['env', 'eval'])
  assert.deepEqual(mapCapabilities(code), ['env', 'eval'])
})

test('analyzeSource keeps evidence, line numbers and import metadata', () => {
  const analysis = analyzeSource("import fs from 'node:fs'\nprocess.env.HOME", 'src/a.js')
  assert.equal(analysis.file, 'src/a.js')
  assert.deepEqual(analysis.capabilities, ['filesystem', 'env'])
  assert.equal(analysis.imports.length, 1)
  const env = analysis.observations.find((item) => item.capability === 'env')
  assert.equal(env.line, 2)
  assert.equal(env.evidence, 'process.env')
  assert.equal(env.origin, 'code')
})

test('parseDeclared supports arrays and objects with truthy/falsy values', () => {
  assert.deepEqual(
    parseDeclared({ dsh: { capabilities: ['filesystem', 'network', 'network'] } }),
    ['filesystem', 'network'],
  )
  assert.deepEqual(
    parseDeclared({ dsh: { capabilities: { network: true, filesystem: false, eval: 1 } } }),
    ['network', 'eval'],
  )
  assert.deepEqual(parseDeclared({ dsh: { capabilities: 'network, fs' } }), [
    'network',
    'filesystem',
  ])
})

test('parseDeclared normalises aliases and accepts convenience shapes', () => {
  assert.deepEqual(
    parseDeclared({ dsh: { capabilities: { fs: true, http: true, child_process: true } } }),
    ['filesystem', 'network', 'process'],
  )
  assert.deepEqual(
    parseDeclared({ dsh: { capabilities: ['environment_variables', 'cryptography'] } }),
    ['env', 'crypto'],
  )
  assert.deepEqual(parseDeclared({ capabilities: ['crypto'] }), ['crypto'])
  assert.deepEqual(parseDeclared([{ capability: 'env', reason: 'reads HOME' }]), ['env'])
  assert.deepEqual(parseDeclared(null), [])
  assert.deepEqual(parseDeclared({}), [])
})

test('normalizeCapability keeps custom names but canonicalises known aliases', () => {
  assert.equal(normalizeCapability('FS'), 'filesystem')
  assert.equal(normalizeCapability('process.env'), 'env')
  assert.equal(normalizeCapability('node:child_process'), 'process')
  assert.equal(normalizeCapability('  gpu  '), 'gpu')
  assert.equal(normalizeCapability(''), null)
  assert.equal(normalizeCapability(42), null)
})

test('diffCapabilities partitions matched, undeclared and unused capabilities', () => {
  assert.deepEqual(
    diffCapabilities(['filesystem', 'network', 'crypto'], ['filesystem', 'env', 'network']),
    {
      matched: ['filesystem', 'network'],
      undeclared: ['env'],
      unused: ['crypto'],
    },
  )
  assert.deepEqual(diffCapabilities(['fs'], ['filesystem']), {
    matched: ['filesystem'],
    undeclared: [],
    unused: [],
  })
  assert.deepEqual(diffCapabilities([], []), { matched: [], undeclared: [], unused: [] })
})

test('lineOfIndex is 1-based', () => {
  assert.equal(lineOfIndex('a\nb\nc', 0), 1)
  assert.equal(lineOfIndex('a\nb\nc', 2), 2)
  assert.equal(lineOfIndex('a\nb\nc', 4), 3)
  assert.equal(lineOfIndex('', 999), 1)
})

test('toSarif emits minimal SARIF 2.1.0 with rules and physical locations', () => {
  const sarif = toSarif(
    [
      { kind: 'undeclared', capability: 'env', file: 'src/a.js', line: 3, message: 'env used' },
      { kind: 'unused', capability: 'crypto', file: 'plugin.json' },
    ],
    { file: 'fallback.js' },
  )

  assert.equal(sarif.version, '2.1.0')
  assert.equal(sarif.$schema, 'https://json.schemastore.org/sarif-2.1.0.json')
  assert.equal(sarif.runs.length, 1)

  const run = sarif.runs[0]
  assert.equal(run.tool.driver.name, 'dsh-capdiff')
  assert.equal(run.tool.driver.version, '0.1.0')
  assert.deepEqual(
    run.tool.driver.rules.map((rule) => rule.id),
    ['dsh-capdiff/undeclared', 'dsh-capdiff/unused'],
  )
  assert.equal(run.results.length, 2)

  const undeclared = run.results[0]
  assert.equal(undeclared.ruleId, 'dsh-capdiff/undeclared')
  assert.equal(undeclared.ruleIndex, 0)
  assert.equal(undeclared.level, 'warning')
  assert.equal(undeclared.message.text, 'env used')
  assert.equal(
    undeclared.locations[0].physicalLocation.artifactLocation.uri,
    'src/a.js',
  )
  assert.equal(undeclared.locations[0].physicalLocation.region.startLine, 3)

  const unused = run.results[1]
  assert.equal(unused.ruleId, 'dsh-capdiff/unused')
  assert.equal(unused.level, 'note')
  assert.equal(unused.locations[0].physicalLocation.artifactLocation.uri, 'plugin.json')
  assert.equal(unused.locations[0].physicalLocation.region, undefined)
})

test('toSarif handles empty input and raw diff objects', () => {
  const empty = toSarif([])
  assert.deepEqual(empty.runs[0].results, [])
  assert.deepEqual(empty.runs[0].tool.driver.rules, [])

  const fromDiff = toSarif({ undeclared: ['env'], unused: ['crypto'] }, { file: 'plugin.json' })
  assert.deepEqual(
    fromDiff.runs[0].results.map((result) => result.ruleId),
    ['dsh-capdiff/undeclared', 'dsh-capdiff/unused'],
  )
  assert.equal(fromDiff.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri, 'plugin.json')
})

test('buildFindings attaches the first evidence location and manifest location', () => {
  const diff = { matched: [], undeclared: ['env'], unused: ['crypto'] }
  const findings = buildFindings(
    diff,
    { env: { file: 'src/a.js', line: 2, evidence: 'process.env' } },
    { manifestFile: 'plugin.json' },
  )

  assert.equal(findings.length, 2)
  assert.equal(findings[0].kind, 'undeclared')
  assert.equal(findings[0].capability, 'env')
  assert.equal(findings[0].file, 'src/a.js')
  assert.equal(findings[0].line, 2)
  assert.match(findings[0].message, /process\.env/)
  assert.equal(findings[1].kind, 'unused')
  assert.equal(findings[1].file, 'plugin.json')
})
