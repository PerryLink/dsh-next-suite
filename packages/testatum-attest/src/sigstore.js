/**
 * Optional Sigstore verification for npm provenance bundles.
 *
 * Scope boundary (read this before trusting a result):
 *
 *   This module verifies the **Sigstore bundle** cryptographically: the DSSE
 *   (or message) signature, the Fulcio certificate chain and SCTs, the Rekor
 *   transparency-log entry/inclusion proof, and any timestamps present in the
 *   bundle. It does **not** bind the signed in-toto subject to a tarball,
 *   repository or commit; use `verifyProvenance` from `./provenance.js` for
 *   that. It also does not fetch the npm registry: the caller supplies the
 *   attestation document or the bundle.
 *
 *   `sigstore` is an **optional** dependency. This module imports it lazily and
 *   only when verification is actually requested, so the default HMAC path
 *   keeps working with zero runtime dependencies.
 *
 *   `verifyImpl` can replace `sigstore.verify` for offline tests (or for
 *   callers that already own a verifier). Injection skips the dynamic import
 *   but keeps the same fail-closed identity policy.
 *
 *   `sigstore.verify` always resolves the Sigstore trusted root through TUF.
 *   That is the network-dependent part: with a warm, unexpired TUF cache and
 *   `tufForceCache: true` verification can run offline (the bundle itself
 *   contains the certificate, SCT and Rekor inclusion material). Rekor and
 *   Fulcio are **not** contacted during verification.
 *
 * @typedef {object} SigstoreIdentity
 * @property {string | null} subjectAlternativeName
 * @property {string | null} issuer
 *
 * @typedef {(bundle: unknown, payloadOrOptions?: unknown, options?: unknown) => Promise<unknown>} SigstoreVerifyImpl
 *
 * @typedef {object} SigstoreVerdict
 * @property {boolean} ok
 * @property {string[]} reasons Stable machine-readable reason codes.
 * @property {string[]} warnings Non-fatal caveats (`artifact-binding-not-checked`, ...).
 * @property {boolean} fatal True when the failure is infrastructural (TUF/module), not a verdict.
 * @property {SigstoreIdentity | null} identity Verified Fulcio identity, when available.
 * @property {string | null} predicateType in-toto predicate type of the selected entry.
 * @property {number | null} tlogEntries Number of transparency-log entries in the bundle.
 * @property {{ tlogThreshold: number, ctLogThreshold: number }} thresholds
 * @property {string} boundary One-line statement of what was/was not verified.
 * @property {{ name: string, code: string | null, message: string }} [error]
 */

import { isPlainObject } from './core.js'

/** npm package that provides the verifier. Optional, loaded lazily. */
export const SIGSTORE_PACKAGE = 'sigstore'

/**
 * One-line statement of what this module does not do. Exported so callers can
 * surface the same wording in their own UIs.
 */
export const SIGSTORE_VERIFICATION_BOUNDARY =
  'Cryptographic bundle verification only: DSSE/message signature, Fulcio ' +
  'certificate chain + SCT, Rekor tlog inclusion, and timestamps are checked. ' +
  'The npm subject digest/repository/commit are NOT bound, and the registry is ' +
  'NOT contacted; combine with verifyProvenance for artifact binding.'

/** Default minimum number of transparency-log entries. */
export const DEFAULT_TLOG_THRESHOLD = 1

/** Default minimum number of certificate-transparency log entries. */
export const DEFAULT_CT_LOG_THRESHOLD = 1

const BUNDLE_MEDIA_TYPE =
  /^application\/vnd\.dev\.sigstore\.bundle(?:\+json;version=\d+\.\d+|\.v\d+\.\d+\+json)$/
const PROVENANCE_TYPE = /slsa|provenance/i

/**
 * Raised when the optional `sigstore` package cannot be loaded. This is a
 * configuration error (exit 2 in a CLI), not a verification verdict (exit 1).
 */
