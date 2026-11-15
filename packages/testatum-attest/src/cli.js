#!/usr/bin/env node
/**
 * testatum-attest CLI.
 *
 * This file owns argument parsing, file IO and exit codes. Trust decisions are
 * delegated to `./core.js` and `./provenance.js`. The secret is read from
 * `TESTATUM_KEY` only and is never printed, logged or written into an artifact.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import {
  attachSignature,
  revokeCard,
  signCard,
  verifyCard,
  verifyCardIntegrity,
} from './core.js'
import { VERIFICATION_BOUNDARY, verifyPackage } from './provenance.js'
import { SigstoreUnavailableError, verifyBundle } from './sigstore.js'

const VERSION = '0.2.3'

const USAGE = `testatum-attest ${VERSION} - HMAC-signed trust cards for plugin artifacts

Usage:
  testatum-attest sign <card.json> --out <signed.json> [--key-id <id>]
  testatum-attest verify <signed.json> [--revocations <list.json>] [--json]
  testatum-attest revoke <signed.json> --reason <text> [--out <record.json>] [--revoked-at <iso>]
  testatum-attest verify-provenance <name>@<version> [--repo <owner/repo>] [--commit <sha>] [--json]
  testatum-attest verify-sigstore <bundle.json> --identity <uri> --issuer <issuer> [--json]

Commands:
  sign    Add an HMAC-SHA256 signature; refuses a card whose hash manifest is invalid.
  verify  Recompute the root hash, verify the signature, and optionally check revocations.
  revoke  Emit a revocation record (stdout unless --out is given).
  verify-provenance  Check the npm provenance attestation for a published package.
  verify-sigstore    Verify a Sigstore bundle with a pinned Fulcio identity/issuer.

Options:
  -h, --help             Show this help.
  -V, --version          Show version.
      --json             Machine-readable output where applicable.
      --out <file>       Output file (required for sign; optional for revoke).
      --reason <text>    Why the card is revoked (required for revoke).
      --revocations <file>  JSON array or { "revocations": [...] } for verify.
      --key-id <id>      Optional key id recorded in the signature (sign only).
      --revoked-at <iso> Override the revocation timestamp (revoke only).
      --repo <owner/repo>    Expected source repository (verify-provenance only).
      --commit <sha>         Expected source commit (verify-provenance only).
      --tarball-sha512 <v>   Expected tarball SHA-512, hex/base64/SRI (verify-provenance only).
      --registry <url>       npm registry base URL (default https://registry.npmjs.org).
      --identity <uri>       Expected Fulcio SAN as a regex (verify-sigstore only).
      --issuer <issuer>      Expected Fulcio issuer, exact match (verify-sigstore only).

Environment:
  TESTATUM_KEY       Shared HMAC secret. Required for sign and verify; never printed.
  TESTATUM_KEY_ID    Optional default key id. Not a secret.

Security:
  HMAC is an MVP shared-secret placeholder, not sigstore or npm provenance.
  Use a high-entropy key, keep it out of shell history, and read DESIGN.md.
  verify-provenance matches attestation metadata only (existence, predicate
  type, subject digest, repository/commit). It does NOT verify the sigstore
  bundle; use sigstore or 'npm audit signatures' for that.
  verify-sigstore performs real Sigstore verification but needs the optional
  'sigstore' package (npm i sigstore) plus a pinned Fulcio identity/issuer.
  HMAC remains the default; the two answer different trust questions.
`

/**
 * @param {string} message
 * @param {number} exitCode
 * @returns {never}
 */
function fail(message, exitCode = 2) {
  const error = new Error(message)
  error.exitCode = exitCode
  throw error
}

/**
 * @param {string} file
 * @param {string} label
 * @returns {Promise<unknown>}
 */
async function readJson(file, label) {
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    fail(`cannot read ${label} ${file}: ${error.code ?? error.message}`)
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    fail(`${label} ${file} is not valid JSON: ${error.message}`)
  }
}

/**
 * @param {string} file
 * @param {unknown} value
 * @returns {Promise<void>}
 */
async function writeJson(file, value) {
  try {
    await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  } catch (error) {
    fail(`cannot write ${file}: ${error.code ?? error.message}`)
  }
}

/**
 * Read the shared secret. The value never appears in output or error text.
 *
 * @returns {string}
 */
