/**
 * Pure, dependency-free core for `cordis-hmr-doctor`.
 *
 * The input is a plain-text Cordis HMR log. The parser is deliberately
 * heuristic: it recognises the status words that HMR implementations use
 * (`settled`, `aborted`, `skipped`, plus the logger messages `reload` and
 * `dispose`) and extracts a module and a reason from each matching line.
 *
 * @typedef {'settled' | 'aborted' | 'skipped' | 'reload' | 'dispose'} HmrStatus
 *
 * @typedef {object} HmrEvent
 * @property {HmrStatus} status   Status reported by the log line.
 * @property {string | null} module  Module path, plugin path, or URL.
 * @property {string | null} reason  Error text / skip reason, when present.
 * @property {number} line  1-based line number in the original text.
 * @property {string} raw  The original line, unchanged.
 * @property {boolean} [failed]  True for a `failed to reload/dispose` line.
 *
 * @typedef {object} HmrSummary
 * @property {number} total
 * @property {number} settled
 * @property {number} aborted
 * @property {number} skipped
 * @property {string | null} topReason  Most frequent raw reason, or null.
 *
 * @typedef {object} CauseGroup
 * @property {string} cause  Stable cause code.
 * @property {string} label  Human-readable cause label.
 * @property {number} count
 * @property {string[]} modules  Unique modules involved.
 * @property {string[]} statuses  Statuses seen in this group.
 * @property {Array<{status: HmrStatus, module: string | null, reason: string | null, line: number}>} examples
 *
 * @typedef {object} Diagnosis
 * @property {{total: number, 'dependency-missing': number, circular: number, 'port-in-use': number, 'config-error': number, timeout: number, unknown: number}} counts
 * @property {CauseGroup[]} causes
 * @property {string[]} suggestions
 *
 * @typedef {object} Report
 * @property {HmrEvent[]} [events]
 * @property {HmrSummary | null} summary
 * @property {Diagnosis['counts']} counts
 * @property {CauseGroup[]} causes
 * @property {string[]} suggestions
 */

/** Stable cause order used by the diagnosis output. */
export const CAUSE_KEYS = Object.freeze([
  'dependency-missing',
  'circular',
  'port-in-use',
  'config-error',
  'timeout',
  'unknown',
])

/** Human-readable labels for the cause codes. */
export const CAUSE_LABELS = Object.freeze({
  'dependency-missing': 'Dependency or module missing',
  circular: 'Circular dependency',
  'port-in-use': 'Port already in use',
  'config-error': 'Configuration or plugin error',
  timeout: 'Timeout',
  unknown: 'Unknown or unmapped reason',
})

/**
 * Cause rules, evaluated in order. Earlier rules win when a reason matches
 * more than one pattern.
 * @type {Array<[string, RegExp]>}
 */
const CAUSE_RULES = [
  [
    'circular',
    /\b(?:circular|cyclic|cycle)\b|\bmodule_recursion\b|循环(?:依赖|引用)?|依赖循环/i,
  ],
  [
    'port-in-use',
    /\beaddrinuse\b|address already in use|port\b.{0,32}\b(?:in use|occupied|taken|already)|端口.{0,8}(?:占用|被占|冲突)/i,
  ],
  [
    'timeout',
    /\betimedout\b|\btimed?\s*out\b|\btimeout\b|deadline exceeded|超时/i,
  ],
  [
    'config-error',
    /\binvalid\s+(?:config|configuration|options?|plugin|schema)\b|\binvalid plugin\b|\bexpect(?:ed)? (?:a )?(?:function|object)\b|\bconfig(?:uration)?\s+(?:error|invalid|validation|failed|missing)\b|\bconfig\s+(?:reload|load)\s+(?:failed|error)\b|\bschema\s+(?:validation|error)\b|\bfailed to (?:load|reload) (?:the )?config\b|\bunknown (?:option|config|configuration)\b|\bunsupported (?:option|config)\b|\bexpected .{0,40}plugin\b|\b(?:is not|not a) (?:valid )?plugin\b|\bdoes not export a component\b|配置(?:错误|无效|缺失)|未知(?:选项|配置)/i,
  ],
  [
    'dependency-missing',
    /\berr_module_not_found\b|\bcannot find (?:module|package)\b|\bmodule not found\b|\b(?:failed|could not|unable) to (?:resolve|find|load) (?:module|package|dependency|import)\b|\b(?:missing|unknown) (?:module|package|dependency)\b|\bdoes not provide an export named\b|\berr_package_(?:path_)?not_exported\b|\bmodulenotfounderror\b|\benoent\b|no such file or directory|找不到(?:模块|依赖|包)|无法(?:解析|找到)(?:模块|依赖|包)?/i,
  ],
]

