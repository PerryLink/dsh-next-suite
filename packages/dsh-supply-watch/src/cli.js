#!/usr/bin/env node
/**
 * dsh-supply-watch CLI.
 *
 * Argument parsing and I/O live here; all heuristics live in `core.js` so they
 * can be tested without spawning a process or touching the network.
 */
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { DISCLAIMER, severityOf, watch } from './core.js'

const HELP = `dsh-supply-watch - offline npm name and version heuristics

Usage:
  dsh-supply-watch check <name> [--known a,b,...] [--versions x,y,...] [--json]
  dsh-supply-watch scan <names.txt> [--known a,b,...] [--json]
  dsh-supply-watch --help
  dsh-supply-watch --version

Commands:
  check    Score one package name and, optionally, its publication history.
  scan     Read package names from a file (one per line).

Options:
  -h, --help      Show this help and exit.
  -V, --version   Show version and exit.
      --known     Comma-separated trusted/known package names.
      --versions  Comma-separated published versions, oldest first (check only).
      --json      Emit machine-readable JSON.

Input file format (scan):
  # blank lines and comments are ignored
  dsh-core
  dsh-cli 1.0.0,1.0.2,99.0.0

  Each line is a package name, optionally followed by whitespace and a
  comma-separated version history. This tool never calls a registry, so the
  known-name list must be supplied by the caller.

Safety:
  Findings are heuristic leads, not proof. Absence of findings is not a
  safety verdict. This tool does not replace an SCA scanner, advisory data,
  registry ownership checks, or tarball inspection.

Exit codes:
  0  check/scan completed (even when findings exist)
  1  unused: findings are not a business-negative result
  2  usage, input, or IO error
`

/**
 * @param {string | undefined} value
 * @returns {string[]}
 */
function splitList(value) {
  if (!value) return []
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * @param {string} text
 * @returns {{ name: string, versions: string[] }[]}
 */
function parseNamesFile(text) {
  /** @type {{ name: string, versions: string[] }[]} */
  const entries = []

  for (const rawLine of String(text).split(/\r?\n/)) {
    let line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const commentAt = line.indexOf(' #')
    if (commentAt !== -1) line = line.slice(0, commentAt).trim()
    if (!line) continue

    const parts = line.split(/\s+/)
    const name = parts.shift()
    if (!name) continue

    const versions = parts
      .join(',')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)

    entries.push({ name, versions })
  }

  return entries
}

/**
 * @param {import('./core.js').WatchFinding[]} findings
 * @returns {string}
 */
function summaryLine(findings) {
  const counts = { high: 0, medium: 0, low: 0 }
  for (const finding of findings) counts[severityOf(finding)] += 1
  return `${findings.length} finding(s): ${counts.high} high, ${counts.medium} medium, ${counts.low} low`
}

/**
 * @param {import('./core.js').WatchFinding[]} findings
 */
function printFindings(findings) {
  for (const finding of findings) {
    const severity = severityOf(finding).toUpperCase()
    if (finding.kind === 'typosquat') {
      console.log(
        `[${severity}] typosquat "${finding.name}" -> nearest "${finding.nearest}" ` +
          `(distance ${finding.distance}): ${finding.reason} (score ${finding.score})`,
      )
    } else {
      console.log(
        `[${severity}] version "${finding.name}" [${finding.code}]: ` +
          `${finding.reason} (score ${finding.score})`,
      )
    }
  }
}

/**
 * @param {string} message
 * @returns {number}
 */
function usageError(message) {
  console.error(`dsh-supply-watch: ${message}`)
  console.error('Run "dsh-supply-watch --help" for usage.')
  return 2
}

/**
 * @param {import('node:util').ParseArgsConfig['options']} options
 */
async function main(options) {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options,
  })

  if (values.help) {
    process.stdout.write(HELP)
    return 0
  }
  if (values.version) {
    console.log('dsh-supply-watch 0.1.0')
    return 0
  }

  const command = positionals[0]
  if (!command || command === 'help') {
    if (!command) {
      process.stderr.write(HELP)
      return 2
    }
    process.stdout.write(HELP)
    return 0
  }

  const known = splitList(values.known)

  if (command === 'check') {
    const name = positionals[1]
    if (!name || positionals.length > 2) {
      return usageError('check requires exactly one package name')
    }
    if (known.length === 0 && !values.json) {
      console.error(
        'note: no --known list supplied; typosquat checks are inactive (version checks only).',
      )
    }

    const versions = splitList(values.versions)
    const findings = watch([{ name, versions }], known)

    if (values.json) {
      console.log(
        JSON.stringify(
          {
            command: 'check',
            ok: true,
            name,
            knownCount: known.length,
            versions,
            findings,
            disclaimer: DISCLAIMER,
          },
          null,
          2,
        ),
      )
      return 0
    }

    console.log(`dsh-supply-watch check: ${name}`)
    console.log(`known names: ${known.length}`)
    if (versions.length > 0) console.log(`versions: ${versions.join(', ')}`)
    console.log('')
    printFindings(findings)
    console.log('')
    console.log(summaryLine(findings))
    if (findings.length === 0) {
      console.log('No heuristic findings. This is not a safety verdict.')
    }
    return 0
  }

  if (command === 'scan') {
    const file = positionals[1]
    if (!file || positionals.length > 2) {
      return usageError('scan requires exactly one input file')
    }

    let text
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`dsh-supply-watch: cannot read "${file}": ${message}`)
      return 2
    }

    const entries = parseNamesFile(text)
    const findings = watch(entries, known)
    if (known.length === 0 && !values.json) {
      console.error(
        'note: no --known list supplied; typosquat checks are inactive (version checks only).',
      )
    }

    if (values.json) {
      console.log(
        JSON.stringify(
          {
            command: 'scan',
            ok: true,
            scanned: entries.length,
            knownCount: known.length,
            findings,
            disclaimer: DISCLAIMER,
          },
          null,
          2,
        ),
      )
      return 0
    }

    console.log(`dsh-supply-watch scan: ${file}`)
    console.log(`scanned: ${entries.length} package name(s)`)
    console.log(`known names: ${known.length}`)
    console.log('')
    printFindings(findings)
    console.log('')
    console.log(summaryLine(findings))
    if (findings.length === 0) {
      console.log('No heuristic findings. This is not a safety verdict.')
    }
    return 0
  }

  return usageError(`unknown command "${command}"`)
}

/** @type {import('node:util').ParseArgsConfig['options']} */
const OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'V' },
  json: { type: 'boolean' },
  known: { type: 'string' },
  versions: { type: 'string' },
}

let code = 2
try {
  code = await main(OPTIONS)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  code = usageError(message)
}
if (code !== 0) process.exitCode = code
