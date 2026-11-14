/**
 * dsh-xbrl core.
 *
 * Offline reconciliation of XBRL-style financial facts:
 * - strict parsing of a small JSON fact snapshot,
 * - balance-sheet and income-statement identity checks,
 * - concept-aligned restatement diffs.
 *
 * This module has no imports, performs no network access, and is a
 * calculator, not an audit tool. See README.md and DESIGN.md for limits.
 */

/** Default absolute tolerance, expressed in the unit of the supplied facts. */
export const DEFAULT_TOLERANCE = 0.01

/**
 * @typedef {object} XbrlFact
 * @property {string} concept Fact name, e.g. `Assets`, `us-gaap:Assets`, or `资产总计`.
 * @property {number} value Finite numeric value.
 * @property {string} unit Reporting unit, e.g. `CNY` or `USD`.
 * @property {string} [period] Optional per-fact period; informational only.
 */

/**
 * @typedef {object} FactsDocument
 * @property {string} entity Reporting entity.
 * @property {string} period Reporting period.
 * @property {XbrlFact[]} facts Parsed facts.
 */

/**
 * @typedef {object} CheckResult
 * @property {boolean} ok True only when every role is present and the identity holds.
 * @property {number|null} lhs Left-hand side value, or null when a role is missing.
 * @property {number|null} rhs Right-hand side value, or null when a role is missing.
 * @property {number|null} diff `lhs - rhs`, or null when a role is missing.
 * @property {string[]} missing Missing role keys, in statement order.
 * @property {number} tolerance Absolute tolerance used for this check.
 * @property {'balance-sheet'|'income-statement'} kind Statement kind.
 * @property {string} identity Human-readable identity.
 * @property {string} lhsLabel Label for the left-hand side.
 * @property {string} rhsLabel Label for the right-hand side.
 * @property {Record<string, string>} matched Role key to the actual concept matched.
 * @property {Record<string, number>} values Found role values; missing roles are absent.
 */

/**
 * @typedef {object} RestatementChange
 * @property {string} concept Concept in the newer snapshot.
 * @property {number} before Previous value.
 * @property {number} after New value.
 * @property {number} delta `after - before`.
 * @property {number|null} pct Percent change relative to `|before|`, or null when
 * `before` is 0 (or the percentage is not finite).
 */

/**
 * @typedef {object} RestatementDiff
 * @property {string[]} added Concepts present only in the newer snapshot.
 * @property {string[]} removed Concepts present only in the older snapshot.
 * @property {RestatementChange[]} changed Concepts present in both with different values.
 * @property {boolean} hasChanges True when any of the three arrays is non-empty.
 * @property {'restatement'} kind Result kind.
 */

/**
 * Error raised for malformed input, bad options, or unsupported API use.
 * `code` is stable enough for callers to branch on; messages are for humans.
 */
export class XbrlError extends Error {
  /**
   * @param {string} code Stable machine-readable error code.
   * @param {string} message Human-readable message.
   */
  constructor(code, message) {
    super(message)
    this.name = 'XbrlError'
    this.code = code
  }
}

/**
 * Roles and aliases for the balance-sheet identity.
 *
 * Aliases are matched case-insensitively after dropping a namespace prefix and
 * removing whitespace, underscores, and hyphens. The first alias that exists in
 * a facts file wins, so keep more specific aliases before broader ones.
 *
 * @type {ReadonlyArray<{key: string, label: string, aliases: ReadonlyArray<string>}>}
 */
export const BALANCE_SHEET_ROLES = Object.freeze([
  Object.freeze({
    key: 'assets',
    label: 'Assets',
    aliases: Object.freeze([
      'Assets',
      'TotalAssets',
      'AssetsTotal',
      '资产总计',
      '资产合计',
      '资产总额',
      '总资产',
    ]),
  }),
  Object.freeze({
    key: 'liabilities',
    label: 'Liabilities',
    aliases: Object.freeze([
      'Liabilities',
      'TotalLiabilities',
      'LiabilitiesTotal',
      '负债总计',
      '负债合计',
      '负债总额',
      '总负债',
    ]),
  }),
  Object.freeze({
    key: 'equity',
    label: 'Equity',
    aliases: Object.freeze([
      'Equity',
      'TotalEquity',
      'EquityTotal',
      'StockholdersEquity',
      'TotalStockholdersEquity',
      'ShareholdersEquity',
      'TotalShareholdersEquity',
      'OwnersEquity',
      '所有者权益合计',
      '所有者权益总计',
      '所有者权益',
      '股东权益合计',
      '股东权益总计',
      '股东权益',
      '净资产',
    ]),
  }),
])