/** Static, cause-specific advice. */
const CAUSE_SUGGESTIONS = Object.freeze({
  'dependency-missing':
    'Install or restore the missing module: check package.json, run the package manager, and verify the import specifier (including exports and file extensions).',
  circular:
    'Break the import cycle by moving shared code into a third module or by using a lazy dynamic import before retrying HMR.',
  'port-in-use':
    'Free the port (stop the other process) or configure a different port before restarting the Cordis process.',
  'config-error':
    'Fix the configuration or plugin export named in the log, then restart; compare it with the schema of the plugin being loaded.',
  timeout:
    'Raise the HMR debounce/timeout or shrink the reloaded module graph; look for a hanging top-level await or a slow watcher.',
  unknown:
    'Inspect the raw lines for the unknown events; this heuristic parser could not map their reasons to a known cause.',
})

const ANSI_PATTERN =
  // CSI/OSC colour and style sequences used by Cordis/console loggers.
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g

const DECORATORS = [
  /^\d{4}-\d{2}-\d{2}[T ][0-9:.+-]+Z?\s*/,
  /^\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\s*/,
  /^(?:TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\b\s*[:|/-]?\s*/i,
  /^(?:cordis|cordisjs|@cordisjs\/hmr|@deepseek-ai\/dsh-hmr|@deepseek-ai\/cordis-plugin-hmr|cordis-plugin-hmr|plugin-hmr|hmr)\b\s*[:|/-]?\s*/i,
  /^[|>]\s*/,
]

const STATUS_NAMES = new Set(['settled', 'aborted', 'skipped', 'reload', 'dispose'])

const SKIPPED_BLOCK_HEADER = /^skipped changes\b/i
const PLUGIN_AT = /^(failed to\s+)?(reload|dispose|skip)\s+plugin\s+at\s+([\s\S]+)$/i
const CONFIG_RELOAD = /^config reload at\s+([\s\S]+)$/i
const DIRECT_STATUS = /^(settled|aborted|skipped|reload|dispose)\b([\s\S]*)$/i
const KEY_VALUE_STATUS =
  /^(?:status|result|event)\s*[:=]\s*(settled|aborted|skipped|reload|dispose)\b([\s\S]*)$/i

/**
 * Diagnostic causes for a set of parsed HMR events.
 *
 * `counts.total` is the number of events that carried a diagnosable failure
 * (aborted/skipped, failed reload/dispose, or an event with an explicit
 * reason). Successful `settled` events without a reason are not failures and
 * are ignored here; `summarize()` still counts them.
 *
 * @param {HmrEvent[]} events
 * @returns {Diagnosis}
 */
export function diagnose(events) {
  /** @type {Diagnosis['counts']} */
  const counts = { total: 0, 'dependency-missing': 0, circular: 0, 'port-in-use': 0, 'config-error': 0, timeout: 0, unknown: 0 }
  /** @type {Map<string, CauseGroup>} */
  const groups = new Map()
  let abortedCount = 0
  let skippedCount = 0

  for (const event of Array.isArray(events) ? events : []) {
    if (!event || typeof event !== 'object' || !isDiagnosable(event)) continue
    if (event.status === 'aborted') abortedCount += 1
    if (event.status === 'skipped') skippedCount += 1

    const cause = classifyEvent(event)
    counts.total += 1
    counts[cause] += 1

    let group = groups.get(cause)
    if (!group) {
      group = {
        cause,
        label: CAUSE_LABELS[cause],
        count: 0,
        modules: [],
        statuses: [],
        examples: [],
      }
      groups.set(cause, group)
    }
    group.count += 1
    if (event.module && !group.modules.includes(event.module)) {
      group.modules.push(event.module)
    }
    if (!group.statuses.includes(event.status)) {
      group.statuses.push(event.status)
    }
    if (group.examples.length < 5) {
      group.examples.push({
        status: event.status,
        module: event.module ?? null,
        reason: event.reason ?? null,
        line: event.line,
      })
    }
  }

  const causes = [...groups.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    return CAUSE_KEYS.indexOf(a.cause) - CAUSE_KEYS.indexOf(b.cause)
  })

  /** @type {string[]} */
  const suggestions = []
  for (const group of causes) {
    suggestions.push(CAUSE_SUGGESTIONS[group.cause])
  }
  if (skippedCount > 0) {
    suggestions.push(
      `${skippedCount} skipped change(s) cannot be applied in place; restart the Cordis process to apply them.`,
    )
  }
  if (abortedCount > 0) {
    suggestions.push(
      `${abortedCount} aborted change(s) are retried on the next HMR batch; fix the first error so they can settle.`,
    )
  }

  return { counts, causes, suggestions }
}

