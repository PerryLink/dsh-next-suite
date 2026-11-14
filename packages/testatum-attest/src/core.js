/**
 * testatum-attest core library.
 *
 * A trust card binds:
 *   - a path-sorted manifest of file paths, SHA-256 digests and sizes;
 *   - one `rootHash` over the canonical JSON of that manifest;
 *   - an HMAC-SHA256 signature over the canonical JSON of the whole card
 *     (every field except `signature`).
 *
 * Node built-ins only. This module performs no filesystem IO: callers pass
 * file contents in, which keeps the core deterministic and offline-testable.
 *
 * @typedef {object} FileInput
 * @property {string} path
 * @property {string | Uint8Array} [content] Raw bytes/UTF-8 text. Required unless `sha256` is supplied.
 * @property {string} [sha256] Pre-computed lowercase SHA-256 hex digest.
 * @property {number | null} [size] Byte length, when only a digest is supplied.
 *
 * @typedef {object} ManifestEntry
 * @property {string} path
 * @property {string} sha256
 * @property {number | null} size
 *
 * @typedef {object} Manifest
 * @property {ManifestEntry[]} files
 * @property {string} rootHash
 *
 * @typedef {object} Signature
 * @property {'hmac-sha256'} alg
 * @property {string} sig
 * @property {string} [keyId]
 *
 * @typedef {object} Card
 * @property {'testatum/v1'} schema
 * @property {string} name
 * @property {string} version
 * @property {ManifestEntry[]} files
 * @property {string} rootHash
 * @property {string} createdAt
 * @property {Signature} [signature]
 *
 * @typedef {object} Revocation
 * @property {'testatum/revocation/v1'} schema
 * @property {string} name
 * @property {string} version
 * @property {string} rootHash
 * @property {string} reason
 * @property {string} revokedAt
 *
 * @typedef {object} VerificationResult
 * @property {boolean} ok
 * @property {string[]} reasons
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/** Card schema id written by this package. */
export const SCHEMA = 'testatum/v1'
/** Revocation record schema id written by this package. */
export const REVOCATION_SCHEMA = 'testatum/revocation/v1'
/** The only signature algorithm implemented in this MVP. */
export const ALG = 'hmac-sha256'

const SHA256_HEX = /^[0-9a-f]{64}$/

/**
 * Return true for a non-null, non-array object with Object.prototype or a
 * null prototype. This deliberately rejects class instances, Dates, Buffers
 * and other values that are not part of the JSON data model.
 *
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Canonical JSON: object keys sorted by UTF-16 code unit, no whitespace,
 * arrays kept in order. Only JSON values are accepted; `undefined`,
 * functions, symbols, bigints, non-finite numbers and cycles throw.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  return encodeCanonical(value, new Set())
}

/**
 * @param {unknown} value
 * @param {Set<object>} stack
 * @returns {string}
 */
function encodeCanonical(value, stack) {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError('canonicalJson: non-finite numbers are not JSON')
      }
      return JSON.stringify(value)
    case 'string':
      return JSON.stringify(value)
    case 'undefined':
    case 'function':
    case 'symbol':
    case 'bigint':
      throw new TypeError(`canonicalJson: ${typeof value} is not JSON`)
    default:
      break
  }

  if (Array.isArray(value)) {
    if (stack.has(value)) throw new TypeError('canonicalJson: cyclic value')
    stack.add(value)
    const encoded = []
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) throw new TypeError('canonicalJson: sparse arrays are not JSON')
      encoded.push(encodeCanonical(value[index], stack))
    }
    stack.delete(value)
    return `[${encoded.join(',')}]`
  }

  if (!isPlainObject(value)) {
    throw new TypeError('canonicalJson: only plain objects and arrays are supported')
  }
  if (stack.has(value)) throw new TypeError('canonicalJson: cyclic value')
  stack.add(value)
  const keys = Object.keys(value).sort(compareCodeUnits)
  const parts = keys.map(
    (key) => `${JSON.stringify(key)}:${encodeCanonical(value[key], stack)}`,
  )
  stack.delete(value)
  return `{${parts.join(',')}}`
}

