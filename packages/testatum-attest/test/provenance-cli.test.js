import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url))
const NAME = 'demo-plugin'
const VERSION = '1.2.3'
const SLSA_V1 = 'https://slsa.dev/provenance/v1'
const PUBLISH_V01 = 'https://github.com/npm/attestation/tree/main/specs/publish/v0.1'
const REPO = 'PerryLink/demo-plugin'
const REPO_URL = 'https://github.com/PerryLink/demo-plugin'
const COMMIT = 'f80cb8448dc5058f38bc25642375c1934112c7ba'

const TARBALL = Buffer.from('cli tarball bytes\n')
const TARBALL_HEX = createHash('sha512').update(TARBALL).digest('hex')
const TARBALL_SRI = `sha512-${createHash('sha512').update(TARBALL).digest('base64')}`

/**
 * Everything below is served from 127.0.0.1: no external network is used.
 */
let origin = ''

function registryDocument(name, version, withAttestations) {
  const dist = { integrity: TARBALL_SRI }
  if (withAttestations) {
    dist.attestations = {
      url: `${origin}/attestations/${name}@${version}`,
      provenance: { predicateType: SLSA_V1 },
    }
  }
  return { name, versions: { [version]: { name, version, dist } } }
}

function statement() {
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: `pkg:npm/${NAME}@${VERSION}`, digest: { sha512: TARBALL_HEX } }],
    predicateType: SLSA_V1,
    predicate: {
      buildDefinition: {
        externalParameters: {
          workflow: { ref: `refs/tags/${VERSION}`, repository: REPO_URL },
        },
        resolvedDependencies: [
          { uri: `git+${REPO_URL}@refs/tags/${VERSION}`, digest: { gitCommit: COMMIT } },
        ],
      },
      runDetails: { metadata: { invocationId: `${REPO_URL}/actions/runs/1/attempts/1` } },
    },
  }
}

function bundle(payloadStatement) {
  return {
    predicateType: payloadStatement.predicateType,
    bundle: {
      mediaType: 'application/vnd.dev.sigstore.bundle+json;version=0.2',
      dsseEnvelope: {
        payloadType: 'application/vnd.in-toto+json',
        payload: Buffer.from(JSON.stringify(payloadStatement)).toString('base64'),
        signatures: [{ sig: 'not-a-real-signature' }],
      },
    },
  }
}

function publishAttestation() {
  return bundle({
    _type: 'https://in-toto.io/Statement/v0.1',
    subject: [{ name: `pkg:npm/${NAME}@${VERSION}`, digest: { sha512: TARBALL_HEX } }],
    predicateType: PUBLISH_V01,
    predicate: { name: NAME, version: VERSION },
  })
}

function send(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(typeof body === 'string' ? body : JSON.stringify(body))
}

const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname
  if (path === `/${NAME}`) {
    send(response, 200, registryDocument(NAME, VERSION, true))
    return
  }
  if (path === '/@scope%2Fdemo') {
    send(response, 200, registryDocument('@scope/demo', VERSION, true))
    return
  }
  if (path === '/no-attestations') {
    send(response, 200, registryDocument('no-attestations', '1.0.0', false))
    return
  }
  if (path === `/attestations/${NAME}@${VERSION}` || path === `/attestations/@scope/demo@${VERSION}`) {
    send(response, 200, { attestations: [publishAttestation(), bundle(statement())] })
    return
  }
  if (path === '/boom/demo-plugin') {
    send(response, 500, { error: 'boom' })
    return
  }
  if (path === '/broken-json/demo-plugin') {
    send(response, 200, 'not json')
    return
  }
  send(response, 404, { error: 'not found' })
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
origin = `http://127.0.0.1:${server.address().port}`

/** Reserve then release a port so the "unreachable registry" test gets ECONNREFUSED. */
const probe = createServer()
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
const closedPort = probe.address().port
await new Promise((resolve) => probe.close(resolve))

after(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})

/**
 * Spawn the CLI with TESTATUM_KEY blanked so an inherited host value can never
 * influence these tests.
 */
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, TESTATUM_KEY: '', TESTATUM_KEY_ID: '' },
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
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

