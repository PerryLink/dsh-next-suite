/**
 * Core heuristics for dsh-supply-watch.
 *
 * Everything in this module is offline and pure: no network access, no
 * filesystem access, no third-party dependencies. The goal is to surface
 * *leads* for a human reviewer, not to prove that a package is malicious or
 * safe.
 */

/** @typedef {'low' | 'medium' | 'high'} Severity */

/**
 * @typedef {object} TyposquatResult
 * @property {string | null} nearest Best matching known name, if any.
 * @property {number | null} distance Levenshtein distance after normalization.
 * @property {number} score 0-100 heuristic suspicion score.
 * @property {string} reason Human-readable explanation.
 */

/**
 * @typedef {object} VersionFinding
 * @property {'version'} kind
 * @property {string} code Stable finding code.
 * @property {number} score 0-100 heuristic suspicion score.
 * @property {string} reason Human-readable explanation.
 * @property {string[]} [versions] Versions involved in the finding.
 */

/**
 * @typedef {object} WatchFinding
 * @property {'typosquat' | 'version'} kind
 * @property {string} name
 * @property {Severity} severity
 * @property {number} score
 * @property {string} reason
 * @property {string} [code]
 */

const SEPARATORS = /[-_.]+/g
const COMPACT_SEPARATORS = /[-_.]/g

/**
 * Matches the optional qualifiers that are commonly placed before the DSH
 * namespace marker. The `dsh` token itself is followed by either a separator
 * or another alphanumeric character (the glued form, e.g. `dshcore`).
 */
const DSH_PREFIX = /^(?:(?:node|deepseek|official)[-_.]?)?dsh(?:[-_.]|(?=[a-z0-9]))(.+)$/

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/

const SEVERITY_RANK = /** @type {Record<Severity, number>} */ ({
  high: 0,
  medium: 1,
  low: 2,
})

const DISCLAIMER =
  'Offline heuristics only. Findings are leads, not proof. This tool is not a ' +
  'substitute for software composition analysis, advisory data, registry ' +
  'ownership checks, or tarball inspection.'

/**
 * Normalize a package name for comparison.
 *
 * - lowercases (npm names are case-insensitive for comparison purposes)
 * - collapses runs of `-`, `_`, and `.` into a single `-`
 * - trims leading/trailing separator characters
 * - preserves an npm scope (`@scope/`) but normalizes separators inside it
 *
 * @param {unknown} name
 * @returns {string}
 */
export function normalizeName(name) {
  let value = String(name ?? '').trim().toLowerCase()
  if (!value) return ''

  // Normalize separators in the scope before handling the rest of the name.
  value = value.replace(/^@([^/]+)\//, (_match, scope) => {
    return `@${String(scope).replace(SEPARATORS, '-').replace(/^-+|-+$/g, '')}/`
  })
  value = value.replace(SEPARATORS, '-').replace(/^-+|-+$/g, '')
  return value
}

/**
 * Remove separator characters so that separator placement can be compared.
 *
 * @param {string} normalized
 * @returns {string}
 */
function compactName(normalized) {
  return normalized.replace(COMPACT_SEPARATORS, '')
}

/**
 * Remove a recognized DSH namespace prefix from a normalized name.
 *
 * Recognized forms include `dsh-core`, `dshcore`, `node-dsh-core`,
 * `deepseek-dsh-core`, and `official-dsh-core`. Returns `null` when no prefix
 * is present, or when stripping would leave an empty string.
 *
 * @param {string} normalized
 * @returns {string | null}
 */
function stripDshPrefix(normalized) {
  const match = DSH_PREFIX.exec(normalized)
  if (!match) return null
  const core = match[1]
  return core ? core : null
}

/**
 * Levenshtein edit distance between two strings.
 *
 * The optional third argument enables a banded, early-exit computation. When
 * the threshold is exceeded the function returns `maxDistance + 1` rather than
 * the exact distance. This is useful for "is this close enough?" checks where
 * the caller does not care about the exact value beyond the bound.
 *
 * Passing a number instead of an options object is also accepted:
 * `levenshtein(a, b, 2)`.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @param {{ maxDistance?: number } | number} [options]
 * @returns {number}
 */