/**
 * Compare two strings by UTF-16 code unit, independent of locale.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareCodeUnits(a, b) {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/**
 * Hash a string (UTF-8) or byte array with SHA-256.
 *
 * @param {string | Uint8Array} data
 * @returns {string} lowercase hex
 */
export function sha256Hex(data) {
  return createHash('sha256').update(toBytes(data)).digest('hex')
}

/**
 * @param {string | Uint8Array} content
 * @returns {Buffer}
 */
function toBytes(content) {
  if (typeof content === 'string') return Buffer.from(content, 'utf8')
  if (content instanceof Uint8Array) {
    return Buffer.from(content.buffer, content.byteOffset, content.byteLength)
  }
  throw new TypeError('content must be a string, Buffer or Uint8Array')
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`)
  }
  return value
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function requireSha256Hex(value, field) {
  if (typeof value !== 'string' || !SHA256_HEX.test(value)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 hex digest`)
  }
  return value
}

/**
 * Normalise one declared file to the manifest shape:
 * `{ path, sha256, size }`.
 *
 * @param {unknown} entry
 * @param {number} index
 * @returns {ManifestEntry}
 */
function normalizeFileEntry(entry, index) {
  if (!isPlainObject(entry)) {
    throw new TypeError(`files[${index}] must be a plain object`)
  }
  const path = requireNonEmptyString(entry.path, `files[${index}].path`)
  if (path.includes('\0')) {
    throw new TypeError(`files[${index}].path must not contain NUL bytes`)
  }

  const hasContent = Object.prototype.hasOwnProperty.call(entry, 'content')
  const hasDigest = Object.prototype.hasOwnProperty.call(entry, 'sha256')
  if (!hasContent && !hasDigest) {
    throw new TypeError(`files[${index}] needs content or sha256`)
  }

  /** @type {string} */
  let sha256
  /** @type {number | null} */
  let size

  if (hasContent) {
    const bytes = toBytes(/** @type {string | Uint8Array} */ (entry.content))
    sha256 = createHash('sha256').update(bytes).digest('hex')
    size = bytes.length
    if (hasDigest && requireSha256Hex(entry.sha256, `files[${index}].sha256`) !== sha256) {
      throw new Error(`files[${index}].sha256 does not match its content`)
    }
    if (entry.size !== undefined && entry.size !== null) {
      if (!Number.isInteger(entry.size) || /** @type {number} */ (entry.size) < 0) {
        throw new TypeError(`files[${index}].size must be a non-negative integer`)
      }
      if (entry.size !== size) {
        throw new Error(`files[${index}].size does not match its content`)
      }
    }
  } else {
    sha256 = requireSha256Hex(entry.sha256, `files[${index}].sha256`)
    if (entry.size === undefined || entry.size === null) {
      size = null
    } else if (!Number.isInteger(entry.size) || /** @type {number} */ (entry.size) < 0) {
      throw new TypeError(`files[${index}].size must be a non-negative integer`)
    } else {
      size = /** @type {number} */ (entry.size)
    }
  }

  return { path, sha256, size }
}

/**
 * Build a path-sorted SHA-256 manifest and its root hash.
 *
 * `rootHash = sha256(canonicalJson(manifest))` where each manifest entry is
 * exactly `{ path, sha256, size }` and entries are sorted by path.
 *
 * @param {FileInput[]} entries
 * @returns {Manifest}
 */
export function hashFiles(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError('hashFiles: entries must be an array')
  }
  const files = entries
    .map((entry, index) => normalizeFileEntry(entry, index))
    .sort((a, b) => compareCodeUnits(a.path, b.path))

  for (let index = 1; index < files.length; index += 1) {
    if (files[index - 1].path === files[index].path) {
      throw new Error(`hashFiles: duplicate path ${files[index].path}`)
    }
  }

  return { files, rootHash: sha256Hex(canonicalJson(files)) }
}

