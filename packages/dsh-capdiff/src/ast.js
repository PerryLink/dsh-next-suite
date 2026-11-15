/**
 * Optional ESTree analysis for dsh-capdiff.
 *
 * Acorn is loaded synchronously with `createRequire` for two reasons:
 *   1. `analyzeSource()` is a synchronous public API and must stay that way;
 *   2. a missing acorn installation degrades to the regex fallback instead of
 *      making `import 'dsh-capdiff'` fail at module-load time.
 *
 * This is still a heuristic scanner. The AST path understands common ESM/CJS
 * syntax and removes several regex false positives, but it does not implement
 * scope/binding resolution and does not parse TypeScript, JSX or obfuscated
 * code. See README.md and DESIGN.md.
 *
 * @module dsh-capdiff/ast
 */

import { createRequire } from 'node:module'

import { capabilityForSpecifier } from './capability.js'

const require = createRequire(import.meta.url)

/** @type {typeof import('acorn')|null} */
let acorn = null
/** @type {Error|null} */
let acornLoadError = null

try {
  acorn = require('acorn')
} catch (error) {
  acornLoadError = error instanceof Error ? error : new Error(String(error))
}

/** Whether the optional acorn dependency was found at module-load time. */
export const AST_AVAILABLE = acorn !== null

const MODULE_PARSE_OPTIONS = Object.freeze({
  ecmaVersion: 'latest',
  sourceType: 'module',
  allowHashBang: true,
  allowReturnOutsideFunction: true,
  locations: true,
})

// ESM is tried first; the script retry keeps CommonJS files that use sloppy-only
// syntax (for example `with` or legacy octal literals) on the AST path.
const SCRIPT_PARSE_OPTIONS = Object.freeze({
  ...MODULE_PARSE_OPTIONS,
  sourceType: 'script',
})

/** @typedef {{ specifier: string, kind: 'static'|'dynamic'|'require'|'re-export', index: number }} AstImportRef */
/** @typedef {{ capability: string, origin: 'import'|'code', kind: string, specifier: string|null, evidence: string, index: number, line: number }} AstEvidence */
/** @typedef {{ message: string, filename: string|null, line: number|null, column: number|null }} AstParseError */

/**
 * @typedef {object} AstAnalysis
 * @property {AstImportRef[]} imports statically visible module references
 * @property {string[]} capabilities de-duplicated capabilities, first use order
 * @property {boolean} dynamic whether runtime module loading is present (any
 *   `import(...)`, or a `require()` call with a computed argument)
 * @property {AstEvidence[]} observations per-evidence detail (extra field used
 *   by `core.analyzeSource`; the four fields above are the public contract)
 * @property {AstParseError} [parseError] present only when parsing failed
 */

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNode(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (/** @type {{ type?: unknown }} */ (value).type) === 'string' &&
    typeof (/** @type {{ start?: unknown }} */ (value).start) === 'number'
  )
}

/**
 * Depth-first traversal without recursion, so deeply nested input cannot blow
 * the call stack. Source order is restored when observations are sorted.
 *
 * @param {import('acorn').Node} root
 * @param {(node: import('acorn').Node) => void} visit
 */
function walk(root, visit) {
  const stack = [root]
  while (stack.length > 0) {
    const node = /** @type {import('acorn').Node} */ (stack.pop())
    visit(node)
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'range') continue
      const value = /** @type {Record<string, unknown>} */ (node)[key]
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index -= 1) {
          if (isNode(value[index])) stack.push(/** @type {import('acorn').Node} */ (value[index]))
        }
      } else if (isNode(value)) {
        stack.push(/** @type {import('acorn').Node} */ (value))
      }
    }
  }
}

/**
 * Resolve a literal / expression-free template string. Anything computed stays
 * `null`: the scanner reports it through `dynamic` instead of guessing.
 *
 * @param {import('acorn').Node|null|undefined} node
 * @returns {string|null}
 */
function staticString(node) {
  if (!node) return null
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0 && node.quasis.length === 1) {
    const value = node.quasis[0].value
    return value.cooked ?? value.raw
  }
  return null
}

/**
 * @param {import('acorn').Node|null|undefined} node
 * @returns {string|null}
 */
function identifierName(node) {
  return node && node.type === 'Identifier' ? node.name : null
}