export function levenshtein(a, b, options = {}) {
  const left = String(a ?? '')
  const right = String(b ?? '')

  let maxDistance = null
  const configured = typeof options === 'number' ? options : options?.maxDistance
  if (typeof configured === 'number' && Number.isFinite(configured) && configured >= 0) {
    maxDistance = Math.floor(configured)
  }

  if (left === right) return 0

  if (left.length === 0 || right.length === 0) {
    const distance = Math.max(left.length, right.length)
    return maxDistance !== null && distance > maxDistance ? maxDistance + 1 : distance
  }

  let source = left
  let target = right
  if (source.length < target.length) {
    const swap = source
    source = target
    target = swap
  }

  if (maxDistance !== null && Math.abs(source.length - target.length) > maxDistance) {
    return maxDistance + 1
  }

  const width = target.length
  /** @type {number[]} */
  let previous = new Array(width + 1)

  if (maxDistance === null) {
    for (let j = 0; j <= width; j += 1) previous[j] = j

    for (let i = 1; i <= source.length; i += 1) {
      const current = new Array(width + 1)
      current[0] = i
      const sourceChar = source[i - 1]

      for (let j = 1; j <= width; j += 1) {
        const substitution = previous[j - 1] + (sourceChar === target[j - 1] ? 0 : 1)
        const insertion = current[j - 1] + 1
        const deletion = previous[j] + 1
        current[j] = Math.min(substitution, insertion, deletion)
      }

      previous = current
    }

    return previous[width]
  }

  const sentinel = maxDistance + 1
  for (let j = 0; j <= width; j += 1) {
    previous[j] = j <= maxDistance ? j : sentinel
  }

  for (let i = 1; i <= source.length; i += 1) {
    const current = new Array(width + 1).fill(sentinel)
    current[0] = i <= maxDistance ? i : sentinel
    const sourceChar = source[i - 1]
    const start = Math.max(1, i - maxDistance)
    const end = Math.min(width, i + maxDistance)
    let rowMinimum = current[0]

    for (let j = start; j <= end; j += 1) {
      const substitution = previous[j - 1] + (sourceChar === target[j - 1] ? 0 : 1)
      const insertion = current[j - 1] + 1
      const deletion = previous[j] + 1
      const value = Math.min(substitution, insertion, deletion, sentinel)
      current[j] = value
      if (value < rowMinimum) rowMinimum = value
    }

    if (rowMinimum > maxDistance) return sentinel
    previous = current
  }

  return previous[width] > maxDistance ? sentinel : previous[width]
}

/**
 * Compare a candidate name with one known name and return the strongest
 * heuristic signal.
 *
 * @param {string} candidate Normalized candidate.
 * @param {string} known Normalized known name.
 * @param {number} distance Levenshtein distance between the normalized names.
 * @param {string} nearest Original known name, for messages.
 * @returns {{ score: number, reason: string } | null}
 */
function compareOne(candidate, known, distance, nearest) {
  if (candidate === known) return null

  /** @type {{ score: number, reason: string } | null} */
  let best = null
  const consider = (score, reason) => {
    if (!best || score > best.score) best = { score, reason }
  }

  // Same characters, different separator placement (`dshcore` / `dsh-core`).
  if (compactName(candidate) === compactName(known)) {
    consider(
      88,
      `separator placement variant of "${nearest}"`,
    )
  }

  // Same name once a DSH namespace prefix is removed or normalized.
  const candidateCore = stripDshPrefix(candidate)
  const knownCore = stripDshPrefix(known)
  const candidateKey = candidateCore ?? candidate
  const knownKey = knownCore ?? known
  if (candidateKey === knownKey && candidate !== known) {
    if (candidateCore && !knownCore) {
      consider(74, `adds a dsh- namespace prefix to "${nearest}"`)
    } else if (!candidateCore && knownCore) {
      consider(74, `omits the dsh- namespace prefix from "${nearest}"`)
    } else {
      consider(74, `uses a different dsh- namespace prefix than "${nearest}"`)
    }
  }

  const maxLength = Math.max(candidate.length, known.length)
  if (distance === 1 && maxLength >= 4) {
    consider(88, `edit distance 1 from "${nearest}"`)
  } else if (distance === 2 && maxLength >= 5) {
    consider(68, `edit distance 2 from "${nearest}"`)
  } else if (distance === 3 && maxLength >= 9) {
    consider(46, `edit distance 3 from "${nearest}"`)
  }

  // A known name with an extra trailing segment, e.g. `dsh-core-utils`.
  if (candidate.length > known.length && candidate.startsWith(`${known}-`)) {
    const extra = candidate.slice(known.length + 1)
    if (extra) {
      consider(44, `adds an extra segment ("${extra}") to "${nearest}"`)
    }
  }

  const candidateCompact = compactName(candidate)
  const knownCompact = compactName(known)
  if (
    candidateCompact.length > knownCompact.length + 2 &&
    candidateCompact.startsWith(knownCompact)
  ) {
    consider(42, `adds an extra suffix to "${nearest}"`)
  }

  return best
}

