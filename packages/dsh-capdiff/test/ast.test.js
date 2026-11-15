import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { AST_AVAILABLE, analyzeAst } from '../src/ast.js'
import {
  analyzeSource,
  collectCapabilityEvidence,
  extractImports,
  mapCapabilities,
} from '../src/core.js'

const FIXTURE_ROOT = fileURLToPath(
  new URL('../../../benchmarks/capdiff/fixtures/', import.meta.url),
)

test('analyzeSource falls back when acorn is not installed', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-capdiff-no-acorn-'))
  t.after(async () => {
    const absolute = resolve(dir)
    const tempRoot = resolve(tmpdir())
    if (!absolute.startsWith(tempRoot + sep)) {
      throw new Error(`refusing to remove test directory outside tmpdir: ${absolute}`)
    }
    await rm(absolute, { recursive: true, force: true })
  })

  // A copy of src/ outside the repository has no node_modules above it, so the
  // optional acorn require fails exactly like an install without the dependency.
  await cp(fileURLToPath(new URL('../src/', import.meta.url)), join(dir, 'src'), {
    recursive: true,
  })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ type: 'module' }))
  await writeFile(
    join(dir, 'probe.mjs'),
    [
      "import { analyzeSource } from './src/core.js'",
      "import { analyzeAst } from './src/ast.js'",
      "const code = \"import fs from 'node:fs'\\nprocess.env.HOME\"",
      'const ast = analyzeAst(code)',
      'const result = analyzeSource(code, "x.js")',
      'console.log(JSON.stringify({',
      '  astCapabilities: ast.capabilities,',
      "  astError: ast.parseError?.message ?? null,",
      '  capabilities: result.capabilities,',
      '  importCount: result.imports.length,',
      '}))',
    ].join('\n'),
  )

  const output = await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['probe.mjs'], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`probe exited ${code}: ${stderr}`))
      } else {
        resolvePromise(JSON.parse(stdout))
      }
    })
  })

  assert.deepEqual(output.astCapabilities, [])
  assert.match(output.astError, /acorn is not installed/)
  assert.deepEqual(output.capabilities, ['filesystem', 'env'])
  assert.equal(output.importCount, 1)
})

/**
 * The pre-AST implementation, kept here as the comparison oracle: extraction
 * plus evidence collection still live in core.js and back the fallback path.
 *
 * @param {string} code
 */
function regexAnalysis(code) {
  const imports = extractImports(code)
  const observations = collectCapabilityEvidence(code, imports)
  const capabilities = []
  for (const observation of observations) {
    if (!capabilities.includes(observation.capability)) capabilities.push(observation.capability)
  }
  return { imports, observations, capabilities }
}

test('AST_AVAILABLE reports the optional acorn dependency', () => {
  assert.equal(AST_AVAILABLE, true)
})

test('analyzeAst extracts static imports, re-exports, dynamic imports and requires', () => {
  const code = [
    "import fs from 'node:fs'",
    "import 'node:path'",
    "export { readFile } from 'node:fs/promises'",
    "export * from './local.js'",
    "const net = await import('node:net')",
    'const cp = require("node:child_process")',
  ].join('\n')

  const analysis = analyzeAst(code, { filename: 'src/index.js' })

  assert.equal(analysis.parseError, undefined)
  assert.deepEqual(
    analysis.imports.map(({ specifier, kind }) => ({ specifier, kind })),
    [
      { specifier: 'node:fs', kind: 'static' },
      { specifier: 'node:path', kind: 'static' },
      { specifier: 'node:fs/promises', kind: 're-export' },
      { specifier: './local.js', kind: 're-export' },
      { specifier: 'node:net', kind: 'dynamic' },
      { specifier: 'node:child_process', kind: 'require' },
    ],
  )
  assert.deepEqual(
    analysis.imports.map((item) => item.index),
    [...analysis.imports.map((item) => item.index)].sort((a, b) => a - b),
  )
  assert.deepEqual(analysis.capabilities, ['filesystem', 'unknown', 'network', 'process'])
  assert.equal(analysis.dynamic, true)
})

