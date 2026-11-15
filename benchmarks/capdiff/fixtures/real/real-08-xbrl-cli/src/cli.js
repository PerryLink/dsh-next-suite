#!/usr/bin/env node
// @benchmark-real-fixture
// Source: dsh-next-suite/packages/dsh-xbrl/src/cli.js lines 1-96
// License: Apache-2.0; see benchmarks/capdiff/fixtures/real/SOURCES.md
// Trimmed at a complete top-level statement boundary; code otherwise unchanged.

import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import {
  XbrlError,
  checkBalanceSheet,
  checkIncomeStatement,
  diffRestatement,
  formatReport,
  parseFacts,
} from './core.js'

const USAGE = `dsh-xbrl 0.1.3 — offline XBRL fact reconciliation and restatement diff

Usage:
  dsh-xbrl check <facts.json> [--json]
  dsh-xbrl diff <a.json> <b.json> [--json]
  dsh-xbrl --help
  dsh-xbrl --version

Commands:
  check   Run the balance-sheet and income-statement identities.
          Statements with no recognized concepts are reported as skipped.
  diff    Align two fact files by concept and report added, removed,
          and changed values.

Options:
  --json         Print machine-readable JSON instead of a text report.
  -h, --help     Show this help and exit.
  -V, --version  Show version and exit.

Input:
  {"entity":"...","period":"YYYY-MM-DD","facts":[
    {"concept":"Assets","value":1000,"unit":"CNY"}
  ]}

Exit codes:
  0  check passed (or diff completed)
  1  check failed or was incomplete
  2  usage, I/O, or input error

Unofficial community tool. Not affiliated with DeepSeek. Apache-2.0.`

/**
 * @param {string[]} argv
 * @returns {Promise<number>} Process exit code.
 */
async function main(argv) {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'V' },
        json: { type: 'boolean' },
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`dsh-xbrl: ${message}\n\n${USAGE}\n`)
    return 2
  }

  const { values, positionals } = parsed
  if (values.help) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }
  if (values.version) {
    process.stdout.write('dsh-xbrl 0.1.3\n')
    return 0
  }

  const [command, ...files] = positionals
  if (!command) {
    process.stderr.write(`dsh-xbrl: missing command\n\n${USAGE}\n`)
    return 2
  }

  try {
    if (command === 'check') return await runCheck(files, values)
    if (command === 'diff') return await runDiff(files, values)
    throw new XbrlError('ERR_USAGE', `unknown command "${command}"`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const usage = error instanceof XbrlError && error.code === 'ERR_USAGE'
    process.stderr.write(
      usage
        ? `dsh-xbrl: ${message}\n\n${USAGE}\n`
        : `dsh-xbrl: ${message}\n`,
    )
    return 2
  }
}
