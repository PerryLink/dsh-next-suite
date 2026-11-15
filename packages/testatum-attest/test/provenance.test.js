import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  DEFAULT_REGISTRY,
  ProvenanceError,
  VERIFICATION_BOUNDARY,
  fetchAttestation,
  normalizeRepo,
  normalizeSha512,
  verifyPackage,
  verifyProvenance,
} from '../src/provenance.js'

const NAME = 'demo-plugin'
const VERSION = '1.2.3'
const METADATA_URL = `${DEFAULT_REGISTRY}/${NAME}`
const ATTESTATION_URL = `${DEFAULT_REGISTRY}/-/npm/v1/attestations/${NAME}@${VERSION}`
const SLSA_V1 = 'https://slsa.dev/provenance/v1'
const PUBLISH_V01 = 'https://github.com/npm/attestation/tree/main/specs/publish/v0.1'
const REPO = 'PerryLink/demo-plugin'
const REPO_URL = 'https://github.com/PerryLink/demo-plugin'
const COMMIT = 'f80cb8448dc5058f38bc25642375c1934112c7ba'

const TARBALL = Buffer.from('demo-plugin tarball bytes\n')
const TARBALL_HEX = createHash('sha512').update(TARBALL).digest('hex')
const TARBALL_BASE64 = createHash('sha512').update(TARBALL).digest('base64')
const TARBALL_SRI = `sha512-${TARBALL_BASE64}`

function statement({ repo = REPO_URL, commit = COMMIT, sha512 = TARBALL_HEX } = {}) {
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: `pkg:npm/${NAME}@${VERSION}`, digest: { sha512 } }],
    predicateType: SLSA_V1,
    predicate: {
      buildDefinition: {
        buildType: 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
        externalParameters: {
          workflow: {
            ref: `refs/tags/${VERSION}`,
            repository: repo,
            path: '.github/workflows/publish.yml',
          },
        },
        resolvedDependencies: [
          { uri: `git+${repo}@refs/tags/${VERSION}`, digest: { gitCommit: commit } },
        ],
      },
      runDetails: {
        builder: { id: 'https://github.com/actions/runner/github-hosted' },
        metadata: { invocationId: `${repo}/actions/runs/1/attempts/1` },
      },
    },
  }
}

/**
 * Wrap an in-toto statement in the sigstore bundle shape npm serves. The
 * "signature" is deliberately fake: this package never checks it.
 */
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
    predicate: { name: NAME, version: VERSION, registry: DEFAULT_REGISTRY },
  })
}

function metadata({ integrity = TARBALL_SRI, attestations } = {}) {
  const dist = { integrity }
  if (attestations !== undefined) dist.attestations = attestations
  return { name: NAME, versions: { [VERSION]: { name: NAME, version: VERSION, dist } } }
}

function defaultAttestations() {
  return {
    url: ATTESTATION_URL,
    provenance: { predicateType: SLSA_V1 },
  }
}

function mockFetch(routes) {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    const route = routes[url]
    if (route === undefined) throw new Error(`unexpected fetch: ${url}`)
    if (route instanceof Error) throw route
    const status = route.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() {
        if (route.jsonError !== undefined) throw new Error(route.jsonError)
        return route.body
      },
    }
  }
  return { fetchImpl, calls }
}

function standardRoutes() {
  return {
    [METADATA_URL]: { body: metadata({ attestations: defaultAttestations() }) },
    [ATTESTATION_URL]: { body: { attestations: [publishAttestation(), bundle(statement())] } },
  }
}

function fetched({
  repo = REPO_URL,
  commit = COMMIT,
  sha512 = TARBALL_HEX,
  predicateType = SLSA_V1,
} = {}) {
  const payload = statement({ repo, commit, sha512 })
  payload.predicateType = predicateType
  return {
    present: true,
    name: NAME,
    version: VERSION,
    url: ATTESTATION_URL,
    predicateType,
    subject: payload.subject,
    predicate: payload.predicate,
    tarballIntegrity: TARBALL_SRI,
    tarballSha512: TARBALL_HEX,
    reason: null,
  }
}

test('fetchAttestation picks the SLSA entry and normalises the tarball digest', async () => {
  const { fetchImpl, calls } = mockFetch(standardRoutes())

  const attestation = await fetchAttestation(NAME, VERSION, { fetchImpl })

  assert.equal(attestation.present, true)
  assert.equal(attestation.url, ATTESTATION_URL)
  assert.equal(attestation.predicateType, SLSA_V1)
  assert.equal(attestation.subject.length, 1)
  assert.deepEqual(attestation.subject[0].digest, { sha512: TARBALL_HEX })
  assert.equal(attestation.predicate.buildDefinition.externalParameters.workflow.repository, REPO_URL)
  assert.equal(attestation.tarballIntegrity, TARBALL_SRI)
  assert.equal(attestation.tarballSha512, TARBALL_HEX)
  assert.equal(attestation.reason, null)
  assert.deepEqual(calls, [METADATA_URL, ATTESTATION_URL])
})

