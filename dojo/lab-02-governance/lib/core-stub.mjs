/**
 * Simplified, offline core for Lab 2.
 *
 * This is NOT a copy of `dsh-os-trace` / `dsh-os-lease` / `dsh-os-quota`.
 * It keeps only the invariants the lab needs to demonstrate:
 *
 * - trace: append-only SHA-256 hash chain + parent links + causal `why()`
 * - lease: workspace-relative paths, segment-aware overlap, TTL, patchsets
 * - quota: admission projection vs. booked consumption, soft/hard limits
 *
 * Everything is in-memory, deterministic, and uses only Node built-ins.
 */

import { createHash } from 'node:crypto'

export const HASH_ALGO = 'sha256'
export const GENESIS_PREV_HASH = '0'.repeat(64)
export const TRACE_FORMAT = 'dojo-trace/bundle'
export const TRACE_VERSION = 1

export const DEFAULT_TTL_MS = 15 * 60 * 1000
export const DEFAULT_SOFT_RATIO = 0.8
export const DIMENSIONS = Object.freeze(['tokens', 'jobs', 'diskMb'])

export const LEASE_ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  INVALID_PATH: 'INVALID_PATH',
  NOT_FOUND: 'NOT_FOUND',
  DUPLICATE_PATH: 'DUPLICATE_PATH',
  PATH_NOT_LEASED: 'PATH_NOT_LEASED',
  CONFLICT: 'CONFLICT',
  LEASE_EXPIRED: 'LEASE_EXPIRED',
  LEASE_RELEASED: 'LEASE_RELEASED',
  ALREADY_RELEASED: 'ALREADY_RELEASED',
  ALREADY_COMMITTED: 'ALREADY_COMMITTED',
  ALREADY_ROLLED_BACK: 'ALREADY_ROLLED_BACK',
})

/** Stable trace error type, mirroring the shape used by the real package. */
export class TraceError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message)
    this.name = 'TraceError'
    this.code = code
  }
}