/**
 * Roles and aliases for `Revenue - Expenses = Net income`.
 *
 * These are convenience labels, not an authoritative taxonomy mapping. A real
 * income statement may not report a single "Expenses" total; supply one
 * explicitly if you want this identity checked.
 *
 * @type {ReadonlyArray<{key: string, label: string, aliases: ReadonlyArray<string>}>}
 */
export const INCOME_STATEMENT_ROLES = Object.freeze([
  Object.freeze({
    key: 'revenue',
    label: 'Revenue',
    aliases: Object.freeze([
      'Revenue',
      'Revenues',
      'TotalRevenue',
      'RevenueTotal',
      'OperatingRevenue',
      'SalesRevenue',
      'NetRevenue',
      '营业收入',
      '营业总收入',
      '收入合计',
      '总收入',
      '营收',
    ]),
  }),
  Object.freeze({
    key: 'expenses',
    label: 'Expenses',
    aliases: Object.freeze([
      'Expenses',
      'TotalExpenses',
      'ExpensesTotal',
      'OperatingExpenses',
      'TotalOperatingExpenses',
      'CostsAndExpenses',
      '费用合计',
      '成本费用合计',
      '成本费用',
      '营业总成本',
      '营业成本及费用',
      '总费用',
    ]),
  }),
  Object.freeze({
    key: 'netIncome',
    label: 'Net income',
    aliases: Object.freeze([
      'NetIncome',
      'NetIncomeLoss',
      'NetProfit',
      'ProfitForThePeriod',
      'NetEarnings',
      '净利润',
      '净利润合计',
      '净收益',
      '净利',
    ]),
  }),
])

const NAMESPACE_PREFIX = /^[A-Za-z_][A-Za-z0-9._-]*:/
const DECIMAL_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

/**
 * Parse and validate a facts document.
 *
 * Accepts either a plain object or a JSON string. Required fields are `entity`,
 * `period`, and `facts`; each fact requires `concept`, `value`, and `unit`.
 * `value` may be a finite number or a plain decimal string (no thousands
 * separators). Fact `period` is optional and preserved when supplied.
 *
 * Duplicate concepts are rejected, not silently overwritten. Concepts are
 * compared after trimming, dropping a namespace prefix such as `us-gaap:`,
 * lower-casing, and removing whitespace, `_`, and `-`.
 *
 * @param {string|object} input JSON text or an object with `{entity, period, facts}`.
 * @returns {FactsDocument}
 * @throws {XbrlError} `ERR_JSON`, `ERR_SCHEMA`, `ERR_VALUE`, or `ERR_DUPLICATE`.
 */
export function parseFacts(input) {
  const document = typeof input === 'string' ? parseJsonText(input) : input
  if (!isPlainObject(document)) {
    throw new XbrlError(
      'ERR_SCHEMA',
      'facts document must be a JSON object with { entity, period, facts }',
    )
  }

  const entity = requireNonEmptyString(document.entity, 'entity')
  const period = requireNonEmptyString(document.period, 'period')
  if (!Array.isArray(document.facts)) {
    throw new XbrlError('ERR_SCHEMA', 'facts must be an array')
  }

  return { entity, period, facts: validateFactsArray(document.facts) }
}

/**
 * Check `Assets = Liabilities + Equity`.
 *
 * The first matching alias for each role is used. Missing roles are reported in
 * `missing`; in that case `lhs`, `rhs`, and `diff` are null and `ok` is false.
 * Passing is based on `|diff| <= tolerance`.
 *
 * @param {FactsDocument|XbrlFact[]|string} input Parsed document, facts array, or JSON text.
 * @param {{tolerance?: number}} [options] Absolute tolerance; defaults to 0.01.
 * @returns {CheckResult}
 * @throws {XbrlError} On invalid input or an invalid tolerance.
 */