function readKey() {
  const key = process.env.TESTATUM_KEY
  if (typeof key !== 'string' || key.trim().length === 0) {
    fail(
      'TESTATUM_KEY is not set; export a high-entropy shared secret ' +
        '(the value is never printed)',
    )
  }
  return key
}

/**
 * @param {Record<string, unknown>} values
 * @returns {string | undefined}
 */
function optionalKeyId(values) {
  const raw = values['key-id'] ?? process.env.TESTATUM_KEY_ID
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : undefined
}

/**
 * @param {string[]} positionals
 * @param {string} command
 * @returns {string}
 */
function requireFile(positionals, command) {
  if (positionals.length === 0) fail(`${command} requires a file argument`)
  if (positionals.length > 1) fail(`${command}: unexpected argument ${positionals[1]}`)
  return positionals[0]
}

/**
 * @param {unknown} card
 * @returns {{ name: string | null, version: string | null, rootHash: string | null }}
 */
function cardSummary(card) {
  const record = card !== null && typeof card === 'object' ? card : {}
  return {
    name: typeof record.name === 'string' ? record.name : null,
    version: typeof record.version === 'string' ? record.version : null,
    rootHash: typeof record.rootHash === 'string' ? record.rootHash : null,
  }
}

/**
 * @param {Record<string, unknown>} values
 * @param {Record<string, unknown>} payload
 * @param {string} human
 */
function emit(values, payload, human) {
  if (values.json) {
    console.log(JSON.stringify(payload, null, 2))
  } else {
    console.log(human)
  }
}

/**
 * @param {Record<string, unknown>} values
 * @param {string[]} positionals
 * @returns {Promise<void>}
 */
async function runSign(values, positionals) {
  const file = requireFile(positionals, 'sign')
  if (typeof values.out !== 'string' || values.out.trim().length === 0) {
    fail('sign requires --out <signed.json>')
  }
  const secret = readKey()
  const card = await readJson(file, 'card')
  const integrity = verifyCardIntegrity(card)
  if (!integrity.ok) {
    fail(`refusing to sign an invalid card: ${integrity.reasons.join(', ')}`, 1)
  }

  const keyId = optionalKeyId(values)
  const signature = signCard(card, keyId === undefined ? secret : { secret, keyId })
  const signed = attachSignature(card, signature)
  await writeJson(/** @type {string} */ (values.out), signed)

  const summary = {
    command: 'sign',
    ok: true,
    out: values.out,
    ...cardSummary(signed),
    alg: signature.alg,
    keyId: signature.keyId ?? null,
  }
  emit(
    values,
    summary,
    `signed ${summary.name}@${summary.version} -> ${values.out} (${signature.alg}${
      signature.keyId === undefined ? '' : `, keyId=${signature.keyId}`
    })`,
  )
}

/**
 * @param {Record<string, unknown>} values
 * @param {string[]} positionals
 * @returns {Promise<void>}
 */
async function runVerify(values, positionals) {
  const file = requireFile(positionals, 'verify')
  const secret = readKey()
  const card = await readJson(file, 'signed card')

  let revocations
  if (typeof values.revocations === 'string' && values.revocations.length > 0) {
    revocations = await readJson(values.revocations, 'revocation list')
  }

  const result = verifyCard(card, { secret, revocations })
  const summary = {
    command: 'verify',
    ok: result.ok,
    reasons: result.reasons,
    ...cardSummary(card),
  }

  if (values.json) {
    console.log(JSON.stringify(summary, null, 2))
  } else if (result.ok) {
    console.log(`OK ${summary.name}@${summary.version} rootHash=${summary.rootHash}`)
  } else {
    console.log(`FAIL ${file}: ${result.reasons.join(', ')}`)
  }
  if (!result.ok) process.exitCode = 1
}

/**
 * @param {Record<string, unknown>} values
 * @param {string[]} positionals
 * @returns {Promise<void>}
 */