/** Stable lease error type, mirroring the shape used by the real package. */
export class LeaseError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details) {
    super(message)
    this.name = 'LeaseError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** @template T @param {T} value @returns {T} */
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Canonical JSON: object keys sorted recursively, no insignificant whitespace.
 * This is what the chain hash covers; key order cannot change the hash.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TraceError('INVALID_SPAN', 'canonical JSON cannot encode a non-finite number')
    }
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(',')}]`
  }
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    return `{${entries.join(',')}}`
  }
  throw new TraceError('INVALID_SPAN', `canonical JSON cannot encode a ${typeof value}`)
}

/**
 * @param {string} text
 * @returns {string}
 */
function sha256(text) {
  return createHash(HASH_ALGO).update(text).digest('hex')
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {string}
 */
function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TraceError('INVALID_SPAN', `${label} must be a non-empty string`)
  }
  return value
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {number}
 */
function requireFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TraceError('INVALID_SPAN', `${label} must be a finite number`)
  }
  return value
}

const SPAN_KINDS = Object.freeze(['tool', 'subagent', 'job', 'approval', 'mcp', 'workflow'])
const SPAN_STATUSES = Object.freeze(['ok', 'error', 'running'])

/**
 * Validate and normalize one raw span. `hash` / `prevHash` are not accepted
 * from callers: the store always owns the chain.
 *
 * @param {Record<string, unknown>} input
 * @returns {Record<string, unknown>}
 */
function normalizeSpan(input) {
  if (!isRecord(input)) {
    throw new TraceError('INVALID_SPAN', 'span must be an object')
  }

  const span = {
    id: requireString(input.id, 'id'),
    sessionId: requireString(input.sessionId, 'sessionId'),
    kind: requireString(input.kind, 'kind'),
    name: requireString(input.name, 'name'),
    startMs: requireFiniteNumber(input.startMs, 'startMs'),
    status: requireString(input.status, 'status'),
  }

  if (!SPAN_KINDS.includes(span.kind)) {
    throw new TraceError('INVALID_SPAN', `kind must be one of: ${SPAN_KINDS.join(', ')}`)
  }
  if (!SPAN_STATUSES.includes(span.status)) {
    throw new TraceError('INVALID_SPAN', `status must be one of: ${SPAN_STATUSES.join(', ')}`)
  }
  if (input.parentId !== undefined) span.parentId = requireString(input.parentId, 'parentId')
  if (input.agentPath !== undefined) span.agentPath = requireString(input.agentPath, 'agentPath')
  if (input.endMs !== undefined) span.endMs = requireFiniteNumber(input.endMs, 'endMs')
  if (input.attrs !== undefined) span.attrs = cloneJson(input.attrs)

  return span
}

/**
 * Create an in-memory trace store. All state is closure-local, so tests can
 * create a fresh chain per case.
 *
 * @param {{ now?: () => number }} [options]
 */
export function createTraceStore(options = {}) {
  const now = options.now ?? Date.now
  /** @type {Record<string, unknown>[]} */
  const spans = []
  /** @type {Map<string, Record<string, unknown>>} */
  const byId = new Map()

  /**
   * Append one span. The caller supplies causal fields only; the store
   * computes `prevHash` and `hash`.
   *
   * @param {Record<string, unknown>} input
   * @returns {Record<string, unknown>}
   */
  function ingest(input) {
    const span = normalizeSpan(input)
    if (byId.has(span.id)) {
      throw new TraceError('DUPLICATE_ID', `span id already exists: ${span.id}`)
    }

    const previous = spans.at(-1)
    const prevHash = previous === undefined ? GENESIS_PREV_HASH : String(previous.hash)
    const hash = sha256(canonicalJson({ ...span, prevHash }))
    const stored = { ...span, hash, prevHash }

    spans.push(stored)
    byId.set(String(span.id), stored)
    return cloneJson(stored)
  }

  /**
   * Walk parent links from an event to its causal root. The returned path is
   * chronological (root first), which is the order instructors should draw.
   *
   * @param {string} eventId
   * @param {number} [depth] Maximum parent hops to follow.
   */
  function why(eventId, depth = 4) {
    const id = String(eventId)
    const target = byId.get(id)
    if (target === undefined) {
      return {
        eventId: id,
        found: false,
        target: null,
        depth,
        spans: [],
        edges: [],
        missing: [id],
        truncated: false,
      }
    }

    /** @type {Record<string, unknown>[]} */
    const chain = []
    /** @type {string[]} */
    const missing = []
    let current = target
    let hops = 0
    let truncated = false

    while (true) {
      chain.push(current)
      const parentId = current.parentId
      if (parentId === undefined) break
      if (hops >= depth) {
        truncated = true
        break
      }
      const parent = byId.get(String(parentId))
      if (parent === undefined) {
        missing.push(String(parentId))
        break
      }
      current = parent
      hops += 1
    }

    chain.reverse()
    /** @type {{ parentId: string, childId: string }[]} */
    const edges = []
    for (let index = 1; index < chain.length; index += 1) {
      if (chain[index].parentId === chain[index - 1].id) {
        edges.push({
          parentId: String(chain[index - 1].id),
          childId: String(chain[index].id),
        })
      }
    }

    return {
      eventId: id,
      found: true,
      target: cloneJson(target),
      depth,
      spans: chain.map((span) => cloneJson(span)),
      edges,
      missing,
      truncated,
    }
  }

  /** @returns {Record<string, unknown>[]} */
  function list() {
    return spans.map((span) => cloneJson(span))
  }

  /** Export a detached bundle; tampering with it must be detectable. */
  function exportBundle() {
    const rootHash = spans.length === 0 ? GENESIS_PREV_HASH : String(spans.at(-1).hash)
    return {
      format: TRACE_FORMAT,
      version: TRACE_VERSION,
      hashAlgo: HASH_ALGO,
      exportedAt: now(),
      spanCount: spans.length,
      rootHash,
      genesisPrevHash: GENESIS_PREV_HASH,
      spans: list(),
    }
  }

  return { ingest, why, list, exportBundle }
}

/**
 * Verify a trace bundle end to end: every `prevHash` must match the previous
 * span, and every `hash` must equal SHA-256 over the canonical span body.
 *
 * @param {unknown} bundle
 * @returns {{
 *   ok: boolean,
 *   count: number,
 *   checked: number,
 *   rootHash: string | null,
 *   firstBad: null | {
 *     index: number,
 *     id: string | null,
 *     reason: string,
 *     expected?: unknown,
 *     actual?: unknown,
 *   },
 * }}
 */
export function verifyBundle(bundle) {
  if (!isRecord(bundle) || !Array.isArray(bundle.spans)) {
    return {
      ok: false,
      count: 0,
      checked: 0,
      rootHash: null,
      firstBad: { index: -1, id: null, reason: 'INVALID_BUNDLE' },
    }
  }

  const spans = bundle.spans
  let prevHash = GENESIS_PREV_HASH

  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index]
    if (!isRecord(span) || typeof span.id !== 'string') {
      return {
        ok: false,
        count: spans.length,
        checked: index,
        rootHash: prevHash,
        firstBad: { index, id: null, reason: 'INVALID_SPAN' },
      }
    }

    if (span.prevHash !== prevHash) {
      return {
        ok: false,
        count: spans.length,
        checked: index,
        rootHash: prevHash,
        firstBad: {
          index,
          id: span.id,
          reason: 'CHAIN_LINK',
          expected: prevHash,
          actual: span.prevHash ?? null,
        },
      }
    }

    const { hash, prevHash: _prevHash, ...core } = span
    const expected = sha256(canonicalJson({ ...core, prevHash }))
    if (hash !== expected) {
      return {
        ok: false,
        count: spans.length,
        checked: index,
        rootHash: prevHash,
        firstBad: {
          index,
          id: span.id,
          reason: 'HASH_MISMATCH',
          expected,
          actual: hash ?? null,
        },
      }
    }

    prevHash = hash
  }

  return {
    ok: true,
    count: spans.length,
    checked: spans.length,
    rootHash: prevHash,
    firstBad: null,
  }
}

/**
 * Normalize a workspace key. Workspaces are opaque keys here; no filesystem
 * lookup happens in the lab.
 *
 * @param {unknown} workspace
 * @returns {string}
 */
export function normalizeWorkspace(workspace) {
  if (typeof workspace !== 'string') {
    throw new LeaseError(LEASE_ERROR_CODES.INVALID_ARGUMENT, 'workspace must be a string')
  }
  const normalized = workspace
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '')
  if (normalized === '') {
    throw new LeaseError(LEASE_ERROR_CODES.INVALID_ARGUMENT, 'workspace must not be blank')
  }
  return normalized
}

/**
 * Normalize one workspace-relative path. Absolute paths, drive letters, `.`
 * segments, and `..` segments are rejected so a lease cannot escape.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizePath(value) {
  if (typeof value !== 'string') {
    throw new LeaseError(LEASE_ERROR_CODES.INVALID_PATH, 'path must be a string', { path: value })
  }
  let normalized = value.trim().replace(/\\/g, '/')
  if (normalized === '') {
    throw new LeaseError(LEASE_ERROR_CODES.INVALID_PATH, 'path must not be blank', { path: value })
  }
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new LeaseError(
      LEASE_ERROR_CODES.INVALID_PATH,
      'path must be workspace-relative',
      { path: value },
    )
  }
  normalized = normalized.replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  while (normalized.startsWith('./')) normalized = normalized.slice(2)
  if (normalized === '') {
    throw new LeaseError(LEASE_ERROR_CODES.INVALID_PATH, 'path must not be the workspace root', {
      path: value,
    })
  }
  for (const segment of normalized.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new LeaseError(
        LEASE_ERROR_CODES.INVALID_PATH,
        'path must not contain empty, "." or ".." segments',
        { path: value },
      )
    }
  }
  return normalized
}

/**
 * Whether two paths overlap on a segment boundary. `src/a` overlaps `src/a/b`
 * but not `src/ab`.
 *
 * @param {string} left
 * @param {string} right
 * @returns {boolean}
 */
export function pathsOverlap(left, right) {
  const a = normalizePath(left)
  const b = normalizePath(right)
  if (a === b) return true
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

/**
 * @param {unknown} paths
 * @returns {string[]}
 */
function normalizePaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new LeaseError(
      LEASE_ERROR_CODES.INVALID_ARGUMENT,
      'paths must be a non-empty array',
    )
  }
  return [...new Set(paths.map((path) => normalizePath(path)))]
}

/**
 * Create an in-memory lease manager plus patchset state machine.
 *
 * @param {{ now?: () => number, defaultTtlMs?: number }} [options]
 */
export function createLeaseManager(options = {}) {
  const now = options.now ?? Date.now
  const defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS
  /** @type {Map<string, Record<string, any>>} */
  const leases = new Map()
  /** @type {Map<string, Record<string, any>>} */
  const patchsets = new Map()
  let sequence = 0

  /** @param {Record<string, any>} lease */
  function isActive(lease) {
    return lease.status === 'active' && lease.expiresAt > now()
  }

  /**
   * @param {string} workspace
   * @param {string[]} paths
   * @param {string} [excludeLeaseId]
   */
  function findConflicts(workspace, paths, excludeLeaseId) {
    /** @type {Record<string, unknown>[]} */
    const conflicts = []
    for (const lease of leases.values()) {
      if (lease.id === excludeLeaseId || lease.workspace !== workspace || !isActive(lease)) {
        continue
      }
      for (const requested of paths) {
        for (const held of lease.paths) {
          if (pathsOverlap(requested, held)) {
            conflicts.push({
              leaseId: lease.id,
              owner: lease.owner,
              path: requested,
              leasePath: held,
              reason: requested === held ? 'exact' : 'prefix',
            })
          }
        }
      }
    }
    return conflicts
  }

  /**
   * Read-only conflict projection; useful before acquiring.
   *
   * @param {{ workspace: string, paths: string[] }} input
   */
  function checkConflict(input) {
    if (!isRecord(input)) {
      throw new LeaseError(LEASE_ERROR_CODES.INVALID_ARGUMENT, 'checkConflict input must be an object')
    }
    const workspace = normalizeWorkspace(input.workspace)
    const paths = normalizePaths(input.paths)
    const conflicts = findConflicts(workspace, paths)
    return {
      workspace,
      paths,
      conflict: conflicts.length > 0,
      conflicts,
      checkedAt: now(),
    }
  }

  /**
   * @param {{ workspace: string, paths: string[], owner: string, ttlMs?: number, id?: string }} input
   */
  function acquire(input) {
    if (!isRecord(input)) {
      throw new LeaseError(LEASE_ERROR_CODES.INVALID_ARGUMENT, 'acquire input must be an object')
    }
    const workspace = normalizeWorkspace(input.workspace)
    const paths = normalizePaths(input.paths)
    if (typeof input.owner !== 'string' || input.owner.trim() === '') {
      throw new LeaseError(LEASE_ERROR_CODES.INVALID_ARGUMENT, 'owner must be a non-empty string')
    }
    const ttlMs = input.ttlMs ?? defaultTtlMs
    if (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new LeaseError(
        LEASE_ERROR_CODES.INVALID_ARGUMENT,
        'ttlMs must be a positive finite number',
      )
    }

    const conflicts = findConflicts(workspace, paths)
    if (conflicts.length > 0) {
      throw new LeaseError(
        LEASE_ERROR_CODES.CONFLICT,
        `workspace paths overlap an active lease: ${conflicts.map((item) => `${item.path} (${item.leaseId})`).join(', ')}`,
        { workspace, conflicts },
      )
    }

    const at = now()
    sequence += 1
    const id = input.id === undefined ? `lease-${sequence}` : String(input.id)
    if (leases.has(id)) {
      throw new LeaseError(LEASE_ERROR_CODES.INVALID_ARGUMENT, `lease id already exists: ${id}`)
    }
    const lease = {
      id,
      workspace,
      paths,
      owner: input.owner,
      ttlMs,
      expiresAt: at + ttlMs,
      status: 'active',
      createdAt: at,
    }
    leases.set(id, lease)
    return cloneJson(lease)
  }

  /**
   * @param {string} id
   * @returns {Record<string, unknown>}
   */
  function release(id) {
    const lease = leases.get(id)
    if (lease === undefined) {
      throw new LeaseError(LEASE_ERROR_CODES.NOT_FOUND, `unknown lease: ${id}`)
    }
    if (lease.status === 'released') {
      throw new LeaseError(LEASE_ERROR_CODES.ALREADY_RELEASED, `lease already released: ${id}`)
    }
    lease.status = 'released'
    return cloneJson(lease)
  }

  /**
   * Stage file bodies against a lease. This never touches the filesystem.
   *
   * @param {string} leaseId
   * @param {{ path: string, before?: string, after: string }[]} files
   */
  function preparePatchset(leaseId, files) {
    const lease = leases.get(leaseId)
    if (lease === undefined) {
      throw new LeaseError(LEASE_ERROR_CODES.NOT_FOUND, `unknown lease: ${leaseId}`)
    }
    if (lease.status === 'released') {
      throw new LeaseError(LEASE_ERROR_CODES.LEASE_RELEASED, `lease already released: ${leaseId}`)
    }
    if (!isActive(lease)) {
      throw new LeaseError(LEASE_ERROR_CODES.LEASE_EXPIRED, `lease expired: ${leaseId}`)
    }
    if (!Array.isArray(files) || files.length === 0) {
      throw new LeaseError(
        LEASE_ERROR_CODES.INVALID_ARGUMENT,
        'files must be a non-empty array',
      )
    }

    const seen = new Set()
    const staged = files.map((file) => {
      if (!isRecord(file)) {
        throw new LeaseError(LEASE_ERROR_CODES.INVALID_ARGUMENT, 'patch file must be an object')
      }
      const path = normalizePath(file.path)
      if (seen.has(path)) {
        throw new LeaseError(LEASE_ERROR_CODES.DUPLICATE_PATH, `duplicate path: ${path}`)
      }
      seen.add(path)

      const covered = lease.paths.some((root) => path === root || path.startsWith(`${root}/`))
      if (!covered) {
        throw new LeaseError(
          LEASE_ERROR_CODES.PATH_NOT_LEASED,
          `path is not covered by lease ${leaseId}: ${path}`,
          { path },
        )
      }
      if (typeof file.after !== 'string') {
        throw new LeaseError(
          LEASE_ERROR_CODES.INVALID_ARGUMENT,
          `after must be a string: ${path}`,
        )
      }
      const entry = { path, after: file.after }
      if (file.before !== undefined) {
        if (typeof file.before !== 'string') {
          throw new LeaseError(
            LEASE_ERROR_CODES.INVALID_ARGUMENT,
            `before must be a string when present: ${path}`,
          )
        }
        entry.before = file.before
      }
      return entry
    })

    sequence += 1
    const patchset = {
      id: `patch-${sequence}`,
      leaseId,
      files: staged,
      status: 'prepared',
      createdAt: now(),
    }
    patchsets.set(patchset.id, patchset)
    return cloneJson(patchset)
  }

  /** @param {string} id */
  function commitPatchset(id) {
    const patchset = patchsets.get(id)
    if (patchset === undefined) {
      throw new LeaseError(LEASE_ERROR_CODES.NOT_FOUND, `unknown patchset: ${id}`)
    }
    if (patchset.status === 'committed') {
      throw new LeaseError(LEASE_ERROR_CODES.ALREADY_COMMITTED, `patchset already committed: ${id}`)
    }
    if (patchset.status === 'rolledBack') {
      throw new LeaseError(LEASE_ERROR_CODES.ALREADY_ROLLED_BACK, `patchset rolled back: ${id}`)
    }
    patchset.status = 'committed'
    patchset.committedAt = now()
    return patchset.files.map((file) => ({ path: file.path, after: file.after }))
  }

  /** @param {string} id */
  function rollbackPatchset(id) {
    const patchset = patchsets.get(id)
    if (patchset === undefined) {
      throw new LeaseError(LEASE_ERROR_CODES.NOT_FOUND, `unknown patchset: ${id}`)
    }
    if (patchset.status === 'committed') {
      throw new LeaseError(LEASE_ERROR_CODES.ALREADY_COMMITTED, `patchset already committed: ${id}`)
    }
    if (patchset.status === 'rolledBack') {
      throw new LeaseError(LEASE_ERROR_CODES.ALREADY_ROLLED_BACK, `patchset rolled back: ${id}`)
    }
    patchset.status = 'rolledBack'
    patchset.rolledBackAt = now()
    return patchset.files.map((file) => ({ path: file.path, before: file.before }))
  }

  function status() {
    return {
      now: now(),
      defaultTtlMs,
      leases: [...leases.values()].map((lease) => cloneJson(lease)),
      patchsets: [...patchsets.values()].map((patchset) => ({
        id: patchset.id,
        leaseId: patchset.leaseId,
        status: patchset.status,
        paths: patchset.files.map((file) => file.path),
        fileCount: patchset.files.length,
        createdAt: patchset.createdAt,
      })),
    }
  }

  return {
    acquire,
    release,
    checkConflict,
    preparePatchset,
    commitPatchset,
    rollbackPatchset,
    status,
  }
}

/** @param {unknown} value */
function normalizeLimit(value) {
  if (value === null || value === undefined) return Number.POSITIVE_INFINITY
  if (typeof value !== 'number' || Number.isNaN(value)) return 0
  if (value < 0) return 0
  return value
}

/** @param {unknown} value */
function normalizeAmount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/** @returns {{ tokens: number, jobs: number, diskMb: number }} */
function emptyUsage() {
  return { tokens: 0, jobs: 0, diskMb: 0 }
}

/** @returns {{ tokens: number, jobs: number, diskMb: number }} */
function unlimitedUsage() {
  return {
    tokens: Number.POSITIVE_INFINITY,
    jobs: Number.POSITIVE_INFINITY,
    diskMb: Number.POSITIVE_INFINITY,
  }
}

/**
 * @param {{ tokens: number, jobs: number, diskMb: number }} left
 * @param {{ tokens: number, jobs: number, diskMb: number }} right
 */
function addUsage(left, right) {
  return {
    tokens: left.tokens + right.tokens,
    jobs: left.jobs + right.jobs,
    diskMb: left.diskMb + right.diskMb,
  }
}

/**
 * @param {{ tokens: number, jobs: number, diskMb: number }} used
 * @param {{ tokens: number, jobs: number, diskMb: number }} limits
 */
function remainingOf(used, limits) {
  /** @type {{ tokens: number, jobs: number, diskMb: number }} */
  const out = emptyUsage()
  for (const dimension of DIMENSIONS) {
    const limit = limits[dimension]
    out[dimension] = Number.isFinite(limit)
      ? Math.max(0, limit - used[dimension])
      : Number.POSITIVE_INFINITY
  }
  return out
}

/**
 * @param {{ tokens: number, jobs: number, diskMb: number }} used
 * @param {{ tokens: number, jobs: number, diskMb: number }} limits
 */
function overByOf(used, limits) {
  /** @type {{ tokens: number, jobs: number, diskMb: number }} */
  const out = emptyUsage()
  for (const dimension of DIMENSIONS) {
    const limit = limits[dimension]
    out[dimension] = Number.isFinite(limit) ? Math.max(0, used[dimension] - limit) : 0
  }
  return out
}

/**
 * Hard wins over soft. Equality with a hard limit is allowed; only strictly
 * above it is denied. The soft threshold is also strict.
 *
 * @param {{ tokens: number, jobs: number, diskMb: number }} used
 * @param {{ tokens: number, jobs: number, diskMb: number }} limits
 * @param {number} softRatio
 */
function classify(used, limits, softRatio) {
  /** @type {string[]} */
  const exceeded = []
  /** @type {string[]} */
  const degraded = []
  let level = 'ok'

  for (const dimension of DIMENSIONS) {
    const limit = limits[dimension]
    if (!Number.isFinite(limit)) continue
    const value = used[dimension]
    if (value > limit) {
      exceeded.push(dimension)
      level = 'hard'
    } else if (value > limit * softRatio) {
      degraded.push(dimension)
      if (level === 'ok') level = 'soft'
    }
  }

  return { level, exceeded, degraded }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function scopeIdOf(value) {
  if (value === undefined || value === null) return 'default'
  if (typeof value === 'string' && value.trim() !== '') return value
  if (isRecord(value) && typeof value.id === 'string' && value.id.trim() !== '') return value.id
  throw new Error('scope must be a non-empty string or an object with an id')
}

/**
 * Create the quota governor. `admit()` projects only; `consume()` books usage.
 *
 * @param {{ now?: () => number, softRatio?: number }} [options]
 */
export function createGovernor(options = {}) {
  const now = options.now ?? Date.now
  const softRatio = options.softRatio ?? DEFAULT_SOFT_RATIO
  if (typeof softRatio !== 'number' || !(softRatio >= 0 && softRatio <= 1)) {
    throw new Error('softRatio must be between 0 and 1')
  }

  /** @type {Map<string, { id: string, limits: object, used: object, windowStartedAt: number }>} */
  const scopes = new Map()

  /** @param {string} id */
  function ensureScope(id) {
    let scope = scopes.get(id)
    if (scope === undefined) {
      scope = {
        id,
        limits: unlimitedUsage(),
        used: emptyUsage(),
        windowStartedAt: now(),
      }
      scopes.set(id, scope)
    }
    return scope
  }

  /**
   * @param {string} id
   * @param {Record<string, unknown>} request
   * @param {boolean} commit
   */
  function decide(id, request, commit) {
    const scope = ensureScope(id)
    const normalized = {
      tokens: normalizeAmount(request.tokens),
      jobs: normalizeAmount(request.jobs),
      diskMb: normalizeAmount(request.diskMb),
    }
    const before = { ...scope.used }
    const projected = addUsage(before, normalized)
    const classification = classify(projected, scope.limits, softRatio)
    if (commit) scope.used = projected

    return {
      scope: id,
      allowed: classification.level !== 'hard',
      level: classification.level,
      reason:
        classification.level === 'hard'
          ? 'hard-limit'
          : classification.level === 'soft'
            ? 'soft-limit'
            : 'ok',
      degrade: classification.level === 'soft',
      remaining: remainingOf(projected, scope.limits),
      overBy: overByOf(projected, scope.limits),
      used: commit ? { ...projected } : before,
      projected,
      request: normalized,
      limits: { ...scope.limits },
      exceeded: classification.exceeded,
      degraded: classification.degraded,
      softRatio,
      windowStartedAt: scope.windowStartedAt,
      timestamp: now(),
    }
  }

  /**
   * @param {string} scope
   * @param {Record<string, unknown>} limits
   */
  function setLimits(scope, limits) {
    const id = scopeIdOf(scope)
    const target = ensureScope(id)
    if (!isRecord(limits)) {
      throw new Error('limits must be an object')
    }
    for (const dimension of DIMENSIONS) {
      if (Object.hasOwn(limits, dimension) && limits[dimension] !== undefined) {
        target.limits[dimension] = normalizeLimit(limits[dimension])
      }
    }
    return status(id)
  }

  /** @param {Record<string, unknown>} [request] */
  function admit(request = {}) {
    const id = scopeIdOf(request.scope)
    return decide(id, request, false)
  }

  /** @param {Record<string, unknown>} [request] */
  function consume(request = {}) {
    const id = scopeIdOf(request.scope)
    return decide(id, request, true)
  }

  /** @param {unknown} [scope] */
  function status(scope = 'default') {
    const id = scopeIdOf(scope)
    const target = ensureScope(id)
    const classification = classify(target.used, target.limits, softRatio)
    return {
      scope: id,
      limits: { ...target.limits },
      used: { ...target.used },
      remaining: remainingOf(target.used, target.limits),
      overBy: overByOf(target.used, target.limits),
      level: classification.level,
      allowed: classification.level !== 'hard',
      degrade: classification.level === 'soft',
      exceeded: classification.exceeded,
      degraded: classification.degraded,
      softRatio,
      windowStartedAt: target.windowStartedAt,
      windowStartedAtIso: new Date(target.windowStartedAt).toISOString(),
      windowAgeMs: Math.max(0, now() - target.windowStartedAt),
    }
  }

  /** @param {unknown} [scope] */
  function resetWindow(scope = 'default') {
    const id = scopeIdOf(scope)
    const target = ensureScope(id)
    const previousUsed = { ...target.used }
    const previousWindowStartedAt = target.windowStartedAt
    target.used = emptyUsage()
    target.windowStartedAt = now()
    return { ...status(id), reset: true, previousUsed, previousWindowStartedAt }
  }

  return {
    setLimits,
    admit,
    consume,
    status,
    resetWindow,
    list: () => [...scopes.keys()].map((id) => status(id)),
    softRatio,
  }
}