/**
 * Count events by status and find the most frequent reason.
 *
 * Ties keep the reason that appeared first. Reasons are compared as the raw
 * strings produced by `parseHmrLog`.
 *
 * @param {HmrEvent[]} events
 * @returns {HmrSummary}
 */
export function summarize(events) {
  const list = Array.isArray(events) ? events : []
  let settled = 0
  let aborted = 0
  let skipped = 0
  const reasonCounts = new Map()
  let topReason = null
  let topCount = 0

  for (const event of list) {
    if (!event || typeof event !== 'object') continue
    if (event.status === 'settled') settled += 1
    else if (event.status === 'aborted') aborted += 1
    else if (event.status === 'skipped') skipped += 1

    const reason = normalizeReason(event.reason)
    if (!reason) continue
    const count = (reasonCounts.get(reason) ?? 0) + 1
    reasonCounts.set(reason, count)
    if (count > topCount) {
      topCount = count
      topReason = reason
    }
  }

  return { total: list.length, settled, aborted, skipped, topReason }
}

/**
 * Parse a heuristic Cordis HMR log.
 *
 * Recognised line shapes (ASCII examples):
 *
 *   [hmr] settled src/routes/index.ts
 *   [hmr] aborted src/db.ts: Cannot find module 'pg'
 *   [hmr] skipped src/main.ts (host-module)
 *   skipped changes, which apply after a restart:
 *   - src/main.ts (host-module)
 *   reload plugin at src/plugins/logger.ts
 *   failed to dispose plugin at src/plugins/old.ts
 *   status=aborted module=src/db.ts reason="listen EADDRINUSE"
 *
 * Unrelated lines are ignored. Paths containing spaces are supported when
 * quoted, or when they appear as an official skip-block bullet. No official
 * Cordis log grammar is assumed; see DESIGN.md.
 *
 * @param {string} text
 * @returns {HmrEvent[]}
 */
export function parseHmrLog(text) {
  if (typeof text !== 'string' || text.length === 0) return []
  /** @type {HmrEvent[]} */
  const events = []
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  let inSkippedBlock = false

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]
    const lineNumber = index + 1
    const stripped = stripDecorations(raw)

    if (!stripped) {
      // Blank lines do not end a logger-emitted skip block.
      continue
    }

    if (SKIPPED_BLOCK_HEADER.test(stripped)) {
      inSkippedBlock = true
      continue
    }

    if (inSkippedBlock) {
      const bullet = stripped.match(/^[-*•]\s+([\s\S]+)$/)
      if (bullet) {
        const parsed = parseBlockBullet(bullet[1])
        if (parsed.module || parsed.reason) {
          events.push({
            status: 'skipped',
            module: parsed.module,
            reason: parsed.reason,
            line: lineNumber,
            raw,
          })
        }
        continue
      }
      inSkippedBlock = false
    }

    let status = null
    let rest = ''
    let failed = false
    let fallbackReason = null

    const pluginAt = stripped.match(PLUGIN_AT)
    if (pluginAt) {
      failed = Boolean(pluginAt[1])
      status = normalizeStatus(pluginAt[2])
      rest = pluginAt[3]
    } else {
      const configReload = stripped.match(CONFIG_RELOAD)
      if (configReload) {
        status = 'reload'
        const body = configReload[1]
        failed = /\s+failed\s*$/i.test(body)
        rest = failed ? body.replace(/\s+failed\s*$/i, '') : body
        fallbackReason = failed ? 'config reload failed' : null
      } else {
        const direct = stripped.match(DIRECT_STATUS)
        if (direct) {
          status = normalizeStatus(direct[1])
          rest = direct[2]
        } else {
          const keyValue = stripped.match(KEY_VALUE_STATUS)
          if (keyValue) {
            status = normalizeStatus(keyValue[1])
            rest = keyValue[2]
          }
        }
      }
    }

    if (!status) continue
    if (/\bfailed\b/i.test(stripped)) failed = true
    if (!STATUS_NAMES.has(status)) continue

    const parsed = parseModuleAndReason(rest, status, failed)
    if (failed && !parsed.reason) {
      parsed.reason =
        fallbackReason ?? (status === 'dispose' ? 'failed to dispose' : 'failed to reload')
    }

    events.push({
      status,
      module: parsed.module,
      reason: parsed.reason,
      line: lineNumber,
      raw,
      ...(failed ? { failed: true } : {}),
    })
  }

  return events
}

