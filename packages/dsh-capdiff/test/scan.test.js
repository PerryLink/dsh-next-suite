import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'

import { collectSourceFiles, scanTarget } from '../src/core.js'

/**
 * @param {import('node:test').TestContext} t
 * @returns {Promise<string>}
 */
async function makeTempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-capdiff-test-'))
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
 * Build a small project with nested sources and directories that must be
 * skipped.
 *
 * @param {string} dir
 */
async function buildProject(dir) {
  await mkdir(join(dir, 'src', 'nested'), { recursive: true })
  await mkdir(join(dir, 'node_modules', 'evil'), { recursive: true })
  await mkdir(join(dir, '.git', 'hooks'), { recursive: true })

  await writeFile(
    join(dir, 'src', 'index.js'),
    "import fs from 'node:fs'\nexport const home = process.env.HOME\n",
  )
  await writeFile(
    join(dir, 'src', 'nested', 'net.mjs'),
    "import net from 'node:net'\nexport { net }\n",
  )
  await writeFile(
    join(dir, 'src', 'legacy.cjs'),
    "const cp = require('node:child_process')\nmodule.exports = cp\n",
  )
  await writeFile(join(dir, 'src', 'notes.txt'), "require('node:fs')\n")
  await writeFile(join(dir, 'node_modules', 'evil', 'index.js'), "require('node:crypto')\n")
  await writeFile(join(dir, '.git', 'hooks', 'post-checkout.js'), "eval('nope')\n")
}

test('collectSourceFiles recurses, filters extensions and skips node_modules/.git', async (t) => {
  const dir = await makeTempDir(t)
  await buildProject(dir)

  const files = await collectSourceFiles(dir)
  const rel = files.map((file) => relative(dir, file).replaceAll(sep, '/'))
  assert.deepEqual(rel, ['src/index.js', 'src/legacy.cjs', 'src/nested/net.mjs'])

  const explicit = await collectSourceFiles(join(dir, 'src', 'index.js'))
  assert.deepEqual(explicit, [resolve(dir, 'src', 'index.js')])

  const ignored = await collectSourceFiles(join(dir, 'src', 'notes.txt'))
  assert.deepEqual(ignored, [])
})

test('scanTarget aggregates capabilities and first evidence across files', async (t) => {
  const dir = await makeTempDir(t)
  await buildProject(dir)

  const report = await scanTarget(dir)
  assert.equal(report.files.length, 3)
  assert.deepEqual(report.files.map((file) => file.file).sort(), [
    'src/index.js',
    'src/legacy.cjs',
    'src/nested/net.mjs',
  ])
  assert.deepEqual(
    [...report.capabilities].sort(),
    ['env', 'filesystem', 'network', 'process'].sort(),
  )

  assert.equal(report.firstEvidence.filesystem.file, 'src/index.js')
  assert.equal(report.firstEvidence.filesystem.line, 1)
  assert.equal(report.firstEvidence.env.file, 'src/index.js')
  assert.equal(report.firstEvidence.env.line, 2)
  assert.equal(report.firstEvidence.network.file, 'src/nested/net.mjs')
  assert.equal(report.firstEvidence.process.file, 'src/legacy.cjs')

  // The ignored trees must not leak crypto/eval into the aggregate.
  assert.equal(report.capabilities.includes('crypto'), false)
  assert.equal(report.capabilities.includes('eval'), false)
})

test('scanTarget reports an empty scan for a directory without sources', async (t) => {
  const dir = await makeTempDir(t)
  await mkdir(join(dir, 'empty'), { recursive: true })

  const report = await scanTarget(join(dir, 'empty'))
  assert.deepEqual(report.files, [])
  assert.deepEqual(report.capabilities, [])
})
