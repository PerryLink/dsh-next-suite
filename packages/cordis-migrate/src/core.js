/**
 * Pure core for `cordis-migrate`.
 *
 * The engine is deliberately small and dependency-free: it applies
 * line-oriented, regular-expression rules to text files. It is NOT a
 * JavaScript/TypeScript parser and it does NOT know the real Cordis API.
 *
 * ⚠️ The built-in {@link RULES} live in `./rules.js`. They are a
 * community-curated, unofficial Cordis 3 -> 4 list — not an official
 * migration table. Every proposal must be reviewed by a human against the
 * target Cordis release before it is written to disk.
 *
 * No third-party imports: the whole module is testable offline.
 */
import { RULES, RULES_NOTICE } from './rules.js'

export { RULES, RULES_NOTICE }

/**
 * @typedef {import('./rules.js').RuleKind} RuleKind
 * @typedef {import('./rules.js').RuleSeverity} RuleSeverity
 *
 * @typedef {object} Rule
 * @property {string} id Unique id used in scan results.
 * @property {RuleKind | string} kind Coarse category (free-form for custom rules).
 * @property {RegExp | string} pattern Line-local pattern. Strings are compiled with `g`.
 * @property {string | ((match: string, ...captures: string[]) => string)} replacement
 *   Replacement text (JS `$1` / `$&` syntax supported) or a function.
 * @property {string} description Human-readable explanation shown in docs.
 * @property {RuleSeverity | string} severity Suggested severity.
 * @property {string} [evidence] One-line evidence trail (built-in rules carry it).
 * @property {boolean} [experimental] True when the rewrite is best-effort.
 *
 * @typedef {object} Match
 * @property {string} ruleId
 * @property {number} line 1-based line number.
 * @property {number} column 1-based column number (UTF-16 code unit index).
 * @property {string} before Exact matched text.
 * @property {string} after Replacement text computed for this match.
 *
 * @typedef {object} PlannedChange
 * @property {string} path
 * @property {Match[]} matches
 *
 * @typedef {object} SkippedFile
 * @property {string} path
 * @property {string} reason
 *
 * @typedef {object} Plan
 * @property {PlannedChange[]} changes
 * @property {SkippedFile[]} skipped
 * @property {{files: number, changedFiles: number, matches: number, skipped: number}} summary
 */

/**
 * Extensions treated as binary. Used to skip files before decoding so that
 * `apply --write` can never corrupt images/archives.
 * @type {ReadonlyArray<string>}
 */
export const BINARY_EXTENSIONS = Object.freeze([
  '.7z',
  '.avi',
  '.avif',
  '.bin',
  '.bmp',
  '.bz2',
  '.class',
  '.db',
  '.dll',
  '.dylib',
  '.eot',
  '.exe',
  '.flac',
  '.gif',
  '.gz',
  '.ico',
  '.jar',
  '.jpeg',
  '.jpg',
  '.mov',
  '.mp3',
  '.mp4',
  '.node',
  '.ogg',
  '.otf',
  '.pdf',
  '.png',
  '.rar',
  '.so',
  '.sqlite',
  '.tar',
  '.tgz',
  '.tif',
  '.tiff',
  '.ttf',
  '.wasm',
  '.wav',
  '.webm',
  '.webp',
  '.woff',
  '.woff2',
  '.xz',
  '.zip',
])

/**
 * @param {string} path
 * @returns {boolean} True when the path has a known binary extension.
 */
export function isBinaryPath(path) {
  const lower = String(path).toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (dot === -1) return false
  return BINARY_EXTENSIONS.includes(lower.slice(dot))
}

/**
 * Decode a file payload without ever throwing for binary/invalid input.
 *
 * Strings are accepted for tests and library callers; byte arrays are what
 * the CLI gets from `fs.readFile`. A NUL byte or a known binary extension is
 * enough to skip. Invalid UTF-8 is skipped instead of being silently
 * replacement-decoded; otherwise `--write` would rewrite the whole file.
 *
 * @param {string} path
 * @param {string | Uint8Array | ArrayBuffer} content
 * @returns {{ok: true, text: string} | {ok: false, reason: string}}
 */