async function runRevoke(values, positionals) {
  const file = requireFile(positionals, 'revoke')
  if (typeof values.reason !== 'string' || values.reason.trim().length === 0) {
    fail('revoke requires --reason <text>')
  }
  const card = await readJson(file, 'signed card')

  const secret = process.env.TESTATUM_KEY
  if (typeof secret === 'string' && secret.trim().length > 0) {
    const check = verifyCard(card, secret)
    if (!check.ok) {
      fail(`refusing to revoke a card that does not verify: ${check.reasons.join(', ')}`, 1)
    }
  } else {
    const check = verifyCardIntegrity(card)
    if (!check.ok) {
      fail(`refusing to revoke an invalid card: ${check.reasons.join(', ')}`, 1)
    }
    console.error(
      'warning: TESTATUM_KEY is not set; the revocation record itself is unauthenticated',
    )
  }

  const record = revokeCard(card, {
    reason: /** @type {string} */ (values.reason),
    revokedAt: /** @type {string | undefined} */ (values['revoked-at']),
  })

  if (typeof values.out === 'string' && values.out.length > 0) {
    await writeJson(values.out, record)
    const summary = {
      command: 'revoke',
      ok: true,
      out: values.out,
      ...cardSummary(card),
      reason: record.reason,
      revokedAt: record.revokedAt,
      revocation: record,
    }
    emit(
      values,
      summary,
      `revoked ${summary.name}@${summary.version} -> ${values.out}`,
    )
  } else if (values.json) {
    console.log(JSON.stringify({ command: 'revoke', ok: true, revocation: record }, null, 2))
  } else {
    console.log(JSON.stringify(record, null, 2))
  }
}

/**
 * Split `name@version`, keeping a scope's leading `@` intact.
 *
 * @param {string} spec
 * @returns {{ name: string, version: string }}
 */
function parsePackageSpec(spec) {
  const at = spec.lastIndexOf('@')
  if (at <= 0) fail(`expected <name>@<version>, got ${spec}`)
  const name = spec.slice(0, at)
  const version = spec.slice(at + 1)
  if (name.trim().length === 0 || version.trim().length === 0) {
    fail(`expected <name>@<version> with a non-empty name and version, got ${spec}`)
  }
  return { name, version }
}

/**
 * Structural npm provenance check. Registry/network failures exit 2; a
 * negative provenance verdict exits 1.
 *
 * @param {Record<string, unknown>} values
 * @param {string[]} positionals
 * @returns {Promise<void>}
 */
async function runVerifyProvenance(values, positionals) {
  if (positionals.length === 0) {
    fail('verify-provenance requires a <name>@<version> argument')
  }
  if (positionals.length > 1) {
    fail(`verify-provenance: unexpected argument ${positionals[1]}`)
  }
  const { name, version } = parsePackageSpec(positionals[0])

  /** @type {{ registry?: string, repo?: string, commit?: string, tarballSha512?: string }} */
  const options = {}
  if (typeof values.registry === 'string') options.registry = values.registry
  if (typeof values.repo === 'string') options.repo = values.repo
  if (typeof values.commit === 'string') options.commit = values.commit
  if (typeof values['tarball-sha512'] === 'string') {
    options.tarballSha512 = values['tarball-sha512']
  }

  /** @type {Awaited<ReturnType<typeof verifyPackage>>} */
  let result
  try {
    result = await verifyPackage(name, version, options)
  } catch (error) {
    fail(`provenance check failed: ${error.message}`, 2)
  }

  const summary = {
    command: 'verify-provenance',
    ok: result.ok,
    name,
    version,
    reasons: result.reasons,
    warnings: result.warnings,
    cryptoVerified: false,
    boundary: VERIFICATION_BOUNDARY,
    url: result.attestation.url ?? null,
    predicateType: result.attestation.predicateType ?? null,
    subject: result.attestation.subject,
    tarballSha512: result.attestation.tarballSha512 ?? null,
    repo: options.repo ?? null,
    commit: options.commit ?? null,
  }

  for (const warning of result.warnings) {
    console.error(`warning: ${warning}`)
  }

  if (values.json) {
    console.log(JSON.stringify(summary, null, 2))
  } else if (result.ok) {
    console.log(
      `OK provenance ${name}@${version} (${summary.predicateType}; ` +
        'metadata match only, sigstore NOT verified)',
    )
  } else {
    console.log(`FAIL provenance ${name}@${version}: ${result.reasons.join(', ')}`)
  }
  if (!result.ok) process.exitCode = 1
}

/**
 * Verify one Sigstore bundle with a pinned Fulcio identity and issuer.
 *
 * Exit codes: 0 verified; 1 verification rejected (identity/signature/
 * certificate/tlog/bundle); 2 usage, invalid input, missing `sigstore`, or an
 * infrastructure failure (TUF/network) that makes the verdict inconclusive.
 *
 * @param {Record<string, unknown>} values
 * @param {string[]} positionals
 * @returns {Promise<void>}
 */