/**
 * @param {import('acorn').Node} member
 * @returns {string|null}
 */
function propertyName(member) {
  if (member.type !== 'MemberExpression') return null
  if (!member.computed && member.property.type === 'Identifier') return member.property.name
  return staticString(member.property)
}

/**
 * @param {import('acorn').SourceLocation} loc
 * @returns {number}
 */
function lineOf(loc) {
  return loc && loc.start ? loc.start.line : 1
}

/**
 * @typedef {object} AnalysisState
 * @property {AstImportRef[]} imports
 * @property {AstEvidence[]} observations
 * @property {Set<string>} importKeys
 * @property {Set<string>} evidenceKeys
 * @property {boolean} dynamic
 */

/**
 * @param {AnalysisState} state
 * @param {string} specifier
 * @param {AstImportRef['kind']} kind
 * @param {import('acorn').Node} node
 */
function addImport(state, specifier, kind, node) {
  const index = Number.isInteger(node.start) ? node.start : 0
  const key = `${index}:${kind}:${specifier}`
  if (state.importKeys.has(key)) return
  state.importKeys.add(key)
  state.imports.push({ specifier, kind, index })
  state.observations.push({
    capability: capabilityForSpecifier(specifier),
    origin: 'import',
    kind,
    specifier,
    evidence: specifier,
    index,
    line: lineOf(node.loc),
  })
}

/**
 * @param {AnalysisState} state
 * @param {import('acorn').Node} node
 * @param {string} capability
 * @param {string} evidence
 */
function addCodeEvidence(state, node, capability, evidence) {
  const index = Number.isInteger(node.start) ? node.start : 0
  const key = `${index}:${capability}:${evidence}`
  if (state.evidenceKeys.has(key)) return
  state.evidenceKeys.add(key)
  state.observations.push({
    capability,
    origin: 'code',
    kind: 'usage',
    specifier: null,
    evidence,
    index,
    line: lineOf(node.loc),
  })
}

/**
 * @param {AnalysisState} state
 * @param {string} objectName
 * @param {import('acorn').Node} node
 * @param {string|null} property
 */
function addMemberCapability(state, objectName, node, property) {
  const suffix = property === null ? '[...]' : `.${property}`
  addCodeEvidence(
    state,
    node,
    objectName === 'fs' ? 'filesystem' : 'process',
    `${objectName}${suffix}`,
  )
}

/**
 * @param {import('acorn').Node} node
 * @param {AnalysisState} state
 */
function visitNode(node, state) {
  switch (node.type) {
    case 'ImportDeclaration': {
      const specifier = staticString(node.source)
      if (specifier !== null) addImport(state, specifier, 'static', node)
      break
    }

    case 'ExportNamedDeclaration':
    case 'ExportAllDeclaration': {
      if (!node.source) break
      const specifier = staticString(node.source)
      if (specifier !== null) addImport(state, specifier, 're-export', node)
      break
    }

    case 'ImportExpression': {
      // Any import() is runtime loading; a non-literal argument is additionally
      // unresolvable and only reported through `dynamic`.
      state.dynamic = true
      const specifier = staticString(node.source)
      if (specifier !== null) addImport(state, specifier, 'dynamic', node)
      break
    }

    case 'CallExpression': {
      const callee = node.callee
      const calleeName = identifierName(callee)
      if (calleeName === 'require') {
        const specifier = staticString(node.arguments[0])
        if (specifier !== null) {
          addImport(state, specifier, 'require', node)
        } else {
          state.dynamic = true
        }
        break
      }
      if (calleeName === 'eval') {
        addCodeEvidence(state, node, 'eval', 'eval()')
        break
      }
      if (calleeName === 'fetch') {
        addCodeEvidence(state, node, 'network', 'fetch()')
        break
      }
      if (callee && callee.type === 'MemberExpression') {
        const objectName = identifierName(callee.object)
        const property = propertyName(callee)
        if ((objectName === 'http' || objectName === 'https') && property === 'request') {
          addCodeEvidence(state, node, 'network', `${objectName}.request()`)
        }
      }
      break
    }

    case 'NewExpression': {
      if (identifierName(node.callee) === 'Function') {
        addCodeEvidence(state, node, 'eval', 'new Function()')
      }
      break
    }

    case 'MemberExpression': {
      const objectName = identifierName(node.object)
      if (objectName === 'process') {
        const property = propertyName(node)
        if (property === 'env') {
          const evidence = node.computed ? "process['env']" : 'process.env'
          addCodeEvidence(state, node, 'env', evidence)
        }
        break
      }
      if (objectName === 'fs' || objectName === 'child_process') {
        addMemberCapability(state, objectName, node, propertyName(node))
      }
      break
    }

    default:
      break
  }
}

