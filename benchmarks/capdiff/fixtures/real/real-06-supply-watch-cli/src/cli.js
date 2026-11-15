#!/usr/bin/env node
// @benchmark-real-fixture
// Source: dsh-next-suite/packages/dsh-supply-watch/src/cli.js lines 1-133
// License: Apache-2.0; see benchmarks/capdiff/fixtures/real/SOURCES.md
// Trimmed at a complete top-level statement boundary; code otherwise unchanged.

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
