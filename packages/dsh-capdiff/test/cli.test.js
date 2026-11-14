import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url))

/**
 * @param {import('node:test').TestContext} t
 * @returns {Promise<string>}
 */
async function makeTempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-capdiff-cli-'))
  t.after(async () => {
    const absolute = resolve(dir)
    const tempRoot = resolve(tmpdir())
    if (!absolute.startsWith(tempRoot + sep)) {
      throw new Error(`refusing to remove test directory outside tmpdir: ${absolute}`)
    }
    await rm(absolute, { recursive: true, force: true })
  })
  return dir
}

/**
 * @param {string[]} args
 * @returns {Promise<{ code: number|null, signal: NodeJS.Signals|null, stdout: string, stderr: string }>}
 */
function runCli(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
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
    child.on('close', (code, signal) => {
      resolvePromise({ code, signal, stdout, stderr })
    })
  })
}

/**
 * @param {string} dir
 * @returns {Promise<{ manifest: string }>}
 */
async function buildCliProject(dir) {
  await mkdir(join(dir, 'src'), { recursive: true })
  const manifest = join(dir, 'plugin.json')
  await writeFile(
    manifest,
    JSON.stringify({ dsh: { capabilities: ['filesystem', 'network', 'crypto'] } }, null, 2),
  )
  await writeFile(
    join(dir, 'src', 'index.js'),
    "import fs from 'node:fs'\nexport const home = process.env.HOME\n",
  )
  return { manifest }
}

test('CLI --help exits 0 and documents the flags and heuristic warning', async () => {
  const result = await runCli(['--help'])
  assert.equal(result.code, 0)
  assert.equal(result.signal, null)
  assert.match(result.stdout, /Usage: dsh-capdiff <file-or-dir> \[options\]/)
  assert.match(result.stdout, /--manifest <path>/)
  assert.match(result.stdout, /--json/)
  assert.match(result.stdout, /--sarif/)
  assert.match(result.stdout, /not\s+proof that a plugin is safe/i)
})

test('CLI --version prints the package version', async () => {
  const result = await runCli(['--version'])
  assert.equal(result.code, 0)
  assert.equal(result.stdout.trim(), `dsh-capdiff ${pkg.version}`)
})

test('CLI --json reports declared, actual and diff for a directory', async (t) => {
  const dir = await makeTempDir(t)
  const { manifest } = await buildCliProject(dir)

  const result = await runCli([dir, '--manifest', manifest, '--json'])
  assert.equal(result.code, 0)
  assert.equal(result.signal, null)

  const report = JSON.parse(result.stdout)
  assert.equal(report.tool, 'dsh-capdiff')
  assert.equal(report.version, pkg.version)
  assert.equal(report.target, resolve(dir))
  assert.equal(report.manifest, resolve(manifest))
  assert.equal(report.filesScanned, 1)
  assert.deepEqual(report.declared, ['filesystem', 'network', 'crypto'])
  assert.deepEqual(report.actual, ['filesystem', 'env'])
  assert.deepEqual(report.diff, {
    matched: ['filesystem'],
    undeclared: ['env'],
    unused: ['network', 'crypto'],
  })
  assert.equal(report.findings.length, 3)
  assert.equal(report.findings[0].kind, 'undeclared')
  assert.equal(report.findings[0].capability, 'env')
  assert.equal(report.findings[0].file, 'src/index.js')
  assert.equal(report.findings[0].line, 2)
})

test('CLI --sarif emits a SARIF 2.1.0 log with locations', async (t) => {
  const dir = await makeTempDir(t)
  const { manifest } = await buildCliProject(dir)

  const result = await runCli([dir, '--manifest', manifest, '--sarif'])
  assert.equal(result.code, 0)
  assert.equal(result.signal, null)

  const sarif = JSON.parse(result.stdout)
  assert.equal(sarif.version, '2.1.0')
  assert.equal(sarif.runs.length, 1)

  const run = sarif.runs[0]
  assert.equal(run.tool.driver.name, 'dsh-capdiff')
  assert.equal(run.results.length, 3)
  assert.deepEqual(
    run.tool.driver.rules.map((rule) => rule.id),
    ['dsh-capdiff/undeclared', 'dsh-capdiff/unused'],
  )
  assert.equal(run.results[0].ruleId, 'dsh-capdiff/undeclared')
  assert.equal(
    run.results[0].locations[0].physicalLocation.artifactLocation.uri,
    'src/index.js',
  )
  assert.equal(run.results[0].locations[0].physicalLocation.region.startLine, 2)
  assert.match(run.results[0].message.text, /env/)
})

test('CLI rejects an invalid manifest with exit code 2', async (t) => {
  const dir = await makeTempDir(t)
  const manifest = join(dir, 'plugin.json')
  await writeFile(manifest, '{ this is not json')
  await writeFile(join(dir, 'index.js'), "import fs from 'node:fs'\n")

  const result = await runCli([dir, '--manifest', manifest, '--json'])
  assert.equal(result.code, 2)
  assert.equal(result.signal, null)
  assert.match(result.stderr, /not valid JSON/)
})

test('CLI rejects --json together with --sarif', async (t) => {
  const dir = await makeTempDir(t)
  const result = await runCli([dir, '--json', '--sarif'])
  assert.equal(result.code, 2)
  assert.match(result.stderr, /either --json or --sarif/)
})
