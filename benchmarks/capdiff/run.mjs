#!/usr/bin/env node
/**
 * dsh-capdiff benchmark runner.
 *
 * Runs two corpora through the package core (scanTarget, parseDeclared,
 * diffCapabilities, buildFindings) and writes results.json + RESULTS.md:
 *
 *   - synthetic: the original 17 hand-written fixtures under ./fixtures/<id>/
 *   - real:      17 verbatim excerpts under ./fixtures/real/<id>/ taken from
 *                the 14 packages in this workspace and two deepseek-harness
 *                docs examples
 *
 * The real corpus scores canonical capabilities only. The scanner's `unknown`
 * fallback (unmapped imports: node:path, node:util, relative modules,
 * third-party packages) is reported separately and is NOT counted as a false
 * positive, because the tool itself documents `unknown` as a fallback bucket
 * rather than a capability. The synthetic corpus keeps its historical
 * convention, where fixture 13's `unknown` is scored as a false positive, so
 * its numbers stay comparable with earlier runs.
 *
 * Usage:
 *   node benchmarks/capdiff/run.mjs
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  TOOL_NAME,
  TOOL_VERSION,
  buildFindings,
  diffCapabilities,
  parseDeclared,
  scanTarget,
} from '../../packages/dsh-capdiff/src/core.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_ROOT = join(HERE, 'fixtures')
const REAL_ROOT = join(FIXTURE_ROOT, 'real')
const PACKAGE_JSON = join(HERE, '..', '..', 'packages', 'dsh-capdiff', 'package.json')
const OUT_JSON = join(HERE, 'results.json')
const OUT_MD = join(HERE, 'RESULTS.md')

const CANONICAL = new Set(['filesystem', 'network', 'process', 'env', 'eval', 'crypto'])
const MIN_SYNTHETIC = 12
const MIN_REAL = 15
const MAX_REAL = 20
const MAX_REAL_SOURCE_LINES = 160
const ALLOWED_LICENSES = new Set(['Apache-2.0', 'MIT'])
const REPO_LICENSES = {
  'dsh-next-suite': 'Apache-2.0',
  'dsh-os-suite': 'Apache-2.0',
  'deepseek-harness': 'MIT',
}

const SYNTHETIC_DISCLAIMER =
  'Synthetic, curated fixtures only. These numbers describe this corpus, not all ' +
  'plugins or the wider npm ecosystem. A passing fixture is not evidence that a ' +
  'plugin is safe; the scanner reports statically visible evidence, never runtime ' +
  'capability.'

const REAL_DISCLAIMER =
  'Real code excerpts, but a small hand-selected corpus. The excerpts are ' +
  'verbatim (trimmed at statement boundaries) except for two docs examples whose ' +
  'TypeScript annotations were stripped. The capability declarations in the ' +
  'fixture manifests are authored for the benchmark: the upstream packages do ' +
  'not declare dsh.capabilities. Rates describe this corpus only; a match is not ' +
  'a safety verdict.'

const COMBINED_DISCLAIMER =
  'Two curated corpora: 17 synthetic fixtures and 17 real excerpts. These numbers ' +
  'describe these corpora, not all plugins or the wider npm ecosystem. A passing ' +
  'fixture is not evidence that a plugin is safe; the scanner reports statically ' +
  'visible evidence, never runtime capability.'

/** @param {string[]} values */
const sortedUnique = (values) => [...new Set(values)].sort()

/**
 * @param {string[]} left
 * @param {string[]} right
 */
const minus = (left, right) => {
  const excluded = new Set(right)
  return left.filter((value) => !excluded.has(value))
}

/**
 * Precision / recall / F1 for one confusion-matrix view.
 *
 * Null rates mean "undefined" (no predicted or no actual positives), not zero.
 *
 * @param {number} tp
 * @param {number} fp
 * @param {number} fn
 */
function rates(tp, fp, fn) {
  const precision = tp + fp === 0 ? null : tp / (tp + fp)
  const recall = tp + fn === 0 ? null : tp / (tp + fn)
  const f1 =
    precision === null || recall === null
      ? null
      : precision + recall === 0
        ? 0
        : (2 * precision * recall) / (precision + recall)
  return {
    tp,
    fp,
    fn,
    precision: precision === null ? null : Number(precision.toFixed(6)),
    recall: recall === null ? null : Number(recall.toFixed(6)),
    f1: f1 === null ? null : Number(f1.toFixed(6)),
  }
}

