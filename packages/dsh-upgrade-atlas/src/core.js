/**
 * Pure core for `dsh-upgrade-atlas`.
 *
 * A breakpoint entry records one DeepSeek Harness (DSH) release change that can
 * break an existing profile, plugin, script, or Session. This module validates
 * entries, builds validated atlases, queries them by package and version
 * window, renders Markdown, and counts entries.
 *
 * It performs no I/O and imports nothing outside the JavaScript language, so
 * `node --test` can run it offline.
 *
 * @module dsh-upgrade-atlas/core
 */

/** Schema version understood by this implementation. */
export const SCHEMA_VERSION = 1

/** Severity values, highest impact first. */
export const SEVERITIES = Object.freeze(['P0', 'P1', 'P2', 'P3'])

/**
 * Entry kinds. `package` covers renames and export removal, `api` covers
 * service and wire-interface changes, `agent` covers subagent and Team
 * behavior, and `ui` covers labels or documentation only.
 */
export const KINDS = Object.freeze([
  'runtime',
  'package',
  'api',
  'config',
  'protocol',
  'tool',
  'agent',
  'ui',
])

/** A `to` value of `*` means "target release unknown: no release bound was established". */
export const OPEN_VERSION = '*'

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const KIND_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const VERSION_PATTERN =
  /^v?(\d+)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

/**
 * Error raised for invalid entries, atlases, and queries.
 *
 * @example
 * try {
 *   validateEntry({ id: 'x' })
 * } catch (error) {
 *   console.error(error.code, error.issues)
 * }
 */
