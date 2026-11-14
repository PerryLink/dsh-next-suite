import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  ALG,
  REVOCATION_SCHEMA,
  SCHEMA,
  attachSignature,
  canonicalJson,
  createCard,
  hashFiles,
  isRevoked,
  revokeCard,
  sha256Hex,
  signCard,
  verifyCard,
  verifyCardIntegrity,
  verifyFiles,
} from '../src/core.js'

const SECRET = 'test-secret-0123456789abcdef-0123456789abcdef'
const OTHER_SECRET = 'other-secret-fedcba9876543210-fedcba9876543210'
const CREATED_AT = '2026-01-02T03:04:05.000Z'

const FILES = [
  { path: 'src/b.js', content: 'console.log("b")\n' },
  { path: 'src/a.js', content: 'export const a = 1\n' },
]

const EXPECTED_FILES = [
  {
    path: 'src/a.js',
    sha256: 'a3b135bcfeaabda5d6780642cf256059889ad4649c9ba4f7a4d5d6e83a68b402',
    size: 19,
  },
  {
    path: 'src/b.js',
    sha256: '3ff509f2d3ce95bd2f50301b27308a893abc24a103a74ead45581920fabe03e6',
    size: 17,
  },
]
const EXPECTED_ROOT = '66789bd978f7915cd118aee915e33c6dd6463e96fdd85df89a98f40e47cc3625'
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

function makeCard(overrides = {}) {
  return createCard({
    name: 'demo-plugin',
    version: '1.2.3',
    files: FILES,
    createdAt: CREATED_AT,
    ...overrides,
  })
}

function makeSignedCard(overrides = {}, secret = SECRET) {
  const card = makeCard(overrides)
  return attachSignature(card, signCard(card, { secret, keyId: 'dev-key' }))
}

test('hashFiles builds a path-sorted manifest with pinned digests and rootHash', () => {
  const manifest = hashFiles(FILES)

  assert.deepEqual(manifest.files, EXPECTED_FILES)
  assert.equal(manifest.rootHash, EXPECTED_ROOT)
  assert.match(manifest.rootHash, /^[0-9a-f]{64}$/)

  // The root hash is sha256(canonicalJson(manifest)), independently checked here.
  const expected = createHash('sha256')
    .update(JSON.stringify(EXPECTED_FILES))
    .digest('hex')
  assert.equal(manifest.rootHash, expected)
})

test('hashFiles is independent of input order and does not mutate the input', () => {
  const reversed = [...FILES].reverse()
  const snapshot = JSON.stringify(reversed)

  assert.deepEqual(hashFiles(reversed), hashFiles(FILES))
  assert.equal(hashFiles(reversed).rootHash, EXPECTED_ROOT)
  assert.equal(JSON.stringify(reversed), snapshot)
})

test('hashFiles hashes empty files and unicode bytes exactly', () => {
  const empty = hashFiles([{ path: 'empty.txt', content: '' }])
  assert.equal(empty.files[0].sha256, EMPTY_SHA256)
  assert.equal(empty.files[0].size, 0)

  const unicode = hashFiles([{ path: 'unicode.txt', content: '你好\n' }])
  assert.equal(
    unicode.files[0].sha256,
    createHash('sha256').update('你好\n', 'utf8').digest('hex'),
  )
  assert.equal(unicode.files[0].size, Buffer.byteLength('你好\n', 'utf8'))
})

test('empty manifest has a deterministic root and empty card verifies', () => {
  const empty = hashFiles([])
  assert.deepEqual(empty.files, [])
  assert.equal(empty.rootHash, createHash('sha256').update('[]').digest('hex'))

  const card = createCard({
    name: 'empty-plugin',
    version: '0.0.0',
    files: [],
    createdAt: CREATED_AT,
  })
  const signed = attachSignature(card, signCard(card, SECRET))
  assert.deepEqual(verifyCard(signed, SECRET), { ok: true, reasons: [] })
})

test('hashFiles rejects duplicate paths, missing content and inconsistent digests', () => {
  assert.throws(
    () => hashFiles([{ path: 'a.js', content: 'a' }, { path: 'a.js', content: 'b' }]),
    /duplicate path/,
  )
  assert.throws(() => hashFiles([{ path: 'a.js' }]), /content or sha256/)
  assert.throws(
    () => hashFiles([{ path: 'a.js', sha256: 'A'.repeat(64) }]),
    /lowercase SHA-256/,
  )
  assert.throws(
    () =>
      hashFiles([
        { path: 'a.js', content: 'a', sha256: '0'.repeat(64) },
      ]),
    /does not match its content/,
  )
  assert.throws(() => hashFiles('not-an-array'), /entries must be an array/)
})