export class SigstoreUnavailableError extends Error {
  /**
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(message, options)
    this.name = 'SigstoreUnavailableError'
    this.code = 'SIGSTORE_NOT_INSTALLED'
  }
}

/**
 * Load the optional `sigstore` package. Tests inject `importer`; production
 * callers should omit it and let the dynamic import resolve `sigstore`.
 *
 * @param {{ importer?: () => Promise<{ verify?: Function }> }} [options]
 * @returns {Promise<{ verify: Function }>}
 */
export async function loadSigstore(options = {}) {
  const opts = options ?? {}
  const importer = typeof opts.importer === 'function' ? opts.importer : () => import('sigstore')

  /** @type {unknown} */
  let module
  try {
    module = await importer()
  } catch (error) {
    if (isModuleNotFound(error)) throw unavailableError(error)
    throw error
  }
  if (module === null || typeof module !== 'object' || typeof module.verify !== 'function') {
    throw new SigstoreUnavailableError(
      'the installed sigstore package does not export verify(); install sigstore@5.x',
    )
  }
  return /** @type {{ verify: Function }} */ (module)
}

/**
 * Pick the SLSA/provenance bundle from an npm attestation document.
 *
 * Accepts the npm attestation response (`{ attestations: [...] }`), an array of
 * entries, a single `{ predicateType, bundle }` entry, or a bare bundle.
 * Entries without a `bundle` are ignored. When `predicateType` is supplied it
 * wins over the first SLSA/provenance entry.
 *
 * @param {unknown} document
 * @param {{ predicateType?: string }} [options]
 * @returns {{ bundle: Record<string, unknown>, predicateType: string | null, entry: Record<string, unknown> | null } | null}
 */
export function selectProvenanceBundle(document, options = {}) {
  const opts = options ?? {}
  const preferred =
    typeof opts.predicateType === 'string' && opts.predicateType.trim() !== ''
      ? opts.predicateType
      : null
  const entries = attestationEntries(document)

  if (entries.length === 0) {
    if (isBundleLike(document)) {
      return { bundle: document, predicateType: preferred, entry: null }
    }
    return null
  }

  const withBundle = entries.filter((entry) => isPlainObject(entry.bundle))
  const selected =
    (preferred === null
      ? undefined
      : withBundle.find((entry) => entry.predicateType === preferred)) ??
    withBundle.find((entry) => isProvenanceType(entry.predicateType)) ??
    null
  if (selected === null) return null

  return {
    bundle: selected.bundle,
    predicateType:
      typeof selected.predicateType === 'string' ? selected.predicateType : null,
    entry: selected,
  }
}

/**
 * Verify one Sigstore bundle.
 *
 * Identity is required by default: `certificateIdentityURI` (recommended for
 * CI/npm provenance) or `certificateIdentityEmail`, **and** `certificateIssuer`.
 * Both identity values are matched by `sigstore` as JavaScript regular
 * expressions, not globs. Pass `allowUnpinnedIdentity: true` only when the
 * identity check is performed elsewhere.
 *
 * `payload` is only needed for `messageSignature` bundles (a `Buffer`); DSSE
 * bundles, including npm provenance attestations, carry their payload.
 *
 * @param {unknown} bundle
 * @param {{
 *   certificateIdentityURI?: string,
 *   certificateIdentityEmail?: string,
 *   certificateIssuer?: string,
 *   tlogThreshold?: number,
 *   ctLogThreshold?: number,
 *   tufCachePath?: string,
 *   tufRootPath?: string,
 *   tufMirrorURL?: string,
 *   tufForceCache?: boolean,
 *   retry?: unknown,
 *   timeout?: number,
 *   payload?: Buffer,
 *   allowUnpinnedIdentity?: boolean,
 *   predicateType?: string,
 *   importer?: () => Promise<{ verify?: Function }>,
 *   verifyImpl?: SigstoreVerifyImpl
 * }} [options]
 * @returns {Promise<SigstoreVerdict>}
 */
export async function verifyBundle(bundle, options = {}) {
  const opts = options ?? {}
  const warnings = []
  const problem = bundleProblem(bundle)
  if (problem !== null) {
    return failure([problem], { options: opts, warnings })
  }

  const policy = buildPolicy(opts, warnings)
  if (policy.reason !== null) {
    return failure([policy.reason], { options: opts, warnings })
  }

  const verifyImpl = opts.verifyImpl
  if (verifyImpl !== undefined && typeof verifyImpl !== 'function') {
    throw new TypeError('verifyBundle: verifyImpl must be a function')
  }

  /** @type {Buffer | undefined} */
  let payload
  if (opts.payload !== undefined) {
    if (!Buffer.isBuffer(opts.payload)) {
      throw new TypeError('verifyBundle: payload must be a Buffer')
    }
    payload = opts.payload
  }
  if (isPlainObject(bundle.messageSignature) && payload === undefined) {
    return failure(['payload-required'], { options: opts, warnings })
  }

  // Injection bypasses the optional import entirely, so offline tests never
  // touch TUF or the network and `sigstore` need not be installed.
  const module = verifyImpl === undefined ? await loadSigstore(opts) : null
  const args = payload === undefined ? [bundle, policy.verifyOptions] : [bundle, payload, policy.verifyOptions]

  try {
    let signer
    if (verifyImpl === undefined) {
      signer = await /** @type {{ verify: Function }} */ (module).verify(...args)
    } else {
      signer = await verifyImpl(...args)
    }
    return success(signer, bundle, opts, warnings)
  } catch (error) {
    const reason = mapError(error)
    return failure([reason], {
      options: opts,
      warnings,
      fatal: reason === 'tuf-error' || reason === 'sigstore-error',
      error,
    })
  }
}

/**
 * Verify the provenance bundle in an npm attestation document, then remind the
 * caller that artifact binding is still required.
 *
 * This is a convenience wrapper around `selectProvenanceBundle` +
 * `verifyBundle`; it does not fetch anything and does not check the subject
 * SHA-512, repository or commit.
 *
 * @param {unknown} document
 * @param {Parameters<typeof verifyBundle>[1]} [options]
 * @returns {Promise<SigstoreVerdict>}
 */
export async function verifyNpmAttestation(document, options = {}) {
  const opts = options ?? {}
  const selected = selectProvenanceBundle(document, opts)
  if (selected === null) {
    return failure(['no-provenance-bundle'], { options: opts, warnings: [] })
  }

  const verdict = await verifyBundle(selected.bundle, {
    ...opts,
    predicateType: selected.predicateType ?? opts.predicateType,
  })
  return {
    ...verdict,
    predicateType: selected.predicateType ?? verdict.predicateType,
    warnings: unique([...verdict.warnings, 'artifact-binding-not-checked']),
  }
}

/**
 * @param {unknown} bundle
 * @returns {string | null}
 */
function bundleProblem(bundle) {
  if (!isPlainObject(bundle)) return 'bundle-invalid'
  if (typeof bundle.mediaType !== 'string' || !BUNDLE_MEDIA_TYPE.test(bundle.mediaType)) {
    return 'bundle-media-type-unsupported'
  }
  if (!isPlainObject(bundle.verificationMaterial)) {
    return 'bundle-verification-material-missing'
  }

  if (isPlainObject(bundle.dsseEnvelope)) {
    if (
      typeof bundle.dsseEnvelope.payload !== 'string' ||
      bundle.dsseEnvelope.payload === ''
    ) {
      return 'bundle-payload-missing'
    }
    if (
      !Array.isArray(bundle.dsseEnvelope.signatures) ||
      bundle.dsseEnvelope.signatures.length !== 1 ||
      !isPlainObject(bundle.dsseEnvelope.signatures[0]) ||
      typeof bundle.dsseEnvelope.signatures[0].sig !== 'string' ||
      bundle.dsseEnvelope.signatures[0].sig === ''
    ) {
      return 'bundle-signature-missing'
    }
    return null
  }

  if (isPlainObject(bundle.messageSignature)) {
    if (
      typeof bundle.messageSignature.signature !== 'string' ||
      bundle.messageSignature.signature === ''
    ) {
      return 'bundle-signature-missing'
    }
    return null
  }

  return 'bundle-content-missing'
}

/**
 * @param {Record<string, unknown>} options
 * @param {string[]} warnings
 * @returns {{ reason: string | null, verifyOptions: Record<string, unknown> }}
 */
function buildPolicy(options, warnings) {
  const email = optionalText(options.certificateIdentityEmail, 'certificateIdentityEmail')
  const uri = optionalText(options.certificateIdentityURI, 'certificateIdentityURI')
  const issuer = optionalText(options.certificateIssuer, 'certificateIssuer')
  const unpinned = options.allowUnpinnedIdentity === true

  if (email !== undefined && uri !== undefined) {
    warnings.push('identity-email-takes-precedence')
  }
  if (email === undefined && uri === undefined && !unpinned) {
    return { reason: 'identity-required', verifyOptions: {} }
  }
  if ((email !== undefined || uri !== undefined) && issuer === undefined) {
    return { reason: 'issuer-required', verifyOptions: {} }
  }
  if (email === undefined && uri === undefined) {
    warnings.push('identity-not-pinned')
  }

  /** @type {Record<string, unknown>} */
  const verifyOptions = {}
  if (email !== undefined) verifyOptions.certificateIdentityEmail = email
  if (uri !== undefined) verifyOptions.certificateIdentityURI = uri
  if (issuer !== undefined) verifyOptions.certificateIssuer = issuer

  const tlogThreshold = threshold(options.tlogThreshold, 'tlogThreshold')
  const ctLogThreshold = threshold(options.ctLogThreshold, 'ctLogThreshold')
  if (tlogThreshold !== undefined) verifyOptions.tlogThreshold = tlogThreshold
  if (ctLogThreshold !== undefined) verifyOptions.ctLogThreshold = ctLogThreshold
  if (tlogThreshold === 0 || ctLogThreshold === 0) {
    warnings.push('threshold-zero-disables-check')
  }

  for (const key of ['tufCachePath', 'tufRootPath', 'tufMirrorURL']) {
    const value = options[key]
    if (value !== undefined) {
      if (typeof value !== 'string' || value.trim() === '') {
        throw new TypeError(`verifyBundle: ${key} must be a non-empty string`)
      }
      verifyOptions[key] = value
    }
  }
  if (options.tufForceCache !== undefined) {
    verifyOptions.tufForceCache = options.tufForceCache === true
  }
  if (options.retry !== undefined) verifyOptions.retry = options.retry
  if (options.timeout !== undefined) {
    if (!Number.isFinite(options.timeout) || options.timeout <= 0) {
      throw new TypeError('verifyBundle: timeout must be a positive number')
    }
    verifyOptions.timeout = options.timeout
  }

  return { reason: null, verifyOptions }
}

/**
 * @param {unknown} value
 * @param {string} name
 * @returns {number | undefined}
 */
function threshold(value, name) {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`verifyBundle: ${name} must be a non-negative integer`)
  }
  return value
}