export function decodeTextContent(path, content) {
  if (isBinaryPath(path)) return { ok: false, reason: 'binary-extension' }

  if (typeof content === 'string') {
    if (content.includes('\u0000')) return { ok: false, reason: 'binary-nul' }
    return { ok: true, text: content }
  }

  /** @type {Uint8Array | null} */
  let bytes = null
  if (content instanceof Uint8Array) bytes = content
  else if (content instanceof ArrayBuffer) bytes = new Uint8Array(content)
  if (!bytes) return { ok: false, reason: 'unsupported-content' }
  if (bytes.includes(0)) return { ok: false, reason: 'binary-nul' }

  try {
    // ignoreBOM: true keeps U+FEFF in the text so writing it back is lossless.
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    return { ok: true, text }
  } catch {
    return { ok: false, reason: 'invalid-utf8' }
  }
}

/**
 * Split text into lines while remembering the exact line terminators.
 *
 * Keeping separators separate means mixed CRLF/LF files round-trip unchanged
 * and untouched line endings are never normalised.
 *
 * @param {string} text
 * @returns {{lines: string[], eols: string[]}}
 */
function splitText(text) {
  const lines = []
  const eols = []
  const separator = /\r\n|\n|\r/g
  let cursor = 0
  let match
  while ((match = separator.exec(text)) !== null) {
    lines.push(text.slice(cursor, match.index))
    eols.push(match[0])
    cursor = match.index + match[0].length
  }
  lines.push(text.slice(cursor))
  return { lines, eols }
}

/**
 * @param {string[]} lines
 * @param {string[]} eols
 * @returns {string}
 */
function joinText(lines, eols) {
  let output = ''
  for (let index = 0; index < lines.length; index++) {
    output += lines[index]
    if (index < eols.length) output += eols[index]
  }
  return output
}

/**
 * Validate a rule up-front so a typo fails loudly instead of producing an
 * empty plan that looks successful.
 *
 * @param {unknown} rule
 * @param {number} index
 * @returns {asserts rule is Rule}
 */
function validateRule(rule, index) {
  if (!rule || typeof rule !== 'object') {
    throw new TypeError(`rule[${index}] must be an object`)
  }
  for (const key of ['id', 'kind', 'description', 'severity']) {
    const value = /** @type {Record<string, unknown>} */ (rule)[key]
    if (typeof value !== 'string' || value.trim() === '') {
      throw new TypeError(`rule[${index}].${key} must be a non-empty string`)
    }
  }
  const pattern = /** @type {Record<string, unknown>} */ (rule).pattern
  if (!(pattern instanceof RegExp) && (typeof pattern !== 'string' || pattern === '')) {
    throw new TypeError(`rule[${index}].pattern must be a non-empty string or RegExp`)
  }
  const replacement = /** @type {Record<string, unknown>} */ (rule).replacement
  if (typeof replacement !== 'string' && typeof replacement !== 'function') {
    throw new TypeError(`rule[${index}].replacement must be a string or function`)
  }
  const evidence = /** @type {Record<string, unknown>} */ (rule).evidence
  if (evidence !== undefined && (typeof evidence !== 'string' || evidence.trim() === '')) {
    throw new TypeError(`rule[${index}].evidence must be a non-empty string when present`)
  }
  const experimental = /** @type {Record<string, unknown>} */ (rule).experimental
  if (experimental !== undefined && typeof experimental !== 'boolean') {
    throw new TypeError(`rule[${index}].experimental must be a boolean when present`)
  }
}

/**
 * @param {ReadonlyArray<Rule>} rules
 */
function compileRules(rules) {
  if (!Array.isArray(rules)) throw new TypeError('rules must be an array')
  return rules.map((rule, order) => {
    validateRule(rule, order)
    const isRegExp = rule.pattern instanceof RegExp
    const source = isRegExp ? rule.pattern.source : rule.pattern
    const flags = isRegExp ? rule.pattern.flags : ''
    const globalFlags = flags.includes('g') ? flags : `${flags}g`
    return {
      rule,
      order,
      regex: new RegExp(source, globalFlags),
      single: new RegExp(source, globalFlags.replace('g', '')),
    }
  })
}

/**
 * @param {{rule: Rule, single: RegExp}} compiled
 * @param {RegExpExecArray} match
 * @returns {string}
 */
function renderAfter(compiled, match) {
  const { rule, single } = compiled
  if (typeof rule.replacement === 'function') {
    return String(rule.replacement(match[0], ...match.slice(1)))
  }
  return match[0].replace(single, rule.replacement)
}

/**
 * @param {string} text
 * @param {ReturnType<typeof compileRules>} compiled
 * @returns {Match[]}
 */
