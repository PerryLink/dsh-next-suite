// @benchmark-real-fixture
// Source: dsh-os-suite/packages/dsh-os-catalog/src/core.js lines 1-139
// License: Apache-2.0; see benchmarks/capdiff/fixtures/real/SOURCES.md
// Trimmed at a complete top-level statement boundary; code otherwise unchanged.

/**
 * Pure capability-catalog logic for dsh-os-catalog.
 *
 * This module has no `@deepseek-ai/*` imports: it can be exercised offline with
 * `node --test`. The Cordis entry point in `index.js` is only a thin adapter
 * that registers three tools and forwards their arguments here.
 *
 * @module dsh-os-catalog/core
 */

/**
 * @typedef {'tool' | 'plugin' | 'mcp' | 'skill' | 'command'} CapabilityKind
 * @typedef {'free' | 'cheap' | 'expensive'} CapabilityCost
 * @typedef {'ok' | 'degraded' | 'down'} CapabilityHealth
 */

/**
 * A capability manifest. It describes what a capability is for; it does not
 * execute or grant anything.
 *
 * @typedef {object} Capability
 * @property {string} id Stable unique id, e.g. `"pdf.convert"`.
 * @property {string} name Human-readable name.
 * @property {CapabilityKind} kind Registry family the capability belongs to.
 * @property {string[]} intents Short natural-language intents it serves.
 * @property {string[]} inputs Accepted input names or types.
 * @property {string[]} outputs Produced output names or types.
 * @property {string[]} permissions Permission ids required to run it.
 * @property {CapabilityCost} cost Declared cost tier.
 * @property {CapabilityHealth} health Declared health.
 * @property {object} [meta] Free-form JSON metadata; never interpreted here.
 */

/**
 * @typedef {object} SearchOptions
 * @property {CapabilityKind | CapabilityKind[]} [kind] Kind or kinds to keep.
 * @property {CapabilityCost} [maxCost] Highest cost tier to keep.
 * @property {string[]} [requirePermissions] Permissions the caller can grant;
 *   only capabilities whose permissions are fully covered are kept.
 * @property {CapabilityHealth} [health] Exact health filter.
 * @property {boolean} [includeDown] Include `down` capabilities (default false).
 * @property {number} [limit] Maximum hits, 1-100 (default 20).
 */

/**
 * @typedef {object} SearchHit
 * @property {Capability} cap Frozen capability manifest.
 * @property {number} score Deterministic relevance score.
 * @property {string[]} why Human-readable match reasons.
 */

/**
 * @typedef {object} Suggestion
 * @property {string} id
 * @property {string} name
 * @property {CapabilityKind} kind
 * @property {string[]} intents
 */

/**
 * @typedef {object} SearchResult
 * @property {SearchHit[]} items Ranked hits, truncated by `limit`.
 * @property {number} total Matched hits before truncation.
 * @property {Suggestion[]} suggestions Browse suggestions when nothing matched.
 */

/**
 * @typedef {object} PreflightBlocker
 * @property {string} code Machine-readable reason.
 * @property {string} message Human-readable reason.
 * @property {string} [permission]
 * @property {CapabilityCost} [cost]
 * @property {CapabilityCost} [maxCost]
 * @property {CapabilityHealth} [health]
 */

/**
 * @typedef {object} PreflightResult
 * @property {boolean} ok True when `blockers` is empty.
 * @property {PreflightBlocker[]} blockers Reasons the capability cannot run now.
 * @property {PreflightBlocker[]} warnings Non-blocking risks.
 * @property {string} id
 * @property {string | null} name
 * @property {CapabilityHealth | null} health
 * @property {CapabilityCost | null} cost
 * @property {string[]} requiredPermissions
 * @property {string[]} missingPermissions
 * @property {string[]} grantedPermissions
 */

/**
 * @typedef {object} Catalog
 * @property {(cap: Capability | object) => Capability} register
 * @property {(id: string) => boolean} remove
 * @property {(id: string) => Capability | undefined} get
 * @property {(intent: string, options?: SearchOptions) => SearchResult} search
 * @property {(id: string, options?: { grantedPermissions?: string[], maxCost?: CapabilityCost }) => PreflightResult} preflight
 * @property {() => Capability[]} list
 */

/** @type {ReadonlyArray<CapabilityKind>} */
export const KINDS = Object.freeze(['tool', 'plugin', 'mcp', 'skill', 'command'])
/** @type {ReadonlyArray<CapabilityCost>} */
export const COSTS = Object.freeze(['free', 'cheap', 'expensive'])
/** @type {ReadonlyArray<CapabilityHealth>} */
export const HEALTHS = Object.freeze(['ok', 'degraded', 'down'])

/** @type {Record<CapabilityCost, number>} */
const COST_RANK = Object.freeze({ free: 0, cheap: 1, expensive: 2 })
/** @type {Record<CapabilityHealth, number>} */
const HEALTH_RANK = Object.freeze({ ok: 0, degraded: 1, down: 2 })

/** Field weights keep intent matches ahead of name and input matches. */
const FIELD_WEIGHTS = Object.freeze({ intents: 6, name: 3, inputs: 1 })

const TIER_LABELS = Object.freeze({ 1: 'contains', 2: 'prefix', 3: 'exact' })

/** Full-query phrase bonuses, applied on top of per-token matches. */
const PHRASE_BONUS = Object.freeze({
  intents: Object.freeze({ 3: 40, 2: 18, 1: 8 }),
  name: Object.freeze({ 3: 20, 2: 8, 1: 3 }),
})

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const MAX_SUGGESTIONS = 5

/** Error raised for catalog usage errors that callers should handle. */
export class CatalogError extends Error {
  /**
   * @param {'DUPLICATE_ID'} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message)
    this.name = 'CatalogError'
    this.code = code
  }
}
