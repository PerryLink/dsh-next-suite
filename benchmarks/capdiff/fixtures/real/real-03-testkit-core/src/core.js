// @benchmark-real-fixture
// Source: dsh-next-suite/packages/cordis-testkit/src/core.js lines 1-146
// License: Apache-2.0; see benchmarks/capdiff/fixtures/real/SOURCES.md
// Trimmed at a complete top-level statement boundary; code otherwise unchanged.

/**
 * Unofficial, dependency-free test double for a Cordis context.
 *
 * This module is intentionally small: it records listeners, effects and
 * plugins so plugin tests can (a) drive `ctx.emit()` deterministically and
 * (b) fail when a plugin forgets to release something. It is **not** a
 * Cordis runtime and does not implement fibers, dependency injection,
 * service reflection or asynchronous effects. See README.md / DESIGN.md.
 *
 * @module cordis-testkit
 */

/**
 * State slot. Registered with `Symbol.for` so several copies of this module
 * can still recognise each other's contexts in a test process.
 */
const STATE = Symbol.for('cordis-testkit.state')

/**
 * @typedef {object} ListenerRecord
 * @property {string | symbol} event
 * @property {Function} callback
 * @property {boolean} active
 */

/**
 * @typedef {object} EffectRecord
 * @property {string} label
 * @property {boolean} active
 * @property {boolean} disposed
 * @property {(() => void) | null} cleanup
 */

/**
 * @typedef {object} PluginRecord
 * @property {string} name
 * @property {boolean} active
 * @property {boolean} disposed
 * @property {(() => void) | null} cleanup
 */

/**
 * LIFO cleanup entry. Listeners are removed en masse at the end of
 * `dispose()`, so they do not need an entry here.
 *
 * @typedef {{ kind: 'effect', record: EffectRecord }
 *   | { kind: 'plugin', record: PluginRecord }} CleanupEntry
 */

/**
 * @typedef {object} MockContextState
 * @property {ListenerRecord[]} listeners
 * @property {EffectRecord[]} effects
 * @property {PluginRecord[]} plugins
 * @property {CleanupEntry[]} cleanups
 * @property {Map<unknown, unknown>} store
 * @property {boolean} disposed
 * @property {number} sequence
 */

/**
 * Active resources of a mock context, in registration order.
 *
 * @typedef {object} ContextSnapshot
 * @property {(string | symbol)[]} listeners Active listener event names.
 * @property {string[]} effects Active effect labels.
 * @property {string[]} plugins Active plugin names.
 * @property {boolean} disposed Whether `ctx.dispose()` has run.
 */

/**
 * Read and validate internal state.
 *
 * @param {unknown} ctx
 * @returns {MockContextState}
 */
function stateOf(ctx) {
  const state =
    ctx !== null && typeof ctx === 'object'
      ? /** @type {Record<symbol, MockContextState | undefined>} */ (ctx)[STATE]
      : undefined
  if (!state) {
    throw new TypeError(
      'expected a mock context created by createMockContext()',
    )
  }
  return state
}

/**
 * @param {MockContextState} state
 * @param {string} operation
 */
function assertActive(state, operation) {
  if (state.disposed) {
    throw new Error(`cannot ${operation} on a disposed Cordis mock context`)
  }
}

/**
 * @param {unknown} event
 * @returns {asserts event is string | symbol}
 */
function assertEvent(event) {
  if (typeof event !== 'string' && typeof event !== 'symbol') {
    throw new TypeError('event must be a string or a symbol')
  }
}

/**
 * Resolve a plugin's display name and check that it is applicable.
 *
 * @param {unknown} plugin
 * @param {MockContextState} state
 * @returns {{ name: string, callback: Function, thisArg: unknown }}
 */
function normalizePlugin(plugin, state) {
  if (typeof plugin === 'function') {
    return {
      name: plugin.name || `plugin#${++state.sequence}`,
      callback: plugin,
      thisArg: undefined,
    }
  }

  if (
    plugin !== null &&
    typeof plugin === 'object' &&
    typeof /** @type {{ apply?: unknown }} */ (plugin).apply === 'function'
  ) {
    const object = /** @type {{ name?: unknown, apply: Function }} */ (plugin)
    let name = typeof object.name === 'string' ? object.name : ''
    if (!name && object.apply.name && object.apply.name !== 'apply') {
      name = object.apply.name
    }
    return {
      name: name || `plugin#${++state.sequence}`,
      callback: object.apply,
      thisArg: object,
    }
  }

  throw new TypeError(
    'plugin must be a function or an object with an apply(ctx, config) method',
  )
}