function scanCompiled(text, compiled) {
  const { lines } = splitText(text)
  /** @type {Array<Match & {order: number}>} */
  const found = []

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]
    for (const entry of compiled) {
      const regex = entry.regex
      regex.lastIndex = 0
      let match
      while ((match = regex.exec(line)) !== null) {
        if (match[0].length === 0) {
          // A zero-length match cannot be applied; advance manually because
          // `exec` does not move `lastIndex` for empty matches.
          if (regex.lastIndex <= match.index) regex.lastIndex = match.index + 1
          continue
        }
        found.push({
          ruleId: entry.rule.id,
          line: lineIndex + 1,
          column: match.index + 1,
          before: match[0],
          after: renderAfter(entry, match),
          order: entry.order,
        })
      }
    }
  }

  // Deterministic order: position first, then the order rules were provided.
  found.sort((a, b) => a.line - b.line || a.column - b.column || a.order - b.order)
  return found.map(({ ruleId, line, column, before, after }) => ({ ruleId, line, column, before, after }))
}

/**
 * Find all rule matches in a source string.
 *
 * Matching is line-oriented: a rule cannot span lines, `line`/`column` are
 * 1-based, and `column` counts UTF-16 code units (JS string indices + 1).
 * Patterns are cloned, so rule `RegExp#lastIndex` state never leaks between
 * files. Rules that overlap still return separate matches here; overlap is
 * resolved later by {@link applySource}.
 *
 * @param {string} code
 * @param {ReadonlyArray<Rule>} [rules]
 * @returns {Match[]}
 */
export function scanSource(code, rules = RULES) {
  return scanCompiled(String(code), compileRules(rules))
}

/**
 * @param {unknown} match
 * @returns {match is Match}
 */
function isValidMatch(match) {
  if (!match || typeof match !== 'object') return false
  const candidate = /** @type {Record<string, unknown>} */ (match)
  return (
    Number.isInteger(candidate.line) &&
    /** @type {number} */ (candidate.line) >= 1 &&
    Number.isInteger(candidate.column) &&
    /** @type {number} */ (candidate.column) >= 1 &&
    typeof candidate.before === 'string' &&
    candidate.before.length > 0 &&
    typeof candidate.after === 'string'
  )
}

/**
 * Apply match proposals to source text.
 *
 * Semantics:
 * - Replacements are made line by line, preserving every original line ending.
 * - The leftmost non-overlapping match wins; overlapping proposals are skipped
 *   (scan results are sorted by position, so this is deterministic).
 * - Selected matches on one line are applied right-to-left, which keeps the
 *   columns of earlier matches valid while editing.
 * - A proposal only applies if `before` still starts at `column` on that line.
 *   Re-running `applySource` with the same matches is therefore a no-op.
 *
 * @param {string} code
 * @param {ReadonlyArray<Match>} matches
 * @returns {string} New source text (the original string when nothing applies).
 */
export function applySource(code, matches) {
  const text = String(code)
  if (!Array.isArray(matches) || matches.length === 0) return text

  const { lines, eols } = splitText(text)
  /** @type {Map<number, Match[]>} */
  const byLine = new Map()

  for (const match of matches) {
    if (!isValidMatch(match)) continue
    if (match.line > lines.length || match.column > lines[match.line - 1].length + 1) continue
    const list = byLine.get(match.line)
    if (list) list.push(match)
    else byLine.set(match.line, [match])
  }

  for (const [lineNumber, proposals] of byLine) {
    const lineIndex = lineNumber - 1
    const original = lines[lineIndex]

    // Greedy left-to-right selection on the original line. `sort` is stable,
    // so equal columns keep the order produced by scanSource.
    /** @type {Match[]} */
    const selected = []
    let cursor = 0
    for (const proposal of [...proposals].sort((a, b) => a.column - b.column)) {
      const start = proposal.column - 1
      const end = start + proposal.before.length
      if (start < cursor) continue
      if (end > original.length) continue
      if (original.slice(start, end) !== proposal.before) continue
      selected.push(proposal)
      cursor = end
    }

    // Apply from the end of the line towards the start so positions stay valid.
    let nextLine = original
    selected.sort((a, b) => b.column - a.column)
    for (const proposal of selected) {
      const start = proposal.column - 1
      nextLine = nextLine.slice(0, start) + proposal.after + nextLine.slice(start + proposal.before.length)
    }
    lines[lineIndex] = nextLine
  }

  return joinText(lines, eols)
}

/**
 * Build a migration plan for in-memory files.
 *
 * `changes` contains only files with at least one match. `skipped` contains
 * files that could not be processed as text (`binary-extension`, `binary-nul`,
 * `invalid-utf8`, `unsupported-content`, `invalid-file`). Clean text files
 * appear in neither list but are counted in `summary.files`.
 *
 * The function is pure: it never reads or writes the filesystem.
 *
 * @param {ReadonlyArray<{path: string, content: string | Uint8Array | ArrayBuffer}>} files
 * @param {ReadonlyArray<Rule>} [rules]
 * @returns {Plan}
 */
