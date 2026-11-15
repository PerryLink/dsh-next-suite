#!/usr/bin/env node
// @benchmark-real-fixture
// Source: dsh-next-suite/packages/testatum-attest/src/cli.js lines 1-128
// License: Apache-2.0; see benchmarks/capdiff/fixtures/real/SOURCES.md
// Trimmed at a complete top-level statement boundary; code otherwise unchanged.

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

const VERSION = '0.1.3'

const USAGE = `testatum-attest ${VERSION} - HMAC-signed trust cards for plugin artifacts

Usage:
  testatum-attest sign <card.json> --out <signed.json> [--key-id <id>]
  testatum-attest verify <signed.json> [--revocations <list.json>] [--json]
  testatum-attest revoke <signed.json> --reason <text> [--out <record.json>] [--revoked-at <iso>]
  testatum-attest verify-provenance <name>@<version> [--repo <owner/repo>] [--commit <sha>] [--json]

Commands:
  sign    Add an HMAC-SHA256 signature; refuses a card whose hash manifest is invalid.
  verify  Recompute the root hash, verify the signature, and optionally check revocations.
  revoke  Emit a revocation record (stdout unless --out is given).
  verify-provenance  Check the npm provenance attestation for a published package.

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

Environment:
  TESTATUM_KEY       Shared HMAC secret. Required for sign and verify; never printed.
  TESTATUM_KEY_ID    Optional default key id. Not a secret.

Security:
  HMAC is an MVP shared-secret placeholder, not sigstore or npm provenance.
  Use a high-entropy key, keep it out of shell history, and read DESIGN.md.
  verify-provenance matches attestation metadata only (existence, predicate
  type, subject digest, repository/commit). It does NOT verify the sigstore
  bundle; use sigstore or 'npm audit signatures' for that.
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
