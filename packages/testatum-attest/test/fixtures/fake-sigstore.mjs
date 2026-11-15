/**
 * Offline stand-in for the optional `sigstore` package, used only by the CLI
 * tests together with `sigstore-hook.mjs`. It never touches the network.
 *
 * `FAKE_SIGSTORE_MODE`:
 *   - `ok` (default): resolve a synthetic signer.
 *   - `identity-mismatch`: throw the same shape as a Fulcio SAN/issuer policy
 *     rejection (`PolicyError` / `UNTRUSTED_SIGNER_ERROR`).
 *   - `tuf-error`: throw the same shape as a TUF refresh failure.
 *
 * When `FAKE_SIGSTORE_CAPTURE` names a file, the call arguments are written
 * there so tests can assert which identity/issuer the CLI passed through.
 */
import { writeFileSync } from 'node:fs'

const DEFAULT_SAN =
  'https://github.com/PerryLink/demo-plugin/.github/workflows/release.yml@refs/heads/main'
const DEFAULT_ISSUER = 'https://token.actions.githubusercontent.com'

function codedError(name, code, message) {
  return Object.assign(new Error(message), { name, code })
}

export async function verify(...args) {
  const capture = process.env.FAKE_SIGSTORE_CAPTURE
  if (typeof capture === 'string' && capture.length > 0) {
    writeFileSync(
      capture,
      JSON.stringify({ mode: process.env.FAKE_SIGSTORE_MODE ?? 'ok', args }, null, 2),
      'utf8',
    )
  }

  const mode = process.env.FAKE_SIGSTORE_MODE ?? 'ok'
  if (mode === 'identity-mismatch') {
    throw codedError('PolicyError', 'UNTRUSTED_SIGNER_ERROR', 'certificate identity mismatch')
  }
  if (mode === 'tuf-error') {
    throw codedError('TUFError', 'TUF_REFRESH_METADATA_ERROR', 'error refreshing TUF metadata')
  }

  return {
    identity: {
      subjectAlternativeName: process.env.FAKE_SIGSTORE_SAN ?? DEFAULT_SAN,
      extensions: { issuer: process.env.FAKE_SIGSTORE_ISSUER ?? DEFAULT_ISSUER },
    },
  }
}