test('fetchAttestation supports scoped names and a custom registry base URL', async () => {
  const base = 'https://registry.example.test/npm/'
  const metadataUrl = 'https://registry.example.test/npm/@scope%2Fdemo-plugin'
  const attestationUrl = 'https://registry.example.test/npm/-/attestations/@scope/demo-plugin@1.2.3'
  const { fetchImpl, calls } = mockFetch({
    [metadataUrl]: { body: metadata({ attestations: { url: attestationUrl } }) },
    [attestationUrl]: { body: { attestations: [bundle(statement())] } },
  })

  const attestation = await fetchAttestation('@scope/demo-plugin', VERSION, {
    fetchImpl,
    registry: base,
  })

  assert.equal(attestation.present, true)
  assert.equal(attestation.url, attestationUrl)
  assert.deepEqual(calls, [metadataUrl, attestationUrl])
})

test('fetchAttestation reports missing package, version and attestations without throwing', async () => {
  const notFound = mockFetch({ [METADATA_URL]: { status: 404, body: {} } })
  const missingPackage = await fetchAttestation(NAME, VERSION, { fetchImpl: notFound.fetchImpl })
  assert.equal(missingPackage.present, false)
  assert.equal(missingPackage.reason, 'package-not-found')
  assert.equal(missingPackage.url, null)
  assert.deepEqual(notFound.calls, [METADATA_URL])

  const noVersion = mockFetch({ [METADATA_URL]: { body: metadata({ attestations: defaultAttestations() }) } })
  const missingVersion = await fetchAttestation(NAME, '9.9.9', { fetchImpl: noVersion.fetchImpl })
  assert.equal(missingVersion.present, false)
  assert.equal(missingVersion.reason, 'version-not-found')

  const noAttestations = mockFetch({ [METADATA_URL]: { body: metadata() } })
  const absent = await fetchAttestation(NAME, VERSION, { fetchImpl: noAttestations.fetchImpl })
  assert.equal(absent.present, false)
  assert.equal(absent.reason, 'no-attestations')
  assert.equal(absent.tarballSha512, TARBALL_HEX)
  assert.deepEqual(noAttestations.calls, [METADATA_URL])
})

test('fetchAttestation rejects a document that only carries the npm publish attestation', async () => {
  const { fetchImpl } = mockFetch({
    [METADATA_URL]: { body: metadata({ attestations: defaultAttestations() }) },
    [ATTESTATION_URL]: { body: { attestations: [publishAttestation()] } },
  })

  const attestation = await fetchAttestation(NAME, VERSION, { fetchImpl })
  assert.equal(attestation.present, false)
  assert.equal(attestation.reason, 'no-provenance-attestation')
  assert.equal(attestation.url, ATTESTATION_URL)
})

test('fetchAttestation throws explicit ProvenanceError codes for transport failures', async () => {
  const networkError = new TypeError('fetch failed', {
    cause: Object.assign(new Error('getaddrinfo ENOTFOUND registry.npmjs.org'), {
      code: 'ENOTFOUND',
    }),
  })
  const network = mockFetch({ [METADATA_URL]: networkError })
  await assert.rejects(fetchAttestation(NAME, VERSION, { fetchImpl: network.fetchImpl }), (error) => {
    assert.ok(error instanceof ProvenanceError)
    assert.equal(error.code, 'REGISTRY_NETWORK')
    assert.match(error.message, /cannot fetch registry metadata for demo-plugin@1\.2\.3/)
    assert.match(error.message, /https:\/\/registry\.npmjs\.org\/demo-plugin/)
    assert.match(error.message, /ENOTFOUND/)
    return true
  })

  const registryHttp = mockFetch({ [METADATA_URL]: { status: 500, body: {} } })
  await assert.rejects(
    fetchAttestation(NAME, VERSION, { fetchImpl: registryHttp.fetchImpl }),
    (error) => {
      assert.equal(error.code, 'REGISTRY_HTTP_500')
      assert.match(error.message, /HTTP 500/)
      return true
    },
  )

  const attestationHttp = mockFetch({
    [METADATA_URL]: { body: metadata({ attestations: defaultAttestations() }) },
    [ATTESTATION_URL]: { status: 503, body: {} },
  })
  await assert.rejects(
    fetchAttestation(NAME, VERSION, { fetchImpl: attestationHttp.fetchImpl }),
    (error) => {
      assert.equal(error.code, 'ATTESTATION_HTTP_503')
      assert.match(error.message, /attestation document for demo-plugin@1\.2\.3/)
      return true
    },
  )

  const badJson = mockFetch({
    [METADATA_URL]: { body: metadata({ attestations: defaultAttestations() }) },
    [ATTESTATION_URL]: { body: null, jsonError: 'Unexpected token <' },
  })
  await assert.rejects(
    fetchAttestation(NAME, VERSION, { fetchImpl: badJson.fetchImpl }),
    (error) => {
      assert.equal(error.code, 'ATTESTATION_INVALID_JSON')
      assert.match(error.message, /not valid JSON/)
      return true
    },
  )
})