export function plan(files, rules = RULES) {
  if (!Array.isArray(files)) throw new TypeError('files must be an array')
  const compiled = compileRules(rules)

  /** @type {PlannedChange[]} */
  const changes = []
  /** @type {SkippedFile[]} */
  const skipped = []

  for (const file of files) {
    if (!file || typeof file !== 'object' || typeof file.path !== 'string' || file.path === '') {
      skipped.push({ path: '<unknown>', reason: 'invalid-file' })
      continue
    }
    const decoded = decodeTextContent(file.path, file.content)
    if (!decoded.ok) {
      skipped.push({ path: file.path, reason: decoded.reason })
      continue
    }
    const matches = scanCompiled(decoded.text, compiled)
    if (matches.length > 0) changes.push({ path: file.path, matches })
  }

  const matchCount = changes.reduce((total, change) => total + change.matches.length, 0)
  return {
    changes,
    skipped,
    summary: {
      files: files.length,
      changedFiles: changes.length,
      matches: matchCount,
      skipped: skipped.length,
    },
  }
}

/**
 * @param {number} value
 * @param {number} width
 * @returns {string}
 */
function pad(value, width) {
  return String(value).padEnd(width)
}

/**
 * @param {unknown} value
 * @param {number} [max]
 * @returns {string}
 */
function truncate(value, max = 88) {
  const text = String(value ?? '').replace(/\s+/g, ' ')
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/**
 * Render a plan as text (default) or JSON.
 *
 * JSON is a safe, stable projection: matches contain strings and numbers only
 * (never rule `RegExp` objects), and the example-rules notice is included.
 *
 * @param {Plan} result
 * @param {{json?: boolean}} [options]
 * @returns {string}
 */
export function formatPlan(result, options = {}) {
  if (!result || typeof result !== 'object') throw new TypeError('plan must be an object')
  const { json = false } = options ?? {}
  const changes = Array.isArray(result.changes) ? result.changes : []
  const skipped = Array.isArray(result.skipped) ? result.skipped : []
  const summary = normalizeSummary(result.summary, changes, skipped)

  if (json) {
    return JSON.stringify({ notice: RULES_NOTICE, ...result, changes, skipped, summary }, null, 2)
  }

  const lines = []
  lines.push(RULES_NOTICE)
  lines.push('')
  lines.push(
    `Files: ${summary.files} scanned, ${summary.changedFiles} with matches, ${summary.skipped} skipped; ${summary.matches} match(es).`,
  )
  lines.push('')

  if (changes.length === 0) {
    lines.push('No matches found.')
  }

  for (const change of changes) {
    lines.push(change.path)
    for (const match of change.matches ?? []) {
      const location = `${match.line}:${match.column}`
      lines.push(
        `  ${pad(location, 12)} ${pad(match.ruleId, 26)} ${truncate(match.before)}  ->  ${truncate(match.after)}`,
      )
    }
    lines.push('')
  }

  if (skipped.length > 0) {
    lines.push('Skipped:')
    for (const item of skipped) {
      lines.push(`  ${item.path}  (${item.reason})`)
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

/**
 * @param {unknown} summary
 * @param {ReadonlyArray<PlannedChange>} changes
 * @param {ReadonlyArray<SkippedFile>} skipped
 * @returns {{files: number, changedFiles: number, matches: number, skipped: number}}
 */
function normalizeSummary(summary, changes, skipped) {
  const matches = changes.reduce(
    (total, change) => total + (Array.isArray(change.matches) ? change.matches.length : 0),
    0,
  )
  if (!summary || typeof summary !== 'object') {
    return {
      files: changes.length + skipped.length,
      changedFiles: changes.length,
      matches,
      skipped: skipped.length,
    }
  }
  const candidate = /** @type {Record<string, unknown>} */ (summary)
  return {
    files: Number.isInteger(candidate.files) ? /** @type {number} */ (candidate.files) : changes.length + skipped.length,
    changedFiles: Number.isInteger(candidate.changedFiles)
      ? /** @type {number} */ (candidate.changedFiles)
      : changes.length,
    matches: Number.isInteger(candidate.matches) ? /** @type {number} */ (candidate.matches) : matches,
    skipped: Number.isInteger(candidate.skipped) ? /** @type {number} */ (candidate.skipped) : skipped.length,
  }
}
