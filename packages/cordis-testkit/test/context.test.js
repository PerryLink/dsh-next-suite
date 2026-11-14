import test from 'node:test'
import assert from 'node:assert/strict'
import { createMockContext, snapshot } from '../src/core.js'

test('on/emit forwards arguments and calls the listener with the context', () => {
  const ctx = createMockContext()
  /** @type {unknown[][]} */
  const calls = []
  /** @type {unknown} */
  let receiver

  function listener(first, second) {
    receiver = this
    calls.push([first, second])
  }

  ctx.on('greet', listener)
  const results = ctx.emit('greet', 'hello', 42)

  assert.deepEqual(calls, [['hello', 42]])
  assert.equal(receiver, ctx)
  assert.equal(results.length, 1)
})

test('emit dispatches in registration order and does not replay late listeners', () => {
  const ctx = createMockContext()
  const calls = []

  ctx.on('a', () => calls.push('a1'))
  ctx.on('b', () => calls.push('b1'))
  ctx.on('a', () => {
    calls.push('a2')
    ctx.on('a', () => calls.push('late'))
  })

  ctx.emit('a')
  assert.deepEqual(calls, ['a1', 'a2'])

  ctx.emit('a')
  assert.deepEqual(calls, ['a1', 'a2', 'a1', 'a2', 'late'])
})

test('set/get stores arbitrary values', () => {
  const ctx = createMockContext()
  const key = Symbol('key')

  assert.equal(ctx.get('missing'), undefined)
  assert.equal(ctx.set('answer', 42), 42)
  assert.equal(ctx.get('answer'), 42)
  assert.equal(ctx.set(key, { ok: true }), ctx.get(key))
  assert.deepEqual(ctx.get(key), { ok: true })
})

test('listener disposer removes the registration exactly once', () => {
  const ctx = createMockContext()
  let calls = 0
  const dispose = ctx.on('tick', () => calls++)

  dispose()
  dispose()
  ctx.emit('tick')

  assert.equal(calls, 0)
  assert.deepEqual(snapshot(ctx).listeners, [])
})

test('snapshot is a detached view of the active resources', () => {
  const ctx = createMockContext()
  ctx.on('ready', () => {})
  ctx.effect(() => () => {}, 'timer')
  ctx.plugin({ name: 'demo', apply() {} })

  const snap = snapshot(ctx)
  assert.deepEqual(snap, {
    listeners: ['ready'],
    effects: ['timer'],
    plugins: ['demo'],
    disposed: false,
  })

  snap.listeners.push('mutated')
  snap.effects.length = 0
  assert.deepEqual(snapshot(ctx), {
    listeners: ['ready'],
    effects: ['timer'],
    plugins: ['demo'],
    disposed: false,
  })
})

test('registering after dispose throws, while emit/get remain readable', () => {
  const ctx = createMockContext()
  ctx.set('kept', 'yes')
  ctx.dispose()

  assert.throws(() => ctx.on('x', () => {}), /disposed/i)
  assert.throws(() => ctx.effect(() => {}), /disposed/i)
  assert.throws(() => ctx.plugin(() => {}), /disposed/i)
  assert.deepEqual(ctx.emit('x'), [])
  assert.equal(ctx.get('kept'), 'yes')
  assert.deepEqual(snapshot(ctx), {
    listeners: [],
    effects: [],
    plugins: [],
    disposed: true,
  })
})
