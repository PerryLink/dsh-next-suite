import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_CT_LOG_THRESHOLD,
  DEFAULT_TLOG_THRESHOLD,
  SIGSTORE_VERIFICATION_BOUNDARY,
  SigstoreUnavailableError,
  loadSigstore,
  selectProvenanceBundle,
  verifyBundle,
  verifyNpmAttestation,
} from '../src/sigstore.js'

const SLSA_V1 = 'https://slsa.dev/provenance/v1'
const PUBLISH_V01 = 'https://github.com/npm/attestation/tree/main/specs/publish/v0.1'
const IDENTITY_URI =
  'https://github.com/PerryLink/demo-plugin/.github/workflows/release.yml@refs/heads/main'
const ISSUER = 'https://token.actions.githubusercontent.com'

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

function entry(predicateType, value = bundle()) {
  return { predicateType, bundle: value }
}

function fakeSigstore({ signer, error } = {}) {
  const calls = []
  const module = {
    verify: async (...args) => {
      calls.push(args)
      if (error !== undefined) throw error
      return (
        signer ?? {
          identity: {
            subjectAlternativeName: IDENTITY_URI,
            extensions: { issuer: ISSUER },
          },
        }
      )
    },
  }
  return { calls, module, importer: async () => module }
}

function codedError(name, code, message = name) {
  return Object.assign(new Error(message), { name, code })
}

