import test from 'node:test'
import assert from 'node:assert/strict'
import { createMockContext, snapshot } from '../src/core.js'

test('effect runs immediately and its cleanup runs on dispose', () => {
  const ctx = createMockContext()
  const calls = []

  ctx.effect(() => {
    calls.push('setup')
    return () => calls.push('cleanup')
  }, 'subscription')

  assert.deepEqual(calls, ['setup'])
  assert.deepEqual(snapshot(ctx).effects, ['subscription'])

  ctx.dispose()
  assert.deepEqual(calls, ['setup', 'cleanup'])
  assert.deepEqual(snapshot(ctx).effects, [])
})

test('effect cleanups run in reverse registration order', () => {
  const ctx = createMockContext()
  const calls = []

  for (const name of ['a', 'b', 'c']) {
    ctx.effect(() => {
      calls.push(`setup:${name}`)
      return () => calls.push(`cleanup:${name}`)
    }, name)
  }

  ctx.dispose()
  assert.deepEqual(calls, [
    'setup:a',
    'setup:b',
    'setup:c',
    'cleanup:c',
    'cleanup:b',
    'cleanup:a',
  ])
})

test('the disposer returned by effect is idempotent', () => {
  const ctx = createMockContext()
  let cleanups = 0
  const dispose = ctx.effect(() => () => cleanups++)

  dispose()
  dispose()
  ctx.dispose()

  assert.equal(cleanups, 1)
  assert.deepEqual(snapshot(ctx), {
    listeners: [],
    effects: [],
    plugins: [],
    disposed: true,
  })
})

test('a failing effect setup leaves no phantom registration', () => {
  const ctx = createMockContext()
  assert.throws(
    () =>
      ctx.effect(() => {
        throw new Error('setup failed')
      }),
    /setup failed/,
  )
  assert.throws(() => ctx.effect(() => 42), /cleanup function/)

  assert.deepEqual(snapshot(ctx).effects, [])
  ctx.dispose()
})

test('dispose releases every effect, collects errors and stays idempotent', () => {
  const ctx = createMockContext()
  const calls = []
  ctx.effect(() => () => {
    calls.push('later')
  }, 'later')
  ctx.effect(
    () => () => {
      calls.push('boom')
      throw new Error('boom')
    },
    'boom',
  )

  assert.throws(
    () => ctx.dispose(),
    (error) => {
      assert.ok(error instanceof AggregateError)
      assert.equal(error.errors.length, 1)
      assert.match(error.errors[0].message, /boom/)
      assert.equal(error.code, 'ERR_CORDIS_DISPOSE')
      return true
    },
  )
  assert.deepEqual(calls, ['boom', 'later'])
  assert.equal(ctx.disposed, true)

  assert.doesNotThrow(() => ctx.dispose())
  assert.deepEqual(snapshot(ctx), {
    listeners: [],
    effects: [],
    plugins: [],
    disposed: true,
  })
})

test('an effect that returns no cleanup is still an owned resource', () => {
  const ctx = createMockContext()
  ctx.effect(() => {})

  assert.equal(snapshot(ctx).effects.length, 1)
  ctx.dispose()
  assert.equal(snapshot(ctx).effects.length, 0)
})
