import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createMockContext,
  runPlugin,
  snapshot,
} from '../src/core.js'

test('function plugins receive the context and config; name is recorded', () => {
  const ctx = createMockContext()
  let seen

  function demoPlugin(inner, config) {
    seen = { inner, config, receiver: this }
  }

  const returned = ctx.plugin(demoPlugin, { enabled: true })

  assert.equal(returned, ctx)
  assert.equal(seen.inner, ctx)
  assert.equal(seen.receiver, ctx)
  assert.deepEqual(seen.config, { enabled: true })
  assert.deepEqual(snapshot(ctx).plugins, ['demoPlugin'])
})

test('object plugins apply with the plugin object as this', () => {
  const ctx = createMockContext()
  const plugin = {
    name: 'object-plugin',
    apply(inner, config) {
      assert.equal(this, plugin)
      assert.equal(inner, ctx)
      assert.equal(config.level, 'info')
      inner.set('level', config.level)
    },
  }

  ctx.plugin(plugin, { level: 'info' })
  assert.equal(ctx.get('level'), 'info')
  assert.deepEqual(snapshot(ctx).plugins, ['object-plugin'])
})

test('plugin cleanup runs on dispose before the effects it registered', () => {
  const ctx = createMockContext()
  const calls = []

  ctx.effect(() => {
    calls.push('external:setup')
    return () => calls.push('external:cleanup')
  })

  ctx.plugin(() => {
    calls.push('plugin:setup')
    ctx.effect(() => () => calls.push('effect:cleanup'))
    return () => calls.push('plugin:cleanup')
  })

  ctx.dispose()
  assert.deepEqual(calls, [
    'external:setup',
    'plugin:setup',
    'plugin:cleanup',
    'effect:cleanup',
    'external:cleanup',
  ])
})

test('plugin-registered resources are removed by ctx.dispose()', () => {
  const ctx = createMockContext()
  ctx.plugin((inner) => {
    inner.on('ping', () => {})
    inner.effect(() => () => {}, 'plugin-effect')
  })

  assert.equal(snapshot(ctx).listeners.length, 1)
  assert.equal(snapshot(ctx).effects.length, 1)

  ctx.dispose()
  assert.deepEqual(snapshot(ctx), {
    listeners: [],
    effects: [],
    plugins: [],
    disposed: true,
  })
})

test('runPlugin applies the plugin and returns the live context', () => {
  const ctx = runPlugin(
    (inner, config) => {
      inner.set('config', config)
      inner.effect(() => () => {}, 'timer')
    },
    { id: 7 },
  )

  assert.deepEqual(ctx.get('config'), { id: 7 })
  assert.equal(snapshot(ctx).effects[0], 'timer')
  assert.equal(snapshot(ctx).disposed, false)

  ctx.dispose()
  assert.equal(ctx.disposed, true)
})

test('runPlugin disposes a partially applied context when apply throws', () => {
  let captured
  assert.throws(
    () =>
      runPlugin((inner) => {
        captured = inner
        inner.on('tick', () => {})
        inner.effect(() => () => {}, 'timer')
        throw new Error('bad plugin')
      }),
    /bad plugin/,
  )

  assert.ok(captured)
  assert.deepEqual(snapshot(captured), {
    listeners: [],
    effects: [],
    plugins: [],
    disposed: true,
  })
})

test('plugin returning an unsupported value is rejected', () => {
  const ctx = createMockContext()
  assert.throws(() => ctx.plugin(() => Promise.resolve()), /cleanup function/)
  assert.deepEqual(snapshot(ctx).plugins, [])
})