/**
 * Set-level confusion matrix, optionally keyed by a composite key.
 *
 * @template T
 * @param {T[]} truth
 * @param {T[]} predicted
 * @param {(value: T) => string} keyOf
 */
function setRates(truth, predicted, keyOf) {
  const truthKeys = new Set(truth.map(keyOf))
  const predictedKeys = new Set(predicted.map(keyOf))
  let tp = 0
  let fp = 0
  let fn = 0
  for (const key of predictedKeys) {
    if (truthKeys.has(key)) tp += 1
    else fp += 1
  }
  for (const key of truthKeys) {
    if (!predictedKeys.has(key)) fn += 1
  }
  return rates(tp, fp, fn)
}

/**
 * @param {Array<ReturnType<typeof rates>>} list
 */
function combine(list) {
  return rates(
    list.reduce((sum, item) => sum + item.tp, 0),
    list.reduce((sum, item) => sum + item.fp, 0),
    list.reduce((sum, item) => sum + item.fn, 0),
  )
}

/**
 * @param {import('../../packages/dsh-capdiff/src/core.js').CapabilityEvidence & { file?: string }} evidence
 */
function evidenceSummary(evidence) {
  if (!evidence) return null
  return {
    file: evidence.file ?? null,
    line: evidence.line ?? null,
    origin: evidence.origin,
    kind: evidence.kind,
    specifier: evidence.specifier,
    evidence: evidence.evidence,
  }
}

/**
 * @param {number | null} value
 */
const pct = (value) => (value === null ? 'n/a' : `${(value * 100).toFixed(2)}%`)

/**
 * @param {string[]} values
 */
const codeList = (values) =>
  values.length === 0 ? '—' : values.map((value) => `\`${value}\``).join(', ')

/**
 * @param {string} value
 */
const cell = (value) => String(value).replace(/\|/g, '\\|')

/**
 * @param {ReturnType<typeof rates>} result
 */
const metricRow = (result) =>
  `| ${result.tp} | ${result.fp} | ${result.fn} | ${pct(result.precision)} | ${pct(result.recall)} | ${pct(result.f1)} |`

/**
 * @param {string} path
 * @returns {Promise<string[]>}
 */
