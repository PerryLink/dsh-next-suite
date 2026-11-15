#!/usr/bin/env node
// @benchmark-real-fixture
// Source: dsh-next-suite/packages/cordis-migrate/src/cli.js lines 1-125
// License: Apache-2.0; see benchmarks/capdiff/fixtures/real/SOURCES.md
// Trimmed at a complete top-level statement boundary; code otherwise unchanged.

/**
 * CLI wrapper for cordis-migrate.
 *
 * Only argument parsing and filesystem IO live here; all matching/planning
 * logic is in `core.js` and is unit-tested without touching disk.
 *
 * Safety defaults:
 * - `apply` is dry-run unless `--write` is passed explicitly.
 * - `scan` never writes.
 * - known binary files / NUL-containing files / invalid UTF-8 are skipped.
 * - no network, no git commands, no third-party dependencies.
 */
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { RULES, RULES_NOTICE, applySource, decodeTextContent, formatPlan, plan } from './core.js'
import { formatRules } from './rules.js'

const USAGE = `cordis-migrate — Cordis 3→4 migration rule engine (unofficial)

⚠️ Built-in rules are community-curated, not an official migration table.
   Some rules are experimental. Review every proposed edit before using --write.

用法 / Usage:
  cordis-migrate scan <dir|file> [--json]
  cordis-migrate apply <dir|file> [--dry-run | --write] [--json]
  cordis-migrate rules [--json]
  cordis-migrate --help
  cordis-migrate --version

Commands:
  scan     Report rule matches. Never writes files.
  apply    Plan and optionally apply fixes. Defaults to --dry-run.
  rules    List built-in rules, kinds, severity, evidence and experimental flags.

Options:
  --json      Print machine-readable JSON on stdout.
  --dry-run   Show the plan without writing (the apply default).
  --write     Write proposed edits to disk. Must be passed explicitly.
  -h, --help  Show this help.
  -V, --version  Show version.

Exit codes:
  0  success (including "matches found" from scan)
  1  unused: matches are not a business-negative result
  2  usage, input, unreadable target, or write failure

Limits:
  - Rules are line-oriented regular expressions, not an AST.
  - Files with binary extensions, NUL bytes, or invalid UTF-8 are skipped.
  - Symlinks and common build/VCS directories are not traversed.
  - This tool never commits, pushes, or edits the Cordis repository for you.`

/** Directories that are almost never migration targets. */
const IGNORED_DIRS = new Set([
  '.cache',
  '.git',
  '.next',
  '.output',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
])

/** Lockfiles and generated files: scanning them creates noise and risky writes. */
const IGNORED_FILES = new Set([
  '.DS_Store',
  'bun.lockb',
  'npm-shrinkwrap.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
])

/**
 * Locale-independent comparator so plans are reproducible across machines.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareNames(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

/** @param {string} name */
function isIgnoredGeneratedFile(name) {
  return /\.min\.(?:js|mjs|cjs)$/.test(name) || name.endsWith('.map')
}

/**
 * @param {string} target absolute path
 * @returns {Promise<string[]>} absolute file paths, sorted for determinism
 */
async function collectFiles(target) {
  const stat = await lstat(target)
  if (stat.isSymbolicLink()) throw new Error(`refusing to follow symlink: ${target}`)
  if (stat.isFile()) return [target]
  if (!stat.isDirectory()) throw new Error(`not a file or directory: ${target}`)

  /** @type {string[]} */
  const files = []
  /** @param {string} dir */
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true })
    entries.sort((a, b) => compareNames(a.name, b.name))
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await walk(full)
        continue
      }
      if (!entry.isFile()) continue
      if (IGNORED_FILES.has(entry.name)) continue
      if (isIgnoredGeneratedFile(entry.name)) continue
      files.push(full)
    }
  }
  await walk(target)
  files.sort(compareNames)
  return files
}