/**
 * Build a complete, JSON-serialisable report from raw log text.
 *
 * @param {string} text
 * @returns {Report}
 */
export function buildReport(text) {
  const events = parseHmrLog(text)
  const diagnosis = diagnose(events)
  return {
    events,
    summary: summarize(events),
    counts: diagnosis.counts,
    causes: diagnosis.causes,
    suggestions: diagnosis.suggestions,
  }
}

/**
 * Render a report as text, or as stable JSON when `json` is true.
 *
 * Accepted inputs are an event array, a `diagnose()` result, a `buildReport()`
 * result, or `{summary, diagnosis}`. Unknown shapes raise a TypeError.
 *
 * @param {HmrEvent[] | Diagnosis | Report | {summary?: HmrSummary | null, diagnosis?: Diagnosis}} result
 * @param {{json?: boolean}} [options]
 * @returns {string}
 */
export function formatReport(result, options = {}) {
  const report = normalizeReport(result)
  if (options && options.json) {
    const output = {
      summary: report.summary,
      counts: report.counts,
      causes: report.causes,
      suggestions: report.suggestions,
    }
    if (report.events) output.events = report.events
    return JSON.stringify(output, null, 2)
  }

  /** @type {string[]} */
  const lines = []
  lines.push('Cordis HMR Doctor - heuristic HMR log report (unofficial)')
  lines.push('=============================================================')

  if (report.summary) {
    const summary = report.summary
    lines.push(
      `Events: ${summary.total} total | settled ${summary.settled} | aborted ${summary.aborted} | skipped ${summary.skipped}`,
    )
    lines.push(`Top reason: ${summary.topReason ?? 'none'}`)
  } else {
    lines.push(`Events diagnosed: ${report.counts.total}`)
  }

  if (report.summary && report.summary.total === 0) {
    lines.push('')
    lines.push('No HMR events were found in this log.')
    lines.push('Check that the log contains settled/aborted/skipped or reload/dispose lines.')
    return lines.join('\n')
  }

  lines.push('')
  lines.push(`Causes (${report.counts.total} event(s) diagnosed):`)
  if (report.causes.length === 0) {
    lines.push('  none - no aborted or skipped event needed classification.')
  } else {
    for (const cause of report.causes) {
      lines.push(`  ${cause.cause} [${cause.count}] - ${cause.label}`)
      for (const example of cause.examples) {
        const where = example.module ?? '(unknown module)'
        const why = example.reason ? ` - ${example.reason}` : ''
        lines.push(`    - [${example.status}] ${where}${why}`)
      }
    }
  }

  lines.push('')
  lines.push('Suggestions:')
  if (report.suggestions.length === 0) {
    lines.push('  - None. No aborted or skipped events were found.')
  } else {
    for (const suggestion of report.suggestions) {
      lines.push(`  - ${suggestion}`)
    }
  }

  lines.push('')
  lines.push(
    'Note: the log format is heuristic; this is not an official Cordis diagnostic tool.',
  )
  return lines.join('\n')
}

