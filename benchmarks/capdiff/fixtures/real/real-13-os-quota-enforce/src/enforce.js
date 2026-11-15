// @benchmark-real-fixture
// Source: dsh-os-suite/packages/dsh-os-quota/src/enforce.js lines 1-117
// License: Apache-2.0; see benchmarks/capdiff/fixtures/real/SOURCES.md
// Trimmed at a complete top-level statement boundary; code otherwise unchanged.

/**
 * Opt-in tool-call enforcement adapter for dsh-os-quota.
 *
 * `src/core.js` is the policy engine (admit/consume); this module is the thin
 * seam that lets a DSH host enforce that policy on real tool calls:
 *
 * - `preExecute(call, next)` is a `tools/pre-execute` waterfall listener. It
 *   estimates the call's cost, asks the governor for admission, denies a hard
 *   overage, and otherwise delegates to `next()` (marking `degrade` on soft).
 * - The attached result listener books reality when a tool result carries
 *   `usage.tokens`; a result without usage is skipped, never guessed.
 *
 * The module imports nothing from `@deepseek-ai/*` so it can be unit-tested
 * with a fake context. It still speaks the DSH waterfall convention
 * (`{ kind: 'deny', reason }`); denial decisions also carry `allow: false` so
 * simple adapters can read the same object without knowing the DSH tag.
 */

/** Stable error code attached to a hard rejection. */
export const QUOTA_DENIED_CODE = 'QUOTA_HARD_LIMIT'

/** Scope used when neither the config nor the call names one. */
const DEFAULT_SCOPE = 'default'

/** Quota's own tools are observability/control-plane calls: never gate them. */
const QUOTA_TOOL_PREFIX = 'quota_'

/** Bound for callId bookkeeping so a long-lived process cannot grow forever. */
const MAX_TRACKED_CALLS = 4096

/** @typedef {'tokens' | 'jobs' | 'diskMb'} Dimension */

/** @typedef {{ tokens: number, jobs: number, diskMb: number }} Usage */

/**
 * A hard-limit denial. `preExecute` returns the denial object by default; it
 * throws this error only when `throwOnDeny: true` (or when called directly by
 * an embedder that prefers exceptions).
 */
export class QuotaDeniedError extends Error {
  /**
   * @param {object} [decision] Admission decision from the governor.
   * @param {object} [options]
   * @param {string} [options.reason] Override the generated model-facing reason.
   * @param {object} [options.call] The tool execution that was denied.
   * @param {string} [options.tool] Tool name when `call` is unavailable.
   */
  constructor(decision, options = {}) {
    const reason = typeof options.reason === 'string' && options.reason !== ''
      ? options.reason
      : describeDenial(decision, options.call, options.tool)
    super(reason)
    this.name = 'QuotaDeniedError'
    this.code = QUOTA_DENIED_CODE
    this.reason = reason
    this.scope = typeof decision?.scope === 'string' ? decision.scope : DEFAULT_SCOPE
    this.level = 'hard'
    this.allowed = false
    this.allow = false
    this.decision = decision ?? null
    this.call = options.call ?? null
    this.info = { name: this.name, code: this.code, reason }
  }
}

/** @param {unknown} value @returns {boolean} */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** @param {unknown} value @returns {string | null} */
function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * Read a tool name from the two spellings hosts use: `name` (DSH) and `tool`
 * (lighter adapters).
 * @param {unknown} call
 * @returns {string}
 */
export function toolNameOf(call) {
  if (!isObject(call)) return ''
  return nonEmptyString(call.name)
    ?? nonEmptyString(call.tool)
    ?? nonEmptyString(call.toolName)
    ?? ''
}

/**
 * Clamp an estimated amount to a non-negative finite number. Estimates are not
 * bookings: bad input becomes 0 rather than corrupting the projection.
 * @param {unknown} value
 * @returns {number}
 */
function estimateAmount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Merge one cost estimate over another. A bare number means tokens; an object
 * may carry any subset of the three dimensions (including an explicit zero).
 * @param {Usage} base
 * @param {unknown} patch
 * @returns {Usage}
 */
function mergeCost(base, patch) {
  if (patch === undefined || patch === null) return base
  if (typeof patch === 'number') return { ...base, tokens: estimateAmount(patch) }
  if (!isObject(patch)) return base
  /** @type {Usage} */
  const next = { ...base }
  for (const dim of /** @type {readonly Dimension[]} */ (['tokens', 'jobs', 'diskMb'])) {
    if (Object.hasOwn(patch, dim)) next[dim] = estimateAmount(patch[dim])
  }
  return next
}
