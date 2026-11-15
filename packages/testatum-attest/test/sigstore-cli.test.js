import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url))
const HOOK = fileURLToPath(new URL('./fixtures/sigstore-hook.mjs', import.meta.url))
const IDENTITY =
  'https://github.com/PerryLink/demo-plugin/.github/workflows/release.yml@refs/heads/main'
const ISSUER = 'https://token.actions.githubusercontent.com'

const dir = await mkdtemp(join(tmpdir(), 'testatum-attest-sigstore-cli-'))
after(async () => {
  await rm(dir, { recursive: true, force: true })
})

function bundle(overrides = {}) {
  return {
    mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
    verificationMaterial: {
      certificate: { rawBytes: 'ZmFrZS1jZXJ0' },
      tlogEntries: [{ logIndex: '1' }],
    },
    dsseEnvelope: {
      payloadType: 'application/vnd.in-toto+json',
      payload: Buffer.from('{"subject":[]}').toString('base64'),
      signatures: [{ sig: 'ZmFrZS1zaWc=' }],
    },
    ...overrides,
  }
}

async function writeJson(name, value) {
  const path = join(dir, name)
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return path
}

/**
 * Spawn the real CLI with a clean test environment. `FAKE_SIGSTORE_MODE`
 * selects the offline stand-in behavior (see test/fixtures/sigstore-hook.mjs);
 * `missing` makes the optional import fail as if it were not installed.
 */
function run(args, { mode = 'ok', env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--no-warnings', '--import', HOOK, CLI, ...args],
      {
        cwd: dir,
        env: {
          ...process.env,
          TESTATUM_KEY: '',
          TESTATUM_KEY_ID: '',
          FAKE_SIGSTORE_MODE: mode,
          FAKE_SIGSTORE_CAPTURE: '',
          FAKE_SIGSTORE_SAN: '',
          FAKE_SIGSTORE_ISSUER: '',
          ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      resolve({ code, signal, stdout, stderr })
    })
  })
}

function command(bundlePath, extra = []) {
  return [
    'verify-sigstore',
    bundlePath,
    '--identity',
    IDENTITY,
    '--issuer',
    ISSUER,
    ...extra,
  ]
}