/**
 * Score how closely a package name resembles names from a trusted/known list.
 *
 * The result is intentionally a lead, not a verdict. A score of 0 also covers
 * "no known names supplied", which disables typo analysis.
 *
 * @param {unknown} name
 * @param {unknown[]} known
 * @returns {TyposquatResult}
 */
export function typosquatScore(name, known = []) {
  const normalized = normalizeName(name)
  if (!normalized) {
    return { nearest: null, distance: null, score: 0, reason: 'empty package name' }
  }

  const knownList = Array.isArray(known) ? known : []
  /** @type {{ original: string, raw: string, normalized: string }[]} */
  const entries = []
  for (const item of knownList) {
    if (item === null || item === undefined) continue
    const original = String(item).trim()
    if (!original) continue
    entries.push({
      original,
      raw: original.toLowerCase(),
      normalized: normalizeName(original),
    })
  }

  if (entries.length === 0) {
    return {
      nearest: null,
      distance: null,
      score: 0,
      reason: 'no known package names supplied',
    }
  }

  const rawCandidate = String(name ?? '').trim().toLowerCase()

  // An exact known name is not a typosquat, even if it resembles a sibling
  // entry in the known list. This avoids flagging aliases such as `core` when
  // both `core` and `dsh-core` are trusted.
  const exact = entries.find((entry) => entry.raw === rawCandidate)
  if (exact) {
    return {
      nearest: exact.original,
      distance: 0,
      score: 0,
      reason: 'matches a known package exactly',
    }
  }

  // Same normalized name but different punctuation: `dsh_core` vs `dsh-core`.
  const punctuationVariant = entries.find((entry) => entry.normalized === normalized)
  if (punctuationVariant) {
    return {
      nearest: punctuationVariant.original,
      distance: 0,
      score: 90,
      reason: `separator or punctuation variant of "${punctuationVariant.original}"`,
    }
  }

  /** @type {TyposquatResult | null} */
  let best = null
  for (const entry of entries) {
    const distance = levenshtein(normalized, entry.normalized)
    const signal = compareOne(normalized, entry.normalized, distance, entry.original)
    const score = signal?.score ?? 0
    const reason = signal?.reason ?? ''
    const candidate = {
      nearest: entry.original,
      distance,
      score,
      reason,
    }

    if (
      best === null ||
      candidate.score > best.score ||
      (candidate.score === best.score &&
        /** @type {number} */ (candidate.distance) < /** @type {number} */ (best.distance))
    ) {
      best = candidate
    }
  }

  if (!best) {
    return {
      nearest: null,
      distance: null,
      score: 0,
      reason: 'no known package names supplied',
    }
  }

  if (best.score === 0) {
    return {
      ...best,
      reason: `no close match among ${entries.length} known package name(s)`,
    }
  }

  return best
}

/**
 * Parse a semver-ish version string. Build metadata is accepted and ignored.
 *
 * @param {unknown} raw
 * @returns {{
 *   raw: string,
 *   major: number,
 *   minor: number,
 *   patch: number,
 *   prerelease: string[],
 * } | null}
 */