const identity = {
  certificateIdentityURI: `^${IDENTITY_URI.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
  certificateIssuer: ISSUER,
}

test('selectProvenanceBundle prefers SLSA over publish and honours an exact type', () => {
  const document = { attestations: [entry(PUBLISH_V01), entry(SLSA_V1)] }
  const selected = selectProvenanceBundle(document)
  assert.equal(selected.predicateType, SLSA_V1)
  assert.equal(selected.bundle.mediaType, bundle().mediaType)

  const exact = selectProvenanceBundle(document, { predicateType: PUBLISH_V01 })
  assert.equal(exact.predicateType, PUBLISH_V01)

  assert.equal(selectProvenanceBundle({ attestations: [] }), null)
  assert.equal(selectProvenanceBundle({ attestations: [entry(PUBLISH_V01)] }), null)
  assert.equal(selectProvenanceBundle(null), null)
})

test('selectProvenanceBundle accepts a single entry and a bare bundle', () => {
  const single = entry(SLSA_V1)
  assert.equal(selectProvenanceBundle(single).predicateType, SLSA_V1)

  const bare = bundle()
  const selected = selectProvenanceBundle(bare)
  assert.equal(selected.bundle, bare)
  assert.equal(selected.predicateType, null)
})

test('verifyBundle verifies a DSSE bundle with a pinned URI identity and issuer', async () => {
  const fake = fakeSigstore()
  const result = await verifyBundle(bundle(), { ...identity, importer: fake.importer })

  assert.equal(result.ok, true)
  assert.deepEqual(result.reasons, [])
  assert.deepEqual(result.warnings, [])
  assert.equal(result.identity.subjectAlternativeName, IDENTITY_URI)
  assert.equal(result.identity.issuer, ISSUER)
  assert.equal(result.tlogEntries, 1)
  assert.deepEqual(result.thresholds, {
    tlogThreshold: DEFAULT_TLOG_THRESHOLD,
    ctLogThreshold: DEFAULT_CT_LOG_THRESHOLD,
  })
  assert.equal(result.boundary, SIGSTORE_VERIFICATION_BOUNDARY)
  assert.equal(fake.calls.length, 1)
  assert.equal(fake.calls[0].length, 2)
  assert.equal(fake.calls[0][1].certificateIdentityURI, identity.certificateIdentityURI)
  assert.equal(fake.calls[0][1].certificateIssuer, ISSUER)
})

test('verifyBundle requires an identity and an issuer by default', async () => {
  const fake = fakeSigstore()
  const noIdentity = await verifyBundle(bundle(), { importer: fake.importer })
  assert.equal(noIdentity.ok, false)
  assert.deepEqual(noIdentity.reasons, ['identity-required'])
  assert.equal(noIdentity.fatal, false)
  assert.equal(fake.calls.length, 0)

  const noIssuer = await verifyBundle(bundle(), {
    certificateIdentityURI: identity.certificateIdentityURI,
    importer: fake.importer,
  })
  assert.equal(noIssuer.ok, false)
  assert.deepEqual(noIssuer.reasons, ['issuer-required'])
  assert.equal(fake.calls.length, 0)

  const unpinned = await verifyBundle(bundle(), {
    allowUnpinnedIdentity: true,
    importer: fake.importer,
  })
  assert.equal(unpinned.ok, true)
  assert.deepEqual(unpinned.warnings, ['identity-not-pinned'])
})

test('verifyBundle warns when email and URI are both supplied', async () => {
  const fake = fakeSigstore()
  const result = await verifyBundle(bundle(), {
    certificateIdentityEmail: 'release@example.com',
    certificateIdentityURI: identity.certificateIdentityURI,
    certificateIssuer: ISSUER,
    importer: fake.importer,
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.warnings, ['identity-email-takes-precedence'])
  assert.equal(fake.calls[0][1].certificateIdentityEmail, 'release@example.com')
})

test('verifyBundle supports messageSignature bundles only with a Buffer payload', async () => {
  const messageBundle = bundle({
    dsseEnvelope: undefined,
    messageSignature: {
      messageDigest: { algorithm: 'SHA2_256', digest: 'ZmFrZQ==' },
      signature: 'ZmFrZS1zaWc=',
    },
  })

  const missing = await verifyBundle(messageBundle, {
    ...identity,
    importer: fakeSigstore().importer,
  })
  assert.equal(missing.ok, false)
  assert.deepEqual(missing.reasons, ['payload-required'])

  const fake = fakeSigstore()
  const result = await verifyBundle(messageBundle, {
    ...identity,
    payload: Buffer.from('artifact'),
    importer: fake.importer,
  })
  assert.equal(result.ok, true)
  assert.equal(fake.calls[0].length, 3)
  assert.deepEqual(fake.calls[0][1], Buffer.from('artifact'))
})

test('verifyBundle maps sigstore policy, tlog, certificate and TUF errors', async () => {
  const policy = await verifyBundle(bundle(), {
    ...identity,
    importer: fakeSigstore({
      error: codedError('PolicyError', 'UNTRUSTED_SIGNER_ERROR', 'certificate identity error'),
    }).importer,
  })
  assert.equal(policy.ok, false)
  assert.deepEqual(policy.reasons, ['identity-mismatch'])
  assert.equal(policy.fatal, false)
  assert.equal(policy.error.code, 'UNTRUSTED_SIGNER_ERROR')

  const tlog = await verifyBundle(bundle(), {
    ...identity,
    importer: fakeSigstore({
      error: codedError('VerificationError', 'TLOG_ERROR', 'expected 1 tlog entries, got 0'),
    }).importer,
  })
  assert.deepEqual(tlog.reasons, ['tlog-invalid'])
  assert.equal(tlog.fatal, false)

  const certificate = await verifyBundle(bundle(), {
    ...identity,
    importer: fakeSigstore({
      error: codedError('VerificationError', 'CERTIFICATE_ERROR', 'certificate expired'),
    }).importer,
  })
  assert.deepEqual(certificate.reasons, ['certificate-invalid'])

  const tuf = await verifyBundle(bundle(), {
    ...identity,
    importer: fakeSigstore({
      error: codedError('TUFError', 'TUF_REFRESH_METADATA_ERROR', 'error refreshing TUF metadata'),
    }).importer,
  })
  assert.deepEqual(tuf.reasons, ['tuf-error'])
  assert.equal(tuf.fatal, true)
})

test('verifyBundle accepts an injected verifyImpl and skips the optional import', async () => {
  const calls = []
  const result = await verifyBundle(bundle(), {
    ...identity,
    importer: async () => {
      throw new Error('the importer must not run when verifyImpl is injected')
    },
    verifyImpl: async (...args) => {
      calls.push(args)
      return {
        identity: {
          subjectAlternativeName: IDENTITY_URI,
          extensions: { issuer: ISSUER },
        },
      }
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.identity.subjectAlternativeName, IDENTITY_URI)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].length, 2)
  assert.equal(calls[0][1].certificateIdentityURI, identity.certificateIdentityURI)
  assert.equal(calls[0][1].certificateIssuer, ISSUER)
})

test('verifyImpl failures are mapped like sigstore.verify failures', async () => {
  const result = await verifyBundle(bundle(), {
    ...identity,
    verifyImpl: async () => {
      throw codedError('PolicyError', 'UNTRUSTED_SIGNER_ERROR', 'certificate identity error')
    },
  })
  assert.equal(result.ok, false)
  assert.deepEqual(result.reasons, ['identity-mismatch'])
  assert.equal(result.fatal, false)
})

test('verifyBundle rejects a non-function verifyImpl', async () => {
  await assert.rejects(
    () => verifyBundle(bundle(), { ...identity, verifyImpl: 'sigstore.verify' }),
    /verifyBundle: verifyImpl must be a function/,
  )
})

test('verifyBundle rejects malformed bundles without importing sigstore', async () => {
  const fake = fakeSigstore()
  for (const [value, reason] of [
    [null, 'bundle-invalid'],
    [{ ...bundle(), mediaType: 'application/json' }, 'bundle-media-type-unsupported'],
    [{ ...bundle(), verificationMaterial: undefined }, 'bundle-verification-material-missing'],
    [
      { ...bundle(), dsseEnvelope: { ...bundle().dsseEnvelope, signatures: [] } },
      'bundle-signature-missing',
    ],
    [{ ...bundle(), dsseEnvelope: undefined }, 'bundle-content-missing'],
  ]) {
    const result = await verifyBundle(value, { ...identity, importer: fake.importer })
    assert.equal(result.ok, false)
    assert.deepEqual(result.reasons, [reason])
    assert.equal(result.fatal, false)
  }
  assert.equal(fake.calls.length, 0)
})

test('verifyBundle validates thresholds and TUF options', async () => {
  await assert.rejects(
    () => verifyBundle(bundle(), { ...identity, tlogThreshold: -1 }),
    /non-negative integer/,
  )
  await assert.rejects(
    () => verifyBundle(bundle(), { ...identity, ctLogThreshold: 1.5 }),
    /non-negative integer/,
  )
  await assert.rejects(
    () => verifyBundle(bundle(), { ...identity, timeout: 0 }),
    /positive number/,
  )
  await assert.rejects(
    () => verifyBundle(bundle(), { ...identity, tufCachePath: '' }),
    /non-empty string/,
  )

  const fake = fakeSigstore()
  const result = await verifyBundle(bundle(), {
    ...identity,
    tlogThreshold: 1,
    ctLogThreshold: 1,
    tufCachePath: '/tmp/sigstore-test-cache',
    tufForceCache: true,
    importer: fake.importer,
  })
  assert.equal(result.ok, true)
  assert.equal(fake.calls[0][1].tufCachePath, '/tmp/sigstore-test-cache')
  assert.equal(fake.calls[0][1].tufForceCache, true)
})

test('verifyBundle warns that zero thresholds disable checks', async () => {
  const fake = fakeSigstore()
  const result = await verifyBundle(bundle(), {
    ...identity,
    tlogThreshold: 0,
    ctLogThreshold: 0,
    importer: fake.importer,
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.warnings, ['threshold-zero-disables-check'])
  assert.equal(fake.calls[0][1].tlogThreshold, 0)
  assert.equal(fake.calls[0][1].ctLogThreshold, 0)
})

test('loadSigstore maps a missing optional package to SigstoreUnavailableError', async () => {
  await assert.rejects(
    () =>
      loadSigstore({
        importer: async () => {
          throw codedError('Error', 'ERR_MODULE_NOT_FOUND', "Cannot find package 'sigstore'")
        },
      }),
    (error) => {
      assert.equal(error instanceof SigstoreUnavailableError, true)
      assert.equal(error.code, 'SIGSTORE_NOT_INSTALLED')
      assert.match(error.message, /npm install --save-dev sigstore/)
      return true
    },
  )

  await assert.rejects(
    () => loadSigstore({ importer: async () => ({}) }),
    (error) => {
      assert.equal(error instanceof SigstoreUnavailableError, true)
      return true
    },
  )
})

test('verifyBundle propagates a missing sigstore package as an infrastructure error', async () => {
  await assert.rejects(
    () =>
      verifyBundle(bundle(), {
        ...identity,
        importer: async () => {
          throw codedError('Error', 'ERR_MODULE_NOT_FOUND', "Cannot find package 'sigstore'")
        },
      }),
    (error) => {
      assert.equal(error instanceof SigstoreUnavailableError, true)
      assert.equal(error.code, 'SIGSTORE_NOT_INSTALLED')
      return true
    },
  )
})

test('verifyNpmAttestation selects the SLSA bundle and flags missing artifact binding', async () => {
  const fake = fakeSigstore()
  const document = { attestations: [entry(PUBLISH_V01), entry(SLSA_V1)] }
  const result = await verifyNpmAttestation(document, { ...identity, importer: fake.importer })

  assert.equal(result.ok, true)
  assert.equal(result.predicateType, SLSA_V1)
  assert.deepEqual(result.warnings, ['artifact-binding-not-checked'])
  assert.equal(fake.calls.length, 1)

  const missing = await verifyNpmAttestation(
    { attestations: [entry(PUBLISH_V01)] },
    { ...identity, importer: fake.importer },
  )
  assert.equal(missing.ok, false)
  assert.deepEqual(missing.reasons, ['no-provenance-bundle'])
  assert.deepEqual(missing.warnings, [])
  assert.equal(fake.calls.length, 1)
})
