#!/usr/bin/env node
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

/**
 * @param {string} value
 * @returns {string}
 */
function dataPath(value) {
  return value === undefined ? DEFAULT_DATA : resolve(process.cwd(), value)
}

/**
 * @param {Record<string, unknown>} values
 * @returns {Record<string, string>}
 */
function filtersFrom(values) {
  /** @type {Record<string, string>} */
  const filters = {}
  for (const key of FILTER_KEYS) {
    const value = values[key]
    if (value !== undefined) filters[key] = String(value)
  }
  return filters
}

/**
 * @param {string} filePath
 * @param {{allowMissing?: boolean}} [options]
 * @returns {Promise<any>}
 */
async function readAtlas(filePath, options = {}) {
  let text
  try {
    text = await readFile(filePath, 'utf8')
  } catch (error) {
    if (options.allowMissing === true && error?.code === 'ENOENT') {
      return createAtlas([])
    }
    throw new AtlasError('IO', `cannot read ${filePath}: ${error.message}`)
  }

  let data
  try {
    data = JSON.parse(text)
  } catch (error) {
    throw new AtlasError('INVALID_ATLAS', `invalid JSON in ${filePath}: ${error.message}`)
  }

  if (Array.isArray(data)) {
    try {
      return createAtlas(data)
    } catch (error) {
      if (error instanceof AtlasError) {
        const wrapped = new AtlasError(
          error.code,
          `${filePath}: ${error.message}`,
          error.details,
        )
        if (error.issues) wrapped.issues = error.issues
        throw wrapped
      }
      throw error
    }
  }

  if (typeof data !== 'object' || data === null || !Array.isArray(data.entries)) {
    throw new AtlasError(
      'INVALID_ATLAS',
      `${filePath} must contain an "entries" array`,
    )
  }
  if (data.schemaVersion !== undefined && data.schemaVersion !== SCHEMA_VERSION) {
    throw new AtlasError(
      'INVALID_ATLAS',
      `${filePath} uses unsupported schemaVersion ${data.schemaVersion}`,
    )
  }

  try {
    return { ...data, ...createAtlas(data.entries) }
  } catch (error) {
    if (error instanceof AtlasError) {
      const wrapped = new AtlasError(
        error.code,
        `${filePath}: ${error.message}`,
        error.details,
      )
      if (error.issues) wrapped.issues = error.issues
      throw wrapped
    }
    throw error
  }
}

/**
 * @param {unknown[]} entries
 * @param {boolean} json
 */
function printEntries(entries, json, command) {
  if (json) {
    console.log(
      JSON.stringify({ command, ok: true, entries, count: entries.length }, null, 2),
    )
    return
  }
  if (entries.length === 0) {
    console.log('No entries.')
    return
  }
  for (const entry of entries) {
    const summary = String(entry.summary).replace(/\s+/g, ' ')
    console.log(
      `${entry.severity} | ${entry.package} | ${entry.from} -> ${entry.to} | ${entry.kind} | ${entry.id} | ${summary}`,
    )
  }
}

/**
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function readEntryInput(filePath) {
  if (filePath !== undefined && filePath !== '-') {
    try {
      return await readFile(resolve(process.cwd(), filePath), 'utf8')
    } catch (error) {
      throw new AtlasError('IO', `cannot read ${filePath}: ${error.message}`)
    }
  }

  if (process.stdin.isTTY) {
    throw new AtlasError(
      'INVALID_INPUT',
      'provide --file <path> or pipe one JSON entry on stdin',
    )
  }

  /** @type {Buffer[]} */
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim().length === 0) {
    throw new AtlasError('INVALID_INPUT', 'no entry JSON on stdin')
  }
  return text
}

/**
 * @param {Record<string, unknown>} values
 */