test('CLI verify-sigstore verifies a bundle and emits command/ok/identity/issuer', async () => {
  const bundlePath = await writeJson('bundle-ok.json', bundle())
  const capturePath = join(dir, 'capture-ok.json')

  const json = await run(command(bundlePath, ['--json']), {
    env: { FAKE_SIGSTORE_CAPTURE: capturePath },
  })
  assert.equal(json.code, 0, json.stderr)
  assert.deepEqual(JSON.parse(json.stdout), {
    command: 'verify-sigstore',
    ok: true,
    identity: IDENTITY,
    issuer: ISSUER,
  })

  const capture = JSON.parse(await readFile(capturePath, 'utf8'))
  assert.equal(capture.mode, 'ok')
  assert.equal(capture.args.length, 2)
  assert.equal(capture.args[0].mediaType, bundle().mediaType)
  assert.deepEqual(capture.args[1], {
    certificateIdentityURI: IDENTITY,
    certificateIssuer: ISSUER,
  })

  const human = await run(command(bundlePath), {
    env: { FAKE_SIGSTORE_CAPTURE: capturePath },
  })
  assert.equal(human.code, 0, human.stderr)
  assert.match(human.stdout, /^OK sigstore /)
  assert.match(human.stdout, new RegExp(`identity=${IDENTITY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  assert.match(human.stdout, new RegExp(`issuer=${ISSUER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
})

test('CLI verify-sigstore exits 1 and reports reasons when identity verification fails', async () => {
  const bundlePath = await writeJson('bundle-mismatch.json', bundle())

  const json = await run(command(bundlePath, ['--json']), { mode: 'identity-mismatch' })
  assert.equal(json.code, 1, json.stderr)
  const summary = JSON.parse(json.stdout)
  assert.equal(summary.command, 'verify-sigstore')
  assert.equal(summary.ok, false)
  assert.equal(summary.identity, IDENTITY)
  assert.equal(summary.issuer, ISSUER)
  assert.deepEqual(summary.reasons, ['identity-mismatch'])
  assert.equal(summary.error.name, 'PolicyError')
  assert.equal(summary.error.code, 'UNTRUSTED_SIGNER_ERROR')
  assert.match(summary.error.message, /certificate identity mismatch/)

  const human = await run(command(bundlePath), { mode: 'identity-mismatch' })
  assert.equal(human.code, 1)
  assert.match(human.stdout, /^FAIL sigstore /)
  assert.match(human.stdout, /identity-mismatch/)
  assert.match(human.stderr, /certificate identity mismatch/)
})

test('CLI verify-sigstore exits 2 with an npm i sigstore hint when sigstore is missing', async () => {
  const bundlePath = await writeJson('bundle-missing-dep.json', bundle())
  const result = await run(command(bundlePath, ['--json']), { mode: 'missing' })

  assert.equal(result.code, 2)
  assert.match(result.stderr, /sigstore is not installed/)
  assert.match(result.stderr, /npm i sigstore/)
  assert.equal(result.stdout, '')
})

test('CLI verify-sigstore exits 2 for missing file, identity, issuer, or extra arguments', async () => {
  const bundlePath = await writeJson('bundle-args.json', bundle())

  const noFile = await run(['verify-sigstore'])
  assert.equal(noFile.code, 2)
  assert.match(noFile.stderr, /verify-sigstore requires a file argument/)

  const noIdentity = await run(['verify-sigstore', bundlePath, '--issuer', ISSUER])
  assert.equal(noIdentity.code, 2)
  assert.match(noIdentity.stderr, /verify-sigstore requires --identity <uri>/)

  const noIssuer = await run(['verify-sigstore', bundlePath, '--identity', IDENTITY])
  assert.equal(noIssuer.code, 2)
  assert.match(noIssuer.stderr, /verify-sigstore requires --issuer <issuer>/)

  const emptyIdentity = await run([
    'verify-sigstore',
    bundlePath,
    '--identity',
    '   ',
    '--issuer',
    ISSUER,
  ])
  assert.equal(emptyIdentity.code, 2)
  assert.match(emptyIdentity.stderr, /--identity <uri>/)

  const extra = await run(command(bundlePath, ['extra.json']))
  assert.equal(extra.code, 2)
  assert.match(extra.stderr, /unexpected argument extra\.json/)
})

test('CLI verify-sigstore exits 2 for invalid JSON and unreadable bundles', async () => {
  const badJsonPath = join(dir, 'bundle-broken.json')
  await writeFile(badJsonPath, '{ not json', 'utf8')

  const badJson = await run(command(badJsonPath, ['--json']))
  assert.equal(badJson.code, 2)
  assert.match(badJson.stderr, /sigstore bundle .* is not valid JSON/)

  const missing = await run(command(join(dir, 'does-not-exist.json')))
  assert.equal(missing.code, 2)
  assert.match(missing.stderr, /cannot read sigstore bundle/)
})

test('CLI verify-sigstore rejects malformed bundles without importing sigstore', async () => {
  const badMediaType = await writeJson(
    'bundle-bad-media-type.json',
    bundle({ mediaType: 'application/json' }),
  )
  const invalid = await run(command(badMediaType, ['--json']), { mode: 'missing' })
  assert.equal(invalid.code, 1, invalid.stderr)
  const invalidSummary = JSON.parse(invalid.stdout)
  assert.equal(invalidSummary.ok, false)
  assert.deepEqual(invalidSummary.reasons, ['bundle-media-type-unsupported'])

  const messageSignature = await writeJson(
    'bundle-message-signature.json',
    bundle({
      dsseEnvelope: undefined,
      messageSignature: {
        messageDigest: { algorithm: 'SHA2_256', digest: 'ZmFrZQ==' },
        signature: 'ZmFrZS1zaWc=',
      },
    }),
  )
  const noPayload = await run(command(messageSignature, ['--json']), {
    mode: 'missing',
  })
  assert.equal(noPayload.code, 1, noPayload.stderr)
  assert.deepEqual(JSON.parse(noPayload.stdout).reasons, ['payload-required'])
})

test('CLI verify-sigstore exits 2 when TUF/network makes the verdict inconclusive', async () => {
  const bundlePath = await writeJson('bundle-tuf.json', bundle())
  const result = await run(command(bundlePath, ['--json']), { mode: 'tuf-error' })

  assert.equal(result.code, 2)
  const summary = JSON.parse(result.stdout)
  assert.equal(summary.ok, false)
  assert.deepEqual(summary.reasons, ['tuf-error'])
  assert.match(result.stderr, /infrastructure error/)
})
