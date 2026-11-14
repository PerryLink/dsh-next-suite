import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCard } from '../src/core.js'

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url))
const SECRET = 'cli-test-secret-0123456789abcdef-0123456789abcdef'
const CREATED_AT = '2026-01-02T03:04:05.000Z'
const KEY_ENV = { TESTATUM_KEY: SECRET }

const FILES = [
  { path: 'dist/index.js', content: 'export default 1\n' },
  { path: 'dist/a.js', content: 'export const a = 1\n' },
]

const dir = await mkdtemp(join(tmpdir(), 'testatum-attest-cli-'))
after(async () => {
  await rm(dir, { recursive: true, force: true })
})

function fixtureCard() {
  return createCard({
    name: 'demo-plugin',
    version: '1.2.3',
    files: FILES,
    createdAt: CREATED_AT,
  })
}

async function writeJson(file, value) {
  const path = join(dir, file)
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return path
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

/**
 * Spawn the CLI with a clean test environment. TESTATUM_KEY and
 * TESTATUM_KEY_ID are blanked first so an inherited host value cannot make a
 * test pass or leak by accident.
 */
function run(args, { env = {}, cwd = dir } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...process.env, TESTATUM_KEY: '', TESTATUM_KEY_ID: '', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
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

function assertNoSecret(result, secret = SECRET) {
  assert.equal(result.stdout.includes(secret), false, 'stdout must not leak TESTATUM_KEY')
  assert.equal(result.stderr.includes(secret), false, 'stderr must not leak TESTATUM_KEY')
}

test('CLI --help and help exit 0 and document every command without printing the key', async () => {
  for (const args of [['--help'], ['help'], ['sign', '--help']]) {
    const result = await run(args, { env: KEY_ENV })
    assert.equal(result.code, 0, args.join(' '))
    assert.match(result.stdout, /Usage:/)
    assert.match(result.stdout, /sign <card\.json> --out <signed\.json>/)
    assert.match(result.stdout, /verify <signed\.json>/)
    assert.match(result.stdout, /revoke <signed\.json> --reason/)
    assert.match(result.stdout, /TESTATUM_KEY/)
    assertNoSecret(result)
  }

  const noArgs = await run([])
  assert.equal(noArgs.code, 2)
  assert.match(noArgs.stderr, /Usage:/)
  assertNoSecret(noArgs)
})

test('CLI sign then verify round-trips a card and reports JSON output', async () => {
  const cardPath = await writeJson('roundtrip-card.json', fixtureCard())
  const signedPath = join(dir, 'roundtrip-signed.json')

  const signed = await run(
    ['sign', cardPath, '--out', signedPath, '--key-id', 'ci-key'],
    { env: KEY_ENV },
  )
  assert.equal(signed.code, 0)
  assert.match(signed.stdout, /signed demo-plugin@1\.2\.3/)
  assertNoSecret(signed)

  const signedCard = await readJson(signedPath)
  assert.equal(signedCard.schema, 'testatum/v1')
  assert.equal(signedCard.name, 'demo-plugin')
  assert.equal(signedCard.signature.alg, 'hmac-sha256')
  assert.equal(signedCard.signature.keyId, 'ci-key')
  assert.match(signedCard.signature.sig, /^[0-9a-f]{64}$/)

  const verified = await run(['verify', signedPath], { env: KEY_ENV })
  assert.equal(verified.code, 0)
  assert.match(verified.stdout, /^OK demo-plugin@1\.2\.3 rootHash=[0-9a-f]{64}/)
  assertNoSecret(verified)

  const verifiedJson = await run(['verify', signedPath, '--json'], {
    env: KEY_ENV,
  })
  assert.equal(verifiedJson.code, 0)
  const summary = JSON.parse(verifiedJson.stdout)
  assert.equal(summary.command, 'verify')
  assert.equal(summary.ok, true)
  assert.deepEqual(summary.reasons, [])
  assert.equal(summary.name, 'demo-plugin')
  assert.equal(summary.version, '1.2.3')
  assert.equal(summary.rootHash, signedCard.rootHash)
  assertNoSecret(verifiedJson)

  const reserialized = await run(
    ['sign', signedPath, '--out', signedPath, '--key-id', 'ci-key'],
    { env: KEY_ENV },
  )
  assert.equal(reserialized.code, 0)
  const resigned = await readJson(signedPath)
  assert.deepEqual(resigned.signature, signedCard.signature)
})

test('CLI fails closed without TESTATUM_KEY and rejects bad invocations', async () => {
  const cardPath = await writeJson('nokey-card.json', fixtureCard())
  const noKeyOut = join(dir, 'nokey-signed.json')

  const noKeySign = await run(['sign', cardPath, '--out', noKeyOut])
  assert.equal(noKeySign.code, 2)
  assert.match(noKeySign.stderr, /TESTATUM_KEY is not set/)
  assertNoSecret(noKeySign)
  await assert.rejects(readFile(noKeyOut), { code: 'ENOENT' })

  const noKeyVerify = await run(['verify', cardPath])
  assert.equal(noKeyVerify.code, 2)
  assert.match(noKeyVerify.stderr, /TESTATUM_KEY is not set/)
  assertNoSecret(noKeyVerify)

  const noOut = await run(['sign', cardPath], { env: KEY_ENV })
  assert.equal(noOut.code, 2)
  assert.match(noOut.stderr, /--out/)
  assertNoSecret(noOut)

  const noFile = await run(['verify'], { env: KEY_ENV })
  assert.equal(noFile.code, 2)
  assert.match(noFile.stderr, /requires a file argument/)
  assertNoSecret(noFile)

  const unknown = await run(['bogus'], { env: KEY_ENV })
  assert.equal(unknown.code, 2)
  assert.match(unknown.stderr, /unknown command bogus/)
  assertNoSecret(unknown)

  const badOption = await run(['verify', cardPath, '--nope'], { env: KEY_ENV })
  assert.equal(badOption.code, 2)
  assert.match(badOption.stderr, /invalid arguments/)
  assertNoSecret(badOption)
})

test('CLI verify returns 1 for tampering, a wrong key or invalid JSON', async () => {
  const cardPath = await writeJson('tamper-card.json', fixtureCard())
  const signedPath = join(dir, 'tamper-signed.json')
  const signed = await run(['sign', cardPath, '--out', signedPath], {
    env: KEY_ENV,
  })
  assert.equal(signed.code, 0)

  const tamperedPath = join(dir, 'tamper-edited.json')
  const tampered = await readJson(signedPath)
  tampered.files[0].sha256 = '0'.repeat(64)
  await writeFile(tamperedPath, JSON.stringify(tampered, null, 2), 'utf8')

  const tamperedResult = await run(['verify', tamperedPath, '--json'], {
    env: KEY_ENV,
  })
  assert.equal(tamperedResult.code, 1)
  const tamperedSummary = JSON.parse(tamperedResult.stdout)
  assert.equal(tamperedSummary.ok, false)
  assert.ok(tamperedSummary.reasons.includes('rootHash-mismatch'))
  assert.ok(tamperedSummary.reasons.includes('signature-mismatch'))
  assertNoSecret(tamperedResult)

  const wrongKey = await run(['verify', signedPath], {
    env: { TESTATUM_KEY: 'a-different-secret-that-is-valid-but-wrong' },
  })
  assert.equal(wrongKey.code, 1)
  assert.match(wrongKey.stdout, /signature-mismatch/)
  assertNoSecret(wrongKey)

  const badJsonPath = join(dir, 'broken.json')
  await writeFile(badJsonPath, '{ not json', 'utf8')
  const badJson = await run(['verify', badJsonPath], { env: KEY_ENV })
  assert.equal(badJson.code, 2)
  assert.match(badJson.stderr, /not valid JSON/)
  assertNoSecret(badJson)

  const missing = await run(['verify', join(dir, 'does-not-exist.json')], {
    env: KEY_ENV,
  })
  assert.equal(missing.code, 2)
  assert.match(missing.stderr, /cannot read/)
  assertNoSecret(missing)
})

test('CLI revoke writes a record and verify detects the revocation', async () => {
  const cardPath = await writeJson('revoke-card.json', fixtureCard())
  const signedPath = join(dir, 'revoke-signed.json')
  const recordPath = join(dir, 'revoke-record.json')
  const signed = await run(['sign', cardPath, '--out', signedPath], {
    env: KEY_ENV,
  })
  assert.equal(signed.code, 0)

  const revoked = await run(
    [
      'revoke',
      signedPath,
      '--reason',
      'signing key compromised',
      '--out',
      recordPath,
      '--revoked-at',
      '2026-02-03T04:05:06.000Z',
    ],
    { env: KEY_ENV },
  )
  assert.equal(revoked.code, 0)
  assert.match(revoked.stdout, /revoked demo-plugin@1\.2\.3/)
  assertNoSecret(revoked)

  const record = await readJson(recordPath)
  assert.equal(record.schema, 'testatum/revocation/v1')
  assert.equal(record.rootHash, (await readJson(signedPath)).rootHash)
  assert.equal(record.reason, 'signing key compromised')
  assert.equal(record.revokedAt, '2026-02-03T04:05:06.000Z')

  const detection = await run(
    ['verify', signedPath, '--revocations', recordPath, '--json'],
    { env: KEY_ENV },
  )
  assert.equal(detection.code, 1)
  const detectionSummary = JSON.parse(detection.stdout)
  assert.equal(detectionSummary.ok, false)
  assert.deepEqual(detectionSummary.reasons, ['revoked'])
  assertNoSecret(detection)

  const human = await run(
    ['verify', signedPath, '--revocations', recordPath],
    { env: KEY_ENV },
  )
  assert.equal(human.code, 1)
  assert.match(human.stdout, /revoked/)
  assertNoSecret(human)
})

test('CLI revoke can work without the key but warns, and never writes plaintext secrets', async () => {
  const cardPath = await writeJson('revoke-nokey-card.json', fixtureCard())
  const signedPath = join(dir, 'revoke-nokey-signed.json')
  const recordPath = join(dir, 'revoke-nokey-record.json')
  const signed = await run(['sign', cardPath, '--out', signedPath], {
    env: KEY_ENV,
  })
  assert.equal(signed.code, 0)

  const result = await run(
    ['revoke', signedPath, '--reason', 'withdrawn', '--out', recordPath],
    { env: { TESTATUM_KEY: '' } },
  )
  assert.equal(result.code, 0)
  assert.match(result.stderr, /unauthenticated/)
  assertNoSecret(result)
  const record = await readJson(recordPath)
  assert.equal(record.reason, 'withdrawn')
  assertNoSecret({ stdout: JSON.stringify(record), stderr: '' })
})

test('CLI refuses to sign or revoke a card that fails integrity checks', async () => {
  const valid = fixtureCard()
  const broken = { ...valid, rootHash: '0'.repeat(64) }
  const brokenPath = await writeJson('broken-card.json', broken)
  const brokenOut = join(dir, 'broken-signed.json')

  const signResult = await run(['sign', brokenPath, '--out', brokenOut], {
    env: KEY_ENV,
  })
  assert.equal(signResult.code, 1)
  assert.match(signResult.stderr, /refusing to sign an invalid card/)
  assert.match(signResult.stderr, /rootHash-mismatch/)
  assertNoSecret(signResult)
  await assert.rejects(readFile(brokenOut), { code: 'ENOENT' })

  const signedPath = join(dir, 'revoke-invalid-signed.json')
  const goodSign = await run(
    ['sign', await writeJson('good-for-revoke.json', valid), '--out', signedPath],
    { env: KEY_ENV },
  )
  assert.equal(goodSign.code, 0)

  const revokePath = join(dir, 'revoke-invalid-record.json')
  const revokeResult = await run(
    ['revoke', brokenPath, '--reason', 'nope', '--out', revokePath],
    { env: KEY_ENV },
  )
  assert.equal(revokeResult.code, 1)
  assert.match(revokeResult.stderr, /refusing to revoke/)
  assertNoSecret(revokeResult)
  await assert.rejects(readFile(revokePath), { code: 'ENOENT' })

  const tamperedSigned = await readJson(signedPath)
  tamperedSigned.name = 'evil-plugin'
  const tamperedPath = await writeJson('revoke-tampered.json', tamperedSigned)
  const tamperedRevoke = await run(
    ['revoke', tamperedPath, '--reason', 'nope'],
    { env: KEY_ENV },
  )
  assert.equal(tamperedRevoke.code, 1)
  assert.match(tamperedRevoke.stderr, /does not verify/)
  assert.match(tamperedRevoke.stderr, /signature-mismatch/)
  assertNoSecret(tamperedRevoke)

  const noReason = await run(['revoke', signedPath], { env: KEY_ENV })
  assert.equal(noReason.code, 2)
  assert.match(noReason.stderr, /--reason/)
  assertNoSecret(noReason)
})