export function checkBalanceSheet(input, options = {}) {
  const tolerance = resolveTolerance(options)
  const facts = factsFrom(input)
  const { values, matched, missing } = resolveRoles(facts, BALANCE_SHEET_ROLES)

  const complete = missing.length === 0
  const lhs = complete ? values.assets : null
  const rhs = complete ? values.liabilities + values.equity : null
  const diff = complete ? lhs - rhs : null

  return {
    ok: complete && Math.abs(diff) <= tolerance,
    lhs,
    rhs,
    diff,
    missing,
    tolerance,
    kind: 'balance-sheet',
    identity: 'Assets = Liabilities + Equity',
    lhsLabel: 'Assets',
    rhsLabel: 'Liabilities + Equity',
    matched,
    values,
  }
}

/**
 * Check `Revenue - Expenses = Net income`.
 *
 * Here `lhs` is `revenue - expenses` and `rhs` is `netIncome`, mirroring the
 * formula literally. Missing roles make `lhs`, `rhs`, and `diff` null and force
 * `ok` to false. Passing is based on `|diff| <= tolerance`.
 *
 * @param {FactsDocument|XbrlFact[]|string} input Parsed document, facts array, or JSON text.
 * @param {{tolerance?: number}} [options] Absolute tolerance; defaults to 0.01.
 * @returns {CheckResult}
 * @throws {XbrlError} On invalid input or an invalid tolerance.
 */
export function checkIncomeStatement(input, options = {}) {
  const tolerance = resolveTolerance(options)
  const facts = factsFrom(input)
  const { values, matched, missing } = resolveRoles(facts, INCOME_STATEMENT_ROLES)

  const complete = missing.length === 0
  const lhs = complete ? values.revenue - values.expenses : null
  const rhs = complete ? values.netIncome : null
  const diff = complete ? lhs - rhs : null

  return {
    ok: complete && Math.abs(diff) <= tolerance,
    lhs,
    rhs,
    diff,
    missing,
    tolerance,
    kind: 'income-statement',
    identity: 'Revenue - Expenses = Net income',
    lhsLabel: 'Revenue - Expenses',
    rhsLabel: 'Net income',
    matched,
    values,
  }
}

/**
 * Compare two fact snapshots by concept.
 *
 * Concepts are aligned with the same normalization used by `parseFacts`. Added
 * and removed lists contain concept names as written in the newer/older
 * snapshot. A concept is `changed` when its value differs exactly; there is no
 * tolerance in a restatement diff. Units and per-fact periods are not compared.
 *
 * `pct` is `(after - before) / |before| * 100`, rounded to six decimals, and is
 * null when `before` is 0 or the percentage is not finite.
 *
 * @param {FactsDocument|XbrlFact[]|string} prev Older snapshot.
 * @param {FactsDocument|XbrlFact[]|string} next Newer snapshot.
 * @returns {RestatementDiff}
 * @throws {XbrlError} On invalid input or duplicate concepts.
 */
export function diffRestatement(prev, next) {
  const beforeIndex = indexByCanonical(factsFrom(prev))
  const afterIndex = indexByCanonical(factsFrom(next))

  /** @type {string[]} */
  const added = []
  /** @type {string[]} */
  const removed = []
  /** @type {RestatementChange[]} */
  const changed = []

  for (const [key, entry] of afterIndex) {
    const previous = beforeIndex.get(key)
    if (!previous) {
      added.push(entry.fact.concept)
      continue
    }
    if (previous.fact.value !== entry.fact.value) {
      const delta = entry.fact.value - previous.fact.value
      changed.push({
        concept: entry.fact.concept,
        before: previous.fact.value,
        after: entry.fact.value,
        delta,
        pct: percentChange(previous.fact.value, entry.fact.value),
      })
    }
  }

  for (const [key, entry] of beforeIndex) {
    if (!afterIndex.has(key)) removed.push(entry.fact.concept)
  }

  added.sort(compareStrings)
  removed.sort(compareStrings)
  changed.sort((a, b) => compareStrings(a.concept, b.concept))

  return {
    added,
    removed,
    changed,
    hasChanges: added.length > 0 || removed.length > 0 || changed.length > 0,
    kind: 'restatement',
  }
}

/**
 * Render a check or restatement result as text or JSON.
 *
 * @param {CheckResult|RestatementDiff|object} result Result returned by this module.
 * @param {{json?: boolean}} [options] When `json` is true, pretty-print JSON.
 * @returns {string} Report text without a trailing newline.
 * @throws {XbrlError} When `result` is not a plain object.
 */