/**
 * Normalise any supported report input to the flat internal report shape.
 * @param {HmrEvent[] | Diagnosis | Report | {summary?: HmrSummary | null, diagnosis?: Diagnosis}} result
 * @returns {Report}
 */
function normalizeReport(result) {
  let input = result
  if (Array.isArray(input)) {
    const events = input
    return {
      events,
      summary: summarize(events),
      ...diagnose(events),
    }
  }
  if (!input || typeof input !== 'object') {
    throw new TypeError('formatReport expects an event array or a report object')
  }

  const diagnosis =
    input.diagnosis && typeof input.diagnosis === 'object' ? input.diagnosis : input
  if (
    !diagnosis.counts ||
    typeof diagnosis.counts !== 'object' ||
    !Array.isArray(diagnosis.causes) ||
    !Array.isArray(diagnosis.suggestions)
  ) {
    throw new TypeError(
      'formatReport expects counts, causes, and suggestions from diagnose()/buildReport()',
    )
  }

  const events = Array.isArray(input.events)
    ? input.events
    : Array.isArray(diagnosis.events)
      ? diagnosis.events
      : null
  const summary =
    input.summary && typeof input.summary === 'object'
      ? input.summary
      : events
        ? summarize(events)
        : null

  return {
    ...(events ? { events } : {}),
    summary,
    counts: diagnosis.counts,
    causes: diagnosis.causes,
    suggestions: diagnosis.suggestions,
  }
}

/**
 * Remove ANSI escapes and common log decorations while preserving the status
 * word. Bracketed status markers such as `[aborted]` are unwrapped rather than
 * discarded.
 * @param {string} line
 * @returns {string}
 */
function stripDecorations(line) {
  let text = String(line).replace(ANSI_PATTERN, '').trim()
  for (let pass = 0; pass < 12; pass += 1) {
    const before = text
    const bracket = text.match(/^\[([^\]]{0,120})\]\s*/)
    if (bracket) {
      const inner = bracket[1].trim()
      text =
        (STATUS_NAMES.has(inner.toLowerCase())
          ? `${inner} `
          : '') + text.slice(bracket[0].length)
      if (text === before) break
      continue
    }
    for (const decorator of DECORATORS) {
      const next = text.replace(decorator, '')
      if (next !== text) {
        text = next
        break
      }
    }
    if (text === before) break
  }
  return text.trim()
}

/**
 * Parse the payload after a status word.
 * @param {string} text
 * @param {HmrStatus} status
 * @param {boolean} failed
 * @returns {{module: string | null, reason: string | null}}
 */
function parseModuleAndReason(text, status, failed) {
  let rest = String(text ?? '').trim()
  rest = rest.replace(/^[:=,;|>–—-]+\s*/, '')
  rest = rest.replace(/^(?:module|file|path|target)\s*[:=]\s*/i, '')
  rest = rest.replace(/^at\s+/i, '')
  rest = rest.replace(/^(?:plugin|module|file)\s+at\s+/i, '')

  // A status line without a module, e.g. `aborted Error: ...`.
  if (
    /^(?:[A-Za-z]*Error\s*:|Cannot\s+(?:find|resolve|load)\b|EADDRINUSE\b|ETIMEDOUT\b|Failed to\b|Invalid (?:config|options?|plugin)\b|listen\s+EADDRINUSE\b)/i.test(
      rest,
    )
  ) {
    return { module: null, reason: normalizeReason(rest) }
  }

  const token = takeModuleToken(rest)
  let module = token.module
  rest = token.rest.trim().replace(/^[:=,;|>–—-]+\s*/, '')

  let reason = null
  if (rest && /^(?:reason|error|cause)\s*[:=]/i.test(rest)) {
    reason = rest.replace(/^(?:reason|error|cause)\s*[:=]\s*/i, '')
  } else if (rest && /^\([^()]*\)$/.test(rest)) {
    reason = rest.slice(1, -1)
  } else if (rest && (status === 'aborted' || status === 'skipped' || failed)) {
    reason = rest
  } else if (rest) {
    const because = rest.match(/^(?:because|due to|caused by)\s+([\s\S]+)$/i)
    const paren = rest.match(/\(([^()]*)\)\s*$/)
    if (because) reason = because[1]
    else if (paren) {
      reason = paren[1]
      rest = rest.slice(0, paren.index).trim()
    } else if (/\b(?:error|failed|invalid|cannot|timeout|eaddrinuse)\b/i.test(rest)) {
      reason = rest
    }
  }

  return {
    module: cleanModule(module),
    reason: normalizeReason(reason),
  }
}