test('CLI verify-provenance succeeds against a local registry with a structural-only verdict', async () => {
  const result = await run([
    'verify-provenance',
    `${NAME}@${VERSION}`,
    '--registry',
    origin,
    '--repo',
    REPO,
    '--commit',
    COMMIT,
    '--json',
  ])
  assert.equal(result.code, 0, result.stderr)

  const summary = JSON.parse(result.stdout)
  assert.equal(summary.command, 'verify-provenance')
  assert.equal(summary.ok, true)
  assert.equal(summary.name, NAME)
  assert.equal(summary.version, VERSION)
  assert.deepEqual(summary.reasons, [])
  assert.deepEqual(summary.warnings, ['tarball-digest-from-registry'])
  assert.equal(summary.cryptoVerified, false)
  assert.match(summary.boundary, /NOT verified/)
  assert.equal(summary.url, `${origin}/attestations/${NAME}@${VERSION}`)
  assert.equal(summary.predicateType, SLSA_V1)
  assert.deepEqual(summary.subject[0].digest, { sha512: TARBALL_HEX })
  assert.equal(summary.tarballSha512, TARBALL_HEX)
  assert.match(result.stderr, /warning: tarball-digest-from-registry/)

  const human = await run([
    'verify-provenance',
    `${NAME}@${VERSION}`,
    '--registry',
    origin,
    '--repo',
    REPO,
    '--commit',
    COMMIT,
    '--tarball-sha512',
    TARBALL_SRI,
  ])
  assert.equal(human.code, 0, human.stderr)
  assert.match(human.stdout, /^OK provenance demo-plugin@1\.2\.3 \(https:\/\/slsa\.dev\/provenance\/v1;/)
  assert.match(human.stdout, /metadata match only, sigstore NOT verified/)
  assert.equal(human.stderr, '')
})

test('CLI verify-provenance accepts a scoped package spec', async () => {
  const result = await run([
    'verify-provenance',
    '@scope/demo@1.2.3',
    '--registry',
    origin,
    '--repo',
    REPO,
    '--commit',
    COMMIT,
    '--tarball-sha512',
    TARBALL_HEX,
    '--json',
  ])
  assert.equal(result.code, 0, result.stderr)
  const summary = JSON.parse(result.stdout)
  assert.equal(summary.name, '@scope/demo')
  assert.equal(summary.version, VERSION)
  assert.equal(summary.ok, true)
})

test('CLI verify-provenance exits 1 for a wrong repo or tarball digest', async () => {
  const wrongRepo = await run([
    'verify-provenance',
    `${NAME}@${VERSION}`,
    '--registry',
    origin,
    '--repo',
    'PerryLink/other',
    '--commit',
    COMMIT,
    '--json',
  ])
  assert.equal(wrongRepo.code, 1)
  const repoSummary = JSON.parse(wrongRepo.stdout)
  assert.equal(repoSummary.ok, false)
  assert.deepEqual(repoSummary.reasons, ['repo-mismatch:perrylink/other'])

  const human = await run([
    'verify-provenance',
    `${NAME}@${VERSION}`,
    '--registry',
    origin,
    '--repo',
    'PerryLink/other',
  ])
  assert.equal(human.code, 1)
  assert.match(human.stdout, /^FAIL provenance demo-plugin@1\.2\.3: repo-mismatch:perrylink\/other/)

  const wrongDigest = await run([
    'verify-provenance',
    `${NAME}@${VERSION}`,
    '--registry',
    origin,
    '--tarball-sha512',
    '0'.repeat(128),
    '--json',
  ])
  assert.equal(wrongDigest.code, 1)
  const digestSummary = JSON.parse(wrongDigest.stdout)
  assert.equal(digestSummary.ok, false)
  assert.deepEqual(digestSummary.reasons, ['subject-digest-mismatch'])
})

test('CLI verify-provenance reports missing attestations as a verification failure', async () => {
  const result = await run([
    'verify-provenance',
    'no-attestations@1.0.0',
    '--registry',
    origin,
    '--json',
  ])
  assert.equal(result.code, 1)
  const summary = JSON.parse(result.stdout)
  assert.equal(summary.ok, false)
  assert.deepEqual(summary.reasons, ['attestation-missing:no-attestations'])
  assert.equal(summary.url, null)
})

test('CLI verify-provenance exits 2 with explicit registry, HTTP and JSON errors', async () => {
  const unreachable = await run([
    'verify-provenance',
    `${NAME}@${VERSION}`,
    '--registry',
    `http://127.0.0.1:${closedPort}`,
  ])
  assert.equal(unreachable.code, 2)
  assert.equal(unreachable.stdout, '')
  assert.match(
    unreachable.stderr,
    /provenance check failed: cannot fetch registry metadata/,
  )
  assert.match(unreachable.stderr, new RegExp(`127\\.0\\.0\\.1:${closedPort}`))

  const httpError = await run(['verify-provenance', `${NAME}@${VERSION}`, '--registry', `${origin}/boom`])
  assert.equal(httpError.code, 2)
  assert.match(httpError.stderr, /HTTP 500/)

  const badJson = await run([
    'verify-provenance',
    `${NAME}@${VERSION}`,
    '--registry',
    `${origin}/broken-json`,
  ])
  assert.equal(badJson.code, 2)
  assert.match(badJson.stderr, /is not valid JSON/)
})

test('CLI verify-provenance validates its package spec and documents the command', async () => {
  const noArg = await run(['verify-provenance'])
  assert.equal(noArg.code, 2)
  assert.match(noArg.stderr, /requires a <name>@<version> argument/)

  const noVersion = await run(['verify-provenance', 'demo-plugin'])
  assert.equal(noVersion.code, 2)
  assert.match(noVersion.stderr, /expected <name>@<version>/)

  const emptyVersion = await run(['verify-provenance', 'demo-plugin@'])
  assert.equal(emptyVersion.code, 2)
  assert.match(emptyVersion.stderr, /non-empty name and version/)

  const extra = await run(['verify-provenance', 'demo-plugin@1.2.3', 'extra'])
  assert.equal(extra.code, 2)
  assert.match(extra.stderr, /unexpected argument extra/)

  const help = await run(['--help'])
  assert.equal(help.code, 0)
  assert.match(help.stdout, /verify-provenance <name>@<version>/)
  assert.match(help.stdout, /--repo <owner\/repo>/)
  assert.match(help.stdout, /--tarball-sha512/)
  assert.match(help.stdout, /does NOT verify the sigstore/)
})