async function directoryIds(path) {
  const entries = await readdir(path, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

/**
 * @param {Record<string, any>} source
 * @param {string} id
 */
function validateSource(source, id) {
  if (!source || typeof source !== 'object') {
    throw new Error(`real fixture ${id}: expected.json is missing a source object`)
  }
  for (const field of ['repo', 'path', 'lines', 'license', 'url', 'transformation']) {
    if (typeof source[field] !== 'string' || source[field].trim() === '') {
      throw new Error(`real fixture ${id}: source.${field} must be a non-empty string`)
    }
  }
  if (!ALLOWED_LICENSES.has(source.license)) {
    throw new Error(
      `real fixture ${id}: license "${source.license}" is not in the allowed set (${[...ALLOWED_LICENSES].join(', ')})`,
    )
  }
  const expectedLicense = REPO_LICENSES[source.repo]
  if (!expectedLicense) {
    throw new Error(`real fixture ${id}: unknown source repo "${source.repo}"`)
  }
  if (source.license !== expectedLicense) {
    throw new Error(
      `real fixture ${id}: source.license is ${source.license}, expected ${expectedLicense} for ${source.repo}`,
    )
  }
  const range = /^(\d+)-(\d+)$/.exec(source.lines)
  if (!range) throw new Error(`real fixture ${id}: source.lines must be "start-end"`)
  const start = Number(range[1])
  const end = Number(range[2])
  if (end < start) throw new Error(`real fixture ${id}: source.lines is inverted`)
  if (end - start + 1 > MAX_REAL_SOURCE_LINES) {
    throw new Error(
      `real fixture ${id}: source.lines spans ${end - start + 1} lines, over the ${MAX_REAL_SOURCE_LINES}-line cap`,
    )
  }
}

/**
 * Evaluate every fixture in one corpus.
 *
 * @param {{
 *   corpus: 'synthetic'|'real',
 *   root: string,
 *   ids: string[],
 *   fixtureRoot: string,
 *   includeUnknown: boolean,
 * }} options
 */
async function evaluateCorpus(options) {
  const { corpus, root: scanRoot, ids, fixtureRoot: displayRoot, includeUnknown } = options
  const fixtures = []
  const falsePositives = []
  const falseNegatives = []

  for (const id of ids) {
    const fixtureDir = join(scanRoot, id)
    const expected = JSON.parse(await readFile(join(fixtureDir, 'expected.json'), 'utf8'))
    const manifest = JSON.parse(await readFile(join(fixtureDir, 'package.json'), 'utf8'))

    if (expected.id !== id) {
      throw new Error(`fixture ${id}: expected.json id is "${expected.id}"`)
    }

    const declared = sortedUnique(parseDeclared(manifest))
    const declaredTruth = sortedUnique(expected.declared ?? [])
    if (JSON.stringify(declared) !== JSON.stringify(declaredTruth)) {
      throw new Error(
        `${id}: manifest parses to ${JSON.stringify(declared)} but expected.json declares ${JSON.stringify(declaredTruth)}`,
      )
    }

    const actual = sortedUnique(expected.actual ?? [])
    const staticVisible = sortedUnique(expected.staticVisible ?? [])
    for (const capability of [...actual, ...staticVisible]) {
      if (!CANONICAL.has(capability)) {
        throw new Error(`${id}: non-canonical ground-truth capability "${capability}"`)
      }
    }
    if (minus(staticVisible, actual).length > 0) {
      throw new Error(`${id}: staticVisible must be a subset of actual`)
    }

    if (corpus === 'real') {
      validateSource(expected.source, id)
    }

    const scan = await scanTarget(fixtureDir)
    const rawDetected = sortedUnique(scan.capabilities)
    const detected = includeUnknown
      ? rawDetected
      : rawDetected.filter((capability) => CANONICAL.has(capability))
    const unmapped = includeUnknown
      ? []
      : rawDetected
          .filter((capability) => !CANONICAL.has(capability))
          .map((capability) => ({
            capability,
            evidence: evidenceSummary(scan.firstEvidence[capability]),
          }))

    const diff = diffCapabilities(declared, detected)
    const findings = buildFindings(diff, scan.firstEvidence, {
      manifestFile: 'package.json',
      target: `fixtures/${corpus === 'real' ? 'real/' : ''}${id}`,
    })

    const detection = setRates(actual, detected, (capability) => capability)
    const inScopeDetection = setRates(staticVisible, detected, (capability) => capability)
    const undeclaredTruth = minus(actual, declared)
    const undeclaredTool = minus(detected, declared)
    const unusedTruth = minus(declared, actual)
    const unusedTool = minus(declared, detected)
    const undeclaredFindings = setRates(
      undeclaredTruth,
      undeclaredTool,
      (capability) => `undeclared:${capability}`,
    )
    const unusedFindings = setRates(
      unusedTruth,
      unusedTool,
      (capability) => `unused:${capability}`,
    )
    const declarationFindings = combine([undeclaredFindings, unusedFindings])

    const fixture = {
      id,
      category: expected.category ?? 'uncategorised',
      description: expected.description ?? '',
      declared,
      expectedActual: actual,
      expectedStaticVisible: staticVisible,
      detected,
      rawDetected,
      unmapped,
      scannedFiles: scan.files.map((file) => file.file),
      diff: {
        matched: diff.matched,
        undeclared: diff.undeclared,
        unused: diff.unused,
      },
      toolFindings: findings,
      metrics: {
        detection,
        inScopeDetection,
        undeclaredFindings,
        unusedFindings,
        declarationFindings,
      },
      ok:
        detection.fp === 0 &&
        detection.fn === 0 &&
        declarationFindings.fp === 0 &&
        declarationFindings.fn === 0,
      notes: expected.notes ?? '',
      limitation: expected.limitation ?? null,
      source: expected.source ?? null,
    }
    fixtures.push(fixture)

    for (const capability of minus(detected, actual)) {
      falsePositives.push({
        layer: 'detection',
        fixture: id,
        capability,
        detail: `not in the fixture's ground-truth actual set`,
        evidence: evidenceSummary(scan.firstEvidence[capability]),
      })
    }
    for (const capability of minus(actual, detected)) {
      falseNegatives.push({
        layer: 'detection',
        fixture: id,
        capability,
        detail:
          expected.limitation ??
          `ground-truth capability "${capability}" is exercised by the fixture but was not detected`,
      })
    }

    const toolFindingKeys = new Set(
      findings.map((finding) => `${finding.kind}:${finding.capability}`),
    )
    for (const finding of findings) {
      const truth = finding.kind === 'unused' ? unusedTruth : undeclaredTruth
      if (!truth.includes(finding.capability)) {
        falsePositives.push({
          layer: 'declaration',
          fixture: id,
          kind: finding.kind,
          capability: finding.capability,
          detail: finding.message,
          file: finding.file ?? null,
          line: finding.line ?? null,
        })
      }
    }
    for (const capability of undeclaredTruth) {
      if (!toolFindingKeys.has(`undeclared:${capability}`)) {
        falseNegatives.push({
          layer: 'declaration',
          fixture: id,
          kind: 'undeclared',
          capability,
          detail:
            expected.limitation ??
            `ground-truth undeclared capability "${capability}" was not reported`,
        })
      }
    }
    for (const capability of unusedTruth) {
      if (!toolFindingKeys.has(`unused:${capability}`)) {
        falseNegatives.push({
          layer: 'declaration',
          fixture: id,
          kind: 'unused',
          capability,
          detail: `ground-truth unused declaration "${capability}" was not reported`,
        })
      }
    }
  }

  const totals = {
    detection: combine(fixtures.map((fixture) => fixture.metrics.detection)),
    inScopeDetection: combine(fixtures.map((fixture) => fixture.metrics.inScopeDetection)),
    undeclaredFindings: combine(fixtures.map((fixture) => fixture.metrics.undeclaredFindings)),
    unusedFindings: combine(fixtures.map((fixture) => fixture.metrics.unusedFindings)),
    declarationFindings: combine(fixtures.map((fixture) => fixture.metrics.declarationFindings)),
  }

  const sortByFixture = (left, right) =>
    left.fixture.localeCompare(right.fixture) ||
    (left.layer ?? '').localeCompare(right.layer ?? '') ||
    (left.kind ?? '').localeCompare(right.kind ?? '') ||
    (left.capability ?? '').localeCompare(right.capability ?? '')

  falsePositives.sort(sortByFixture)
  falseNegatives.sort(sortByFixture)

  const result = {
    corpus,
    fixtureRoot: displayRoot,
    fixtureCount: fixtures.length,
    includeUnknown,
    totals,
    fixtures,
    falsePositives,
    falseNegatives,
    disclaimer: corpus === 'real' ? REAL_DISCLAIMER : SYNTHETIC_DISCLAIMER,
  }

  if (corpus === 'real') {
    const unmappedFixtures = fixtures.filter((fixture) => fixture.unmapped.length > 0)
    result.unmapped = {
      fixtureCount: unmappedFixtures.length,
      totalFixtures: fixtures.length,
      fixtures: unmappedFixtures.map((fixture) => ({
        fixture: fixture.id,
        capabilities: fixture.unmapped.map((entry) => entry.capability),
        evidence: fixture.unmapped.map((entry) => entry.evidence),
      })),
    }
    result.unknownAsFalsePositive = rates(
      totals.detection.tp,
      unmappedFixtures.length,
      totals.detection.fn,
    )
    result.sources = {
      byRepo: Object.fromEntries(
        [...new Set(fixtures.map((fixture) => fixture.source.repo))].map((repo) => [
          repo,
          fixtures.filter((fixture) => fixture.source.repo === repo).length,
        ]),
      ),
      byLicense: Object.fromEntries(
        [...new Set(fixtures.map((fixture) => fixture.source.license))].map((license) => [
          license,
          fixtures.filter((fixture) => fixture.source.license === license).length,
        ]),
      ),
      fixtures: fixtures.map((fixture) => ({
        id: fixture.id,
        ...fixture.source,
      })),
    }
  }

  return result
}

async function main() {
  const syntheticIds = (await directoryIds(FIXTURE_ROOT)).filter((id) => id !== 'real')
  const realIds = await directoryIds(REAL_ROOT)

  if (syntheticIds.length < MIN_SYNTHETIC) {
    throw new Error(
      `expected at least ${MIN_SYNTHETIC} synthetic fixtures, found ${syntheticIds.length}`,
    )
  }
  if (realIds.length < MIN_REAL || realIds.length > MAX_REAL) {
    throw new Error(
      `expected ${MIN_REAL}-${MAX_REAL} real fixtures, found ${realIds.length}`,
    )
  }

  const toolPackage = JSON.parse(await readFile(PACKAGE_JSON, 'utf8'))

  const synthetic = await evaluateCorpus({
    corpus: 'synthetic',
    root: FIXTURE_ROOT,
    fixtureRoot: 'benchmarks/capdiff/fixtures',
    ids: syntheticIds,
    includeUnknown: true,
  })
  const real = await evaluateCorpus({
    corpus: 'real',
    root: REAL_ROOT,
    fixtureRoot: 'benchmarks/capdiff/fixtures/real',
    ids: realIds,
    includeUnknown: false,
  })

  const results = {
    benchmark: 'dsh-capdiff',
    description:
      'Declaration-vs-static-use benchmark over 17 synthetic DSH-style plugin fixtures and 17 real code excerpts (14 workspace packages + 2 DSH docs examples).',
    tool: {
      name: TOOL_NAME,
      coreVersion: TOOL_VERSION,
      packageVersion: toolPackage.version,
    },
    generatedAt: new Date().toISOString(),
    node: process.version,
    corpora: {
      synthetic,
      real,
    },
    disclaimer: COMBINED_DISCLAIMER,
  }

  await writeFile(OUT_JSON, `${JSON.stringify(results, null, 2)}\n`)
  await writeFile(OUT_MD, renderMarkdown(results))

  for (const corpus of [synthetic, real]) {
    const label = corpus.corpus
    console.log(
      `dsh-capdiff ${label}: ${corpus.fixtureCount} fixtures${label === 'real' ? ' (canonical capabilities only; unknown fallback excluded)' : ''}`,
    )
    console.log(
      `  detection: P ${pct(corpus.totals.detection.precision)} R ${pct(corpus.totals.detection.recall)} F1 ${pct(corpus.totals.detection.f1)} (TP ${corpus.totals.detection.tp}, FP ${corpus.totals.detection.fp}, FN ${corpus.totals.detection.fn})`,
    )
    console.log(
      `  in-scope:  P ${pct(corpus.totals.inScopeDetection.precision)} R ${pct(corpus.totals.inScopeDetection.recall)} F1 ${pct(corpus.totals.inScopeDetection.f1)}`,
    )
    console.log(
      `  declaration findings: P ${pct(corpus.totals.declarationFindings.precision)} R ${pct(corpus.totals.declarationFindings.recall)} F1 ${pct(corpus.totals.declarationFindings.f1)}`,
    )
    if (label === 'real') {
      console.log(
        `  unmapped imports (not scored): ${corpus.unmapped.fixtureCount}/${corpus.unmapped.totalFixtures} fixtures; if scored as FP, precision would be ${pct(corpus.unknownAsFalsePositive.precision)}`,
      )
    }
  }
  console.log(`wrote ${OUT_JSON}`)
  console.log(`wrote ${OUT_MD}`)
}

/**
 * @param {Record<string, any>} results
 */
function renderMarkdown(results) {
  const synthetic = results.corpora.synthetic
  const real = results.corpora.real
  const lines = []
  const push = (...values) => lines.push(...values)

  push(
    '# dsh-capdiff benchmark results',
    '',
    `Generated by \`benchmarks/capdiff/run.mjs\` at ${results.generatedAt} with Node ${results.node}.`,
    '',
    `Tool: \`${results.tool.name}\` core ${results.tool.coreVersion}, package ${results.tool.packageVersion}. ` +
      `${synthetic.fixtureCount} synthetic fixtures + ${real.fixtureCount} real excerpts.`,
    '',
    `> ${results.disclaimer}`,
    '',
    '## Summary: synthetic vs real',
    '',
    '| View | Synthetic precision | Synthetic recall | Synthetic F1 | Real precision | Real recall | Real F1 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  )

  const views = [
    ['Capability detection', 'detection'],
    ['In-scope detection', 'inScopeDetection'],
    ['Undeclared findings', 'undeclaredFindings'],
    ['Unused findings', 'unusedFindings'],
    ['All declaration findings', 'declarationFindings'],
  ]
  for (const [label, key] of views) {
    const left = synthetic.totals[key]
    const right = real.totals[key]
    push(
      `| ${label} | ${pct(left.precision)} | ${pct(left.recall)} | ${pct(left.f1)} | ${pct(right.precision)} | ${pct(right.recall)} | ${pct(right.f1)} |`,
    )
  }

  push(
    '',
    '### Confusion counts',
    '',
    '| View | Synthetic TP | Synthetic FP | Synthetic FN | Real TP | Real FP | Real FN |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  )
  for (const [label, key] of views) {
    const left = synthetic.totals[key]
    const right = real.totals[key]
    push(
      `| ${label} | ${left.tp} | ${left.fp} | ${left.fn} | ${right.tp} | ${right.fp} | ${right.fn} |`,
    )
  }

  push(
    '',
    'Real-corpus convention: only the six canonical capabilities are scored ' +
      `(${[...CANONICAL].map((value) => `\`${value}\``).join(', ')}). ` +
      'The scanner\'s `unknown` fallback is reported below and is not a false positive.',
    '',
    '## Real corpus',
    '',
    `${real.fixtureCount} excerpts: 15 package excerpts covering all 14 workspace packages (9 from dsh-next-suite, 6 from dsh-os-suite) ` +
      'plus 2 deepseek-harness docs examples. Code is verbatim except for trimming at statement ' +
      'boundaries; the two docs examples had TypeScript annotations stripped. Each copied file keeps a ' +
      'provenance header. The fixture manifests are authored for the benchmark because the upstream ' +
      'packages do not declare `dsh.capabilities`.',
    '',
    '### Sources and licenses',
    '',
    '| Fixture | Source | Lines | License | Transformation |',
    '| --- | --- | --- | --- | --- |',
  )

  for (const fixture of real.fixtures) {
    const source = fixture.source
    const label = `[${source.repo}: ${source.path}](${source.url})`
    push(
      `| \`${fixture.id}\` | ${cell(label)} | ${source.lines} | ${source.license} | ${cell(source.transformation)} |`,
    )
  }

  const repoSummary = Object.entries(real.sources.byRepo)
    .map(([repo, count]) => `${repo} ${count}`)
    .join(', ')
  const licenseSummary = Object.entries(real.sources.byLicense)
    .map(([license, count]) => `${license} ${count}`)
    .join(', ')
  push(
    '',
    `Repositories: ${repoSummary}. Licenses: ${licenseSummary}. Full attribution and license text pointers are in ` +
      '`benchmarks/capdiff/fixtures/real/SOURCES.md`.',
    '',
    '### Per-fixture results',
    '',
    '| Fixture | Category | Declared | Actual | Detected (scored) | Unmapped (ignored) | Tool findings | Detection TP/FP/FN | Declaration TP/FP/FN | Verdict |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  )

  for (const fixture of real.fixtures) {
    const findings = fixture.toolFindings
      .map((finding) => `${finding.kind}:${finding.capability}`)
      .join(', ')
    const unmapped = [...new Set(fixture.unmapped.map((entry) => entry.capability))]
    const verdict = fixture.ok ? 'match' : 'diff'
    push(
      `| \`${fixture.id}\` | ${cell(fixture.category)} | ${codeList(fixture.declared)} | ${codeList(fixture.expectedActual)} | ${codeList(fixture.detected)} | ${codeList(unmapped)} | ${findings ? codeList(findings.split(', ')) : '—'} | ${fixture.metrics.detection.tp}/${fixture.metrics.detection.fp}/${fixture.metrics.detection.fn} | ${fixture.metrics.declarationFindings.tp}/${fixture.metrics.declarationFindings.fp}/${fixture.metrics.declarationFindings.fn} | ${verdict} |`,
    )
  }

  push(
    '',
    '### Unmapped imports (not scored)',
    '',
    `${
      real.unmapped.fixtureCount
    } of ${real.unmapped.totalFixtures} real fixtures contain imports that the capability map does not classify. ` +
      'The raw scanner reports `unknown` and `undeclared:unknown` for them; canonical scoring ignores that fallback bucket. ' +
      `If it were scored as a false positive (the synthetic convention), real detection precision would be ` +
      `${pct(real.unknownAsFalsePositive.precision)} instead of ${pct(real.totals.detection.precision)}.`,
    '',
  )
  for (const entry of real.unmapped.fixtures) {
    const evidence = entry.evidence
      .map((item) => (item ? `\`${item.specifier ?? item.evidence}\` at ${item.file ?? '?'}:${item.line ?? '?'}` : 'unknown'))
      .join('; ')
    push(`- \`${entry.fixture}\`: ${evidence}`)
  }

  push(
    '',
    '## Synthetic corpus',
    '',
    `The original ${synthetic.fixtureCount} hand-written fixtures. This table keeps the historical ` +
      'convention, including fixture 13\'s `unknown` false positive, so the synthetic numbers remain comparable ' +
      'with earlier runs.',
    '',
    '| Fixture | Category | Declared | Ground-truth actual | Detected | Tool findings | Detection TP/FP/FN | Declaration TP/FP/FN | Verdict |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  )

  for (const fixture of synthetic.fixtures) {
    const findings = fixture.toolFindings
      .map((finding) => `${finding.kind}:${finding.capability}`)
      .join(', ')
    const verdict = fixture.ok ? 'match' : 'diff'
    push(
      `| \`${fixture.id}\` | ${cell(fixture.category)} | ${codeList(fixture.declared)} | ${codeList(fixture.expectedActual)} | ${codeList(fixture.detected)} | ${findings ? codeList(findings.split(', ')) : '—'} | ${fixture.metrics.detection.tp}/${fixture.metrics.detection.fp}/${fixture.metrics.detection.fn} | ${fixture.metrics.declarationFindings.tp}/${fixture.metrics.declarationFindings.fp}/${fixture.metrics.declarationFindings.fn} | ${verdict} |`,
    )
  }

  push(
    '',
    '`Verdict: match` means the fixture produced no false positives or false negatives in either scored view. It does **not** mean the tool emitted no findings: expected true positives (for example `04-child-process`) still show `match`.',
    '',
    '## False positives',
    '',
  )

  const renderFalsePositives = (corpus) => {
    if (corpus.falsePositives.length === 0) {
      push(`### ${corpus.corpus}`, '', 'None in this corpus.', '')
      return
    }
    push(`### ${corpus.corpus}`, '')
    const detection = corpus.falsePositives.filter((item) => item.layer === 'detection')
    const declaration = corpus.falsePositives.filter((item) => item.layer === 'declaration')
    if (detection.length > 0) {
      push('#### Detection', '')
      for (const item of detection) {
        const evidence = item.evidence
          ? ` evidence: \`${item.evidence.evidence}\`${item.evidence.specifier ? ` (specifier \`${item.evidence.specifier}\`)` : ''} at ${item.evidence.file ?? '?'}:${item.evidence.line ?? '?'}`
          : ''
        push(`- \`${item.fixture}\`: reported \`${item.capability}\` — ${item.detail}.${evidence}`)
      }
      push('')
    }
    if (declaration.length > 0) {
      push('#### Declaration findings', '')
      for (const item of declaration) {
        push(
          `- \`${item.fixture}\`: \`${item.kind}:${item.capability}\` — ${item.detail}${item.file ? ` (${item.file}${item.line ? `:${item.line}` : ''})` : ''}`,
        )
      }
      push('')
    }
  }

  renderFalsePositives(synthetic)
  renderFalsePositives(real)

  push('## False negatives', '')
  const renderFalseNegatives = (corpus) => {
    if (corpus.falseNegatives.length === 0) {
      push(`### ${corpus.corpus}`, '', 'None in this corpus.', '')
      return
    }
    push(`### ${corpus.corpus}`, '')
    const detection = corpus.falseNegatives.filter((item) => item.layer === 'detection')
    const declaration = corpus.falseNegatives.filter((item) => item.layer === 'declaration')
    if (detection.length > 0) {
      push('#### Detection', '')
      for (const item of detection) {
        push(`- \`${item.fixture}\`: missed \`${item.capability}\` — ${item.detail}`)
      }
      push('')
    }
    if (declaration.length > 0) {
      push('#### Declaration findings', '')
      for (const item of declaration) {
        push(`- \`${item.fixture}\`: missed \`${item.kind}:${item.capability}\` — ${item.detail}`)
      }
      push('')
    }
  }
  renderFalseNegatives(synthetic)
  renderFalseNegatives(real)

  push(
    '## Interpretation and limits',
    '',
    `- **Two corpora.** ${synthetic.fixtureCount} synthetic fixtures preserve the original hand-written traps. ${real.fixtureCount} real excerpts cover 14 workspace packages and 2 DSH docs examples; 15 package excerpts cover 14 packages because dsh-capdiff contributes two excerpts.`,
    '- **Real code provenance.** 9 excerpts are Apache-2.0 from a `dsh-next-suite` workspace snapshot (public `main`, 2026-11-15; this checkout has no standalone git metadata), 6 are Apache-2.0 from `dsh-os-suite` @ `cb1baa8`, and 2 are MIT from `deepseek-harness` docs @ `39163dd30f`. No package code was modified and no external code was downloaded. Excerpts are 66-154 lines (the two docs examples are shorter); each is trimmed at a complete top-level boundary and keeps a provenance header.',
    '- **Authored declarations.** None of the 14 upstream packages declares `dsh.capabilities`, so each fixture manifest is authored for the benchmark. Ground truth (`actual`) was derived by reading the excerpt, not by trusting the scanner. Three real fixtures deliberately under-declare (`filesystem` in `real-02`, `env` in `real-09` and `real-15`) and one over-declares (`env` in `real-03`) to exercise declaration findings on real code.',
    '- **`unknown` handling.** Real metrics score canonical capabilities only. Unmapped imports (`node:path`, `node:util`, relative modules, third-party packages) are reported in the unmapped section. Counting them as false positives would drop real detection precision to ' +
      `${pct(real.unknownAsFalsePositive.precision)}; the synthetic corpus keeps its historical convention instead.`,
    '- **Real capability coverage.** The real excerpts exercise `filesystem`, `crypto`, `env` and `network` (global `fetch` in the docs adapter). None of these 14 packages uses `child_process` or `eval`, so those capabilities are covered only by synthetic fixtures.',
    '- **Not a population estimate.** The real corpus is 17 hand-selected excerpts, not a random sample of plugins or npm. A 100% score on this corpus does not mean the scanner is complete; look at the synthetic traps and at the unmapped-import noise.',
    '- **Static only.** The scanner is AST-first (acorn) with a regex fallback. It does not execute plugin code and cannot observe runtime capability, transitive dependencies, minified bundles, TypeScript/JSX sources (the docs examples were pre-stripped), or native addons. Global `fetch()` is AST-only: it is invisible to the legacy regex scope, which is why `real-17` contributes one in-scope false positive while capability detection is correct.',
    '- **Synthetic traps remain.** `09-obfuscated-eval` (computed global eval) and `13-fp-unmapped-builtin` (unmapped imports become `unknown`) intentionally fail. `08-obfuscated-concat` and `17-global-fetch` are detected by the AST path but appear as in-scope false positives under the legacy `staticVisible` scope.',
    '- **A clean fixture is not a safety claim.** It only means no statically visible capability was found by this scanner in that excerpt.',
    '',
    `_Disclaimer: ${results.disclaimer}_`,
    '',
  )

  return `${lines.join('\n')}\n`
}

main().catch((error) => {
  console.error(`dsh-capdiff benchmark failed: ${error.message}`)
  process.exitCode = 1
})
