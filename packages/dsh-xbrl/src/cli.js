#!/usr/bin/env node
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

/**
 * @param {string[]} files
 * @param {{json?: boolean}} values
 * @returns {Promise<number>}
 */
async function runCheck(files, values) {
  if (files.length !== 1) {
    throw new XbrlError('ERR_USAGE', 'check requires exactly one facts file')
  }

  const document = await readFacts(files[0])
  const statements = [checkBalanceSheet(document), checkIncomeStatement(document)]
  const skipped = statements
    .filter((statement) => Object.keys(statement.matched).length === 0)
    .map((statement) => statement.kind)
  const applicable = statements.filter(
    (statement) => Object.keys(statement.matched).length > 0,
  )
  const ok = applicable.length > 0 && applicable.every((statement) => statement.ok)

  if (values.json) {
    const payload = {
      command: 'check',
      ok,
      entity: document.entity,
      period: document.period,
      statements,
      skipped,
    }
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
  } else {
    const blocks = statements.map((statement) => {
      if (Object.keys(statement.matched).length === 0) {
        return `${titleOf(statement)} [SKIPPED]\n  no recognized concepts for this statement in the input`
      }
      return formatReport(statement)
    })
    process.stdout.write(`${blocks.join('\n\n')}\n`)
    if (applicable.length === 0) {
      process.stderr.write(
        'dsh-xbrl: no recognized statement totals; check concept names or see README aliases\n',
      )
    }
  }

  return ok ? 0 : 1
}

/**
 * @param {string[]} files
 * @param {{json?: boolean}} values
 * @returns {Promise<number>}
 */
async function runDiff(files, values) {
  if (files.length !== 2) {
    throw new XbrlError('ERR_USAGE', 'diff requires exactly two facts files')
  }

  const [before, after] = await Promise.all([readFacts(files[0]), readFacts(files[1])])
  const result = diffRestatement(before, after)

  if (values.json) {
    const payload = JSON.parse(formatReport(result, { json: true }))
    process.stdout.write(`${JSON.stringify({ command: 'diff', ok: true, ...payload }, null, 2)}\n`)
  } else {
    process.stdout.write(`${formatReport(result)}\n`)
  }
  return 0
}

/**
 * @param {string} path
 * @returns {Promise<{entity: string, period: string, facts: Array<{concept: string, value: number, unit: string, period?: string}>}>}
 */
async function readFacts(path) {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    const code = isNodeError(error) ? error.code : undefined
    const reason = code === 'ENOENT'
      ? 'file not found'
      : error instanceof Error
        ? error.message
        : String(error)
    throw new XbrlError('ERR_IO', `cannot read "${path}": ${reason}`)
  }
  return parseFacts(text)
}

/**
 * @param {unknown} error
 * @returns {error is NodeJS.ErrnoException}
 */
function isNodeError(error) {
  return error instanceof Error && 'code' in error
}

/**
 * @param {{kind?: string}} statement
 * @returns {string}
 */
function titleOf(statement) {
  return statement.kind === 'balance-sheet' ? 'Balance sheet' : 'Income statement'
}

try {
  process.exitCode = await main(process.argv.slice(2))
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`dsh-xbrl: ${message}\n`)
  process.exitCode = 2
}