async function runVerifySigstore(values, positionals) {
  const file = requireFile(positionals, 'verify-sigstore')
  if (typeof values.identity !== 'string' || values.identity.trim().length === 0) {
    fail('verify-sigstore requires --identity <uri>')
  }
  if (typeof values.issuer !== 'string' || values.issuer.trim().length === 0) {
    fail('verify-sigstore requires --issuer <issuer>')
  }
  const identity = /** @type {string} */ (values.identity)
  const issuer = /** @type {string} */ (values.issuer)
  const bundle = await readJson(file, 'sigstore bundle')

  /** @type {Awaited<ReturnType<typeof verifyBundle>>} */
  let verdict
  try {
    verdict = await verifyBundle(bundle, {
      certificateIdentityURI: identity,
      certificateIssuer: issuer,
    })
  } catch (error) {
    const unavailable =
      error instanceof SigstoreUnavailableError ||
      (error !== null &&
        typeof error === 'object' &&
        error.code === 'SIGSTORE_NOT_INSTALLED')
    if (unavailable) {
      fail(
        'sigstore is not installed; run `npm i sigstore` to enable verify-sigstore',
        2,
      )
    }
    fail(
      `sigstore verification could not run: ${
        error instanceof Error ? error.message : String(error)
      }`,
      2,
    )
  }

  for (const warning of verdict.warnings) {
    console.error(`warning: ${warning}`)
  }

  /** @type {{ command: string, ok: boolean, identity: string, issuer: string, reasons?: string[], error?: unknown }} */
  const summary = {
    command: 'verify-sigstore',
    ok: verdict.ok,
    identity,
    issuer,
  }
  if (!verdict.ok) {
    summary.reasons = verdict.reasons
    if (verdict.error !== undefined) summary.error = verdict.error
  }

  if (values.json) {
    console.log(JSON.stringify(summary, null, 2))
  } else if (verdict.ok) {
    console.log(`OK sigstore ${file} identity=${identity} issuer=${issuer}`)
  } else {
    console.log(`FAIL sigstore ${file}: ${verdict.reasons.join(', ')}`)
    if (verdict.error !== undefined) {
      console.error(`reason: ${verdict.error.message}`)
    }
  }

  if (!verdict.ok) {
    if (verdict.fatal) {
      console.error(
        'testatum-attest: infrastructure error (TUF/network); ' +
          'the verification verdict is inconclusive, exiting 2',
      )
      process.exitCode = 2
    } else {
      process.exitCode = 1
    }
  }
}

/**
 * @param {string[]} argv
 * @returns {Promise<void>}
 */
async function main(argv) {
  /** @type {{ values: Record<string, unknown>, positionals: string[] }} */
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'V' },
        json: { type: 'boolean' },
        out: { type: 'string' },
        reason: { type: 'string' },
        revocations: { type: 'string' },
        'key-id': { type: 'string' },
        'revoked-at': { type: 'string' },
        repo: { type: 'string' },
        commit: { type: 'string' },
        'tarball-sha512': { type: 'string' },
        registry: { type: 'string' },
        identity: { type: 'string' },
        issuer: { type: 'string' },
      },
    })
  } catch (error) {
    console.error(USAGE)
    fail(`invalid arguments: ${error.message}`)
  }

  const values = parsed.values
  if (values.help) {
    console.log(USAGE)
    return
  }
  if (values.version) {
    console.log(`testatum-attest ${VERSION}`)
    return
  }

  const [command, ...args] = parsed.positionals
  if (command === undefined) {
    console.error(USAGE)
    process.exitCode = 2
    return
  }

  switch (command) {
    case 'help':
      console.log(USAGE)
      return
    case 'sign':
      await runSign(values, args)
      return
    case 'verify':
      await runVerify(values, args)
      return
    case 'revoke':
      await runRevoke(values, args)
      return
    case 'verify-provenance':
      await runVerifyProvenance(values, args)
      return
    case 'verify-sigstore':
      await runVerifySigstore(values, args)
      return
    default:
      fail(`unknown command ${command}; try --help`)
  }
}

try {
  await main(process.argv.slice(2))
} catch (error) {
  console.error(`testatum-attest: ${error.message}`)
  process.exitCode = typeof error.exitCode === 'number' ? error.exitCode : 2
}
