#!/usr/bin/env node
// @benchmark-real-fixture
// Source: dsh-next-suite/packages/dsh-upgrade-atlas/src/cli.js lines 1-148
// License: Apache-2.0; see benchmarks/capdiff/fixtures/real/SOURCES.md
// Trimmed at a complete top-level statement boundary; code otherwise unchanged.

/**
 * CLI for `dsh-upgrade-atlas`.
 *
 * This module only parses arguments and performs I/O. Validation, querying,
 * rendering, and counting live in `core.js`.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import {
  AtlasError,
  KINDS,
  SCHEMA_VERSION,
  SEVERITIES,
  addEntry,
  createAtlas,
  query,
  renderMarkdown,
  stats,
  validateEntry,
} from './core.js'

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)
const NAME = packageJson.name
const VERSION = packageJson.version
const DEFAULT_DATA = fileURLToPath(new URL('../data/atlas.json', import.meta.url))

const FILTER_KEYS = ['package', 'from', 'to', 'severity', 'kind']
const COMMANDS = new Set(['list', 'query', 'render', 'stats', 'add'])

const OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'V' },
  json: { type: 'boolean' },
  data: { type: 'string' },
  package: { type: 'string' },
  from: { type: 'string' },
  to: { type: 'string' },
  severity: { type: 'string' },
  kind: { type: 'string' },
  file: { type: 'string' },
  out: { type: 'string' },
}

/**
 * @param {string} text
 * @returns {string}
 */
function trimTrailing(text) {
  return text.replace(/\s+$/, '')
}

/**
 * @returns {string}
 */
function helpText() {
  return trimTrailing(`
${NAME} ${VERSION}

Community-maintained and unofficial atlas of DeepSeek Harness (DSH) upgrade breakpoints.
Not affiliated with DeepSeek.

Usage:
  ${NAME} <command> [options]

Commands:
  list      List entries, optionally filtered
  query     Query entries by package, version window, severity, or kind
  render    Render Markdown grouped by severity
  stats     Count entries by severity and kind
  add       Add one entry from JSON (--file or stdin)

Options:
  --data <path>       Atlas JSON (default: bundled data/atlas.json)
  --package <prefix>  Package-name prefix
  --from <version>    Window start (inclusive, prefix-aware)
  --to <version>      Window end (inclusive, prefix-aware)
  --severity <level>  Severity prefix: P0, P1, P2, or P3
  --kind <kind>       Kind prefix (see below)
  --file <path>       Entry JSON for add; "-" reads stdin
  --out <path>        Write render output to a file; "-" writes stdout
  --json              Machine-readable output
  -h, --help          Show help
  -V, --version       Show version

Kinds (recommended): ${KINDS.join(', ')}
Severities: P0 (blocks upgrade), P1 (breaks a workflow), P2 (degraded),
            P3 (wording or UI only)

Examples:
  ${NAME} list --severity P0
  ${NAME} query --package @deepseek-ai/dsh-office --from 0.2.1 --to 0.2.2 --json
  ${NAME} render --out UPGRADE.md
  ${NAME} add --data ./atlas.json --file ./breakpoint.json

Exit codes:
  0  command completed (including an empty query result)
  1  unused: no business-negative result
  2  usage, input, validation, or IO error
`)
}

/**
 * @param {string} command
 * @returns {string}
 */
function commandHelp(command) {
  const usage = {
    list: `Usage: ${NAME} list [filter options] [--json]\n\nLists matching entries. Same filters as query.`,
    query: `Usage: ${NAME} query [filter options] [--json]\n\nFilters:\n  --package <prefix>  Package-name prefix\n  --from <version>    Window start (inclusive, prefix-aware)\n  --to <version>      Window end (inclusive, prefix-aware)\n  --severity <level>  P0, P1, P2, or P3 (prefix allowed)\n  --kind <kind>       Entry kind (prefix allowed)`,
    render: `Usage: ${NAME} render [filter options] [--out <path>] [--json]\n\nRenders Markdown grouped by severity. With --json, prints { command, ok, total, markdown }; with --out, writes the Markdown file instead.`,
    stats: `Usage: ${NAME} stats [filter options] [--json]\n\nCounts entries by severity and kind. Zero-count buckets are included.`,
    add: `Usage: ${NAME} add (--file <path> | < entry.json) [--data <path>] [--json]\n\nValidates and appends one entry. Duplicate ids fail. If --data does not exist, an empty atlas is created.`,
  }
  const data = usage[command]
  if (data === undefined) return helpText()
  return trimTrailing(`${data}\n\nShared options:\n  --data <path>  Atlas JSON\n  --json         Machine-readable output\n  -h, --help     Show this help`)
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
  if (error instanceof AtlasError) return `${NAME}: ${error.message}`
  if (error instanceof Error) return `${NAME}: ${error.message}`
  return `${NAME}: ${String(error)}`
}

/**
 * @param {unknown} error
 */
function reportError(error) {
  console.error(errorMessage(error))
  if (error instanceof AtlasError && Array.isArray(error.issues)) {
    for (const issue of error.issues) console.error(`  - ${issue}`)
  }
  if (error instanceof AtlasError && error.code === 'USAGE') {
    console.error(`Run "${NAME} --help" for usage.`)
  }
}