export function formatReport(result, options = {}) {
  if (!isPlainObject(result)) {
    throw new XbrlError('ERR_INPUT', 'formatReport expects a result object')
  }
  if (options?.json === true) return JSON.stringify(result, null, 2)

  if (result.kind === 'balance-sheet' || result.kind === 'income-statement') {
    return formatCheckResult(result)
  }
  if (result.kind === 'restatement') return formatRestatementResult(result)
  return JSON.stringify(result, null, 2)
}

/**
 * Normalize a concept for alias lookup and diff alignment.
 *
 * @param {string} concept Raw concept name.
 * @returns {string}
 */
function canonicalConcept(concept) {
  return String(concept)
    .trim()
    .replace(NAMESPACE_PREFIX, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * @param {string} text
 * @returns {unknown}
 */
function parseJsonText(text) {
  const source = text.replace(/^\uFEFF/, '').trim()
  if (source === '') throw new XbrlError('ERR_JSON', 'input is empty')

  try {
    return JSON.parse(source)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new XbrlError('ERR_JSON', `invalid JSON: ${reason}`)
  }
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new XbrlError('ERR_SCHEMA', `${field} must be a non-empty string`)
  }
  return value.trim()
}

/**
 * @param {unknown} rawFact
 * @param {number} index
 * @returns {XbrlFact}
 */
function normalizeFact(rawFact, index) {
  const where = `facts[${index}]`
  if (!isPlainObject(rawFact)) {
    throw new XbrlError('ERR_SCHEMA', `${where} must be an object`)
  }

  const concept = requireNonEmptyString(rawFact.concept, `${where}.concept`)
  const value = parseValue(rawFact.value, `${where}.value`)
  const unit = requireNonEmptyString(rawFact.unit, `${where}.unit`)

  /** @type {XbrlFact} */
  const fact = { concept, value, unit }
  if (rawFact.period !== undefined) {
    fact.period = requireNonEmptyString(rawFact.period, `${where}.period`)
  }
  return fact
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {number}
 */
function parseValue(value, field) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new XbrlError('ERR_VALUE', `${field} must be a finite number`)
    }
    return value
  }

  if (typeof value === 'string') {
    const text = value.trim()
    if (text !== '' && DECIMAL_TEXT.test(text)) {
      const numeric = Number(text)
      if (Number.isFinite(numeric)) return numeric
    }
  }

  throw new XbrlError(
    'ERR_VALUE',
    `${field} must be a finite number or a plain decimal string (got ${preview(value)})`,
  )
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function preview(value) {
  if (typeof value === 'string') {
    const clipped = value.length > 40 ? `${value.slice(0, 37)}...` : value
    return JSON.stringify(clipped)
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/**
 * @param {unknown[]} rawFacts
 * @returns {XbrlFact[]}
 */
function validateFactsArray(rawFacts) {
  const facts = rawFacts.map((rawFact, index) => normalizeFact(rawFact, index))
  indexByCanonical(facts)
  return facts
}

/**
 * Index facts by canonical concept and reject duplicates.
 *
 * @param {XbrlFact[]} facts
 * @returns {Map<string, {fact: XbrlFact, index: number}>}
 */
function indexByCanonical(facts) {
  const index = new Map()
  for (let position = 0; position < facts.length; position += 1) {
    const fact = facts[position]
    const key = canonicalConcept(fact.concept)
    const prior = index.get(key)
    if (prior) {
      throw new XbrlError(
        'ERR_DUPLICATE',
        `duplicate concept "${fact.concept}" at facts[${position}] (already present as ` +
          `"${prior.fact.concept}" at facts[${prior.index}]); concepts are compared after ` +
          'trimming, dropping a namespace prefix, lower-casing, and removing spaces/_/-, and ' +
          'duplicates are rejected rather than silently overwritten',
      )
    }
    index.set(key, { fact, index: position })
  }
  return index
}

/**
 * Accept a parsed document, a raw facts array, or JSON text from check APIs.
 *
 * @param {FactsDocument|XbrlFact[]|string} input
 * @returns {XbrlFact[]}
 */
function factsFrom(input) {
  if (typeof input === 'string') return parseFacts(input).facts
  if (Array.isArray(input)) return validateFactsArray(input)
  if (isPlainObject(input) && Array.isArray(input.facts)) {
    return validateFactsArray(input.facts)
  }
  throw new XbrlError(
    'ERR_INPUT',
    'expected a facts document, a facts array, or JSON text',
  )
}

/**
 * @param {{tolerance?: number}|null|undefined} options
 * @returns {number}
 */
function resolveTolerance(options) {
  const source = options ?? {}
  if (!isPlainObject(source)) {
    throw new XbrlError('ERR_OPTIONS', 'options must be an object')
  }
  const tolerance = source.tolerance ?? DEFAULT_TOLERANCE
  if (typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance < 0) {
    throw new XbrlError('ERR_TOLERANCE', 'tolerance must be a finite, non-negative number')
  }
  return tolerance
}

/**
 * @param {XbrlFact[]} facts
 * @param {ReadonlyArray<{key: string, aliases: ReadonlyArray<string>}>} roles
 * @returns {{values: Record<string, number>, matched: Record<string, string>, missing: string[]}}
 */
function resolveRoles(facts, roles) {
  const index = indexByCanonical(facts)
  /** @type {Record<string, number>} */
  const values = {}
  /** @type {Record<string, string>} */
  const matched = {}
  /** @type {string[]} */
  const missing = []

  for (const role of roles) {
    let found = null
    for (const alias of role.aliases) {
      const candidate = index.get(canonicalConcept(alias))
      if (candidate) {
        found = candidate
        break
      }
    }

    if (found) {
      values[role.key] = found.fact.value
      matched[role.key] = found.fact.concept
    } else {
      missing.push(role.key)
    }
  }

  return { values, matched, missing }
}

/**
 * @param {number} before
 * @param {number} after
 * @returns {number|null}
 */
function percentChange(before, after) {
  if (before === 0) return null
  const raw = ((after - before) / Math.abs(before)) * 100
  if (!Number.isFinite(raw)) return null
  const rounded = Number(raw.toFixed(6))
  return Object.is(rounded, -0) ? 0 : rounded
}

/**
 * Locale-independent string sort.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareStrings(a, b) {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/**
 * @param {number|null|undefined} value
 * @returns {string}
 */
function showNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a'
  return String(value)
}

/**
 * @param {number|null|undefined} value
 * @returns {string}
 */
function showSigned(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a'
  return value > 0 ? `+${value}` : String(value)
}

/**
 * @param {CheckResult} result
 * @returns {string}
 */
function formatCheckResult(result) {
  const title = result.kind === 'balance-sheet' ? 'Balance sheet' : 'Income statement'
  const status = result.missing.length > 0 ? 'INCOMPLETE' : result.ok ? 'PASS' : 'FAIL'

  const lines = [
    `${title} [${status}]`,
    `  identity: ${result.identity}`,
    `  ${result.lhsLabel} (lhs): ${showNumber(result.lhs)}`,
    `  ${result.rhsLabel} (rhs): ${showNumber(result.rhs)}`,
    `  difference: ${showSigned(result.diff)} (tolerance ${showNumber(result.tolerance)})`,
  ]

  const matched = Object.entries(result.matched ?? {})
  if (matched.length > 0) {
    lines.push(`  matched: ${matched.map(([role, concept]) => `${role}=${concept}`).join(', ')}`)
  }
  if (result.missing.length > 0) {
    lines.push(`  missing: ${result.missing.join(', ')}`)
  }
  return lines.join('\n')
}

/**
 * @param {RestatementDiff} result
 * @returns {string}
 */
function formatRestatementResult(result) {
  const lines = [`Restatement diff [${result.hasChanges ? 'CHANGED' : 'NO CHANGES'}]`]

  lines.push(`  added: ${result.added.length}`)
  for (const concept of result.added) lines.push(`    + ${concept}`)

  lines.push(`  removed: ${result.removed.length}`)
  for (const concept of result.removed) lines.push(`    - ${concept}`)

  lines.push(`  changed: ${result.changed.length}`)
  for (const change of result.changed) {
    const pct = change.pct === null || change.pct === undefined
      ? 'n/a'
      : `${showSigned(change.pct)}%`
    lines.push(
      `    ~ ${change.concept}: ${showNumber(change.before)} -> ${showNumber(change.after)} ` +
        `(delta ${showSigned(change.delta)}, pct ${pct})`,
    )
  }

  return lines.join('\n')
}