/**
 * Create an unsigned trust card.
 *
 * @param {object} input
 * @param {string} input.name
 * @param {string} input.version
 * @param {FileInput[]} [input.files]
 * @param {string} [input.createdAt] ISO-8601 timestamp; defaults to now.
 * @returns {Card}
 */
export function createCard({ name, version, files = [], createdAt } = {}) {
  requireNonEmptyString(name, 'createCard: name')
  requireNonEmptyString(version, 'createCard: version')
  if (!Array.isArray(files)) {
    throw new TypeError('createCard: files must be an array')
  }

  const stamp = createdAt === undefined ? new Date().toISOString() : createdAt
  if (
    typeof stamp !== 'string' ||
    stamp.trim().length === 0 ||
    Number.isNaN(Date.parse(stamp))
  ) {
    throw new TypeError('createCard: createdAt must be a parseable date string')
  }

  const manifest = hashFiles(files)
  return {
    schema: SCHEMA,
    name,
    version,
    files: manifest.files,
    rootHash: manifest.rootHash,
    createdAt: stamp,
  }
}

/**
 * Canonical JSON bytes that an HMAC covers: the card without `signature`.
 * The `signature` field is metadata about the signature and is excluded to
 * avoid a recursive definition.
 *
 * @param {Card | Record<string, unknown>} card
 * @returns {string}
 */
export function signaturePayload(card) {
  if (!isPlainObject(card)) {
    throw new TypeError('signaturePayload: card must be a plain object')
  }
  const unsigned = Object.create(null)
  for (const key of Object.keys(card)) {
    if (key !== 'signature') unsigned[key] = card[key]
  }
  return canonicalJson(unsigned)
}

/**
 * @param {string | Uint8Array | { secret?: string | Uint8Array, keyId?: string } | undefined} input
 * @returns {{ secret: string | Uint8Array | undefined, keyId?: string }}
 */
function normalizeSignOptions(input) {
  if (typeof input === 'string' || input instanceof Uint8Array) {
    return { secret: input }
  }
  if (isPlainObject(input)) {
    return {
      secret: /** @type {string | Uint8Array | undefined} */ (input.secret),
      keyId: /** @type {string | undefined} */ (input.keyId),
    }
  }
  throw new TypeError('signCard: secret must be a string, Uint8Array or { secret, keyId }')
}

/**
 * @param {unknown} secret
 * @returns {string | Uint8Array}
 */
function requireSecret(secret) {
  if (typeof secret === 'string') {
    if (secret.trim().length === 0) throw new TypeError('secret must not be empty')
    return secret
  }
  if (secret instanceof Uint8Array) {
    if (secret.length === 0) throw new TypeError('secret must not be empty')
    return secret
  }
  throw new TypeError('secret must be a non-empty string or Uint8Array')
}

/**
 * HMAC-SHA256 sign a card. The secret is supplied by the caller and is never
 * read from the environment or written into the returned signature.
 *
 * @param {Card | Record<string, unknown>} card
 * @param {string | Uint8Array | { secret: string | Uint8Array, keyId?: string }} secretOrOptions
 * @returns {Signature}
 */
export function signCard(card, secretOrOptions) {
  const { secret, keyId } = normalizeSignOptions(secretOrOptions)
  const key = requireSecret(secret)
  const sig = createHmac('sha256', key)
    .update(signaturePayload(card), 'utf8')
    .digest('hex')

  /** @type {Signature} */
  const signature = { alg: ALG, sig }
  if (keyId !== undefined && keyId !== null) {
    signature.keyId = requireNonEmptyString(keyId, 'keyId')
  }
  return signature
}

/**
 * Attach a signature to a card without mutating the input.
 *
 * @param {Card | Record<string, unknown>} card
 * @param {Signature} signature
 * @returns {Card}
 */