test('verifyProvenance accepts matching repo, commit and tarball digests in hex/base64/SRI', () => {
  const strict = verifyProvenance(fetched(), {
    repo: REPO,
    commit: COMMIT,
    tarballSha512: TARBALL_SRI,
  })
  assert.deepEqual(strict, { ok: true, reasons: [], warnings: [] })

  const loose = verifyProvenance(fetched(), {
    repo: REPO_URL,
    commit: COMMIT.toUpperCase(),
    tarballSha512: TARBALL_BASE64,
  })
  assert.deepEqual(loose, { ok: true, reasons: [], warnings: [] })

  const abbreviated = verifyProvenance(fetched(), {
    repo: REPO,
    commit: COMMIT.slice(0, 12),
    tarballSha512: TARBALL_HEX,
  })
  assert.equal(abbreviated.ok, true)
})

test('verifyProvenance rejects a wrong repo, commit or tarball digest', () => {
  const wrongRepo = verifyProvenance(fetched(), {
    repo: 'PerryLink/other',
    commit: COMMIT,
    tarballSha512: TARBALL_HEX,
  })
  assert.equal(wrongRepo.ok, false)
  assert.deepEqual(wrongRepo.reasons, ['repo-mismatch:perrylink/other'])

  const wrongCommit = verifyProvenance(fetched(), {
    repo: REPO,
    commit: '0123456789abcdef0123456789abcdef01234567',
    tarballSha512: TARBALL_HEX,
  })
  assert.equal(wrongCommit.ok, false)
  assert.deepEqual(wrongCommit.reasons, [
    'commit-mismatch:0123456789abcdef0123456789abcdef01234567',
  ])

  const wrongDigest = verifyProvenance(fetched(), {
    repo: REPO,
    commit: COMMIT,
    tarballSha512: '0'.repeat(128),
  })
  assert.equal(wrongDigest.ok, false)
  assert.deepEqual(wrongDigest.reasons, ['subject-digest-mismatch'])

  const invalidDigest = verifyProvenance(fetched(), {
    repo: REPO,
    commit: COMMIT,
    tarballSha512: 'sha512-not-base64!',
  })
  assert.equal(invalidDigest.ok, false)
  assert.deepEqual(invalidDigest.reasons, ['tarball-digest-invalid'])
})

test('verifyProvenance scopes commit candidates to the expected repository', () => {
  const otherCommit = 'b'.repeat(40)
  const payload = statement()
  payload.predicate.buildDefinition.resolvedDependencies.push({
    uri: 'git+https://github.com/PerryLink/other@refs/heads/main',
    digest: { gitCommit: otherCommit },
  })
  const attestation = { ...fetched(), predicate: payload.predicate }

  const mismatch = verifyProvenance(attestation, {
    repo: REPO,
    commit: otherCommit,
    tarballSha512: TARBALL_HEX,
  })
  assert.equal(mismatch.ok, false)
  assert.deepEqual(mismatch.reasons, [`commit-mismatch:${otherCommit}`])

  const ok = verifyProvenance(attestation, {
    repo: REPO,
    commit: COMMIT,
    tarballSha512: TARBALL_HEX,
  })
  assert.equal(ok.ok, true)
})

