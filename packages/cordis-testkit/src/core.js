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

/**
 * Dispose one effect and (optionally) collect its cleanup error.
 *
 * The record is marked disposed before the cleanup runs, so a re-entrant or
 * repeated disposal cannot call the cleanup twice.
 *
 * @param {MockContextState} state
 * @param {EffectRecord} record
 * @param {unknown[] | null} errors Collect errors when non-null; otherwise
 *   rethrow immediately (used by the disposer returned from `ctx.effect()`).
 */
function disposeEffect(state, record, errors) {
  if (record.disposed) return
  record.disposed = true
  record.active = false

  const index = state.effects.indexOf(record)
  if (index !== -1) state.effects.splice(index, 1)

  if (!record.cleanup) return
  try {
    record.cleanup()
  } catch (error) {
    if (errors) errors.push(error)
    else throw error
  }
}

/**
 * Dispose one plugin instance and optionally collect its cleanup error.
 *
 * @param {MockContextState} state
 * @param {PluginRecord} record
 * @param {unknown[] | null} errors
 */
function disposePlugin(state, record, errors) {
  if (record.disposed) return
  record.disposed = true
  record.active = false

  const index = state.plugins.indexOf(record)
  if (index !== -1) state.plugins.splice(index, 1)

  if (!record.cleanup) return
  try {
    record.cleanup()
  } catch (error) {
    if (errors) errors.push(error)
    else throw error
  }
}

/**
 * @param {unknown[]} names
 * @returns {string}
 */
function formatNames(names) {
  return names
    .map((name) =>
      typeof name === 'symbol' ? name.toString() : JSON.stringify(name),
    )
    .join(', ')
}

/**
 * A minimal, synchronous mock of a Cordis context.
 *
 * Create one with {@link createMockContext}. Do not construct it directly in
 * tests: `createMockContext()` is the stable entry point.
 */
export class MockContext {
  constructor() {
    /** @type {MockContextState} */
    this[STATE] = {
      listeners: [],
      effects: [],
      plugins: [],
      cleanups: [],
      store: new Map(),
      disposed: false,
      sequence: 0,
    }
  }

  /** @returns {boolean} */
  get disposed() {
    return this[STATE].disposed
  }

  /**
   * Register an event listener.
   *
   * The listener is invoked with the mock context as `this`. Registering the
   * same callback twice creates two independent registrations.
   *
   * @param {string | symbol} event
   * @param {(...args: unknown[]) => unknown} callback
   * @returns {() => void} Idempotent disposer for this registration.
   */
  on(event, callback) {
    const state = stateOf(this)
    assertActive(state, 'register a listener')
    assertEvent(event)
    if (typeof callback !== 'function') {
      throw new TypeError('listener must be a function')
    }

    /** @type {ListenerRecord} */
    const record = { event, callback, active: true }
    state.listeners.push(record)

    let removed = false
    return () => {
      if (removed) return
      removed = true
      record.active = false
      const index = state.listeners.indexOf(record)
      if (index !== -1) state.listeners.splice(index, 1)
    }
  }

  /**
   * Emit an event synchronously.
   *
   * Listeners are snapshotted before dispatch: listeners added during the
   * emit are not called by this emit, while listeners removed during it are
   * skipped. Errors propagate and stop the dispatch, matching Cordis.
   *
   * Unlike Cordis (which returns `void`), this returns the listeners' return
   * values as a convenience for tests.
   *
   * @param {string | symbol} event
   * @param {...unknown} args
   * @returns {unknown[]}
   */
  emit(event, ...args) {
    const state = stateOf(this)
    assertEvent(event)

    const results = []
    for (const record of state.listeners.slice()) {
      if (!record.active || record.event !== event) continue
      results.push(Reflect.apply(record.callback, this, args))
    }
    return results
  }