export function attachSignature(card, signature) {
  if (!isPlainObject(card)) throw new TypeError('attachSignature: card must be a plain object')
  if (!isPlainObject(signature)) {
    throw new TypeError('attachSignature: signature must be a plain object')
  }
  return /** @type {Card} */ ({ ...card, signature })
}

/**
 * Check the unsigned part of a card: schema, identity fields, manifest shape,
 * path ordering and the recomputed root hash. Signature checks belong to
 * `verifyCard`.
 *
 * Reasons are stable machine-readable codes; some carry a `:<detail>` suffix.
 *
 * @param {unknown} card
 * @returns {VerificationResult}
 */
export function verifyCardIntegrity(card) {
  /** @type {string[]} */
  const reasons = []

  if (!isPlainObject(card)) {
    return { ok: false, reasons: ['card-invalid'] }
  }
  if (card.schema !== SCHEMA) reasons.push('schema-invalid')
  if (typeof card.name !== 'string' || card.name.trim().length === 0) {
    reasons.push('name-invalid')
  }
  if (typeof card.version !== 'string' || card.version.trim().length === 0) {
    reasons.push('version-invalid')
  }
  if (
    typeof card.createdAt !== 'string' ||
    card.createdAt.trim().length === 0 ||
    Number.isNaN(Date.parse(card.createdAt))
  ) {
    reasons.push('createdAt-invalid')
  }
  if (typeof card.rootHash !== 'string' || !SHA256_HEX.test(card.rootHash)) {
    reasons.push('rootHash-invalid')
  }

  if (!Array.isArray(card.files)) {
    reasons.push('files-invalid')
    return { ok: false, reasons: unique(reasons) }
  }

  /** @type {ManifestEntry[]} */
  const manifest = []
  const seen = new Set()
  let filesOk = true
  let previousPath = null

  for (let index = 0; index < card.files.length; index += 1) {
    const entry = card.files[index]
    if (!isPlainObject(entry)) {
      reasons.push(`file-invalid:${index}`)
      filesOk = false
      continue
    }
    if (typeof entry.path !== 'string' || entry.path.trim().length === 0 || entry.path.includes('\0')) {
      reasons.push(`file-path-invalid:${index}`)
      filesOk = false
      continue
    }
    const path = entry.path
    if (seen.has(path)) {
      reasons.push(`file-duplicate:${path}`)
      filesOk = false
      continue
    }
    seen.add(path)
    if (previousPath !== null && compareCodeUnits(previousPath, path) > 0) {
      reasons.push('files-unsorted')
    }
    previousPath = path

    if (typeof entry.sha256 !== 'string' || !SHA256_HEX.test(entry.sha256)) {
      reasons.push(`file-digest-invalid:${path}`)
      filesOk = false
      continue
    }
    const sha256 = entry.sha256

    /** @type {number | null} */
    let size = null
    if (entry.size !== undefined && entry.size !== null) {
      if (typeof entry.size !== 'number' || !Number.isInteger(entry.size) || entry.size < 0) {
        reasons.push(`file-size-invalid:${path}`)
        filesOk = false
      } else {
        size = entry.size
      }
    }

    if (Object.prototype.hasOwnProperty.call(entry, 'content')) {
      try {
        const bytes = toBytes(/** @type {string | Uint8Array} */ (entry.content))
        if (size !== null && bytes.length !== size) {
          reasons.push(`file-size-mismatch:${path}`)
        }
        if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
          reasons.push(`file-content-mismatch:${path}`)
        }
      } catch {
        reasons.push(`file-content-invalid:${path}`)
      }
    }

    manifest.push({ path, sha256, size })
  }

  if (filesOk) {
    const sorted = [...manifest].sort((a, b) => compareCodeUnits(a.path, b.path))
    const computed = sha256Hex(canonicalJson(sorted))
    if (card.rootHash !== computed) reasons.push('rootHash-mismatch')
  }

  const uniqueReasons = unique(reasons)
  return { ok: uniqueReasons.length === 0, reasons: uniqueReasons }
}