test('hashFiles accepts a precomputed sorted manifest', () => {
  const precomputed = EXPECTED_FILES.map((file) => ({ ...file }))
  assert.deepEqual(hashFiles(precomputed), hashFiles(FILES))
})

test('createCard emits the v1 schema and a valid default timestamp', () => {
  const card = makeCard()

  assert.deepEqual(Object.keys(card), [
    'schema',
    'name',
    'version',
    'files',
    'rootHash',
    'createdAt',
  ])
  assert.equal(card.schema, SCHEMA)
  assert.equal(card.name, 'demo-plugin')
  assert.equal(card.version, '1.2.3')
  assert.deepEqual(card.files, EXPECTED_FILES)
  assert.equal(card.rootHash, EXPECTED_ROOT)
  assert.equal(card.createdAt, CREATED_AT)

  const live = createCard({ name: 'live', version: '1', files: [] })
  assert.equal(Number.isNaN(Date.parse(live.createdAt)), false)

  assert.throws(() => createCard({ name: '', version: '1' }), /name/)
  assert.throws(() => createCard({ name: 'x', version: '' }), /version/)
  assert.throws(
    () => createCard({ name: 'x', version: '1', createdAt: 'not-a-date' }),
    /createdAt/,
  )
})

test('signCard is deterministic, returns the expected shape, and honours keyId', () => {
  const card = makeCard()
  const first = signCard(card, SECRET)
  const second = signCard(card, SECRET)

  assert.deepEqual(first, second)
  assert.equal(first.alg, ALG)
  assert.match(first.sig, /^[0-9a-f]{64}$/)
  assert.equal(first.keyId, undefined)

  const identified = signCard(card, { secret: SECRET, keyId: 'release-2026' })
  assert.equal(identified.keyId, 'release-2026')
  assert.equal(identified.sig, first.sig)

  assert.notEqual(signCard(card, OTHER_SECRET).sig, first.sig)
  assert.throws(() => signCard(card, ''), /empty/)
  assert.throws(() => signCard(card, { secret: '' }), /empty/)
  assert.throws(() => signCard(card), /secret/)
})

test('verifyCard accepts an intact signed card in all accepted option forms', () => {
  const signed = makeSignedCard()

  assert.deepEqual(verifyCard(signed, SECRET), { ok: true, reasons: [] })
  assert.deepEqual(verifyCard(signed, { secret: SECRET }), {
    ok: true,
    reasons: [],
  })
  assert.equal(signed.signature.keyId, 'dev-key')

  // A JSON round-trip with reversed top-level insertion order is equivalent.
  const reparsed = JSON.parse(JSON.stringify(signed))
  const reordered = Object.fromEntries(Object.entries(reparsed).reverse())
  assert.deepEqual(verifyCard(reordered, SECRET), { ok: true, reasons: [] })
})

test('verifyFiles binds a signed card to actual artifact bytes', () => {
  const signed = makeSignedCard()

  assert.deepEqual(verifyFiles(signed, FILES), { ok: true, reasons: [] })
  assert.deepEqual(verifyCard(signed, { secret: SECRET, files: FILES }), {
    ok: true,
    reasons: [],
  })

  const changed = [
    { ...FILES[0] },
    { ...FILES[1], content: 'tampered\n' },
  ]
  const changedResult = verifyFiles(signed, changed)
  assert.equal(changedResult.ok, false)
  assert.ok(changedResult.reasons.includes('file-mismatch:src/a.js'))
  const changedCardResult = verifyCard(signed, {
    secret: SECRET,
    files: changed,
  })
  assert.equal(changedCardResult.ok, false)
  assert.ok(changedCardResult.reasons.includes('file-mismatch:src/a.js'))

  const missing = verifyFiles(signed, [FILES[1]])
  assert.equal(missing.ok, false)
  assert.ok(missing.reasons.includes('file-missing:src/b.js'))

  const extra = verifyFiles(signed, [
    ...FILES,
    { path: 'src/extra.js', content: 'extra' },
  ])
  assert.equal(extra.ok, false)
  assert.ok(extra.reasons.includes('file-extra:src/extra.js'))

  const invalid = verifyFiles(signed, [{ path: 'only-path' }])
  assert.deepEqual(invalid, { ok: false, reasons: ['files-input-invalid'] })
})