/**
 * @param {string} source
 * @returns {{ ast: import('acorn').Program, error?: never }|{ ast?: never, error: Error }}
 */
function parseSource(source) {
  if (!acorn) throw new Error('acorn is not available')
  /** @type {Error|null} */
  let moduleError = null
  try {
    return { ast: acorn.parse(source, MODULE_PARSE_OPTIONS) }
  } catch (error) {
    moduleError = error instanceof Error ? error : new Error(String(error))
  }
  try {
    return { ast: acorn.parse(source, SCRIPT_PARSE_OPTIONS) }
  } catch {
    return { error: moduleError }
  }
}

/**
 * @param {Error} error
 * @param {string|null} filename
 * @returns {AstParseError}
 */
function toParseError(error, filename) {
  const located = /** @type {Error & { loc?: { line: number, column: number } }} */ (error)
  return {
    message: located.message,
    filename,
    line: located.loc && Number.isInteger(located.loc.line) ? located.loc.line : null,
    column:
      located.loc && Number.isInteger(located.loc.column) ? located.loc.column + 1 : null,
  }
}

/**
 * Parse and analyze one JavaScript source string with acorn.
 *
 * Recognised constructs:
 * - `import ... from 'm'` / `import 'm'` -> `static`
 * - `export ... from 'm'` / `export * from 'm'` -> `re-export`
 * - `import('m')` -> `dynamic` (string/template literals only)
 * - `require('m')` -> `require` (string/template literals only)
 * - `process.env` / `process['env']` -> `env`
 * - `fs.*` / `child_process.*` -> `filesystem` / `process`
 * - `eval(...)` / `new Function(...)` -> `eval`
 * - `fetch(...)` / `http.request(...)` / `https.request(...)` -> `network`
 *
 * Computed `import()`/`require()` arguments are not guessed; they set
 * `dynamic: true`. On any parse failure (TypeScript, JSX, genuinely broken
 * source) the result carries `parseError` and `core.analyzeSource` falls back
 * to the regex scanner.
 *
 * @param {string} code
 * @param {{ filename?: string }} [options]
 * @returns {AstAnalysis}
 */
export function analyzeAst(code, options = {}) {
  const source = typeof code === 'string' ? code : String(code ?? '')
  const filename =
    options && typeof options.filename === 'string' && options.filename ? options.filename : null

  if (!acorn) {
    return {
      imports: [],
      capabilities: [],
      dynamic: false,
      observations: [],
      parseError: {
        message: `acorn is not installed${acornLoadError ? ` (${acornLoadError.message})` : ''}`,
        filename,
        line: null,
        column: null,
      },
    }
  }

  const parsed = parseSource(source)
  if (parsed.error) {
    return {
      imports: [],
      capabilities: [],
      dynamic: false,
      observations: [],
      parseError: toParseError(parsed.error, filename),
    }
  }

  /** @type {AnalysisState} */
  const state = {
    imports: [],
    observations: [],
    importKeys: new Set(),
    evidenceKeys: new Set(),
    dynamic: false,
  }

  walk(parsed.ast, (node) => visitNode(node, state))

  state.imports.sort(
    (left, right) =>
      left.index - right.index ||
      left.kind.localeCompare(right.kind) ||
      left.specifier.localeCompare(right.specifier),
  )
  state.observations.sort(
    (left, right) =>
      left.index - right.index ||
      left.capability.localeCompare(right.capability) ||
      left.evidence.localeCompare(right.evidence),
  )

  /** @type {string[]} */
  const capabilities = []
  for (const observation of state.observations) {
    if (!capabilities.includes(observation.capability)) {
      capabilities.push(observation.capability)
    }
  }

  return {
    imports: state.imports,
    capabilities,
    dynamic: state.dynamic,
    observations: state.observations,
  }
}