/**
 * @param {unknown} value
 * @param {string} name
 * @returns {string | undefined}
 */
function optionalText(value, name) {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`verifyBundle: ${name} must be a non-empty string`)
  }
  return value
}

/**
 * @param {unknown} signer
 * @param {Record<string, unknown>} bundle
 * @param {Record<string, unknown>} options
 * @param {string[]} warnings
 * @returns {SigstoreVerdict}
 */
function success(signer, bundle, options, warnings) {
  const signerRecord = signer !== null && typeof signer === 'object' ? signer : null
  const identity =
    signerRecord !== null &&
    signerRecord.identity !== null &&
    typeof signerRecord.identity === 'object'
      ? signerRecord.identity
      : null
  const extensions =
    identity !== null && isPlainObject(identity.extensions) ? identity.extensions : {}
  return {
    ok: true,
    reasons: [],
    warnings: unique(warnings),
    fatal: false,
    identity:
      identity === null
        ? null
        : {
            subjectAlternativeName:
              typeof identity.subjectAlternativeName === 'string'
                ? identity.subjectAlternativeName
                : null,
            issuer: typeof extensions.issuer === 'string' ? extensions.issuer : null,
          },
    predicateType:
      typeof options.predicateType === 'string' ? options.predicateType : null,
    tlogEntries: Array.isArray(bundle.verificationMaterial?.tlogEntries)
      ? bundle.verificationMaterial.tlogEntries.length
      : 0,
    thresholds: thresholdsOf(options),
    boundary: SIGSTORE_VERIFICATION_BOUNDARY,
  }
}