test('tampering a file entry fails rootHash and signature checks', () => {
  const signed = makeSignedCard()

  const digest = structuredClone(signed)
  digest.files[0].sha256 = '0'.repeat(64)
  const digestResult = verifyCard(digest, SECRET)
  assert.equal(digestResult.ok, false)
  assert.ok(digestResult.reasons.includes('rootHash-mismatch'))
  assert.ok(digestResult.reasons.includes('signature-mismatch'))

  const path = structuredClone(signed)
  path.files[0].path = 'src/zz.js'
  const pathResult = verifyCard(path, SECRET)
  assert.equal(pathResult.ok, false)
  assert.ok(pathResult.reasons.includes('files-unsorted'))
  assert.ok(pathResult.reasons.includes('signature-mismatch'))

  const size = structuredClone(signed)
  size.files[0].size = 999
  const sizeResult = verifyCard(size, SECRET)
  assert.equal(sizeResult.ok, false)
  assert.ok(sizeResult.reasons.includes('rootHash-mismatch'))
  assert.ok(sizeResult.reasons.includes('signature-mismatch'))
})

test('reordering files or editing a top-level field fails verification', () => {
  const signed = makeSignedCard()

  const reordered = structuredClone(signed)
  reordered.files.reverse()
  const reorderedResult = verifyCard(reordered, SECRET)
  assert.equal(reorderedResult.ok, false)
  assert.ok(reorderedResult.reasons.includes('files-unsorted'))
  assert.ok(reorderedResult.reasons.includes('signature-mismatch'))

  for (const [field, value] of [
    ['name', 'evil-plugin'],
    ['version', '9.9.9'],
    ['createdAt', '2027-01-01T00:00:00.000Z'],
    ['rootHash', '0'.repeat(64)],
    ['schema', 'testatum/v2'],
  ]) {
    const tampered = structuredClone(signed)
    tampered[field] = value
    const result = verifyCard(tampered, SECRET)
    assert.equal(result.ok, false, `${field} tamper must fail`)
    assert.ok(
      result.reasons.includes('signature-mismatch'),
      `${field} tamper must break the signature: ${result.reasons.join(',')}`,
    )
  }
})

test('wrong, missing or malformed signature material fails closed', () => {
  const signed = makeSignedCard()

  const wrongSecret = verifyCard(signed, OTHER_SECRET)
  assert.equal(wrongSecret.ok, false)
  assert.ok(wrongSecret.reasons.includes('signature-mismatch'))

  const noSecret = verifyCard(signed)
  assert.equal(noSecret.ok, false)
  assert.ok(noSecret.reasons.includes('secret-missing'))

  const unsigned = verifyCard(makeCard(), SECRET)
  assert.equal(unsigned.ok, false)
  assert.ok(unsigned.reasons.includes('signature-missing'))

  const malformed = structuredClone(signed)
  malformed.signature.sig = 'not-hex'
  const malformedResult = verifyCard(malformed, SECRET)
  assert.equal(malformedResult.ok, false)
  assert.ok(malformedResult.reasons.includes('signature-malformed'))

  const unsupported = structuredClone(signed)
  unsupported.signature.alg = 'ed25519'
  const unsupportedResult = verifyCard(unsupported, SECRET)
  assert.equal(unsupportedResult.ok, false)
  assert.ok(unsupportedResult.reasons.includes('signature-alg-unsupported'))
})

test('canonical JSON is key-order independent and rejects non-JSON values', () => {
  const first = { z: 1, a: { d: 4, c: [3, { f: 6, e: 5 }] } }
  const second = { a: { c: [3, { e: 5, f: 6 }], d: 4 }, z: 1 }

  assert.equal(
    canonicalJson(first),
    '{"a":{"c":[3,{"e":5,"f":6}],"d":4},"z":1}',
  )
  assert.equal(canonicalJson(first), canonicalJson(second))

  assert.throws(() => canonicalJson({ a: undefined }), /undefined/)
  assert.throws(() => canonicalJson({ a: Number.NaN }), /non-finite/)
  assert.throws(() => canonicalJson({ a: 1n }), /bigint/)
  assert.throws(() => canonicalJson([, 1]), /sparse/)

  const cyclic = {}
  cyclic.self = cyclic
  assert.throws(() => canonicalJson(cyclic), /cyclic/)
})

