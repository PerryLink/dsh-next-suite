/**
 * npm provenance attestation helpers.
 *
 * Scope boundary (read this before trusting a result):
 *
 *   This module performs **structural matching only**. It checks that the npm
 *   registry advertises an attestation for a version, that the selected
 *   attestation has a SLSA/provenance `predicateType`, that its subject
 *   `sha512` matches an expected tarball digest, and that the declared source
 *   repository/commit match the expected values.
 *
 *   It does NOT verify the sigstore bundle: no DSSE signature check, no
 *   Fulcio certificate chain or SAN identity check, no Rekor transparency-log
 *   inclusion check, no timestamp check. Anyone who can control the registry
 *   response can forge an attestation that passes every check below. For
 *   cryptographic verification use `sigstore` or `npm audit signatures`.
 *
 * The module never reads files and never touches the network by itself:
 * `fetchAttestation` takes an injectable `fetchImpl`, and `verifyProvenance`
 * is a pure function over the attestation object.
 *
 * @typedef {object} AttestationSubject
 * @property {string} [name]
 * @property {Record<string, string>} [digest]
 *
 * @typedef {object} FetchedAttestation
 * @property {boolean} present
 * @property {string} name
 * @property {string} version
 * @property {string | null} url Attestation document URL, when one was advertised.
 * @property {string | null} predicateType
 * @property {AttestationSubject[]} subject Decoded in-toto subject entries.
 * @property {Record<string, unknown> | null} predicate Decoded in-toto predicate (unverified).
 * @property {string | null} tarballIntegrity Raw `dist.integrity` from the registry.
 * @property {string | null} tarballSha512 `dist.integrity` normalised to SHA-512 hex.
 * @property {string | null} reason Why `present` is false (`no-attestations`, ...).
 *
 * @typedef {object} ProvenanceVerdict
 * @property {boolean} ok
 * @property {string[]} reasons Stable machine-readable reason codes.
 * @property {string[]} warnings Non-fatal scope caveats (`tarball-digest-from-registry`, ...).
 */

import { isPlainObject } from './core.js'

/** Default npm registry base URL. */
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org'

/**
 * One-line statement of what this module does not do. Exported so callers can
 * surface the same wording in their own UIs.
 */
export const VERIFICATION_BOUNDARY =
  'Structural check only: attestation existence, SLSA/provenance predicateType, ' +
  'subject SHA-512 and source repository/commit are matched, but the sigstore ' +
  'bundle (DSSE signature, Fulcio identity, Rekor log) is NOT verified. ' +
  'Use sigstore or `npm audit signatures` for cryptographic verification.'

const SHA512_HEX = /^[0-9a-f]{128}$/i
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const PROVENANCE_TYPE = /slsa|provenance/i
const COMMIT_HEX = /^[0-9a-f]{7,64}$/i

/**
 * Error raised for registry/network failures. Programmer errors (bad
 * arguments) are plain `TypeError`s; transport/format failures use this class
 * with a stable `code` so callers can branch on it.
 */
