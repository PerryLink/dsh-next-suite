// @benchmark-real-fixture
// Source: dsh-next-suite/packages/dsh-capdiff/src/capability.js lines 1-66
// License: Apache-2.0; see benchmarks/capdiff/fixtures/real/SOURCES.md
// Trimmed at a complete top-level statement boundary; code otherwise unchanged.

/**
 * Capability mapping shared by the regex scanner and the optional AST scanner.
 *
 * Kept in its own module so `ast.js` can classify import specifiers without
 * importing `core.js` (which imports `ast.js` for the preferred analysis path).
 *
 * @module dsh-capdiff/capability
 */

/**
 * Import specifier / language construct -> capability.
 *
 * Bare and `node:`-prefixed builtins are both listed where useful. The three
 * non-module keys (`process.env`, `eval`, `new Function`) are language-level
 * evidence; they are detected by scanning source text or AST nodes, not by
 * imports.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CAPABILITY_MAP = Object.freeze({
  'node:fs': 'filesystem',
  fs: 'filesystem',
  'node:fs/promises': 'filesystem',
  'fs/promises': 'filesystem',
  'node:net': 'network',
  net: 'network',
  'node:http': 'network',
  http: 'network',
  'node:https': 'network',
  https: 'network',
  'node:http2': 'network',
  http2: 'network',
  'node:tls': 'network',
  tls: 'network',
  'node:dgram': 'network',
  dgram: 'network',
  fetch: 'network',
  'node:child_process': 'process',
  child_process: 'process',
  'node:crypto': 'crypto',
  crypto: 'crypto',
  'process.env': 'env',
  eval: 'eval',
  'new Function': 'eval',
})

/**
 * Map one module specifier to a capability. Subpaths such as
 * `node:fs/promises` inherit the capability of their builtin root.
 *
 * @param {string} specifier
 * @returns {string}
 */
export function capabilityForSpecifier(specifier) {
  if (typeof specifier !== 'string') return 'unknown'
  const value = specifier.trim()
  if (!value) return 'unknown'
  if (Object.hasOwn(CAPABILITY_MAP, value)) return CAPABILITY_MAP[value]

  const bare = value.startsWith('node:') ? value.slice(5) : value
  if (Object.hasOwn(CAPABILITY_MAP, bare)) return CAPABILITY_MAP[bare]

  const [base] = bare.split('/')
  if (base && Object.hasOwn(CAPABILITY_MAP, base)) return CAPABILITY_MAP[base]
  return 'unknown'
}