test('analyzeAst detects process.env, fs/child_process members, eval and network calls', () => {
  const code = [
    'const token = process.env.TOKEN',
    'const fallback = process["env"].FALLBACK',
    "fs.readFileSync('x')",
    "child_process.exec('x')",
    "eval('1')",
    "new Function('return 1')",
    "fetch('https://example.com')",
    "http.request('http://example.com')",
    "https.request('https://example.com')",
  ].join('\n')

  const analysis = analyzeAst(code)

  assert.deepEqual(analysis.capabilities, ['env', 'filesystem', 'process', 'eval', 'network'])
  assert.deepEqual(
    analysis.observations.map((item) => item.evidence),
    [
      'process.env',
      "process['env']",
      'fs.readFileSync',
      'child_process.exec',
      'eval()',
      'new Function()',
      'fetch()',
      'http.request()',
      'https.request()',
    ],
  )
  assert.equal(analysis.dynamic, false)
  assert.ok(analysis.observations.every((item) => item.origin === 'code'))
})

test('analyzeAst ignores eval/fetch-shaped properties and non-process env fields', () => {
  const code = [
    'const calculator = { eval: (value) => Number(value) }',
    'const machine = { env: "test" }',
    "calculator.eval('1 + 1')",
    "calculator.fetch('https://example.com')",
    'machine.env.length',
  ].join('\n')

  assert.deepEqual(analyzeAst(code).capabilities, [])
})

test('analyzeAst flags runtime module loading and only records literal specifiers', () => {
  const code = [
    'const computed = await import(name)',
    'const computedCjs = require(name)',
    "const fs = await import('node:fs')",
    'const http = require("node:http")',
  ].join('\n')

  const analysis = analyzeAst(code)

  assert.equal(analysis.dynamic, true)
  assert.deepEqual(
    analysis.imports.map(({ specifier, kind }) => ({ specifier, kind })),
    [
      { specifier: 'node:fs', kind: 'dynamic' },
      { specifier: 'node:http', kind: 'require' },
    ],
  )
  assert.deepEqual(analysis.capabilities, ['filesystem', 'network'])

  // A literal import() is still runtime loading, hence dynamic=true.
  assert.equal(analyzeAst("import('node:fs')").dynamic, true)
  assert.equal(analyzeAst("require('node:fs')").dynamic, false)
})

test('analyzeAst parses hashbangs and sloppy CommonJS through the script retry', () => {
  const code = [
    '#!/usr/bin/env node',
    "const fs = require('node:fs')",
    'with (Math) { round(1.2) }',
    'module.exports = fs',
  ].join('\n')

  const analysis = analyzeAst(code, { filename: 'legacy.cjs' })

  assert.equal(analysis.parseError, undefined)
  assert.deepEqual(
    analysis.imports.map(({ specifier, kind }) => ({ specifier, kind })),
    [{ specifier: 'node:fs', kind: 'require' }],
  )
  assert.deepEqual(analysis.capabilities, ['filesystem'])
})

test('analyzeAst returns parseError for invalid JavaScript and TypeScript syntax', () => {
  const invalid = analyzeAst('const = 1')
  assert.ok(invalid.parseError)
  assert.equal(invalid.parseError.filename, null)
  assert.equal(typeof invalid.parseError.message, 'string')
  assert.equal(invalid.parseError.line, 1)
  assert.deepEqual(invalid.capabilities, [])

  const typescript = analyzeAst('interface Box { value: string }\nconst box: Box = { value: "x" }', {
    filename: 'src/index.ts',
  })
  assert.ok(typescript.parseError)
  assert.equal(typescript.parseError.filename, 'src/index.ts')
  assert.deepEqual(typescript.imports, [])
})

test('analyzeSource falls back to the regex scanner when parsing fails', () => {
  const code = [
    "import fs from 'node:fs'",
    'const broken = 1 = 2',
    'const cp = require("node:child_process")',
    'process.env.HOME',
  ].join('\n')

  assert.ok(analyzeAst(code).parseError, 'the sample must be unparseable for this test')

  const fallback = analyzeSource(code, 'src/broken.js')
  const oracle = regexAnalysis(code)

  assert.deepEqual(fallback.capabilities, oracle.capabilities)
  assert.deepEqual(fallback.imports, oracle.imports)
  assert.deepEqual(fallback.observations, oracle.observations)
  assert.deepEqual(fallback.capabilities, ['filesystem', 'process', 'env'])
})

