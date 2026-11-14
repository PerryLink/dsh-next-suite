import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertNoLeaks,
  createMockContext,
  runPlugin,
  snapshot,
} from '../src/core.js'

test('assertNoLeaks passes for a disposed context', () => {
  const ctx = createMockContext()
  ctx.on('tick', () => {})
  ctx.effect(() => () => {}, 'timer')
  ctx.plugin({ name: 'demo', apply() {} })

  ctx.dispose()
  assert.doesNotThrow(() => assertNoLeaks(ctx))
})

test('assertNoLeaks reports a leaked listener with its event name', () => {
  const ctx = createMockContext()
  ctx.on('tick', () => {})

  assert.throws(
    () => assertNoLeaks(ctx),
    (error) => {
      assert.equal(error.code, 'ERR_CORDIS_LEAK')
      assert.match(error.message, /leak detected/i)
      assert.match(error.message, /listener/)
      assert.match(error.message, /tick/)
      assert.deepEqual(error.leaks.listeners, ['tick'])
      return true
    },
  )
})

test('assertNoLeaks reports a leaked effect with its label', () => {
  const ctx = createMockContext()
  ctx.effect(() => () => {}, 'interval')

  assert.throws(
    () => assertNoLeaks(ctx),
    (error) => {
      assert.equal(error.code, 'ERR_CORDIS_LEAK')
      assert.match(error.message, /effect/)
      assert.match(error.message, /interval/)
      assert.deepEqual(error.leaks.effects, ['interval'])
      return true
    },
  )
})

test('assertNoLeaks reports a leaked plugin with its name', () => {
  const ctx = createMockContext()
  ctx.plugin({ name: 'leaky', apply() {} })

  assert.throws(
    () => assertNoLeaks(ctx),
    (error) => {
      assert.equal(error.code, 'ERR_CORDIS_LEAK')
      assert.match(error.message, /plugin/)
      assert.match(error.message, /leaky/)
      assert.deepEqual(error.leaks.plugins, ['leaky'])
      return true
    },
  )
})

test('assertNoLeaks lists every category and every outstanding name', () => {
  const ctx = createMockContext()
  ctx.on('ready', () => {})
  ctx.on('close', () => {})
  ctx.effect(() => () => {}, 'one')
  ctx.effect(() => () => {}, 'two')
  ctx.plugin({ name: 'first', apply() {} })
  ctx.plugin({ name: 'second', apply() {} })

  assert.throws(
    () => assertNoLeaks(ctx),
    (error) => {
      assert.deepEqual(error.leaks.listeners, ['ready', 'close'])
      assert.deepEqual(error.leaks.effects, ['one', 'two'])
      assert.deepEqual(error.leaks.plugins, ['first', 'second'])
      assert.match(error.message, /listeners: 2/)
      assert.match(error.message, /effects: 2/)
      assert.match(error.message, /plugins: 2/)
      return true
    },
  )
})

test('explicitly released resources pass without disposing the context', () => {
  const ctx = createMockContext()
  const off = ctx.on('tick', () => {})
  const offEffect = ctx.effect(() => () => {}, 'timer')

  off()
  offEffect()

  assert.deepEqual(snapshot(ctx), {
    listeners: [],
    effects: [],
    plugins: [],
    disposed: false,
  })
  assert.doesNotThrow(() => assertNoLeaks(ctx))
})

test('a fully released plugin context passes the leak gate', () => {
  const ctx = runPlugin(
    (inner, config) => {
      inner.on('tick', () => config.ticks++)
      inner.effect(() => () => {}, 'timer')
    },
    { ticks: 0 },
  )

  ctx.dispose()
  assert.doesNotThrow(() => assertNoLeaks(ctx))
})

test('assertNoLeaks rejects objects that are not mock contexts', () => {
  assert.throws(() => assertNoLeaks({}), /createMockContext/)
  assert.throws(() => assertNoLeaks(null), /createMockContext/)
})