async function commandAdd(values) {
  const source = await readEntryInput(
    values.file === undefined ? undefined : String(values.file),
  )

  let entry
  try {
    entry = JSON.parse(source)
  } catch (error) {
    throw new AtlasError('INVALID_INPUT', `entry is not valid JSON: ${error.message}`)
  }
  if (
    typeof entry === 'object' &&
    entry !== null &&
    !Array.isArray(entry) &&
    entry.id === undefined &&
    typeof entry.entry === 'object' &&
    entry.entry !== null
  ) {
    entry = entry.entry
  }

  // Validate before touching the atlas file so `add` never writes partial data.
  validateEntry(entry)

  const file = dataPath(
    values.data === undefined ? undefined : String(values.data),
  )
  const atlas = await readAtlas(file, { allowMissing: true })
  const next = addEntry(atlas, entry)
  const entries = Array.isArray(next) ? next : next.entries
  const saved = Array.isArray(next)
    ? { schemaVersion: SCHEMA_VERSION, entries }
    : next

  try {
    await writeFile(file, `${JSON.stringify(saved, null, 2)}\n`, 'utf8')
  } catch (error) {
    throw new AtlasError('IO', `cannot write ${file}: ${error.message}`)
  }

  const added = entries[entries.length - 1]
  if (values.json === true) {
    console.log(
      JSON.stringify(
        { command: 'add', ok: true, added: added.id, total: entries.length, data: file },
        null,
        2,
      ),
    )
  } else {
    console.log(`added ${added.id} to ${file} (${entries.length} entries)`)
  }
}

/**
 * @param {Record<string, unknown>} values
 */
async function commandRender(values) {
  const file = dataPath(
    values.data === undefined ? undefined : String(values.data),
  )
  const atlas = await readAtlas(file)
  const entries = query(atlas, filtersFrom(values))
  const markdown = renderMarkdown(entries)

  let out = null
  if (values.out !== undefined && String(values.out) !== '-') {
    out = resolve(process.cwd(), String(values.out))
    try {
      await writeFile(out, markdown, 'utf8')
    } catch (error) {
      throw new AtlasError('IO', `cannot write ${out}: ${error.message}`)
    }
  }

  if (values.json === true) {
    console.log(
      JSON.stringify(
        out === null
          ? { command: 'render', ok: true, total: entries.length, markdown }
          : { command: 'render', ok: true, total: entries.length, out },
        null,
        2,
      ),
    )
    return
  }
  if (out !== null) {
    console.log(`wrote ${out} (${entries.length} entries)`)
    return
  }
  process.stdout.write(markdown)
}

/**
 * @param {Record<string, unknown>} values
 */
async function commandStats(values) {
  const file = dataPath(
    values.data === undefined ? undefined : String(values.data),
  )
  const atlas = await readAtlas(file)
  const result = stats(query(atlas, filtersFrom(values)))

  if (values.json === true) {
    console.log(JSON.stringify({ command: 'stats', ok: true, ...result }, null, 2))
    return
  }

  console.log(`total: ${result.total}`)
  for (const severity of SEVERITIES) {
    console.log(`${severity}: ${result.bySeverity[severity]}`)
  }
  for (const kind of KINDS) {
    console.log(`${kind}: ${result.byKind[kind]}`)
  }
}

/**
 * @param {string} command
 * @param {Record<string, unknown>} values
 */
async function runCommand(command, values) {
  if (command === 'add') {
    await commandAdd(values)
    return
  }
  if (command === 'render') {
    await commandRender(values)
    return
  }
  if (command === 'stats') {
    await commandStats(values)
    return
  }

  const file = dataPath(
    values.data === undefined ? undefined : String(values.data),
  )
  const atlas = await readAtlas(file)
  printEntries(query(atlas, filtersFrom(values)), values.json === true, command)
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: OPTIONS,
  })

  if (values.version === true) {
    console.log(`${NAME} ${VERSION}`)
    return
  }

  const command = positionals[0]
  if (values.help === true) {
    console.log(command !== undefined && COMMANDS.has(command) ? commandHelp(command) : helpText())
    return
  }
  if (command === undefined) {
    console.error(helpText())
    process.exitCode = 2
    return
  }
  if (!COMMANDS.has(command)) {
    throw new AtlasError('USAGE', `unknown command: ${command}`, {
      issues: [`commands: ${[...COMMANDS].join(', ')}`],
    })
  }
  if (positionals.length > 1) {
    throw new AtlasError('USAGE', `unexpected argument: ${positionals[1]}`)
  }

  await runCommand(command, values)
}

try {
  await main()
} catch (error) {
  if (error?.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' || error?.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
    reportError(new AtlasError('USAGE', error.message))
  } else {
    reportError(error)
  }
  process.exitCode = 2
}