/**
 * Compare a card's manifest with the actual bytes of an artifact. This is the
 * step that binds a signed card to files on disk; `verifyCard` alone only
 * proves that the card is internally consistent and signed.
 *
 * @param {unknown} card
 * @param {FileInput[]} entries Actual files, in `[{ path, content }]` form.
 * @returns {VerificationResult}
 */
export function verifyFiles(card, entries) {
  if (!isPlainObject(card) || !Array.isArray(card.files)) {
    return { ok: false, reasons: ['card-invalid'] }
  }
  let actual
  try {
    actual = hashFiles(entries)
  } catch {
    return { ok: false, reasons: ['files-input-invalid'] }
  }

  const expected = new Map()
  for (const file of card.files) {
    if (isPlainObject(file) && typeof file.path === 'string') {
      expected.set(file.path, file)
    }
  }

  /** @type {string[]} */
  const reasons = []
  const seen = new Set()
  for (const file of actual.files) {
    seen.add(file.path)
    const wanted = expected.get(file.path)
    if (wanted === undefined) {
      reasons.push(`file-extra:${file.path}`)
      continue
    }
    if (wanted.sha256 !== file.sha256) {
      reasons.push(`file-mismatch:${file.path}`)
    } else if (typeof wanted.size === 'number' && wanted.size !== file.size) {
      reasons.push(`file-size-mismatch:${file.path}`)
    }
  }
  for (const path of expected.keys()) {
    if (!seen.has(path)) reasons.push(`file-missing:${path}`)
  }

  const uniqueReasons = unique(reasons)
  return { ok: uniqueReasons.length === 0, reasons: uniqueReasons }
}

/**
 * Verify a signed card: recompute the manifest/root hash and check the HMAC.
 *
 * A secret is required for HMAC verification. Without one the result is
 * always `ok: false` with `secret-missing`; use `verifyCardIntegrity` if only
 * structural/hash checks are wanted.
 *
 * Pass `files: [{ path, content }]` to additionally bind the card to actual
 * artifact bytes (same comparison as `verifyFiles`).
 *
 * @param {unknown} card
 * @param {string | Uint8Array | { secret?: string | Uint8Array, revocations?: unknown, files?: FileInput[] }} [secretOrOptions]
 * @returns {VerificationResult}
 */
export function verifyCard(card, secretOrOptions = {}) {
  /** @type {string | Uint8Array | undefined} */
  let secret
  /** @type {unknown} */
  let revocations
  /** @type {FileInput[] | undefined} */
  let files
  if (typeof secretOrOptions === 'string' || secretOrOptions instanceof Uint8Array) {
    secret = secretOrOptions
  } else if (isPlainObject(secretOrOptions)) {
    secret = /** @type {string | Uint8Array | undefined} */ (secretOrOptions.secret)
    revocations = secretOrOptions.revocations
    files = /** @type {FileInput[] | undefined} */ (secretOrOptions.files)
  } else {
    secret = undefined
  }

  const integrity = verifyCardIntegrity(card)
  /** @type {string[]} */
  const reasons = [...integrity.reasons]

  const signature = isPlainObject(card) ? card.signature : undefined
  let signatureCanBeChecked = false
  if (!isPlainObject(signature)) {
    reasons.push(signature === undefined ? 'signature-missing' : 'signature-invalid')
  } else {
    if (signature.alg !== ALG) {
      reasons.push('signature-alg-unsupported')
    } else if (typeof signature.sig !== 'string' || !SHA256_HEX.test(signature.sig)) {
      reasons.push('signature-malformed')
    } else {
      signatureCanBeChecked = true
    }
    if (
      signature.keyId !== undefined &&
      (typeof signature.keyId !== 'string' || signature.keyId.trim().length === 0)
    ) {
      reasons.push('signature-keyId-invalid')
    }
  }

  /** @type {'ok' | 'missing' | 'invalid'} */
  let secretState = 'ok'
  if (secret === undefined || secret === null) {
    secretState = 'missing'
  } else if (typeof secret === 'string') {
    secretState = secret.trim().length === 0 ? 'missing' : 'ok'
  } else if (secret instanceof Uint8Array) {
    secretState = secret.length === 0 ? 'missing' : 'ok'
  } else {
    secretState = 'invalid'
  }
  if (secretState !== 'ok') {
    reasons.push(secretState === 'invalid' ? 'secret-invalid' : 'secret-missing')
  } else if (signatureCanBeChecked) {
    try {
      const expected = createHmac('sha256', /** @type {string | Uint8Array} */ (secret))
        .update(signaturePayload(card), 'utf8')
        .digest('hex')
      if (!timingSafeEqualHex(expected, /** @type {string} */ (signature?.sig))) {
        reasons.push('signature-mismatch')
      }
    } catch {
      reasons.push('card-not-canonicalizable')
    }
  }

  if (revocations !== undefined && isRevoked(card, revocations)) {
    reasons.push('revoked')
  }

  if (files !== undefined) {
    const fileCheck = verifyFiles(card, files)
    if (!fileCheck.ok) reasons.push(...fileCheck.reasons)
  }

  const uniqueReasons = unique(reasons)
  return { ok: uniqueReasons.length === 0, reasons: uniqueReasons }
}

