/**
 * dsh-capdiff core: static capability extraction and declaration diffing.
 *
 * This module deliberately uses regular expressions instead of a JavaScript
 * parser so it can run offline with zero dependencies on arbitrary plugin
 * source. It is a heuristic scanner: it reports what is *statically visible*,
 * never what a plugin can actually do at runtime. See README.md / DESIGN.md.
 *
 * @module dsh-capdiff/core
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'

export const TOOL_NAME = 'dsh-capdiff'
export const TOOL_VERSION = '0.1.0'

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

/**
 * Import specifier / language construct -> capability.
 *
 * Bare and `node:`-prefixed builtins are both listed where useful. The three
 * non-module keys (`process.env`, `eval`, `new Function`) are language-level
 * evidence; they are detected by scanning source text, not by imports.
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
function maskNonCode(code) {
  const source = String(code)
  const output = source.split('')
  const length = source.length
  let index = 0
  /** @type {'code'|'line-comment'|'block-comment'|'single'|'double'|'template'} */
  let state = 'code'

  while (index < length) {
    const char = source[index]
    const next = source[index + 1]

    if (state === 'code') {
      if (char === '/' && next === '/') {
        output[index] = ' '
        output[index + 1] = ' '
        index += 2
        state = 'line-comment'
      } else if (char === '/' && next === '*') {
        output[index] = ' '
        output[index + 1] = ' '
        index += 2
        state = 'block-comment'
      } else if (char === "'") {
        output[index] = ' '
        index += 1
        state = 'single'
      } else if (char === '"') {
        output[index] = ' '
        index += 1
        state = 'double'
      } else if (char === '`') {
        output[index] = ' '
        index += 1
        state = 'template'
      } else {
        index += 1
      }
      continue
    }

    if (state === 'line-comment') {
      if (char === '\n') {
        state = 'code'
      } else {
        output[index] = ' '
      }
      index += 1
      continue
    }

    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        output[index] = ' '
        output[index + 1] = ' '
        index += 2
        state = 'code'
      } else {
        if (char !== '\n' && char !== '\r') output[index] = ' '
        index += 1
      }
      continue
    }

    // String / template literal state.
    if (char === '\\') {
      output[index] = ' '
      if (index + 1 < length) {
        const escaped = source[index + 1]
        if (escaped !== '\n' && escaped !== '\r') output[index + 1] = ' '
      }
      index += 2
      continue
    }

    const closing = state === 'single' ? "'" : state === 'double' ? '"' : '`'
    if (char === closing) {
      output[index] = ' '
      index += 1
      state = 'code'
      continue
    }

    // A raw newline terminates a normal string (invalid JS, but recover
    // gracefully); template literals may span lines.
    if ((state === 'single' || state === 'double') && char === '\n') {
      state = 'code'
      index += 1
      continue
    }

    if (char !== '\n' && char !== '\r') output[index] = ' '
    index += 1
  }

  return output.join('')
}

