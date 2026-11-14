/**
 * Lab 2 check: three governance questions, answered against mock data.
 *
 * No DSH packages, network, real filesystem writes, or credentials are used.
 * The simplified stubs in `lib/core-stub.mjs` keep the same observable
 * invariants as dsh-os-trace / dsh-os-lease / dsh-os-quota.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  GENESIS_PREV_HASH,
  createGovernor,
  createLeaseManager,
  createTraceStore,
  verifyBundle,
} from './lib/core-stub.mjs'

/**
 * @param {'spans' | 'leases' | 'quota'} name
 * @returns {any}
 */
function readJson(name) {
  return JSON.parse(readFileSync(new URL(`./data/${name}.json`, import.meta.url), 'utf8'))
}

function loadTrace() {
  const data = readJson('spans')
  const store = createTraceStore({ now: () => data.spans.at(-1).endMs })
  for (const span of data.spans) {
    store.ingest({ ...span, sessionId: data.sessionId })
  }
  return { data, store }
}

function setupLeases() {
  const data = readJson('leases')
  const manager = createLeaseManager({ now: () => data.nowMs })
  const leaseA = manager.acquire({
    workspace: data.workspace,
    paths: data.requests[0].paths,
    owner: data.requests[0].owner,
    ttlMs: data.ttlMs,
  })
  return { data, manager, leaseA }
}

function setupQuota() {
  const data = readJson('quota')
  const governor = createGovernor({
    now: () => data.nowMs,
    softRatio: data.softRatio,
  })
  governor.setLimits(data.scope, data.limits)
  return { data, governor }
}

// ---------------------------------------------------------------------------
// Trace: who approved this operation?
// ---------------------------------------------------------------------------

test('trace: ingests the mock chain and seals it with a SHA-256 hash chain', () => {
  const { data, store } = loadTrace()
  const spans = store.list()

  assert.equal(spans.length, data.spans.length)
  assert.deepEqual(spans.map((span) => span.id), data.spans.map((span) => span.id))
  assert.equal(spans[0].prevHash, GENESIS_PREV_HASH)
  assert.match(spans[0].hash, /^[0-9a-f]{64}$/)
  assert.equal(spans[1].prevHash, spans[0].hash)
  assert.equal(spans[1].parentId, spans[0].id)
  assert.equal(spans[2].prevHash, spans[1].hash)
  assert.equal(spans[2].parentId, spans[1].id)
})

test('trace: why() returns the approval -> tool -> write causal path', () => {
  const { store } = loadTrace()
  const why = store.why('span-write')

  assert.equal(why.found, true)
  assert.deepEqual(
    why.spans.map((span) => span.name),
    ['approve:workspace_apply', 'workspace_apply', 'write_file:src/app.js'],
  )
  assert.deepEqual(why.edges, [
    { parentId: 'span-approval', childId: 'span-tool' },
    { parentId: 'span-tool', childId: 'span-write' },
  ])
  assert.deepEqual(why.missing, [])
  assert.equal(why.truncated, false)
  assert.equal(why.target.id, 'span-write')
})

test('trace: exported bundle verifies from genesis to root hash', () => {
  const { store } = loadTrace()
  const bundle = store.exportBundle()
  const result = verifyBundle(bundle)

  assert.equal(bundle.spanCount, 3)
  assert.equal(bundle.spans[0].prevHash, GENESIS_PREV_HASH)
  assert.equal(result.ok, true)
  assert.equal(result.checked, 3)
  assert.equal(result.rootHash, bundle.spans.at(-1).hash)
  assert.equal(result.firstBad, null)
})

test('trace: editing an attribute after export is detected as HASH_MISMATCH', () => {
  const { store } = loadTrace()
  const bundle = store.exportBundle()
  bundle.spans[2].attrs.bytes = 43

  const result = verifyBundle(bundle)
  assert.equal(result.ok, false)
  assert.equal(result.firstBad.index, 2)
  assert.equal(result.firstBad.id, 'span-write')
  assert.equal(result.firstBad.reason, 'HASH_MISMATCH')
})

test('trace: unknown event ids return found=false instead of throwing', () => {
  const { store } = loadTrace()
  const why = store.why('span-does-not-exist')

  assert.equal(why.found, false)
  assert.equal(why.target, null)
  assert.deepEqual(why.spans, [])
  assert.deepEqual(why.missing, ['span-does-not-exist'])
})

// ---------------------------------------------------------------------------
// Lease: why two agents did not step on each other
// ---------------------------------------------------------------------------

test('lease: acquire normalizes workspace-relative paths', () => {
  const { data, leaseA } = setupLeases()

  assert.equal(leaseA.workspace, data.workspace)
  assert.deepEqual(leaseA.paths, data.requests[0].paths)
  assert.equal(leaseA.status, 'active')
  assert.equal(leaseA.expiresAt, data.nowMs + data.ttlMs)
})

test('lease: an overlapping path on the same workspace is rejected with CONFLICT', () => {
  const { data, manager, leaseA } = setupLeases()

  assert.throws(
    () =>
      manager.acquire({
        workspace: data.workspace,
        paths: data.requests[1].paths,
        owner: data.requests[1].owner,
        ttlMs: data.ttlMs,
      }),
    (error) => {
      assert.equal(error.name, 'LeaseError')
      assert.equal(error.code, 'CONFLICT')
      assert.equal(error.details.conflicts[0].leaseId, leaseA.id)
      assert.equal(error.details.conflicts[0].path, 'src/app.js')
      assert.equal(error.details.conflicts[0].reason, 'exact')
      return true
    },
  )
})