test('verifyCardIntegrity catches malformed cards and embedded content tampering', () => {
  assert.deepEqual(verifyCardIntegrity(null), {
    ok: false,
    reasons: ['card-invalid'],
  })

  const card = makeCard()
  assert.deepEqual(verifyCardIntegrity(card), { ok: true, reasons: [] })

  const badSchema = verifyCardIntegrity({ ...card, schema: 'other/v1' })
  assert.equal(badSchema.ok, false)
  assert.ok(badSchema.reasons.includes('schema-invalid'))

  const badFiles = verifyCardIntegrity({ ...card, files: 'nope' })
  assert.equal(badFiles.ok, false)
  assert.ok(badFiles.reasons.includes('files-invalid'))

  const duplicate = structuredClone(card)
  duplicate.files = [duplicate.files[0], duplicate.files[0]]
  const duplicateResult = verifyCardIntegrity(duplicate)
  assert.equal(duplicateResult.ok, false)
  assert.ok(
    duplicateResult.reasons.some((reason) => reason.startsWith('file-duplicate:')),
  )

  const badDigest = structuredClone(card)
  badDigest.files[0].sha256 = 'xyz'
  const badDigestResult = verifyCardIntegrity(badDigest)
  assert.equal(badDigestResult.ok, false)
  assert.ok(
    badDigestResult.reasons.some((reason) => reason.startsWith('file-digest-invalid:')),
  )

  const withContent = structuredClone(card)
  withContent.files[0] = { ...withContent.files[0], content: 'tampered' }
  const contentResult = verifyCardIntegrity(withContent)
  assert.equal(contentResult.ok, false)
  assert.ok(
    contentResult.reasons.some((reason) =>
      reason.startsWith('file-content-mismatch:'),
    ),
  )
})

test('revokeCard produces a record and isRevoked matches by rootHash', () => {
  const card = makeCard()
  const record = revokeCard(card, {
    reason: 'signing key compromised',
    revokedAt: '2026-02-03T04:05:06.000Z',
  })

  assert.deepEqual(record, {
    schema: REVOCATION_SCHEMA,
    name: card.name,
    version: card.version,
    rootHash: card.rootHash,
    reason: 'signing key compromised',
    revokedAt: '2026-02-03T04:05:06.000Z',
  })
  assert.equal(record.rootHash, EXPECTED_ROOT)

  assert.equal(isRevoked(card, [record]), true)
  assert.equal(isRevoked(card, { revocations: [record] }), true)
  assert.equal(isRevoked(card, record), true)
  assert.equal(isRevoked(card, [card.rootHash]), true)
  assert.equal(isRevoked(card, []), false)
  assert.equal(isRevoked(card, undefined), false)

  const otherBuild = { ...card, rootHash: '1'.repeat(64) }
  assert.equal(isRevoked(otherBuild, [record]), false)
  assert.equal(
    isRevoked(otherBuild, [{ name: card.name, version: card.version }]),
    true,
  )

  assert.throws(() => revokeCard(card, { reason: ' ' }), /reason/)
  assert.throws(
    () => revokeCard({ ...card, rootHash: '0'.repeat(64) }, { reason: 'x' }),
    /invalid/,
  )
})

test('verifyCard reports revocation without hiding a valid signature', () => {
  const signed = makeSignedCard()
  const record = revokeCard(signed, {
    reason: 'withdrawn release',
    revokedAt: '2026-02-03T04:05:06.000Z',
  })

  assert.deepEqual(verifyCard(signed, { secret: SECRET, revocations: [record] }), {
    ok: false,
    reasons: ['revoked'],
  })
  assert.deepEqual(verifyCard(signed, SECRET), { ok: true, reasons: [] })
})

test('sha256Hex uses UTF-8 for strings and raw bytes for Uint8Array views', () => {
  const text = 'trust-card-✓'
  assert.equal(
    sha256Hex(text),
    createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
  )

  const padded = new Uint8Array([0x00, 0x01, 0x02, 0x03])
  const view = padded.subarray(1, 3)
  assert.equal(
    sha256Hex(view),
    createHash('sha256').update(Buffer.from([0x01, 0x02])).digest('hex'),
  )
})
