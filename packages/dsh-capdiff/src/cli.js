#!/usr/bin/env node
/**
 * dsh-capdiff CLI. Argument parsing and IO only; all analysis lives in core.js.
 */

import { readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import {
  TOOL_NAME,
  TOOL_VERSION,
  buildFindings,
  diffCapabilities,
  parseDeclared,
  scanTarget,
  toSarif,
} from './core.js'

const USAGE = `Usage: ${TOOL_NAME} <file-or-dir> [options]

Scan .js/.mjs/.cjs files for statically visible capabilities and compare them
with the dsh.capabilities entries in a plugin manifest.

Options:
  --manifest <path>  Manifest JSON containing dsh.capabilities
  --json             Print a machine-readable JSON report
  --sarif            Print a SARIF 2.1.0 log
  -h, --help         Show this help
  -V, --version      Show version

Directories are scanned recursively; node_modules and .git are skipped.
This is a static heuristic: code is never executed, and a clean report is not
proof that a plugin is safe.

Exit codes: 0 = scan completed (even with findings), 1 = unused (no business-negative
result; findings do not fail the command), 2 = bad arguments, input, or IO.`

/**
 * @param {string|null|undefined} file
 * @returns {string}
 */
function displayPath(file) {
  if (!file) return '(none)'
  const rel = relative(process.cwd(), file)
  if (!rel) return '.'
  return rel.startsWith('..') ? file : rel
}

/**
 * @param {string[]} values
 * @returns {string}
 */
function formatList(values) {
  return values.length ? values.join(', ') : '(none)'
}

/**
 * @param {{
 *   target: string,
 *   manifest: string|null,
 *   filesScanned: number,
 *   declared: string[],
 *   actual: string[],
 *   diff: { matched: string[], undeclared: string[], unused: string[] },
 *   findings: Array<{ kind: string, capability: string, file?: string, line?: number, evidence?: string }>
 * }} result
 * @returns {string}
 */
function formatHuman(result) {
  const lines = []
  lines.push(`${TOOL_NAME} ${TOOL_VERSION} - static capability diff (heuristic)`)
  lines.push(`Target:   ${displayPath(result.target)}`)
  lines.push(
    `Manifest: ${result.manifest ? displayPath(result.manifest) : '(none; pass --manifest to compare)'}`,
  )
  lines.push(`Files:    ${result.filesScanned} source file(s) scanned`)
  lines.push(`Declared: ${formatList(result.declared)}`)
  lines.push(`Detected: ${formatList(result.actual)}`)
  lines.push('')

  if (result.diff.undeclared.length) {
    lines.push(`Undeclared (${result.diff.undeclared.length}) - used in code, absent from manifest:`)
    for (const finding of result.findings) {
      if (finding.kind !== 'undeclared') continue
      const where = finding.file
        ? `${displayPath(finding.file)}${finding.line ? `:${finding.line}` : ''}`
        : 'scanned code'
      const trigger = finding.evidence ? `, ${finding.evidence}` : ''
      lines.push(`  - ${finding.capability} (${where}${trigger})`)
    }
    lines.push('')
  }

  if (result.diff.unused.length) {
    lines.push(
      `Unused declarations (${result.diff.unused.length}) - declared, not statically visible:`,
    )
    for (const finding of result.findings) {
      if (finding.kind !== 'unused') continue
      lines.push(`  - ${finding.capability}`)
    }
    lines.push('')
  }

  if (result.diff.matched.length) {
    lines.push(`Matched (${result.diff.matched.length}): ${formatList(result.diff.matched)}`)
    lines.push('')
  }

  if (!result.diff.undeclared.length && !result.diff.unused.length) {
    lines.push('No static capability differences found.')
    lines.push('')
  }

  if (result.filesScanned === 0) {
    lines.push('Warning: no .js/.mjs/.cjs files were found.')
    lines.push('')
  }

  lines.push('Note: static heuristic only - "matched" and zero findings are not proof of safety.')
  return lines.join('\n')
}

/**
 * @returns {Promise<number>} process exit code
 */
async function main() {
  let parsed
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'V' },
        manifest: { type: 'string' },
        json: { type: 'boolean' },
        sarif: { type: 'boolean' },
      },
    })
  } catch (error) {
    console.error(`${TOOL_NAME}: ${/** @type {Error} */ (error).message}`)
    console.error(`Try '${TOOL_NAME} --help'.`)
    return 2
  }

  const { values, positionals } = parsed

  if (values.help) {
    console.log(USAGE)
    return 0
  }
  if (values.version) {
    console.log(`${TOOL_NAME} ${TOOL_VERSION}`)
    return 0
  }
  if (positionals.length === 0) {
    console.error(USAGE)
    return 2
  }
  if (positionals.length > 1) {
    console.error(`${TOOL_NAME}: expected exactly one <file-or-dir> argument.`)
    console.error(`Try '${TOOL_NAME} --help'.`)
    return 2
  }
  if (values.json && values.sarif) {
    console.error(`${TOOL_NAME}: choose either --json or --sarif, not both.`)
    return 2
  }

  const targetArg = positionals[0]
  /** @type {string|null} */
  let manifestPath = null
  /** @type {string[]} */
  let declared = []

  if (values.manifest !== undefined) {
    if (!values.manifest) {
      console.error(`${TOOL_NAME}: --manifest requires a non-empty path.`)
      return 2
    }
    manifestPath = resolve(values.manifest)
    let text
    try {
      text = await readFile(manifestPath, 'utf8')
    } catch (error) {
      const detail =
        /** @type {NodeJS.ErrnoException} */ (error).code ?? /** @type {Error} */ (error).message
      console.error(`${TOOL_NAME}: cannot read manifest "${values.manifest}": ${detail}`)
      return 2
    }

    let manifest
    try {
      manifest = JSON.parse(text)
    } catch (error) {
      console.error(
        `${TOOL_NAME}: manifest "${values.manifest}" is not valid JSON: ${/** @type {Error} */ (error).message}`,
      )
      return 2
    }
    declared = parseDeclared(manifest)
  }

  let report
  try {
    report = await scanTarget(targetArg)
  } catch (error) {
    const err = /** @type {NodeJS.ErrnoException} */ (error)
    const detail = err.code === 'ENOENT' ? 'path does not exist' : err.message
    console.error(`${TOOL_NAME}: cannot scan "${targetArg}": ${detail}`)
    return 2
  }

  const diff = diffCapabilities(declared, report.capabilities)
  const findings = buildFindings(diff, report.firstEvidence, {
    manifestFile: manifestPath ?? undefined,
    target: report.target,
  })

  if (values.sarif) {
    const sarif = toSarif(findings, { file: manifestPath ?? undefined })
    console.log(JSON.stringify(sarif, null, 2))
    return 0
  }

  const result = {
    command: 'scan',
    ok: true,
    tool: TOOL_NAME,
    version: TOOL_VERSION,
    target: report.target,
    manifest: manifestPath,
    filesScanned: report.files.length,
    declared,
    actual: report.capabilities,
    diff,
    findings,
  }

  if (values.json) {
    console.log(JSON.stringify(result, null, 2))
    return 0
  }

  console.log(formatHuman(result))
  return 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    console.error(`${TOOL_NAME}: unexpected failure: ${error?.stack ?? error}`)
    process.exitCode = 2
  })