/**
 * Take one module token. Quoted and bracketed/angle-bracketed values may
 * contain spaces; bare values end at whitespace.
 * @param {string} text
 * @returns {{module: string | null, rest: string}}
 */
function takeModuleToken(text) {
  const value = String(text ?? '').trim()
  if (!value) return { module: null, rest: '' }
  if (value.startsWith('(')) return { module: null, rest: value }

  const first = value[0]
  if (first === '"' || first === "'" || first === '`') {
    const end = value.indexOf(first, 1)
    if (end > 0) {
      return { module: value.slice(1, end), rest: value.slice(end + 1) }
    }
  }
  if (first === '[') {
    const end = value.indexOf(']')
    if (end > 1) {
      return { module: value.slice(1, end), rest: value.slice(end + 1) }
    }
  }
  if (first === '<') {
    const end = value.indexOf('>')
    if (end > 1) {
      return { module: value.slice(1, end), rest: value.slice(end + 1) }
    }
  }

  const match = value.match(/^(\S+)/)
  if (!match) return { module: null, rest: '' }
  return {
    module: match[1].replace(/[,;:]+$/, ''),
    rest: value.slice(match[0].length),
  }
}

/**
 * Parse an official skip-block bullet such as
 * `- src/main.ts (host-module)`. The whole prefix is the module, so paths with
 * spaces work.
 * @param {string} text
 * @returns {{module: string | null, reason: string | null}}
 */
function parseBlockBullet(text) {
  let rest = String(text ?? '').trim()
  let reason = null
  const parenthetical = rest.match(/^(.*?)\s*\(([^()]*)\)\s*$/)
  if (parenthetical) {
    rest = parenthetical[1].trim()
    reason = parenthetical[2]
  }
  return {
    module: cleanModule(unquote(rest.replace(/[,;]+$/, '').trim())),
    reason: normalizeReason(reason),
  }
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function cleanModule(value) {
  if (typeof value !== 'string') return null
  const module = unquote(value.trim()).replace(/[,;:]+$/, '')
  if (!module || module === '%C' || module === 'at') return null
  return module
}

/**
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
function normalizeReason(value) {
  if (typeof value !== 'string') return null
  const reason = unquote(value).trim()
  return reason || null
}

/**
 * @param {string} value
 * @returns {string}
 */
function unquote(value) {
  const text = String(value).trim()
  if (text.length >= 2) {
    const first = text[0]
    const last = text[text.length - 1]
    if ((first === '"' || first === "'" || first === '`') && first === last) {
      return text.slice(1, -1)
    }
  }
  return text
}

/**
 * @param {string} value
 * @returns {HmrStatus}
 */
function normalizeStatus(value) {
  return value.toLowerCase() === 'skip' ? 'skipped' : /** @type {HmrStatus} */ (value.toLowerCase())
}

/**
 * @param {HmrEvent} event
 * @returns {boolean}
 */
function isDiagnosable(event) {
  if (event.status === 'aborted' || event.status === 'skipped') return true
  if (event.failed === true) return true
  const reason = normalizeReason(event.reason)
  if (!reason) return false
  if (event.status === 'settled') {
    return /\b(?:fail(?:ed|ure)?|error|invalid|cannot|timeout|eaddrinuse|econnrefused|warn(?:ing)?)\b/i.test(
      reason,
    )
  }
  return /\b(?:fail(?:ed|ure)?|error|invalid|cannot|timeout|eaddrinuse|econnrefused)\b/i.test(
    reason,
  )
}

/**
 * @param {HmrEvent} event
 * @returns {string}
 */
function classifyEvent(event) {
  const reason = normalizeReason(event.reason)
  if (!reason) return 'unknown'
  for (const [cause, pattern] of CAUSE_RULES) {
    if (pattern.test(reason)) return cause
  }
  return 'unknown'
}
