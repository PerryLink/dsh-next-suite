// @benchmark-real-fixture
// Source: dsh-next-suite/packages/dsh-capdiff/src/core.js lines 1-95
// License: Apache-2.0; see benchmarks/capdiff/fixtures/real/SOURCES.md
// Trimmed at a complete top-level statement boundary; code otherwise unchanged.

/**
 * dsh-capdiff core: static capability extraction and declaration diffing.
 *
 * The preferred analysis path parses source with acorn (see `ast.js`). When
 * acorn is unavailable, or the file cannot be parsed (TypeScript, JSX, broken
 * source), analysis falls back to the zero-dependency regex scanner below.
 * Either way this is a heuristic scanner: it reports what is *statically
 * visible*, never what a plugin can actually do at runtime. See README.md /
 * DESIGN.md.
 *
 * @module dsh-capdiff/core
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'

import { analyzeAst } from './ast.js'
import { CAPABILITY_MAP, capabilityForSpecifier } from './capability.js'

export { CAPABILITY_MAP, capabilityForSpecifier }

export const TOOL_NAME = 'dsh-capdiff'
export const TOOL_VERSION = '0.1.3'

/** Source extensions scanned by {@link collectSourceFiles}. */
export const SOURCE_EXTENSIONS = Object.freeze(['.js', '.mjs', '.cjs'])

const SOURCE_EXTENSION_SET = new Set(SOURCE_EXTENSIONS)
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git'])

/**
 * Whether a path has a source extension understood by this package.
 *
 * @param {string} file
 * @returns {boolean}
 */
export function isSourceFile(file) {
  return SOURCE_EXTENSION_SET.has(extname(String(file)).toLowerCase())
}

// Import specifier / language construct -> capability lives in capability.js so
// the AST path can use it without importing this module. It is re-exported
// above for backwards compatibility.

const CANONICAL_CAPABILITIES = new Set([
  'filesystem',
  'network',
  'process',
  'env',
  'eval',
  'crypto',
  'unknown',
])

// Friendly aliases accepted in manifests. Underscores and whitespace are
// normalised to "-" before this table is consulted.
const DECLARATION_ALIASES = Object.freeze({
  fs: 'filesystem',
  file: 'filesystem',
  files: 'filesystem',
  'file-system': 'filesystem',
  net: 'network',
  networking: 'network',
  http: 'network',
  https: 'network',
  fetch: 'network',
  'child-process': 'process',
  subprocess: 'process',
  spawn: 'process',
  environment: 'env',
  'environment-variable': 'env',
  'environment-variables': 'env',
  'code-execution': 'eval',
  'dynamic-code': 'eval',
  'new-function': 'eval',
  'process-env': 'env',
  cryptography: 'crypto',
})

/** @typedef {{ specifier: string, kind: 'static'|'dynamic'|'require'|'re-export', index: number }} ImportRef */
/** @typedef {{ capability: string, origin: 'import'|'code', kind: string, specifier: string|null, evidence: string, index: number, line: number }} CapabilityEvidence */
/** @typedef {{ matched: string[], undeclared: string[], unused: string[] }} CapabilityDiff */

/**
 * Replace comments and string/template literal contents with spaces while
 * preserving offsets and newlines. This keeps line numbers stable and lets the
 * import/code regexes ignore commented-out code and string examples.
 *
 * Regex literals and template `${...}` expressions are not parsed. Masking the
 * whole template is intentional: missing a capability inside `${...}` is a
 * false negative, documented in DESIGN.md.
 *
 * @param {string} code
 * @returns {string}
 */