/**
 * @param {string} expected
 * @param {string} actual
 * @returns {boolean}
 */
function timingSafeEqualHex(expected, actual) {
  if (!SHA256_HEX.test(expected) || !SHA256_HEX.test(actual)) return false
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'))
}

/**
 * Build a revocation record for a structurally valid card. The record is not
 * itself signed in this MVP; distribute revocation lists over a trusted
 * channel and treat their authenticity as a separate problem.
 *
 * @param {Card | Record<string, unknown>} card
 * @param {{ reason: string, revokedAt?: string }} input
 * @returns {Revocation}
 */
export function revokeCard(card, { reason, revokedAt } = /** @type {any} */ ({})) {
  const integrity = verifyCardIntegrity(card)
  if (!integrity.ok) {
    throw new Error(`revokeCard: card is invalid (${integrity.reasons.join(', ')})`)
  }
  const why = requireNonEmptyString(reason, 'revokeCard: reason')
  const stamp = revokedAt === undefined ? new Date().toISOString() : revokedAt
  if (
    typeof stamp !== 'string' ||
    stamp.trim().length === 0 ||
    Number.isNaN(Date.parse(stamp))
  ) {
    throw new TypeError('revokeCard: revokedAt must be a parseable date string')
  }
  const safeCard = /** @type {Card} */ (card)
  return {
    schema: REVOCATION_SCHEMA,
    name: safeCard.name,
    version: safeCard.version,
    rootHash: safeCard.rootHash,
    reason: why,
    revokedAt: stamp,
  }
}

/**
 * Test whether a card appears in a revocation list. Records may be matched by
 * `rootHash` (preferred) or, for legacy/manual lists, by `name` + `version`.
 * `list` may be an array, a `{ revocations: [...] }` wrapper, or one record.
 *
 * @param {unknown} card
 * @param {unknown} list
 * @returns {boolean}
 */
export function isRevoked(card, list) {
  if (!isPlainObject(card)) return false
  /** @type {unknown[]} */
  let records
  if (Array.isArray(list)) {
    records = list
  } else if (isPlainObject(list) && Array.isArray(list.revocations)) {
    records = list.revocations
  } else if (isPlainObject(list)) {
    records = [list]
  } else {
    return false
  }

  return records.some((record) => {
    if (typeof record === 'string') return record === card.rootHash
    if (!isPlainObject(record)) return false
    if (typeof record.rootHash === 'string') {
      return typeof card.rootHash === 'string' && record.rootHash === card.rootHash
    }
    return (
      typeof record.name === 'string' &&
      typeof record.version === 'string' &&
      record.name === card.name &&
      record.version === card.version
    )
  })
}

/**
 * @param {string[]} reasons
 * @returns {string[]}
 */
function unique(reasons) {
  return [...new Set(reasons)]
}