export class AtlasError extends Error {
  /**
   * @param {string} code Stable machine-readable code.
   * @param {string} message Human-readable summary.
   * @param {{issues?: string[], [key: string]: unknown}} [details]
   */
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'AtlasError'
    this.code = code
    if (Array.isArray(details.issues)) this.issues = details.issues
    if (details.id !== undefined) this.id = details.id
    this.details = details
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareText(a, b) {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/**
 * Parse a semver-like DSH version. Missing components are allowed for query
 * prefixes (`0.2`, `0.2.x`), and a leading `v` is ignored.
 *
 * @param {unknown} value
 * @param {string} label Field name used in error messages.
 * @param {string[]} issues Receives human-readable problems.
 * @returns {{
 *   open: boolean,
 *   raw: string,
 *   major?: number,
 *   minor?: number | null,
 *   patch?: number | null,
 *   prerelease?: string[],
 *   partial?: boolean
 * } | null}
 */
function parseVersion(value, label, issues) {
  if (!isNonEmptyString(value)) {
    issues.push(`${label} must be a non-empty version string`)
    return null
  }
  const raw = value.trim()
  if (raw === OPEN_VERSION) return { open: true, raw }

  const match = VERSION_PATTERN.exec(raw)
  if (match === null) {
    issues.push(`${label} is not a valid version: ${raw}`)
    return null
  }

  const minorRaw = match[2]
  const patchRaw = match[3]
  const wildcard = (part) => part === undefined || /^[xX*]$/.test(part)
  const minor = wildcard(minorRaw) ? null : Number(minorRaw)
  const patch = wildcard(patchRaw) ? null : Number(patchRaw)

  if (minor === null && patch !== null) {
    issues.push(`${label} cannot name a patch without a minor version: ${raw}`)
    return null
  }

  const prerelease = match[4] === undefined ? [] : match[4].split('.')
  if (minor === null && prerelease.length > 0) {
    issues.push(`${label} cannot carry a prerelease without a full version: ${raw}`)
    return null
  }

  return {
    open: false,
    raw,
    major: Number(match[1]),
    minor,
    patch,
    prerelease,
    partial: minor === null || patch === null,
  }
}

/**
 * Fill missing version components with zero.
 *
 * @param {Exclude<ReturnType<typeof parseVersion>, null>} version
 * @param {string[]} [prerelease]
 * @returns {{major: number, minor: number, patch: number, prerelease: string[]}}
 */
function concrete(version, prerelease = version.prerelease ?? []) {
  return {
    major: version.major ?? 0,
    minor: version.minor ?? 0,
    patch: version.patch ?? 0,
    prerelease,
  }
}

/**
 * Exclusive upper bound after a partial prefix, with a `0` prerelease so the
 * next release's own prereleases are excluded too.
 *
 * @param {Exclude<ReturnType<typeof parseVersion>, null>} version
 * @returns {{major: number, minor: number, patch: number, prerelease: string[]}}
 */
function nextPrefix(version) {
  if (version.minor === null) {
    return { major: (version.major ?? 0) + 1, minor: 0, patch: 0, prerelease: ['0'] }
  }
  if (version.patch === null) {
    return { major: version.major ?? 0, minor: version.minor + 1, patch: 0, prerelease: ['0'] }
  }
  return {
    major: version.major ?? 0,
    minor: version.minor,
    patch: version.patch + 1,
    prerelease: ['0'],
  }
}

/**
 * Exclusive upper bound immediately after one exact release.
 *
 * @param {Exclude<ReturnType<typeof parseVersion>, null>} version
 * @returns {{major: number, minor: number, patch: number, prerelease: string[]}}
 */
function nextPatch(version) {
  return {
    major: version.major ?? 0,
    minor: version.minor ?? 0,
    patch: (version.patch ?? 0) + 1,
    prerelease: ['0'],
  }
}

/**
 * Semver precedence for the DSH subset. Build metadata is not accepted.
 *
 * @param {{major: number, minor: number, patch: number, prerelease: string[]}} a
 * @param {{major: number, minor: number, patch: number, prerelease: string[]}} b
 * @returns {-1 | 0 | 1}
 */
function compareVersions(a, b) {
  for (const key of /** @type {const} */ (['major', 'minor', 'patch'])) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }

  const aPre = a.prerelease
  const bPre = b.prerelease
  if (aPre.length === 0 && bPre.length === 0) return 0
  if (aPre.length === 0) return 1
  if (bPre.length === 0) return -1

  const length = Math.max(aPre.length, bPre.length)
  for (let index = 0; index < length; index += 1) {
    const left = aPre[index]
    const right = bPre[index]
    if (left === undefined) return -1
    if (right === undefined) return 1

    const leftNumeric = /^\d+$/.test(left)
    const rightNumeric = /^\d+$/.test(right)
    if (leftNumeric && rightNumeric) {
      const leftNumber = Number(left)
      const rightNumber = Number(right)
      if (leftNumber !== rightNumber) return leftNumber < rightNumber ? -1 : 1
      continue
    }
    if (leftNumeric) return -1
    if (rightNumeric) return 1
    if (left !== right) return compareText(left, right)
  }
  return 0
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {Exclude<ReturnType<typeof parseVersion>, null>}
 */
function parseEntryVersion(value, label) {
  const issues = []
  const version = parseVersion(value, label, issues)
  if (version === null) {
    throw new AtlasError('INVALID_ENTRY', issues.join('; '), { issues })
  }
  return version
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {Exclude<ReturnType<typeof parseVersion>, null>}
 */
function parseQueryVersion(value, label) {
  const issues = []
  const version = parseVersion(value, label, issues)
  if (version === null) {
    throw new AtlasError('INVALID_QUERY', issues.join('; '), { issues })
  }
  return version
}

/**
 * Upper bound of an entry range. A partial `to` (`0.2`) ends just before the
 * next component's first prerelease; an exact `to` is inclusive.
 *
 * @param {Exclude<ReturnType<typeof parseVersion>, null>} version
 * @returns {{
 *   value: {major: number, minor: number, patch: number, prerelease: string[]},
 *   exclusive: boolean
 * } | null}
 */
function entryUpperBound(version) {
  if (version.open) return null
  if (version.partial) return { value: nextPrefix(version), exclusive: true }
  return { value: concrete(version), exclusive: false }
}

/**
 * Inclusive lower and upper bounds of one entry's affected version range.
 *
 * @param {{from: string, to: string}} entry
 * @returns {{
 *   lower: {major: number, minor: number, patch: number, prerelease: string[]},
 *   upper: {major: number, minor: number, patch: number, prerelease: string[]} | null,
 *   upperExclusive: boolean
 * }}
 */
function entryBounds(entry) {
  const from = parseEntryVersion(entry.from, 'from')
  if (from.open) {
    throw new AtlasError('INVALID_ENTRY', 'from must name a concrete version')
  }
  const to = parseEntryVersion(entry.to, 'to')
  const upperBound = entryUpperBound(to)

  return {
    lower: from.partial ? concrete(from, ['0']) : concrete(from),
    upper: upperBound === null ? null : upperBound.value,
    upperExclusive: upperBound === null ? false : upperBound.exclusive,
  }
}

/**
 * Turn query `from`/`to` values into a version window. A version without a
 * prerelease is prefix-aware: `0.2.1` covers `0.2.1-rc.*` and `0.2.1`, while a
 * partial version such as `0.2` covers every `0.2.x` release.
 *
 * @param {{from?: string, to?: string}} filters
 * @returns {{
 *   lower: {major: number, minor: number, patch: number, prerelease: string[]} | null,
 *   upper: {major: number, minor: number, patch: number, prerelease: string[]} | null,
 *   upperExclusive: boolean
 * }}
 */
function queryBounds(filters) {
  let lower = null
  let upper = null
  let upperExclusive = false

  if (filters.from !== undefined) {
    const from = parseQueryVersion(filters.from, 'from')
    if (!from.open) {
      lower =
        from.partial || from.prerelease.length === 0
          ? concrete(from, ['0'])
          : concrete(from)
    }
  }

  if (filters.to !== undefined) {
    const to = parseQueryVersion(filters.to, 'to')
    if (!to.open) {
      if (to.partial) {
        upper = nextPrefix(to)
        upperExclusive = true
      } else if (to.prerelease.length === 0) {
        upper = nextPatch(to)
        upperExclusive = true
      } else {
        upper = concrete(to)
      }
    }
  }

  if (lower !== null && upper !== null) {
    const comparison = compareVersions(lower, upper)
    const empty = upperExclusive ? comparison >= 0 : comparison > 0
    if (empty) {
      throw new AtlasError(
        'INVALID_QUERY',
        `empty version window: from ${filters.from} is after to ${filters.to}`,
      )
    }
  }

  return { lower, upper, upperExclusive }
}

/**
 * @param {Record<string, unknown>} filters
 * @returns {{package?: string, from?: string, to?: string, severity?: string, kind?: string}}
 */
function normalizeFilters(filters) {
  if (filters === undefined || filters === null) filters = {}
  if (!isPlainObject(filters)) {
    throw new AtlasError('INVALID_QUERY', 'filters must be an object')
  }

  const allowed = new Set(['package', 'from', 'to', 'severity', 'kind'])
  for (const key of Object.keys(filters)) {
    if (!allowed.has(key)) {
      throw new AtlasError('INVALID_QUERY', `unknown filter: ${key}`)
    }
  }

  /** @type {{package?: string, from?: string, to?: string, severity?: string, kind?: string}} */
  const result = {}

  for (const key of /** @type {const} */ (['package', 'from', 'to'])) {
    if (filters[key] === undefined) continue
    if (!isNonEmptyString(filters[key])) {
      throw new AtlasError('INVALID_QUERY', `${key} must be a non-empty string`)
    }
    result[key] = filters[key].trim()
  }

  if (filters.severity !== undefined) {
    if (!isNonEmptyString(filters.severity)) {
      throw new AtlasError('INVALID_QUERY', 'severity must be a non-empty string')
    }
    const severity = filters.severity.trim().toUpperCase()
    if (!SEVERITIES.some((item) => item.startsWith(severity))) {
      throw new AtlasError('INVALID_QUERY', `unknown severity: ${filters.severity}`)
    }
    result.severity = severity
  }

  if (filters.kind !== undefined) {
    if (!isNonEmptyString(filters.kind)) {
      throw new AtlasError('INVALID_QUERY', 'kind must be a non-empty string')
    }
    const kind = filters.kind.trim().toLowerCase()
    if (!KIND_PATTERN.test(kind)) {
      throw new AtlasError(
        'INVALID_QUERY',
        'kind must be lowercase kebab-case (for example "api")',
      )
    }
    result.kind = kind
  }

  return result
}

/**
 * Whether one entry overlaps the query window and scalar filters.
 *
 * @param {{package: string, kind: string, severity: string, from: string, to: string}} entry
 * @param {{package?: string, severity?: string, kind?: string}} filters
 * @param {ReturnType<typeof queryBounds>} bounds
 * @returns {boolean}
 */
function matchesEntry(entry, filters, bounds) {
  if (filters.package !== undefined && !entry.package.startsWith(filters.package)) {
    return false
  }
  if (filters.kind !== undefined && !entry.kind.startsWith(filters.kind)) return false
  if (
    filters.severity !== undefined &&
    !entry.severity.startsWith(filters.severity)
  ) {
    return false
  }

  const window = entryBounds(entry)
  if (bounds.lower !== null && window.upper !== null) {
    const comparison = compareVersions(window.upper, bounds.lower)
    if (window.upperExclusive ? comparison <= 0 : comparison < 0) return false
  }
  if (bounds.upper !== null) {
    const comparison = compareVersions(window.lower, bounds.upper)
    if (bounds.upperExclusive ? comparison >= 0 : comparison > 0) return false
  }
  return true
}

/**
 * @param {string} severity
 * @returns {number}
 */
function severityRank(severity) {
  const index = SEVERITIES.indexOf(severity)
  return index === -1 ? SEVERITIES.length : index
}

/**
 * Compare entry `from` versions, falling back to text for malformed values.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareFromVersions(a, b) {
  const left = parseVersion(a, 'from', [])
  const right = parseVersion(b, 'from', [])
  if (left === null || left.open || right === null || right.open) {
    return compareText(a, b)
  }
  return compareVersions(concrete(left), concrete(right))
}

/**
 * Stable query order: severity, package, from version, then id.
 *
 * @template {{id: string, package: string, severity: string, from: string}} T
 * @param {T[]} entries
 * @returns {T[]}
 */
function sortEntries(entries) {
  return entries.slice().sort((left, right) => {
    const severity =
      severityRank(left.severity) - severityRank(right.severity)
    if (severity !== 0) return severity

    const packageOrder = compareText(left.package, right.package)
    if (packageOrder !== 0) return packageOrder

    const versionOrder = compareFromVersions(left.from, right.from)
    if (versionOrder !== 0) return versionOrder

    return compareText(left.id, right.id)
  })
}

/**
 * Extract entries from an atlas object or accept an entries array directly.
 *
 * @param {unknown} atlas
 * @returns {any[]}
 */
function entriesOf(atlas) {
  if (Array.isArray(atlas)) return atlas
  if (isPlainObject(atlas) && Array.isArray(atlas.entries)) return atlas.entries
  throw new AtlasError(
    'INVALID_ATLAS',
    'atlas must be an entry array or an object with an entries array',
  )
}

/**
 * @param {Record<string, unknown>} entry
 * @param {string} field
 * @param {string[]} issues
 * @returns {string | null}
 */
function requireString(entry, field, issues) {
  const value = entry[field]
  if (!isNonEmptyString(value)) {
    issues.push(`${field} must be a non-empty string`)
    return null
  }
  return value.trim()
}

/**
 * Validate and normalize one breakpoint entry.
 *
 * The returned object contains exactly the documented fields, with `evidence`
 * normalized to an array and strings trimmed. Invalid input throws an
 * {@link AtlasError} with code `INVALID_ENTRY` and an `issues` array.
 *
 * @param {unknown} entry
 * @returns {{
 *   id: string,
 *   package: string,
 *   from: string,
 *   to: string,
 *   kind: string,
 *   severity: string,
 *   summary: string,
 *   fix: string,
 *   evidence: string[]
 * }}
 */
export function validateEntry(entry) {
  if (!isPlainObject(entry)) {
    throw new AtlasError('INVALID_ENTRY', 'entry must be an object', {
      issues: ['entry must be an object'],
    })
  }

  const issues = []
  const id = requireString(entry, 'id', issues)
  const packageName = requireString(entry, 'package', issues)
  const from = requireString(entry, 'from', issues)
  const to = requireString(entry, 'to', issues)
  const kind = requireString(entry, 'kind', issues)
  const severity = requireString(entry, 'severity', issues)
  const summary = requireString(entry, 'summary', issues)
  const fix = requireString(entry, 'fix', issues)

  if (id !== null && !ID_PATTERN.test(id)) {
    issues.push('id must be lowercase kebab-case (for example "node-24-minimum")')
  }
  if (severity !== null && !SEVERITIES.includes(severity)) {
    issues.push(`severity must be one of ${SEVERITIES.join(', ')}`)
  }
  if (kind !== null && !KIND_PATTERN.test(kind)) {
    issues.push('kind must be lowercase kebab-case (for example "api")')
  }

  const fromVersion = from === null ? null : parseVersion(from, 'from', issues)
  const toVersion = to === null ? null : parseVersion(to, 'to', issues)

  if (fromVersion !== null && fromVersion.open) {
    issues.push('from must name a concrete version, not "*"')
  }
  if (fromVersion !== null && toVersion !== null) {
    const lower =
      fromVersion.open || toVersion.open
        ? null
        : fromVersion.partial
          ? concrete(fromVersion, ['0'])
          : concrete(fromVersion)
    const upperBound =
      fromVersion.open || toVersion.open ? null : entryUpperBound(toVersion)
    if (lower !== null && upperBound !== null) {
      const comparison = compareVersions(lower, upperBound.value)
      if (upperBound.exclusive ? comparison >= 0 : comparison > 0) {
        issues.push('to must be greater than or equal to from')
      }
    }
  }

  /** @type {string[]} */
  const evidence = []
  if (typeof entry.evidence === 'string') {
    if (!isNonEmptyString(entry.evidence)) {
      issues.push('evidence must not be empty')
    } else {
      evidence.push(entry.evidence.trim())
    }
  } else if (Array.isArray(entry.evidence)) {
    if (entry.evidence.length === 0) {
      issues.push('evidence must contain at least one path or URL')
    }
    entry.evidence.forEach((item, index) => {
      if (!isNonEmptyString(item)) {
        issues.push(`evidence[${index}] must be a non-empty string`)
      } else {
        evidence.push(item.trim())
      }
    })
  } else {
    issues.push('evidence must be a string or an array of strings')
  }

  if (issues.length > 0) {
    throw new AtlasError(
      'INVALID_ENTRY',
      id === null ? 'invalid entry' : `invalid entry "${id}"`,
      { issues },
    )
  }

  return {
    id,
    package: packageName,
    from,
    to,
    kind,
    severity,
    summary,
    fix,
    evidence,
  }
}

/**
 * Build a validated atlas. Duplicate ids are rejected.
 *
 * @param {unknown[]} [entries]
 * @returns {{schemaVersion: number, entries: ReturnType<typeof validateEntry>[]}}
 */
export function createAtlas(entries = []) {
  if (!Array.isArray(entries)) {
    throw new AtlasError('INVALID_ATLAS', 'createAtlas expects an array of entries')
  }

  const seen = new Set()
  const normalized = entries.map((entry) => {
    const value = validateEntry(entry)
    if (seen.has(value.id)) {
      throw new AtlasError('DUPLICATE_ID', `duplicate entry id: ${value.id}`, {
        id: value.id,
      })
    }
    seen.add(value.id)
    return value
  })

  return { schemaVersion: SCHEMA_VERSION, entries: normalized }
}

/**
 * Append one validated entry to an atlas and return that same atlas/array.
 * Invalid or duplicate input leaves the atlas unchanged.
 *
 * @param {unknown} atlas
 * @param {unknown} entry
 * @returns {any}
 */
export function addEntry(atlas, entry) {
  const current = entriesOf(atlas)
  const value = validateEntry(entry)
  if (current.some((item) => item.id === value.id)) {
    throw new AtlasError('DUPLICATE_ID', `duplicate entry id: ${value.id}`, {
      id: value.id,
    })
  }

  current.push(value)
  if (!Array.isArray(atlas)) {
    atlas.entries = current
    if (atlas.schemaVersion === undefined) atlas.schemaVersion = SCHEMA_VERSION
  }
  return atlas
}

/**
 * Query an atlas.
 *
 * `package`, `severity`, and `kind` are prefix filters. `from` and `to` select
 * entries whose affected version range overlaps the requested window; a
 * missing bound is open. Results are sorted by severity, package, `from`, and
 * id.
 *
 * @param {unknown} atlas
 * @param {{package?: string, from?: string, to?: string, severity?: string, kind?: string}} [filters]
 * @returns {ReturnType<typeof validateEntry>[]}
 */
export function query(atlas, filters = {}) {
  const entries = entriesOf(atlas)
  const normalized = normalizeFilters(filters)
  const bounds = queryBounds(normalized)
  return sortEntries(entries.filter((entry) => matchesEntry(entry, normalized, bounds)))
}

/**
 * Count entries by severity and kind. Every known severity and kind appears,
 * including zero counts, so output shape is stable.
 *
 * @param {unknown} atlas
 * @returns {{
 *   total: number,
 *   bySeverity: Record<string, number>,
 *   byKind: Record<string, number>
 * }}
 */
export function stats(atlas) {
  const entries = entriesOf(atlas)
  /** @type {Record<string, number>} */
  const bySeverity = {}
  for (const severity of SEVERITIES) bySeverity[severity] = 0
  /** @type {Record<string, number>} */
  const byKind = {}
  for (const kind of KINDS) byKind[kind] = 0

  for (const entry of entries) {
    bySeverity[entry.severity] = (bySeverity[entry.severity] ?? 0) + 1
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1
  }

  return { total: entries.length, bySeverity, byKind }
}

/**
 * Escape one Markdown table cell.
 *
 * @param {unknown} value
 * @returns {string}
 */
function markdownCell(value) {
  return String(value ?? '')
    .replaceAll('|', '\\|')
    .replace(/\r?\n/g, '<br>')
}

/**
 * Render entries as Markdown grouped by severity.
 *
 * @param {unknown} entries Entries array or atlas object.
 * @returns {string}
 */
export function renderMarkdown(entries) {
  const list = sortEntries(entriesOf(entries))

  if (list.length === 0) {
    return ['# DSH Upgrade Atlas', '', '_No entries._', ''].join('\n')
  }

  const lines = [
    '# DSH Upgrade Atlas',
    '',
    '> Community-maintained and unofficial. Verify each breakpoint against the cited DSH source.',
    '',
    'The `to` value `*` means the target release is unknown; read the summary for whether the breakpoint is still current.',
    '',
  ]

  const groups = new Map()
  for (const entry of list) {
    const group = groups.get(entry.severity)
    if (group === undefined) groups.set(entry.severity, [entry])
    else group.push(entry)
  }

  for (const [severity, group] of groups) {
    lines.push(`## ${severity}`, '')
    lines.push('| package | from → to | kind | summary | fix |')
    lines.push('| --- | --- | --- | --- | --- |')
    for (const entry of group) {
      lines.push(
        `| ${markdownCell(entry.package)} | ${markdownCell(entry.from)} → ${markdownCell(entry.to)} | ${markdownCell(entry.kind)} | ${markdownCell(entry.summary)} | ${markdownCell(entry.fix)} |`,
      )
    }
    lines.push('')
  }

  return `${lines.join('\n').trimEnd()}\n`
}