function parseVersion(raw) {
  const value = String(raw ?? '').trim()
  const match = SEMVER.exec(value)
  if (!match) return null
  return {
    raw: value,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

/**
 * Compare two parsed versions using SemVer precedence rules. Build metadata is
 * ignored and prerelease identifiers are compared according to SemVer 2.0.0.
 *
 * @param {ReturnType<typeof parseVersion>} left
 * @param {ReturnType<typeof parseVersion>} right
 * @returns {number} negative when left < right, positive when left > right.
 */
function compareVersions(left, right) {
  if (!left || !right) return 0
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  if (left.patch !== right.patch) return left.patch - right.patch

  const a = left.prerelease
  const b = right.prerelease
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1

  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i += 1) {
    const x = a[i]
    const y = b[i]
    if (x === y) continue
    const xNumeric = /^\d+$/.test(x)
    const yNumeric = /^\d+$/.test(y)
    if (xNumeric && yNumeric) return Number(x) - Number(y)
    if (xNumeric) return -1
    if (yNumeric) return 1
    return x < y ? -1 : 1
  }
  return a.length - b.length
}

/**
 * @param {ReturnType<typeof parseVersion>[]} versions
 * @returns {ReturnType<typeof parseVersion>[]}
 */
function uniqueVersions(versions) {
  const seen = new Set()
  const unique = []
  for (const version of versions) {
    if (!version) continue
    const key = `${version.major}.${version.minor}.${version.patch}-${version.prerelease.join('.')}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(version)
  }
  return unique
}

/**
 * Detect heuristic version anomalies in a publication history.
 *
 * The input is expected to be ordered oldest-to-newest (npm publication order)
 * for regression/rollback checks. Structural checks (jumps, gaps) sort a copy
 * internally, so they are order-independent.
 *
 * Detected codes:
 * - `placeholder-version`: 0.0.0 / 0.0.1 placeholder releases
 * - `implausible-major`: major >= 99 (a common dependency-confusion bait)
 * - `major-jump`: a published history skips two or more major versions
 * - `missing-intermediate`: minor/patch gaps within the same major
 * - `prerelease-rollback`: a prerelease sorts below the previous publish
 * - `version-regression`: any other version decrease in publication order
 *
 * Invalid/non-semver entries are ignored rather than guessed at.
 *
 * @param {unknown} versions
 * @returns {VersionFinding[]}
 */
export function versionAnomaly(versions) {
  const list = Array.isArray(versions)
    ? versions
    : typeof versions === 'string'
      ? [versions]
      : []

  /** @type {ReturnType<typeof parseVersion>[]} */
  const parsed = []
  for (const raw of list) {
    const version = parseVersion(raw)
    if (version) parsed.push(version)
  }
  if (parsed.length === 0) return []

  const unique = uniqueVersions(parsed)
  /** @type {VersionFinding[]} */
  const findings = []

  for (const version of unique) {
    if (version.major === 0 && version.minor === 0 && version.patch <= 1) {
      findings.push({
        kind: 'version',
        code: 'placeholder-version',
        score: 52,
        reason: `placeholder version "${version.raw}" (0.0.x releases are commonly accidental or incomplete publishes)`,
        versions: [version.raw],
      })
    }
  }

  for (const version of unique) {
    if (version.major >= 99) {
      findings.push({
        kind: 'version',
        code: 'implausible-major',
        score: 92,
        reason: `implausible major version "${version.raw}" (major >= 99)`,
        versions: [version.raw],
      })
    }
  }

  const stableAscending = unique
    .filter((version) => version.prerelease.length === 0)
    .sort(compareVersions)

  for (let i = 1; i < stableAscending.length; i += 1) {
    const previous = stableAscending[i - 1]
    const current = stableAscending[i]
    // A 99.x version is already reported as implausible; do not add a noisy
    // "skips N majors" finding on top of it.
    if (current.major >= 99) continue
    const jump = current.major - previous.major
    if (jump >= 2) {
      findings.push({
        kind: 'version',
        code: 'major-jump',
        score: jump >= 5 ? 85 : 70,
        reason: `major version jumps from "${previous.raw}" to "${current.raw}" (skips ${jump - 1} major version(s))`,
        versions: [previous.raw, current.raw],
        skippedMajors: jump - 1,
      })
    }
  }

  for (let i = 1; i < stableAscending.length; i += 1) {
    const previous = stableAscending[i - 1]
    const current = stableAscending[i]
    if (current.major !== previous.major) continue

    if (current.minor !== previous.minor) {
      const gap = current.minor - previous.minor
      if (gap >= 2) {
        const missingCount = gap - 1
        const missing = []
        for (let step = 1; step <= missingCount && step <= 5; step += 1) {
          missing.push(`${previous.major}.${previous.minor + step}.x`)
        }
        findings.push({
          kind: 'version',
          code: 'missing-intermediate',
          score: 45,
          reason: `missing ${missingCount} minor version line(s) between "${previous.raw}" and "${current.raw}"`,
          versions: [previous.raw, current.raw],
          missing,
          missingCount,
        })
      }
      continue
    }

    const patchGap = current.patch - previous.patch
    if (patchGap >= 2) {
      const missingCount = patchGap - 1
      const missing = []
      for (let step = 1; step <= missingCount && step <= 5; step += 1) {
        missing.push(`${previous.major}.${previous.minor}.${previous.patch + step}`)
      }
      findings.push({
        kind: 'version',
        code: 'missing-intermediate',
        score: 35,
        reason: `missing ${missingCount} patch version(s) between "${previous.raw}" and "${current.raw}"`,
        versions: [previous.raw, current.raw],
        missing,
        missingCount,
      })
    }
  }

  // These checks use publication order on purpose.
  for (let i = 1; i < parsed.length; i += 1) {
    const previous = parsed[i - 1]
    const current = parsed[i]
    const comparison = compareVersions(current, previous)
    if (comparison >= 0) continue

    if (current.prerelease.length > 0) {
      findings.push({
        kind: 'version',
        code: 'prerelease-rollback',
        score: 86,
        reason: `prerelease "${current.raw}" sorts below the previous publish "${previous.raw}"`,
        versions: [previous.raw, current.raw],
      })
    } else {
      findings.push({
        kind: 'version',
        code: 'version-regression',
        score: 82,
        reason: `version regresses from "${previous.raw}" to "${current.raw}" in publication order`,
        versions: [previous.raw, current.raw],
      })
    }
  }

  return findings
}

/**
 * Map a finding (or an explicit severity string) to low/medium/high.
 *
 * Scores >= 80 are high, >= 50 are medium, everything else is low. An explicit
 * valid `severity` field wins over the score.
 *
 * @param {unknown} finding
 * @returns {Severity}
 */
export function severityOf(finding) {
  if (typeof finding === 'string') {
    if (finding === 'high' || finding === 'medium' || finding === 'low') return finding
    return 'low'
  }
  if (finding && typeof finding === 'object') {
    const explicit = /** @type {{ severity?: unknown }} */ (finding).severity
    if (explicit === 'high' || explicit === 'medium' || explicit === 'low') return explicit
    const score = Number(/** @type {{ score?: unknown }} */ (finding).score)
    if (Number.isFinite(score)) {
      if (score >= 80) return 'high'
      if (score >= 50) return 'medium'
    }
  }
  return 'low'
}

/**
 * Sort findings by severity (high first), then score (descending), then name
 * and code for deterministic output.
 *
 * @param {WatchFinding[]} findings
 * @returns {WatchFinding[]}
 */
function sortFindings(findings) {
  return [...findings].sort((a, b) => {
    const severity = SEVERITY_RANK[severityOf(a)] - SEVERITY_RANK[severityOf(b)]
    if (severity !== 0) return severity

    const score = (b.score ?? 0) - (a.score ?? 0)
    if (score !== 0) return score

    const aName = a.name ?? ''
    const bName = b.name ?? ''
    if (aName !== bName) return aName < bName ? -1 : 1

    const aCode = a.code ?? a.kind ?? ''
    const bCode = b.code ?? b.kind ?? ''
    if (aCode !== bCode) return aCode < bCode ? -1 : 1
    return 0
  })
}

/**
 * Combine typo and version heuristics for a list of package names and return
 * findings ordered by severity.
 *
 * `names` accepts strings or `{ name, versions }` objects. `known` is an array
 * of trusted package names; it is never fetched from the network. If `known`
 * is empty, typo checks are inactive and only version checks run.
 *
 * @param {unknown} names
 * @param {unknown[]} known
 * @returns {WatchFinding[]}
 */
export function watch(names, known = []) {
  const list = Array.isArray(names)
    ? names
    : names === null || names === undefined
      ? []
      : [names]

  const knownList = Array.isArray(known) ? known : []
  /** @type {WatchFinding[]} */
  const findings = []

  for (const item of list) {
    /** @type {string} */
    let name = ''
    /** @type {unknown} */
    let versions = null

    if (typeof item === 'string') {
      name = item
    } else if (item && typeof item === 'object') {
      const entry = /** @type {{ name?: unknown, versions?: unknown }} */ (item)
      name = entry.name === null || entry.name === undefined ? '' : String(entry.name)
      versions = entry.versions
    }

    name = name.trim()
    if (!name) continue

    const typo = typosquatScore(name, knownList)
    if (typo.score > 0) {
      findings.push({
        kind: 'typosquat',
        name,
        nearest: typo.nearest,
        distance: typo.distance,
        score: typo.score,
        severity: severityOf(typo),
        reason: typo.reason,
      })
    }

    if (versions !== null && versions !== undefined) {
      const versionList = Array.isArray(versions)
        ? versions
        : typeof versions === 'string'
          ? versions.split(',').map((value) => value.trim()).filter(Boolean)
          : []

      if (versionList.length > 0) {
        for (const versionFinding of versionAnomaly(versionList)) {
          const finding = {
            ...versionFinding,
            name,
            severity: severityOf(versionFinding),
          }
          findings.push(/** @type {WatchFinding} */ (finding))
        }
      }
    }
  }

  return sortFindings(findings)
}

export { DISCLAIMER }