export class ProvenanceError extends Error {
  /**
   * @param {string} code Stable machine-readable code (`REGISTRY_NETWORK`, `ATTESTATION_HTTP_503`, ...).
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(code, message, options = {}) {
    super(message, options)
    this.name = 'ProvenanceError'
    this.code = code
  }
}

/**
 * Read the npm attestation for `name@version`.
 *
 * Flow: `GET <registry>/<name>` → `versions[version].dist.attestations` →
 * `GET <attestations.url>` → pick the SLSA/provenance entry and decode its
 * in-toto statement (the DSSE payload, base64 JSON).
 *
 * A missing package, version or attestation returns `{ present: false,
 * reason }`; transport/HTTP/format failures throw `ProvenanceError`.
 *
 * @param {string} name Package name (`pkg` or `@scope/pkg`).
 * @param {string} version Exact version key from the registry document.
 * @param {{ fetchImpl?: typeof fetch, registry?: string }} [options]
 * @returns {Promise<FetchedAttestation>}
 */
export async function fetchAttestation(name, version, options = {}) {
  requireText(name, 'fetchAttestation: name')
  requireText(version, 'fetchAttestation: version')
  const opts = options ?? {}
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  const base = registryBase(opts.registry ?? DEFAULT_REGISTRY)
  const metadataUrl = `${base}/${packagePath(name)}`
  const metadata = await fetchJson(fetchImpl, metadataUrl, {
    kind: 'REGISTRY',
    what: `registry metadata for ${name}@${version}`,
    allowNotFound: true,
    accept: 'application/vnd.npm.install-v1+json, application/json;q=0.8',
  })

  if (metadata === undefined) return absent(name, version, 'package-not-found')
  if (!isPlainObject(metadata)) {
    throw new ProvenanceError(
      'REGISTRY_INVALID_DOCUMENT',
      `registry metadata for ${name}@${version} is not a JSON object: ${metadataUrl}`,
    )
  }

  const record =
    isPlainObject(metadata.versions) && Object.prototype.hasOwnProperty.call(metadata.versions, version)
      ? metadata.versions[version]
      : undefined
  if (!isPlainObject(record)) return absent(name, version, 'version-not-found')

  const dist = isPlainObject(record.dist) ? record.dist : {}
  const integrity = typeof dist.integrity === 'string' ? dist.integrity : null
  const tarballSha512 = normalizeSha512(integrity)
  const declared = isPlainObject(dist.attestations) ? dist.attestations : null
  if (declared === null || typeof declared.url !== 'string' || declared.url.trim() === '') {
    return absent(name, version, 'no-attestations', { tarballIntegrity: integrity, tarballSha512 })
  }

  const url = attestationUrl(declared.url)
  const preferredType =
    isPlainObject(declared.provenance) && typeof declared.provenance.predicateType === 'string'
      ? declared.provenance.predicateType
      : null
  const document = await fetchJson(fetchImpl, url, {
    kind: 'ATTESTATION',
    what: `attestation document for ${name}@${version}`,
  })
  const entry = pickProvenanceEntry(document, preferredType)
  if (entry === null) {
    return absent(name, version, 'no-provenance-attestation', {
      url,
      tarballIntegrity: integrity,
      tarballSha512,
    })
  }

  const decoded = decodeAttestation(entry)
  return {
    present: true,
    name,
    version,
    url,
    predicateType: decoded.predicateType,
    subject: decoded.subject,
    predicate: decoded.predicate,
    tarballIntegrity: integrity,
    tarballSha512,
    reason: null,
  }
}

/**
 * Match an attestation against an expected package provenance.
 *
 * Checks, in order:
 *   1. an attestation is present and `predicateType` contains `slsa` or
 *      `provenance`;
 *   2. at least one subject carries a `sha512` digest, and it equals
 *      `tarballSha512` (hex, base64 and `sha512-<base64>` SRI are accepted).
 *      When `tarballSha512` is omitted, `attestation.tarballSha512` (the
 *      registry's own `dist.integrity`) is used and a warning is emitted;
 *   3. `repo` matches a repository URL/name found in the predicate;
 *   4. `commit` matches a git commit found in the predicate (a prefix of at
 *      least 7 hex characters is accepted).
 *
 * `repo` and `commit` are optional. When they are omitted the result carries
 * `repo-not-verified` / `commit-not-verified` warnings, but `ok` is not
 * affected.
 *
 * @param {FetchedAttestation | Record<string, unknown>} attestation
 * @param {{ repo?: string, commit?: string, tarballSha512?: string }} [options]
 * @returns {ProvenanceVerdict}
 */
export function verifyProvenance(attestation, options = {}) {
  const opts = options ?? {}
  const reasons = []
  const warnings = []
  const parsed = toAttestation(attestation)

  if (!parsed.present) {
    reasons.push(
      typeof parsed.reason === 'string' && parsed.reason !== ''
        ? `attestation-missing:${parsed.reason}`
        : 'attestation-missing',
    )
    if (opts.repo === undefined || opts.repo === null) warnings.push('repo-not-verified')
    if (opts.commit === undefined || opts.commit === null) warnings.push('commit-not-verified')
    return { ok: false, reasons: unique(reasons), warnings: unique(warnings) }
  }

  if (typeof parsed.predicateType !== 'string' || parsed.predicateType.trim() === '') {
    reasons.push('predicate-type-missing')
  } else if (!isProvenanceType(parsed.predicateType)) {
    reasons.push(`predicate-type-unsupported:${parsed.predicateType}`)
  }

  if (parsed.subject.length === 0) {
    reasons.push('subject-missing')
  } else {
    const subjectDigests = parsed.subject
      .map((subject) => subjectDigest(subject))
      .filter((digest) => digest !== null)
    if (subjectDigests.length === 0) {
      reasons.push('subject-digest-missing')
    } else {
      /** @type {string | null} */
      let expected = null
      const explicit = opts.tarballSha512
      if (explicit !== undefined && explicit !== null) {
        expected = normalizeSha512(explicit)
        if (expected === null) reasons.push('tarball-digest-invalid')
      } else {
        expected = normalizeSha512(parsed.tarballSha512)
        if (expected === null) {
          reasons.push('tarball-digest-missing')
        } else {
          warnings.push('tarball-digest-from-registry')
        }
      }
      if (expected !== null && !subjectDigests.includes(expected)) {
        reasons.push('subject-digest-mismatch')
      }
    }
  }

  /** @type {string | null} */
  let expectedRepo = null
  if (opts.repo !== undefined && opts.repo !== null) {
    expectedRepo = normalizeRepo(opts.repo)
    if (expectedRepo === null) {
      reasons.push('repo-invalid')
    } else {
      const found = collectRepos(parsed.predicate)
      if (found.length === 0) reasons.push('repo-missing')
      else if (!found.includes(expectedRepo)) reasons.push(`repo-mismatch:${expectedRepo}`)
    }
  } else {
    warnings.push('repo-not-verified')
  }

  if (opts.commit !== undefined && opts.commit !== null) {
    const expected = normalizeCommit(opts.commit)
    if (expected === null) {
      reasons.push('commit-invalid')
    } else {
      const found = collectCommits(parsed.predicate, expectedRepo)
      if (found.length === 0) reasons.push('commit-missing')
      else if (!found.some((commit) => commitMatches(expected, commit))) {
        reasons.push(`commit-mismatch:${expected}`)
      }
    }
  } else {
    warnings.push('commit-not-verified')
  }

  const uniqueReasons = unique(reasons)
  return { ok: uniqueReasons.length === 0, reasons: uniqueReasons, warnings: unique(warnings) }
}

/**
 * Fetch and verify in one call. Fetch failures are thrown (they are not a
 * provenance verdict); absent attestations are reported as `ok: false` with
 * `attestation-missing:<reason>`.
 *
 * @param {string} name
 * @param {string} version
 * @param {{ fetchImpl?: typeof fetch, registry?: string, repo?: string, commit?: string, tarballSha512?: string }} [options]
 * @returns {Promise<{ name: string, version: string, ok: boolean, reasons: string[], warnings: string[], attestation: FetchedAttestation }>}
 */
export async function verifyPackage(name, version, options = {}) {
  const attestation = await fetchAttestation(name, version, options)
  const verdict = verifyProvenance(attestation, options)
  return { name, version, ok: verdict.ok, reasons: verdict.reasons, warnings: verdict.warnings, attestation }
}

/**
 * Normalise a SHA-512 digest to lowercase hex. Accepts 128 hex characters,
 * standard base64, and the SRI form `sha512-<base64>`. Returns `null` for
 * anything else (including other algorithms).
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeSha512(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '') return null
  if (text.slice(0, 7).toLowerCase() === 'sha512-') return decodeBase64Sha512(text.slice(7))
  if (SHA512_HEX.test(text)) return text.toLowerCase()
  return decodeBase64Sha512(text)
}

/**
 * @param {unknown} fetchImpl
 * @param {string} url
 * @param {{ kind: string, what: string, allowNotFound?: boolean, accept?: string }} details
 * @returns {Promise<unknown | undefined>}
 */
async function fetchJson(fetchImpl, url, details) {
  if (typeof fetchImpl !== 'function') {
    throw new ProvenanceError(
      'NO_FETCH',
      'no fetch implementation available; pass { fetchImpl } or use Node.js >= 18 (global fetch)',
    )
  }

  /** @type {Response} */
  let response
  try {
    response = await fetchImpl(url, {
      headers: { accept: details.accept ?? 'application/json' },
      redirect: 'follow',
    })
  } catch (error) {
    throw new ProvenanceError(
      `${details.kind}_NETWORK`,
      `cannot fetch ${details.what} from ${url}: ${describeError(error)}`,
      { cause: error },
    )
  }

  if (
    response === null ||
    typeof response !== 'object' ||
    typeof response.status !== 'number' ||
    typeof response.ok !== 'boolean'
  ) {
    throw new ProvenanceError(
      `${details.kind}_INVALID_RESPONSE`,
      `cannot fetch ${details.what} from ${url}: fetch implementation returned an invalid response`,
    )
  }
  if (details.allowNotFound === true && response.status === 404) return undefined
  if (!response.ok) {
    throw new ProvenanceError(
      `${details.kind}_HTTP_${response.status}`,
      `${details.what} request failed with HTTP ${response.status}: ${url}`,
    )
  }
  if (typeof response.json !== 'function') {
    throw new ProvenanceError(
      `${details.kind}_INVALID_RESPONSE`,
      `${details.what} from ${url}: response has no json() method`,
    )
  }
  try {
    return await response.json()
  } catch (error) {
    throw new ProvenanceError(
      `${details.kind}_INVALID_JSON`,
      `${details.what} from ${url} is not valid JSON: ${describeError(error)}`,
      { cause: error },
    )
  }
}

/**
 * @param {string} name
 * @param {string} version
 * @param {string} reason
 * @param {{ url?: string | null, tarballIntegrity?: string | null, tarballSha512?: string | null }} [extra]
 * @returns {FetchedAttestation}
 */
function absent(name, version, reason, extra = {}) {
  return {
    present: false,
    name,
    version,
    url: extra.url ?? null,
    predicateType: null,
    subject: [],
    predicate: null,
    tarballIntegrity: extra.tarballIntegrity ?? null,
    tarballSha512: extra.tarballSha512 ?? null,
    reason,
  }
}

/**
 * Pick the provenance entry from an npm attestation document. npm publishes a
 * `.../publish/v0.1` attestation alongside the SLSA one, so the declared
 * `dist.attestations.provenance.predicateType` (when usable) wins; otherwise
 * the first entry whose type mentions SLSA/provenance is chosen.
 *
 * @param {unknown} document
 * @param {string | null} preferredType
 * @returns {Record<string, unknown> | null}
 */
function pickProvenanceEntry(document, preferredType) {
  let candidates
  if (Array.isArray(document)) {
    candidates = document
  } else if (isPlainObject(document) && Array.isArray(document.attestations)) {
    candidates = document.attestations
  } else if (isPlainObject(document)) {
    candidates = [document]
  } else {
    candidates = []
  }
  const entries = candidates.filter(isPlainObject)
  if (entries.length === 0) return null
  if (typeof preferredType === 'string' && isProvenanceType(preferredType)) {
    const exact = entries.find((entry) => entry.predicateType === preferredType)
    if (exact !== undefined) return exact
  }
  return entries.find((entry) => isProvenanceType(entry.predicateType)) ?? null
}

/**
 * @param {Record<string, unknown>} entry
 * @returns {{ subject: Record<string, unknown>[], predicate: Record<string, unknown> | null, predicateType: string | null }}
 */
function decodeAttestation(entry) {
  /** @type {Record<string, unknown> | null} */
  let statement = null
  if (isPlainObject(entry.statement)) {
    statement = entry.statement
  } else if (
    isPlainObject(entry.bundle) &&
    isPlainObject(entry.bundle.dsseEnvelope) &&
    typeof entry.bundle.dsseEnvelope.payload === 'string'
  ) {
    statement = decodePayload(entry.bundle.dsseEnvelope.payload)
  } else if (typeof entry.payload === 'string') {
    statement = decodePayload(entry.payload)
  }

  const fromStatement = statement !== null && Array.isArray(statement.subject) ? statement.subject : null
  const fromEntry = Array.isArray(entry.subject) ? entry.subject : null
  const subjects = (fromStatement ?? fromEntry ?? []).filter(isPlainObject).map((subject) => ({ ...subject }))
  const predicate =
    statement !== null && isPlainObject(statement.predicate)
      ? statement.predicate
      : isPlainObject(entry.predicate)
        ? entry.predicate
        : null
  const predicateType =
    typeof entry.predicateType === 'string'
      ? entry.predicateType
      : statement !== null && typeof statement.predicateType === 'string'
        ? statement.predicateType
        : null

  return { subject: subjects, predicate, predicateType }
}

/**
 * @param {string} payload base64-encoded in-toto statement (DSSE payload).
 * @returns {Record<string, unknown> | null}
 */
function decodePayload(payload) {
  try {
    const text = Buffer.from(payload, 'base64').toString('utf8')
    const parsed = JSON.parse(text)
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Accept either a `fetchAttestation` result or a raw npm attestation document
 * (`{ attestations: [...] }`), a single sigstore bundle entry, or a plain
 * in-toto statement.
 *
 * @param {unknown} input
 * @returns {{ present: boolean, reason: string | null, predicateType: string | null, subject: Record<string, unknown>[], predicate: Record<string, unknown> | null, tarballSha512: string | null }}
 */
function toAttestation(input) {
  const empty = {
    present: false,
    reason: 'attestation-invalid',
    predicateType: null,
    subject: [],
    predicate: null,
    tarballSha512: null,
  }
  if (!isPlainObject(input)) return empty
  if (input.present === false) {
    return {
      ...empty,
      present: false,
      reason: typeof input.reason === 'string' && input.reason !== '' ? input.reason : 'attestation-missing',
      tarballSha512: typeof input.tarballSha512 === 'string' ? input.tarballSha512 : null,
    }
  }

  /** @type {Record<string, unknown>} */
  let entry = input
  if (Array.isArray(input.attestations)) {
    const entries = input.attestations.filter(isPlainObject)
    if (entries.length === 0) return { ...empty, reason: 'no-attestations' }
    const preferred =
      isPlainObject(input.provenance) && typeof input.provenance.predicateType === 'string'
        ? input.provenance.predicateType
        : null
    entry =
      (preferred !== null && entries.find((candidate) => candidate.predicateType === preferred)) ||
      entries.find((candidate) => isProvenanceType(candidate.predicateType)) ||
      entries[0]
  }

  const decoded = decodeAttestation(entry)
  return {
    present: true,
    reason: null,
    predicateType: decoded.predicateType,
    subject: decoded.subject,
    predicate: decoded.predicate,
    tarballSha512: typeof input.tarballSha512 === 'string' ? input.tarballSha512 : null,
  }
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function subjectDigest(value) {
  if (!isPlainObject(value) || !isPlainObject(value.digest)) return null
  return normalizeSha512(value.digest.sha512)
}

/**
 * @param {Record<string, unknown> | null} predicate
 * @returns {string[]}
 */
function collectRepos(predicate) {
  /** @type {string[]} */
  const found = []
  const add = (value) => {
    const normalized = normalizeRepo(value)
    if (normalized !== null) found.push(normalized)
  }
  if (!isPlainObject(predicate)) return found

  if (isPlainObject(predicate.buildDefinition)) {
    const definition = predicate.buildDefinition
    if (isPlainObject(definition.externalParameters)) {
      const external = definition.externalParameters
      add(external.repository)
      add(external.repo)
      add(external.sourceRepository)
      if (isPlainObject(external.workflow)) {
        add(external.workflow.repository)
        add(external.workflow.sourceRepository)
        add(external.workflow.repo)
      }
      if (isPlainObject(external.github)) {
        add(external.github.repository)
        add(external.github.repositoryUrl)
      }
    }
    if (Array.isArray(definition.resolvedDependencies)) {
      for (const dependency of definition.resolvedDependencies) {
        if (isPlainObject(dependency)) add(dependency.uri)
      }
    }
  }

  if (isPlainObject(predicate.invocation)) {
    const invocation = predicate.invocation
    if (isPlainObject(invocation.configSource)) {
      add(invocation.configSource.uri)
      add(invocation.configSource.repository)
    }
    if (isPlainObject(invocation.environment)) {
      add(invocation.environment.repository)
      add(invocation.environment.sourceRepository)
    }
  }

  if (isPlainObject(predicate.runDetails) && isPlainObject(predicate.runDetails.metadata)) {
    add(predicate.runDetails.metadata.invocationId)
  }

  return unique(found)
}

/**
 * Collect git commit candidates from the predicate. When `expectedRepo` is
 * given, commits from `resolvedDependencies` pointing at that repository take
 * precedence, so an unrelated toolchain commit cannot satisfy the check. If no
 * dependency matches the expected repository, all dependency commits are kept
 * so the repo and commit verdicts stay independently diagnosable.
 *
 * @param {Record<string, unknown> | null} predicate
 * @param {string | null} expectedRepo
 * @returns {string[]}
 */
function collectCommits(predicate, expectedRepo = null) {
  /** @type {string[]} */
  const dependencyCommits = []
  /** @type {string[]} */
  const scopedCommits = []
  /** @type {string[]} */
  const otherCommits = []
  const addTo = (target, value) => {
    const normalized = normalizeCommit(value)
    if (normalized !== null) target.push(normalized)
  }
  const add = (value) => addTo(otherCommits, value)
  if (!isPlainObject(predicate)) return []

  if (isPlainObject(predicate.buildDefinition)) {
    const definition = predicate.buildDefinition
    if (Array.isArray(definition.resolvedDependencies)) {
      for (const dependency of definition.resolvedDependencies) {
        if (!isPlainObject(dependency) || !isPlainObject(dependency.digest)) continue
        const dependencyRepo = normalizeRepo(dependency.uri)
        const inScope = expectedRepo === null || dependencyRepo === expectedRepo
        const digests = [
          dependency.digest.gitCommit,
          dependency.digest.sha1,
          dependency.digest.sha256,
        ]
        for (const digest of digests) {
          addTo(dependencyCommits, digest)
          if (inScope) addTo(scopedCommits, digest)
        }
      }
    }
    if (isPlainObject(definition.externalParameters)) {
      const external = definition.externalParameters
      if (isPlainObject(external.workflow)) add(external.workflow.ref)
      add(external.commit)
      add(external.sha)
    }
  }

  if (
    isPlainObject(predicate.invocation) &&
    isPlainObject(predicate.invocation.configSource) &&
    isPlainObject(predicate.invocation.configSource.digest)
  ) {
    add(predicate.invocation.configSource.digest.sha1)
    add(predicate.invocation.configSource.digest.gitCommit)
  }

  const selected =
    expectedRepo !== null && scopedCommits.length > 0 ? scopedCommits : dependencyCommits
  return unique([...selected, ...otherCommits])
}

/**
 * Normalise a repository reference to `owner/repo` (lowercase). Accepts a
 * GitHub-style URL, `git+`/`ssh`/`git@` forms, refs such as
 * `https://github.com/o/r@refs/tags/v1`, and an `owner/repo` slug. Returns
 * `null` when the value is not a usable reference.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeRepo(value) {
  if (typeof value !== 'string') return null
  let text = value.trim()
  if (text === '') return null
  text = text.replace(/^git\+/i, '')
  if (/^git@/i.test(text)) text = `ssh://${text.replace(':', '/')}`

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    /** @type {URL} */
    let url
    try {
      url = new URL(text)
    } catch {
      return null
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    if (host === '') return null
    let path = stripRef(url.pathname.replace(/^\/+|\/+$/g, ''))
    path = path.replace(/\/actions\/(?:runs|workflows)\/.*$/i, '').replace(/\.git$/i, '')
    const parts = path.split('/').filter(Boolean)
    if (parts.length < 2) return null
    if (host === 'github.com') return `${parts[0]}/${parts[1]}`.toLowerCase()
    return `${host}/${parts.join('/')}`.toLowerCase()
  }

  const path = stripRef(text.replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '')).replace(/\.git$/i, '')
  const parts = path.split('/').filter(Boolean)
  if (parts.length !== 2) return null
  return `${parts[0]}/${parts[1]}`.toLowerCase()
}

/**
 * Drop a trailing `@<ref>` (which may itself contain slashes), e.g.
 * `owner/repo@refs/tags/v1` → `owner/repo`. Repository names cannot contain
 * `@`, so the first `@` in the path is always the ref separator.
 *
 * @param {string} path
 * @returns {string}
 */
function stripRef(path) {
  const at = path.indexOf('@')
  return at === -1 ? path : path.slice(0, at)
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeCommit(value) {
  if (typeof value !== 'string') return null
  const text = value.trim().toLowerCase()
  return COMMIT_HEX.test(text) ? text : null
}

/**
 * @param {string} expected
 * @param {string} candidate
 * @returns {boolean}
 */
function commitMatches(expected, candidate) {
  if (expected === candidate) return true
  const [short, long] = expected.length <= candidate.length ? [expected, candidate] : [candidate, expected]
  return short.length >= 7 && long.startsWith(short)
}

/**
 * @param {string} value
 * @returns {string | null}
 */
function decodeBase64Sha512(value) {
  if (!BASE64.test(value)) return null
  try {
    const bytes = Buffer.from(value, 'base64')
    if (bytes.length !== 64) return null
    return bytes.toString('hex')
  } catch {
    return null
  }
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isProvenanceType(value) {
  return typeof value === 'string' && PROVENANCE_TYPE.test(value)
}

/**
 * @param {string} value
 * @returns {string}
 */
function registryBase(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('registry must be a non-empty http(s) URL')
  }
  /** @type {URL} */
  let url
  try {
    url = new URL(value.trim())
  } catch {
    throw new TypeError(`registry must be an http(s) URL: ${value}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TypeError(`registry must use http or https: ${value}`)
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

/**
 * @param {string} name
 * @returns {string}
 */
function packagePath(name) {
  if (name.startsWith('@')) {
    const slash = name.indexOf('/')
    if (slash <= 1 || slash === name.length - 1) {
      throw new TypeError(`package name must look like @scope/name: ${name}`)
    }
    return `@${encodeURIComponent(name.slice(1, slash))}%2F${encodeURIComponent(name.slice(slash + 1))}`
  }
  return encodeURIComponent(name)
}

/**
 * @param {string} value
 * @returns {string}
 */
function attestationUrl(value) {
  const text = value.trim()
  /** @type {URL} */
  let url
  try {
    url = new URL(text)
  } catch {
    throw new ProvenanceError('ATTESTATION_URL_INVALID', `registry returned an invalid attestation URL: ${text}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ProvenanceError(
      'ATTESTATION_URL_INVALID',
      `registry returned a non-http(s) attestation URL: ${text}`,
    )
  }
  return url.href
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string`)
  }
  return value
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describeError(error) {
  if (!(error instanceof Error)) return String(error)
  if (!(error.cause instanceof Error)) return error.message
  const code = error.cause.code ?? null
  return `${error.message} (${code === null ? error.cause.message : `${code}: ${error.cause.message}`})`
}

/**
 * @template T
 * @param {T[]} values
 * @returns {T[]}
 */
function unique(values) {
  return [...new Set(values)]
}