  /**
   * Run a setup callback immediately and remember its cleanup.
   *
   * Supported return values are a synchronous cleanup function or
   * `undefined`/`null`. Promises, iterators and other asynchronous forms are
   * rejected: this test double is deliberately synchronous.
   *
   * Effects are considered owned resources even when they return no cleanup;
   * `dispose()` or the returned disposer must be called before
   * {@link assertNoLeaks} passes.
   *
   * @param {() => (() => void) | void | null} callback
   * @param {string | symbol} [label] Diagnostic label; defaults to `effect#N`.
   * @returns {() => void} Idempotent disposer for this effect.
   */
  effect(callback, label) {
    const state = stateOf(this)
    assertActive(state, 'register an effect')
    if (typeof callback !== 'function') {
      throw new TypeError('effect callback must be a function')
    }

    /** @type {EffectRecord} */
    const record = {
      label:
        label === undefined || label === null
          ? `effect#${++state.sequence}`
          : String(label),
      active: true,
      disposed: false,
      cleanup: null,
    }
    /** @type {CleanupEntry} */
    const entry = { kind: 'effect', record }
    state.effects.push(record)
    state.cleanups.push(entry)

    try {
      const cleanup = callback()
      if (cleanup !== undefined && cleanup !== null) {
        if (typeof cleanup !== 'function') {
          throw new TypeError(
            'effect callback must return a synchronous cleanup function, ' +
              'undefined or null',
          )
        }
        record.cleanup = cleanup
      }
    } catch (error) {
      // A failed setup must not leave a phantom effect behind.
      record.active = false
      record.disposed = true
      const effectIndex = state.effects.indexOf(record)
      if (effectIndex !== -1) state.effects.splice(effectIndex, 1)
      const cleanupIndex = state.cleanups.indexOf(entry)
      if (cleanupIndex !== -1) state.cleanups.splice(cleanupIndex, 1)
      throw error
    }

    let removed = false
    return () => {
      if (removed) return
      removed = true
      disposeEffect(state, record, null)
    }
  }

  /**
   * Store a value on the mock context.
   *
   * @param {unknown} key
   * @param {unknown} value
   * @returns {unknown} The stored value.
   */
  set(key, value) {
    stateOf(this).store.set(key, value)
    return value
  }

  /**
   * Read a value previously stored with {@link set}.
   *
   * @param {unknown} key
   * @returns {unknown}
   */
  get(key) {
    return stateOf(this).store.get(key)
  }

  /**
   * Apply a plugin synchronously.
   *
   * Function plugins are called as `plugin(ctx, config)` with `this` bound to
   * the mock context. Object plugins are called as `plugin.apply(ctx, config)`
   * with `this` bound to the plugin object. A returned function is treated as
   * the plugin's cleanup function and runs during `ctx.dispose()`.
   *
   * The plugin receives the same context (there is no forked child fiber),
   * and its listeners/effects are therefore owned by this context.
   *
   * @param {Function | { name?: string, apply: Function }} plugin
   * @param {unknown} [config]
   * @returns {this} The context, for optional chaining.
   */
  plugin(plugin, config) {
    const state = stateOf(this)
    assertActive(state, 'load a plugin')
    const target = normalizePlugin(plugin, state)

    /** @type {PluginRecord} */
    const record = {
      name: target.name,
      active: true,
      disposed: false,
      cleanup: null,
    }
    state.plugins.push(record)

    let result
    try {
      result = Reflect.apply(target.callback, target.thisArg ?? this, [
        this,
        config,
      ])
    } catch (error) {
      // The plugin never finished loading, so it has no instance to dispose.
      record.active = false
      const index = state.plugins.indexOf(record)
      if (index !== -1) state.plugins.splice(index, 1)
      throw error
    }

    if (result !== undefined && result !== null) {
      if (typeof result !== 'function') {
        record.active = false
        record.disposed = true
        const index = state.plugins.indexOf(record)
        if (index !== -1) state.plugins.splice(index, 1)
        throw new TypeError(
          'plugin must return a synchronous cleanup function, ' +
            'undefined or null',
        )
      }
      record.cleanup = result
    }

    // Register the plugin's lifecycle after its apply completed, so cleanup
    // runs before the effects it registered (LIFO disposal).
    state.cleanups.push({ kind: 'plugin', record })
    return this
  }