// Clause characters: identifiers, whitespace, braces, commas, star. Keeping the
// clause bounded (instead of [\s\S]*?) avoids swallowing unrelated lines when
// malformed source lacks a `from`.
const STATIC_IMPORT_RE =
  /(?<![\w$.])import\s+[\w$\s{},*]+?\s+from\s*(['"])([^'"\r\n]+)\1/g
const SIDE_EFFECT_IMPORT_RE =
  /(?<![\w$.])import\s*(?!\()(['"])([^'"\r\n]+)\1/g
const DYNAMIC_IMPORT_RE =
  /(?<![\w$.])import\s*\(\s*(['"])([^'"\r\n]+)\1\s*\)/g
const REQUIRE_RE = /(?<![\w$.])require\s*\(\s*(['"])([^'"\r\n]+)\1\s*\)/g
const EXPORT_FROM_RE =
  /(?<![\w$.])export\s+[\w$\s{},*]+?\s+from\s*(['"])([^'"\r\n]+)\1/g

/**
 * Find statically written module references.
 *
 * Recognised kinds:
 * - `static`     `import x from 'm'`, `import { x } from 'm'`, `import 'm'`
 * - `dynamic`    `import('m')` (string literals only)
 * - `require`    `require('m')` (string literals only)
 * - `re-export`  `export ... from 'm'`
 *
 * Computed specifiers (`import(name)`) are invisible to a regex scanner and are
 * ignored. Imports inside comments or string literals are ignored as well.
 *
 * @param {string} code
 * @returns {ImportRef[]} matches sorted by source offset
 */
export function extractImports(code) {
  const source = typeof code === 'string' ? code : String(code ?? '')
  const masked = maskNonCode(source)
  /** @type {ImportRef[]} */
  const imports = []
  const seen = new Set()

  /**
   * @param {RegExp} pattern
   * @param {ImportRef['kind']} kind
   */
  const collect = (pattern, kind) => {
    const regex = new RegExp(pattern.source, pattern.flags)
    for (const match of source.matchAll(regex)) {
      const index = match.index ?? 0
      // The keyword must be visible code, not a comment/string placeholder.
      if (masked[index] !== source[index]) continue
      const specifier = match[2]
      if (!specifier) continue
      const key = `${index}:${kind}:${specifier}`
      if (seen.has(key)) continue
      seen.add(key)
      imports.push({ specifier, kind, index })
    }
  }

  collect(STATIC_IMPORT_RE, 'static')
  collect(SIDE_EFFECT_IMPORT_RE, 'static')
  collect(DYNAMIC_IMPORT_RE, 'dynamic')
  collect(REQUIRE_RE, 'require')
  collect(EXPORT_FROM_RE, 're-export')

  return imports.sort((a, b) => a.index - b.index)
}

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

/**
 * 1-based line number of a UTF-16 offset.
 *
 * @param {string} code
 * @param {number} index
 * @returns {number}
 */
export function lineOfIndex(code, index) {
  const source = typeof code === 'string' ? code : String(code ?? '')
  const limit = Math.max(0, Math.min(Number.isInteger(index) ? index : 0, source.length))
  let line = 1
  for (let i = 0; i < limit; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1
  }
  return line
}

// Language-level capabilities that are not imports. Lookbehinds avoid matching
// property access such as `foo.eval(...)`.
const CODE_CAPABILITY_PATTERNS = Object.freeze([
  {
    capability: 'env',
    evidence: 'process.env',
    regex: /(?<![\w$.])process\s*\.\s*env\b/g,
  },
  {
    capability: 'env',
    evidence: "process['env']",
    regex: /(?<![\w$.])process\s*\[\s*(['"])env\1\s*\]/g,
  },
  {
    capability: 'eval',
    evidence: 'eval()',
    regex: /(?<![\w$.])eval\s*\(/g,
  },
  {
    capability: 'eval',
    evidence: 'new Function()',
    regex: /(?<![\w$.])new\s+Function\s*\(/g,
  },
])

/**
 * Collect every capability observation from a source string.
 *
 * @param {string} code
 * @param {ImportRef[]|string[]} [imports] pre-extracted imports; when omitted
 *   they are derived from `code`
 * @returns {CapabilityEvidence[]} sorted by source offset
 */
export function collectCapabilityEvidence(code, imports) {
  const source = typeof code === 'string' ? code : ''
  const masked = maskNonCode(source)
  const importList = Array.isArray(imports) ? imports : extractImports(source)
  /** @type {CapabilityEvidence[]} */
  const evidence = []

  for (const entry of importList) {
    const specifier =
      typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object' && typeof entry.specifier === 'string'
          ? entry.specifier
          : null
    if (!specifier) continue
    const kind =
      entry && typeof entry === 'object' && typeof entry.kind === 'string' && entry.kind
        ? entry.kind
        : 'static'
    const index =
      entry && typeof entry === 'object' && Number.isInteger(entry.index) && entry.index >= 0
        ? entry.index
        : 0
    evidence.push({
      capability: capabilityForSpecifier(specifier),
      origin: 'import',
      kind,
      specifier,
      evidence: specifier,
      index,
      line: lineOfIndex(source, index),
    })
  }

  for (const pattern of CODE_CAPABILITY_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags)
    // Match raw source so patterns containing string literals (process['env'])
    // still work, but require the token to start in visible code. A match that
    // starts inside a comment or string is skipped, matching extractImports.
    for (const match of source.matchAll(regex)) {
      const index = match.index ?? 0
      if (masked[index] !== source[index]) continue
      evidence.push({
        capability: pattern.capability,
        origin: 'code',
        kind: 'usage',
        specifier: null,
        evidence: pattern.evidence,
        index,
        line: lineOfIndex(source, index),
      })
    }
  }

  return evidence.sort(
    (a, b) =>
      a.index - b.index ||
      a.capability.localeCompare(b.capability) ||
      a.evidence.localeCompare(b.evidence),
  )
}

/**
 * Map imports plus language-level uses to a de-duplicated capability list.
 * Order follows the first observation in source order.
 *
 * @param {ImportRef[]|string} [imports]
 * @param {string} [code]
 * @returns {string[]}
 */
export function mapCapabilities(imports = [], code = '') {
  if (typeof imports === 'string') {
    code = imports
    imports = extractImports(code)
  }

  const source = typeof code === 'string' ? code : ''
  const importList = Array.isArray(imports) ? imports : extractImports(source)
  const evidence = collectCapabilityEvidence(source, importList)
  /** @type {string[]} */
  const capabilities = []
  for (const item of evidence) {
    if (!capabilities.includes(item.capability)) capabilities.push(item.capability)
  }
  return capabilities
}

/**
 * Normalise a declared capability token. Unknown custom names are preserved
 * (lower-cased, whitespace/underscores collapsed) so callers can still diff
 * vendor-specific declarations.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeCapability(value) {
  if (typeof value !== 'string') return null
  const lower = value.trim().toLowerCase()
  if (!lower) return null

  // Check exact specifiers first so keys containing underscores
  // (e.g. node:child_process) are not mangled by separator normalisation.
  if (Object.hasOwn(CAPABILITY_MAP, lower)) {
    const mapped = CAPABILITY_MAP[lower]
    if (CANONICAL_CAPABILITIES.has(mapped)) return mapped
  }

  const name = lower.replace(/[\s_]+/g, '-')
  if (CANONICAL_CAPABILITIES.has(name)) return name
  if (Object.hasOwn(DECLARATION_ALIASES, name)) return DECLARATION_ALIASES[name]
  if (Object.hasOwn(CAPABILITY_MAP, name)) {
    const mapped = CAPABILITY_MAP[name]
    if (CANONICAL_CAPABILITIES.has(mapped)) return mapped
  }
  return name
}

/**
 * Parse a plugin manifest into a canonical capability array.
 *
 * Accepts both forms:
 *   { dsh: { capabilities: ['filesystem', 'network'] } }
 *   { dsh: { capabilities: { filesystem: true, network: false } } }
 *
 * Array entries may be strings or objects with `capability`/`name`/`id`/`type`.
 * `manifest.capabilities` and a bare array are accepted as conveniences.
 *
 * @param {unknown} manifest
 * @returns {string[]} normalised, de-duplicated, declaration order preserved
 */
export function parseDeclared(manifest) {
  if (manifest == null) return []

  /** @type {unknown} */
  let raw
  if (Array.isArray(manifest)) {
    raw = manifest
  } else if (typeof manifest === 'object') {
    const record = /** @type {Record<string, unknown>} */ (manifest)
    const dsh = record.dsh
    if (
      dsh &&
      typeof dsh === 'object' &&
      !Array.isArray(dsh) &&
      Object.hasOwn(/** @type {object} */ (dsh), 'capabilities')
    ) {
      raw = /** @type {Record<string, unknown>} */ (dsh).capabilities
    } else if (Object.hasOwn(record, 'capabilities')) {
      raw = record.capabilities
    }
  }

  if (raw == null) return []

  /** @type {string[]} */
  const tokens = []
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry === 'string') {
        tokens.push(entry)
      } else if (entry && typeof entry === 'object') {
        const named = ['capability', 'name', 'id', 'type']
          .map((key) => /** @type {Record<string, unknown>} */ (entry)[key])
          .find((value) => typeof value === 'string')
        if (typeof named === 'string') {
          tokens.push(named)
        }
      }
    }
  } else if (typeof raw === 'string') {
    tokens.push(...raw.split(','))
  } else if (typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) {
      if (!value) continue
      if (typeof value === 'string' && /^(?:false|no|off|none)$/i.test(value.trim())) continue
      tokens.push(key)
    }
  }

  /** @type {string[]} */
  const declared = []
  for (const token of tokens) {
    const name = normalizeCapability(token)
    if (name && !declared.includes(name)) declared.push(name)
  }
  return declared
}

/**
 * Normalise a list of capability values (strings or declaration objects).
 *
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeCapabilityList(value) {
  /** @type {unknown[]} */
  let list
  if (Array.isArray(value)) list = value
  else if (value instanceof Set) list = [...value]
  else if (typeof value === 'string') list = [value]
  else list = []

  /** @type {string[]} */
  const normalized = []
  for (const entry of list) {
    const raw =
      typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object'
          ? (/** @type {Record<string, unknown>} */ (entry).capability ??
            /** @type {Record<string, unknown>} */ (entry).name)
          : null
    const name = normalizeCapability(raw)
    if (name && !normalized.includes(name)) normalized.push(name)
  }
  return normalized
}

/**
 * Set-diff declarations against statically visible capabilities.
 *
 * @param {unknown} declared
 * @param {unknown} actual
 * @returns {CapabilityDiff}
 */
export function diffCapabilities(declared, actual) {
  const declaredList = normalizeCapabilityList(declared)
  const actualList = normalizeCapabilityList(actual)
  const declaredSet = new Set(declaredList)
  const actualSet = new Set(actualList)

  return {
    matched: declaredList.filter((capability) => actualSet.has(capability)),
    undeclared: actualList.filter((capability) => !declaredSet.has(capability)),
    unused: declaredList.filter((capability) => !actualSet.has(capability)),
  }
}

/**
 * Turn a capability diff into SARIF-friendly findings. Undeclared findings get
 * the first evidence location when available; unused findings point at the
 * manifest (or target) when known.
 *
 * @param {CapabilityDiff} diff
 * @param {Record<string, CapabilityEvidence & { file?: string }>|Map<string, CapabilityEvidence & { file?: string }>} [firstEvidence]
 * @param {{ manifestFile?: string, target?: string }} [options]
 * @returns {Array<{ kind: 'undeclared'|'unused', capability: string, message: string, file?: string, line?: number, evidence?: string }>}
 */
export function buildFindings(diff, firstEvidence = {}, options = {}) {
  if (!diff || typeof diff !== 'object') return []
  const opts = options && typeof options === 'object' ? options : {}
  const lookup =
    firstEvidence instanceof Map
      ? (capability) => firstEvidence.get(capability)
      : (capability) =>
          firstEvidence && typeof firstEvidence === 'object'
            ? firstEvidence[capability]
            : undefined

  /** @type {Array<{ kind: 'undeclared'|'unused', capability: string, message: string, file?: string, line?: number, evidence?: string }>} */
  const findings = []

  for (const capability of Array.isArray(diff.undeclared) ? diff.undeclared : []) {
    const evidence = lookup(capability)
    /** @type {{ kind: 'undeclared', capability: string, message: string, file?: string, line?: number, evidence?: string }} */
    const finding = {
      kind: 'undeclared',
      capability,
      message: `Capability "${capability}" is used in code but is not declared in dsh.capabilities.`,
    }
    const file = evidence?.file ?? opts.target
    if (file) finding.file = file
    if (Number.isInteger(evidence?.line)) finding.line = evidence.line
    if (evidence?.evidence) finding.evidence = evidence.evidence
    if (file && Number.isInteger(evidence?.line)) {
      finding.message = `Capability "${capability}" is used in code (${evidence?.evidence}) at ${file}:${evidence.line} but is not declared in dsh.capabilities.`
    }
    findings.push(finding)
  }

  for (const capability of Array.isArray(diff.unused) ? diff.unused : []) {
    /** @type {{ kind: 'unused', capability: string, message: string, file?: string }} */
    const finding = {
      kind: 'unused',
      capability,
      message: `Capability "${capability}" is declared in dsh.capabilities but is not statically visible in the scanned files.`,
    }
    const file = opts.manifestFile ?? opts.target
    if (file) finding.file = file
    findings.push(finding)
  }

  return findings
}

const SARIF_SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json'
const HELP_URI = 'https://github.com/PerryLink/dsh-next-suite/tree/main/packages/dsh-capdiff#limitations'

/**
 * @param {'undeclared'|'unused'} kind
 * @returns {Record<string, unknown>}
 */
function sarifRule(kind) {
  const unused = kind === 'unused'
  return {
    id: `dsh-capdiff/${kind}`,
    name: unused ? 'UnusedCapabilityDeclaration' : 'UndeclaredCapability',
    shortDescription: {
      text: unused
        ? 'Capability declared but not statically visible'
        : 'Capability used in code but not declared',
    },
    fullDescription: {
      text: unused
        ? 'The manifest declares this capability, but the scanner found no import or language-level use in the scanned files. This is a review hint, not a security verdict.'
        : 'The scanner found a statically visible use of this capability, but the manifest does not declare it. Static heuristics can produce false positives.',
    },
    defaultConfiguration: { level: unused ? 'note' : 'warning' },
    helpUri: HELP_URI,
  }
}

/**
 * @param {unknown} input
 * @returns {unknown[]}
 */
function normalizeFindingsInput(input) {
  if (Array.isArray(input)) return input
  if (input && typeof input === 'object') {
    const record = /** @type {Record<string, unknown>} */ (input)
    if (Array.isArray(record.findings)) return record.findings
    if (Array.isArray(record.undeclared) || Array.isArray(record.unused)) {
      return [
        ...(Array.isArray(record.undeclared)
          ? record.undeclared.map((capability) => ({ kind: 'undeclared', capability }))
          : []),
        ...(Array.isArray(record.unused)
          ? record.unused.map((capability) => ({ kind: 'unused', capability }))
          : []),
      ]
    }
  }
  return []
}

/**
 * @param {string} file
 * @returns {string}
 */
function sarifUri(file) {
  const normalized = String(file).replace(/\\/g, '/')
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) return normalized
  return encodeURI(normalized)
}

/**
 * Build a minimal SARIF 2.1.0 log. SARIF treats unknown `ruleId`s as errors in
 * some consumers, so only the two rule kinds emitted here are declared.
 *
 * Findings may also be a raw diff object (`{undeclared, unused}`), which is a
 * convenience for scripted callers.
 *
 * @param {unknown} findings
 * @param {{ file?: string, toolVersion?: string }} [options]
 * @returns {Record<string, unknown>}
 */
export function toSarif(findings, options = {}) {
  const opts = options && typeof options === 'object' ? options : {}
  const fallbackFile = typeof opts.file === 'string' && opts.file ? opts.file : undefined

  /** @type {Record<string, unknown>[]} */
  const rules = []
  /** @type {Map<string, number>} */
  const ruleIndexByKind = new Map()
  /** @type {Record<string, unknown>[]} */
  const results = []

  for (const raw of normalizeFindingsInput(findings)) {
    if (!raw) continue
    const finding =
      typeof raw === 'string'
        ? { kind: 'undeclared', capability: raw }
        : typeof raw === 'object'
          ? /** @type {Record<string, unknown>} */ (raw)
          : null
    if (!finding) continue

    const kind = finding.kind === 'unused' ? 'unused' : 'undeclared'
    const capability =
      typeof finding.capability === 'string'
        ? finding.capability
        : typeof finding.name === 'string'
          ? finding.name
          : 'unknown'

    if (!ruleIndexByKind.has(kind)) {
      ruleIndexByKind.set(kind, rules.length)
      rules.push(sarifRule(kind))
    }

    const message =
      typeof finding.message === 'string' && finding.message.trim()
        ? finding.message
        : kind === 'unused'
          ? `Capability "${capability}" is declared but not statically visible in scanned code.`
          : `Capability "${capability}" is used in code but not declared in dsh.capabilities.`

    /** @type {Record<string, unknown>} */
    const result = {
      ruleId: `dsh-capdiff/${kind}`,
      ruleIndex: ruleIndexByKind.get(kind),
      level: kind === 'unused' ? 'note' : 'warning',
      message: { text: message },
      properties: { capability, kind },
    }

    const file =
      typeof finding.file === 'string' && finding.file ? finding.file : fallbackFile
    if (file) {
      /** @type {Record<string, unknown>} */
      const physicalLocation = {
        artifactLocation: { uri: sarifUri(file) },
      }
      if (
        typeof finding.line === 'number' &&
        Number.isInteger(finding.line) &&
        finding.line > 0
      ) {
        physicalLocation.region = { startLine: finding.line }
      }
      result.locations = [{ physicalLocation }]
    }

    results.push(result)
  }

  return {
    $schema: SARIF_SCHEMA,
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: TOOL_NAME,
            version:
              typeof opts.toolVersion === 'string' && opts.toolVersion
                ? opts.toolVersion
                : TOOL_VERSION,
            informationUri: HELP_URI,
            rules,
          },
        },
        results,
      },
    ],
  }
}

/**
 * Analyze one source string. Convenience wrapper around extraction + mapping
 * that keeps the evidence (line, trigger) for reporting.
 *
 * @param {string} code
 * @param {string|null} [file]
 * @returns {{ file: string|null, imports: ImportRef[], capabilities: string[], observations: CapabilityEvidence[] }}
 */
export function analyzeSource(code, file = null) {
  const source = typeof code === 'string' ? code : ''
  const imports = extractImports(source)
  const observations = collectCapabilityEvidence(source, imports)
  /** @type {string[]} */
  const capabilities = []
  for (const observation of observations) {
    if (!capabilities.includes(observation.capability)) {
      capabilities.push(observation.capability)
    }
  }
  return { file: file ?? null, imports, capabilities, observations }
}

/**
 * Recursively collect `.js` / `.mjs` / `.cjs` files. `node_modules` and `.git`
 * directories are skipped; symlinks are not followed. Results are sorted.
 *
 * @param {string} target file or directory
 * @returns {Promise<string[]>} absolute paths
 */
export async function collectSourceFiles(target) {
  const root = resolve(String(target))
  const info = await stat(root)

  if (info.isFile()) return isSourceFile(root) ? [root] : []
  if (!info.isDirectory()) return []

  /** @type {string[]} */
  const files = []

  /**
   * @param {string} directory
   * @returns {Promise<void>}
   */
  const walk = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name.toLowerCase())) continue
        await walk(join(directory, entry.name))
      } else if (entry.isFile() && isSourceFile(entry.name)) {
        files.push(join(directory, entry.name))
      }
    }
  }

  await walk(root)
  return files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * Scan a file or directory and aggregate capabilities across all files.
 *
 * @param {string} target
 * @returns {Promise<{
 *   target: string,
 *   root: string,
 *   files: Array<{ file: string|null, absolutePath: string, imports: ImportRef[], capabilities: string[], observations: CapabilityEvidence[] }>,
 *   capabilities: string[],
 *   firstEvidence: Record<string, CapabilityEvidence & { file: string|null }>
 * }>}
 */
export async function scanTarget(target) {
  const resolvedTarget = resolve(String(target))
  const info = await stat(resolvedTarget)
  const root = info.isDirectory() ? resolvedTarget : dirname(resolvedTarget)
  const paths = await collectSourceFiles(resolvedTarget)

  /** @type {Array<{ file: string|null, absolutePath: string, imports: ImportRef[], capabilities: string[], observations: CapabilityEvidence[] }>} */
  const files = []
  /** @type {string[]} */
  const capabilities = []
  /** @type {Record<string, CapabilityEvidence & { file: string|null }>} */
  const firstEvidence = Object.create(null)

  for (const absolutePath of paths) {
    const code = await readFile(absolutePath, 'utf8')
    const relativePath = relative(root, absolutePath) || basename(absolutePath)
    const analysis = analyzeSource(code, relativePath)
    files.push({ ...analysis, absolutePath })

    for (const observation of analysis.observations) {
      if (!capabilities.includes(observation.capability)) {
        capabilities.push(observation.capability)
      }
      if (!firstEvidence[observation.capability]) {
        firstEvidence[observation.capability] = { ...observation, file: relativePath }
      }
    }
  }

  return { target: resolvedTarget, root, files, capabilities, firstEvidence }
}