test('verifyProvenance fails closed for absent, non-provenance or empty attestations', () => {
  const absent = verifyProvenance({ present: false, reason: 'no-attestations' }, {})
  assert.equal(absent.ok, false)
  assert.deepEqual(absent.reasons, ['attestation-missing:no-attestations'])
  assert.deepEqual(absent.warnings, ['repo-not-verified', 'commit-not-verified'])

  const unsupported = verifyProvenance(fetched({ predicateType: PUBLISH_V01 }), {
    tarballSha512: TARBALL_HEX,
  })
  assert.equal(unsupported.ok, false)
  assert.deepEqual(unsupported.reasons, [`predicate-type-unsupported:${PUBLISH_V01}`])

  const invalid = verifyProvenance(null, {})
  assert.equal(invalid.ok, false)
  assert.deepEqual(invalid.reasons, ['attestation-missing:attestation-invalid'])

  const noSubject = verifyProvenance({ ...fetched(), subject: [] }, { tarballSha512: TARBALL_HEX })
  assert.deepEqual(noSubject.reasons, ['subject-missing'])

  const sha256Only = verifyProvenance(
    { ...fetched(), subject: [{ name: 'pkg', digest: { sha256: 'a'.repeat(64) } }] },
    { tarballSha512: TARBALL_HEX },
  )
  assert.deepEqual(sha256Only.reasons, ['subject-digest-missing'])
})

test('verifyProvenance warns when the tarball digest or repo/commit checks are missing', () => {
  const fallback = verifyProvenance(fetched(), {})
  assert.equal(fallback.ok, true)
  assert.deepEqual(fallback.reasons, [])
  assert.deepEqual(fallback.warnings, [
    'tarball-digest-from-registry',
    'repo-not-verified',
    'commit-not-verified',
  ])

  const noDigest = verifyProvenance({ ...fetched(), tarballSha512: null }, {})
  assert.equal(noDigest.ok, false)
  assert.deepEqual(noDigest.reasons, ['tarball-digest-missing'])

  const noPredicate = verifyProvenance({ ...fetched(), predicate: null }, {
    repo: REPO,
    commit: COMMIT,
    tarballSha512: TARBALL_HEX,
  })
  assert.deepEqual(noPredicate.reasons, ['repo-missing', 'commit-missing'])
})

test('verifyPackage composes fetch and verification and propagates fetch failures', async () => {
  const { fetchImpl, calls } = mockFetch(standardRoutes())

  const result = await verifyPackage(NAME, VERSION, {
    fetchImpl,
    repo: REPO,
    commit: COMMIT,
    tarballSha512: TARBALL_HEX,
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.reasons, [])
  assert.deepEqual(result.warnings, [])
  assert.equal(result.attestation.present, true)
  assert.equal(result.attestation.predicateType, SLSA_V1)
  assert.deepEqual(calls, [METADATA_URL, ATTESTATION_URL])

  const rejected = await verifyPackage(NAME, VERSION, {
    fetchImpl,
    repo: 'PerryLink/other',
    commit: COMMIT,
    tarballSha512: TARBALL_HEX,
  })
  assert.equal(rejected.ok, false)
  assert.deepEqual(rejected.reasons, ['repo-mismatch:perrylink/other'])

  await assert.rejects(
    verifyPackage(NAME, VERSION, {
      fetchImpl: async () => {
        throw new Error('boom')
      },
    }),
    /cannot fetch registry metadata/,
  )
})

test('normalizeRepo and normalizeSha512 handle the accepted input shapes', () => {
  assert.equal(normalizeRepo(REPO), 'perrylink/demo-plugin')
  assert.equal(normalizeRepo(REPO_URL), 'perrylink/demo-plugin')
  assert.equal(normalizeRepo(`${REPO_URL}.git`), 'perrylink/demo-plugin')
  assert.equal(normalizeRepo(`git+${REPO_URL}@refs/tags/${VERSION}`), 'perrylink/demo-plugin')
  assert.equal(normalizeRepo('git@github.com:PerryLink/demo-plugin.git'), 'perrylink/demo-plugin')
  assert.equal(normalizeRepo(`${REPO_URL}/actions/runs/1/attempts/1`), 'perrylink/demo-plugin')
  assert.equal(normalizeRepo('not a repo'), null)
  assert.equal(normalizeRepo(null), null)

  assert.equal(normalizeSha512(TARBALL_HEX), TARBALL_HEX)
  assert.equal(normalizeSha512(TARBALL_HEX.toUpperCase()), TARBALL_HEX)
  assert.equal(normalizeSha512(TARBALL_BASE64), TARBALL_HEX)
  assert.equal(normalizeSha512(TARBALL_SRI), TARBALL_HEX)
  assert.equal(normalizeSha512(`sha256-${'a'.repeat(43)}`), null)
  assert.equal(normalizeSha512('not-a-digest'), null)
  assert.equal(normalizeSha512(42), null)

  assert.match(VERIFICATION_BOUNDARY, /NOT verified/)
  assert.match(VERIFICATION_BOUNDARY, /npm audit signatures/)
})