  /**
   * Dispose the context.
   *
   * Cleanup entries (effects and plugin cleanups) run in reverse registration
   * order; listener tables are cleared last. All cleanup errors are collected
   * and rethrown together after every resource has been released, so a
   * failing cleanup cannot leave the context half-alive.
   *
   * The call is idempotent: the second and later calls are no-ops, even if
   * the first call threw. It is safe to call `dispose()` from inside a
   * cleanup.
   *
   * @returns {void}
   * @throws {AggregateError} When one or more cleanup functions threw.
   */
  dispose() {
    const state = stateOf(this)
    if (state.disposed) return
    state.disposed = true

    /** @type {unknown[]} */
    const errors = []
    while (state.cleanups.length > 0) {
      const entry = /** @type {CleanupEntry} */ (state.cleanups.pop())
      if (entry.kind === 'effect') {
        disposeEffect(state, entry.record, errors)
      } else {
        disposePlugin(state, entry.record, errors)
      }
    }

    for (const listener of state.listeners) listener.active = false
    state.listeners.length = 0
    state.effects.length = 0
    state.plugins.length = 0

    if (errors.length > 0) {
      const error = new AggregateError(
        errors,
        `context disposal failed: ${errors.length} cleanup step(s) threw`,
      )
      // @ts-expect-error -- expando used by tests and tooling.
      error.code = 'ERR_CORDIS_DISPOSE'
      throw error
    }
  }
}

/**
 * Create a fresh mock context.
 *
 * @returns {MockContext}
 */
export function createMockContext() {
  return new MockContext()
}

/**
 * Capture the context's active resources.
 *
 * The arrays are freshly allocated copies of the active resources (disposed
 * registrations are omitted), so callers may mutate them freely.
 *
 * @param {MockContext} ctx
 * @returns {ContextSnapshot}
 */
export function snapshot(ctx) {
  const state = stateOf(ctx)
  return {
    listeners: state.listeners
      .filter((listener) => listener.active)
      .map((listener) => listener.event),
    effects: state.effects
      .filter((effect) => effect.active)
      .map((effect) => effect.label),
    plugins: state.plugins
      .filter((plugin) => plugin.active)
      .map((plugin) => plugin.name),
    disposed: state.disposed,
  }
}

/**
 * Assert that the context has no active listeners, effects or plugins.
 *
 * Typical use is after `ctx.dispose()`:
 *
 * ```js
 * const ctx = runPlugin(plugin)
 * ctx.dispose()
 * assertNoLeaks(ctx)
 * ```
 *
 * A context that was never disposed still passes when every registration was
 * explicitly released. `disposed` itself is not a requirement.
 *
 * @param {MockContext} ctx
 * @returns {void}
 * @throws {Error & { code: string, leaks: ContextSnapshot }} With a
 *   human-readable inventory when resources remain.
 */
export function assertNoLeaks(ctx) {
  const leaks = snapshot(ctx)
  if (
    leaks.listeners.length === 0 &&
    leaks.effects.length === 0 &&
    leaks.plugins.length === 0
  ) {
    return
  }

  const parts = []
  if (leaks.listeners.length > 0) {
    parts.push(
      `listeners: ${leaks.listeners.length} [${formatNames(leaks.listeners)}]`,
    )
  }
  if (leaks.effects.length > 0) {
    parts.push(`effects: ${leaks.effects.length} [${formatNames(leaks.effects)}]`)
  }
  if (leaks.plugins.length > 0) {
    parts.push(
      `plugins: ${leaks.plugins.length} [${formatNames(leaks.plugins)}]`,
    )
  }

  const error = new Error(
    `Cordis mock context leak detected: ${parts.join('; ')}. ` +
      'Call ctx.dispose() or release each registration before asserting.',
  )
  Object.assign(error, { code: 'ERR_CORDIS_LEAK', leaks })
  throw error
}

/**
 * Create a context, apply one plugin to it and return the live context.
 *
 * The caller owns disposal: call `ctx.dispose()` and then
 * {@link assertNoLeaks} when the test is done. If applying the plugin throws,
 * this helper disposes the partial context before rethrowing, so a failed
 * setup cannot leak listeners/effects.
 *
 * @param {Function | { name?: string, apply: Function }} plugin
 * @param {unknown} [config]
 * @returns {MockContext}
 */
export function runPlugin(plugin, config) {
  const ctx = createMockContext()
  try {
    ctx.plugin(plugin, config)
  } catch (error) {
    try {
      ctx.dispose()
    } catch {
      // Preserve the plugin's original error; cleanup errors are secondary.
    }
    throw error
  }
  return ctx
}