/**
 * @param {string[]} reasons
 * @param {{ options?: Record<string, unknown>, warnings?: string[], fatal?: boolean, error?: unknown }} [details]
 * @returns {SigstoreVerdict}
 */
function failure(reasons, details = {}) {
  const options = details.options ?? {}
  /** @type {SigstoreVerdict} */
  const verdict = {
    ok: false,
    reasons: unique(reasons),
    warnings: unique(details.warnings ?? []),
    fatal: details.fatal === true,
    identity: null,
    predicateType: typeof options.predicateType === 'string' ? options.predicateType : null,
    tlogEntries: null,
    thresholds: thresholdsOf(options),
    boundary: SIGSTORE_VERIFICATION_BOUNDARY,
  }
  if (details.error !== undefined) verdict.error = errorInfo(details.error)
  return verdict
}

/**
 * @param {Record<string, unknown>} options
 * @returns {{ tlogThreshold: number, ctLogThreshold: number }}
 */
function thresholdsOf(options) {
  return {
    tlogThreshold:
      Number.isInteger(options.tlogThreshold) && options.tlogThreshold >= 0
        ? options.tlogThreshold
        : DEFAULT_TLOG_THRESHOLD,
    ctLogThreshold:
      Number.isInteger(options.ctLogThreshold) && options.ctLogThreshold >= 0
        ? options.ctLogThreshold
        : DEFAULT_CT_LOG_THRESHOLD,
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function mapError(error) {
  const name = error instanceof Error ? error.name : ''
  const code =
    error !== null && typeof error === 'object' && typeof error.code === 'string'
      ? error.code
      : ''
  if (name === 'PolicyError' || code === 'UNTRUSTED_SIGNER_ERROR') return 'identity-mismatch'
  if (name === 'TUFError' || code.startsWith('TUF_')) return 'tuf-error'
  if (code === 'SIGNATURE_ERROR') return 'signature-invalid'
  if (code === 'TLOG_ERROR' || code.startsWith('TLOG_')) return 'tlog-invalid'
  if (code === 'CERTIFICATE_ERROR') return 'certificate-invalid'
  if (code === 'TIMESTAMP_ERROR') return 'timestamp-invalid'
  if (name === 'ValidationError') return 'bundle-invalid'
  return 'sigstore-error'
}

/**
 * @param {unknown} error
 * @returns {{ name: string, code: string | null, message: string }}
 */
function errorInfo(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      code: typeof error.code === 'string' ? error.code : null,
      message: error.message,
    }
  }
  return { name: 'Error', code: null, message: String(error) }
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isModuleNotFound(error) {
  if (error === null || typeof error !== 'object') return false
  if (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND') return true
  return /Cannot find (?:package|module) ['"]?sigstore/.test(String(error.message))
}

/**
 * @param {unknown} cause
 * @returns {SigstoreUnavailableError}
 */
function unavailableError(cause) {
  return new SigstoreUnavailableError(
    'the optional sigstore package is not installed; run `npm i sigstore` ' +
      '(or `npm install --save-dev sigstore@5.0.1`; Node ^22.22.2 || ^24.15.0 || >=26) ' +
      'or use the default HMAC-only verification',
    { cause },
  )
}

/**
 * @param {unknown} document
 * @returns {Record<string, unknown>[]}
 */
function attestationEntries(document) {
  if (Array.isArray(document)) return document.filter(isPlainObject)
  if (isPlainObject(document) && Array.isArray(document.attestations)) {
    return document.attestations.filter(isPlainObject)
  }
  if (isPlainObject(document) && isPlainObject(document.bundle)) return [document]
  return []
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isBundleLike(value) {
  return (
    isPlainObject(value) &&
    typeof value.mediaType === 'string' &&
    isPlainObject(value.verificationMaterial) &&
    (isPlainObject(value.dsseEnvelope) || isPlainObject(value.messageSignature))
  )
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isProvenanceType(value) {
  return typeof value === 'string' && PROVENANCE_TYPE.test(value)
}

/**
 * @template T
 * @param {T[]} values
 * @returns {T[]}
 */
function unique(values) {
  return [...new Set(values)]
}