test('lease: checkConflict distinguishes src/app.js from src/application.js', () => {
  const { data, manager } = setupLeases()

  const overlapping = manager.checkConflict({
    workspace: data.workspace,
    paths: ['src/app.js'],
  })
  const sibling = manager.checkConflict({
    workspace: data.workspace,
    paths: ['src/application.js'],
  })

  assert.equal(overlapping.conflict, true)
  assert.equal(overlapping.conflicts[0].reason, 'exact')
  assert.equal(sibling.conflict, false)
  assert.deepEqual(sibling.conflicts, [])
})

test('lease: a non-overlapping path is acquired without conflict', () => {
  const { data, manager } = setupLeases()
  const leaseC = manager.acquire({
    workspace: data.workspace,
    paths: data.requests[2].paths,
    owner: data.requests[2].owner,
    ttlMs: data.ttlMs,
  })

  assert.equal(leaseC.status, 'active')
  assert.deepEqual(leaseC.paths, ['docs/readme.md'])
  assert.equal(manager.status().leases.length, 2)
})

test('lease: patchset commits staged bodies in two phases', () => {
  const { data, manager, leaseA } = setupLeases()
  const patchset = manager.preparePatchset(leaseA.id, data.patchset.files)

  assert.equal(patchset.status, 'prepared')
  assert.equal(patchset.leaseId, leaseA.id)
  assert.deepEqual(
    patchset.files.map((file) => file.path),
    ['src/app.js', 'src/lib/util.js'],
  )

  const committed = manager.commitPatchset(patchset.id)
  assert.deepEqual(committed, [
    { path: 'src/app.js', after: 'export const version = 2\n' },
    { path: 'src/lib/util.js', after: 'export const util = true\n' },
  ])
  assert.equal(manager.status().patchsets[0].status, 'committed')
})

test('lease: a patchset outside the leased roots is refused', () => {
  const { data, manager, leaseA } = setupLeases()

  assert.throws(
    () =>
      manager.preparePatchset(leaseA.id, [
        { path: 'docs/readme.md', before: 'old', after: 'new' },
      ]),
    (error) => {
      assert.equal(error.name, 'LeaseError')
      assert.equal(error.code, 'PATH_NOT_LEASED')
      return true
    },
  )
})

test('lease: releasing a lease lets a competing owner acquire', () => {
  const { data, manager, leaseA } = setupLeases()

  manager.release(leaseA.id)
  const leaseB = manager.acquire({
    workspace: data.workspace,
    paths: data.requests[1].paths,
    owner: data.requests[1].owner,
    ttlMs: data.ttlMs,
  })

  assert.equal(leaseB.owner, 'agent-b')
  assert.equal(manager.status().leases.find((lease) => lease.id === leaseA.id).status, 'released')
})

// ---------------------------------------------------------------------------
// Quota: why the task was stopped
// ---------------------------------------------------------------------------

test('quota: admitting 80 of 100 tokens is allowed and does not mutate usage', () => {
  const { data, governor } = setupQuota()
  const decision = governor.admit({ scope: data.scope, ...data.requests.first })

  assert.equal(decision.allowed, true)
  assert.equal(decision.level, 'ok')
  assert.equal(decision.reason, 'ok')
  assert.equal(decision.projected.tokens, 80)
  assert.equal(decision.remaining.tokens, 20)
  assert.equal(decision.used.tokens, 0)
  assert.equal(governor.status(data.scope).used.tokens, 0)
})

test('quota: the next 30-token request is hard-rejected', () => {
  const { data, governor } = setupQuota()
  governor.consume({ scope: data.scope, ...data.requests.first })
  const decision = governor.admit({ scope: data.scope, ...data.requests.second })

  assert.equal(decision.allowed, false)
  assert.equal(decision.level, 'hard')
  assert.equal(decision.reason, 'hard-limit')
  assert.deepEqual(decision.exceeded, ['tokens'])
  assert.equal(decision.projected.tokens, 110)
  assert.equal(decision.overBy.tokens, 10)
  assert.equal(decision.used.tokens, 80)
})

test('quota: consume books the overage instead of hiding it', () => {
  const { data, governor } = setupQuota()
  const first = governor.consume({ scope: data.scope, ...data.requests.first })
  const second = governor.consume({ scope: data.scope, ...data.requests.second })

  assert.equal(first.allowed, true)
  assert.equal(first.used.tokens, 80)
  assert.equal(second.allowed, false)
  assert.equal(second.level, 'hard')
  assert.equal(second.used.tokens, 110)
  assert.equal(second.overBy.tokens, 10)
  assert.equal(governor.status(data.scope).level, 'hard')
})

test('quota: spending exactly up to the hard limit is allowed', () => {
  const { data, governor } = setupQuota()
  governor.setLimits(data.scope, { tokens: 10 })

  const decision = governor.admit({ scope: data.scope, tokens: 10 })
  assert.equal(decision.allowed, true)
  assert.equal(decision.level, 'soft')
  assert.equal(decision.reason, 'soft-limit')
  assert.equal(decision.remaining.tokens, 0)
})

test('quota: 95 of 100 is over the 80% soft threshold but still allowed', () => {
  const { data, governor } = setupQuota()
  const decision = governor.admit({ scope: data.scope, tokens: 95 })

  assert.equal(decision.allowed, true)
  assert.equal(decision.level, 'soft')
  assert.equal(decision.reason, 'soft-limit')
  assert.equal(decision.degrade, true)
  assert.deepEqual(decision.degraded, ['tokens'])
})