test('analyzeSource keeps the pre-AST return shape and evidence lines', () => {
  const analysis = analyzeSource("import fs from 'node:fs'\nprocess.env.HOME", 'src/a.js')

  assert.deepEqual(Object.keys(analysis).sort(), [
    'capabilities',
    'file',
    'imports',
    'observations',
  ])
  assert.equal(analysis.file, 'src/a.js')
  assert.deepEqual(analysis.capabilities, ['filesystem', 'env'])
  assert.equal(analysis.observations.find((item) => item.capability === 'env').line, 2)
})

test('AST and regex agree on common static samples', () => {
  const samples = [
    "import fs from 'node:fs'\nprocess.env.HOME",
    "const cp = require('node:child_process')",
    "export { x } from 'node:net'",
    "export * from 'node:crypto'",
    "const m = await import('node:fs/promises')",
    "eval('1')\nnew Function('return 1')",
    "// import fs from 'node:fs'\nconst text = \"require('node:fs')\"",
    "import { readFile } from 'node:fs/promises'\nreadFile(process.env.CONFIG)",
  ]

  for (const code of samples) {
    const ast = analyzeAst(code)
    const oracle = regexAnalysis(code)
    assert.equal(ast.parseError, undefined)
    assert.deepEqual(ast.capabilities, oracle.capabilities, code)
    assert.deepEqual(
      ast.imports.map(({ specifier, kind }) => ({ specifier, kind })),
      oracle.imports.map(({ specifier, kind }) => ({ specifier, kind })),
      code,
    )
  }
})

test('AST path covers constructs the regex scanner misses', () => {
  const samples = [
    { code: 'const key = `token:${process.env.TOKEN}`', capability: 'env' },
    { code: "fetch('https://example.com')", capability: 'network' },
    { code: "http.request('http://example.com')", capability: 'network' },
    { code: 'fs.readFileSync("x")', capability: 'filesystem' },
  ]

  for (const { code, capability } of samples) {
    assert.deepEqual(mapCapabilities([], code), [], `regex should miss: ${code}`)
    assert.ok(analyzeAst(code).capabilities.includes(capability), `AST should see: ${code}`)
  }
})

test('analyzeAst parses every benchmark fixture and keeps known AST detections', async () => {
  const entries = await readdir(FIXTURE_ROOT, { withFileTypes: true })
  const fixtureIds = entries
    .filter((entry) => entry.isDirectory() && entry.name !== 'real')
    .map((entry) => entry.name)
    .sort()

  assert.ok(fixtureIds.length >= 12)
  const detectedById = new Map()

  for (const id of fixtureIds) {
    const srcDir = join(FIXTURE_ROOT, id, 'src')
    const files = (await readdir(srcDir)).filter((file) => /\.(?:js|mjs|cjs)$/.test(file))
    assert.ok(files.length > 0, `${id} has no source files`)

    const capabilities = []
    for (const file of files) {
      const code = await readFile(join(srcDir, file), 'utf8')
      const analysis = analyzeAst(code, { filename: `${id}/src/${file}` })
      assert.equal(analysis.parseError, undefined, `${id}/src/${file}: ${analysis.parseError?.message}`)
      for (const capability of analysis.capabilities) {
        if (!capabilities.includes(capability)) capabilities.push(capability)
      }
    }
    detectedById.set(id, capabilities.sort())
  }

  assert.deepEqual(detectedById.get('08-obfuscated-concat'), ['filesystem'])
  assert.deepEqual(detectedById.get('09-obfuscated-eval'), [])
  assert.deepEqual(detectedById.get('13-fp-unmapped-builtin'), ['unknown'])
  assert.deepEqual(detectedById.get('17-global-fetch'), ['network'])
  assert.deepEqual(detectedById.get('16-multi-undeclared'), [
    'env',
    'filesystem',
    'network',
    'process',
  ])
})
