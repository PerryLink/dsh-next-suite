#!/usr/bin/env node
/**
 * dsh-capdiff benchmark runner.
 *
 * Reads every fixture under ./fixtures/<id>/ (package.json + expected.json +
 * source files), calls the package core (scanTarget, parseDeclared,
 * diffCapabilities, buildFindings), and writes results.json + RESULTS.md.
 *
 * This measures the scanner on a small, deliberately curated synthetic corpus.
 * It is not a population estimate and not a safety verdict. Fixtures 08, 09,
 * 13 and 17 are expected to expose known limitations; a red number here is a
 * finding about the scanner, not a test bug.
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
const PACKAGE_JSON = join(HERE, '..', '..', 'packages', 'dsh-capdiff', 'package.json')
const OUT_JSON = join(HERE, 'results.json')
const OUT_MD = join(HERE, 'RESULTS.md')

const CANONICAL = new Set(['filesystem', 'network', 'process', 'env', 'eval', 'crypto'])
const MIN_FIXTURES = 12

const DISCLAIMER =
  'Synthetic, curated fixtures only. These numbers describe this corpus, not all ' +
  'plugins or the wider npm ecosystem. A passing fixture is not evidence that a ' +
  'plugin is safe; the scanner reports statically visible evidence, never runtime ' +
  'capability.'

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
 * @param {string[]} left
 * @param {string[]} right
 */
const intersect = (left, right) => {
  const included = new Set(right)
  return left.filter((value) => included.has(value))
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

async function main() {
  const entries = await readdir(FIXTURE_ROOT, { withFileTypes: true })
  const fixtureIds = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  if (fixtureIds.length < MIN_FIXTURES) {
    throw new Error(`expected at least ${MIN_FIXTURES} fixtures, found ${fixtureIds.length}`)
  }

  const toolPackage = JSON.parse(await readFile(PACKAGE_JSON, 'utf8'))
  const fixtures = []
  const falsePositives = []
  const falseNegatives = []

  for (const id of fixtureIds) {
    const fixtureDir = join(FIXTURE_ROOT, id)
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

    const scan = await scanTarget(fixtureDir)
    const detected = sortedUnique(scan.capabilities)
    const diff = diffCapabilities(declared, detected)
    const findings = buildFindings(diff, scan.firstEvidence, {
      manifestFile: 'package.json',
      target: `fixtures/${id}`,
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

  const results = {
    benchmark: 'dsh-capdiff',
    description:
      'Declaration-vs-static-use benchmark over curated synthetic DSH-style plugin fixtures.',
    tool: {
      name: TOOL_NAME,
      coreVersion: TOOL_VERSION,
      packageVersion: toolPackage.version,
    },
    generatedAt: new Date().toISOString(),
    node: process.version,
    fixtureRoot: 'benchmarks/capdiff/fixtures',
    fixtureCount: fixtures.length,
    totals,
    fixtures,
    falsePositives,
    falseNegatives,
    disclaimer: DISCLAIMER,
  }

  await writeFile(OUT_JSON, `${JSON.stringify(results, null, 2)}\n`)
  await writeFile(OUT_MD, renderMarkdown(results))

  console.log(`dsh-capdiff benchmark: ${fixtures.length} fixtures`)
  console.log(
    `capability detection: P ${pct(totals.detection.precision)} R ${pct(totals.detection.recall)} F1 ${pct(totals.detection.f1)} (TP ${totals.detection.tp}, FP ${totals.detection.fp}, FN ${totals.detection.fn})`,
  )
  console.log(
    `in-scope detection:   P ${pct(totals.inScopeDetection.precision)} R ${pct(totals.inScopeDetection.recall)} F1 ${pct(totals.inScopeDetection.f1)}`,
  )
  console.log(
    `declaration findings: P ${pct(totals.declarationFindings.precision)} R ${pct(totals.declarationFindings.recall)} F1 ${pct(totals.declarationFindings.f1)}`,
  )
  console.log(`wrote ${OUT_JSON}`)
  console.log(`wrote ${OUT_MD}`)
}

/**
 * @param {Record<string, any>} results
 */
function renderMarkdown(results) {
  const { totals } = results
  const lines = []
  const push = (...values) => lines.push(...values)

  push(
    '# dsh-capdiff benchmark results',
    '',
    `Generated by \`benchmarks/capdiff/run.mjs\` at ${results.generatedAt} with Node ${results.node}.`,
    '',
    `Tool: \`${results.tool.name}\` core ${results.tool.coreVersion}, package ${results.tool.packageVersion}. ` +
      `${results.fixtureCount} synthetic fixtures.`,
    '',
    `> ${results.disclaimer}`,
    '',
    '## Summary',
    '',
    '| View | TP | FP | FN | Precision | Recall | F1 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| Capability detection (vs ground truth) ${metricRow(totals.detection)}`,
    `| In-scope detection (vs static-visible truth) ${metricRow(totals.inScopeDetection)}`,
    `| Undeclared findings (vs truth) ${metricRow(totals.undeclaredFindings)}`,
    `| Unused findings (vs truth) ${metricRow(totals.unusedFindings)}`,
    `| All declaration findings ${metricRow(totals.declarationFindings)}`,
    '',
    'Reading the views:',
    '',
    '- **Capability detection** compares every capability the scanner reports with `actual` in each `expected.json`. It counts documented out-of-scope constructs (computed imports, computed global eval, global `fetch`) as false negatives.',
    '- **In-scope detection** compares only with `staticVisible`, the subset a regex scanner is supposed to see. False negatives here are implementation gaps rather than documented scope limits.',
    '- **Undeclared findings** compares the tool\'s `undeclared` output with the ground-truth `actual - declared` set.',
    '- **Unused findings** compares the tool\'s `unused` output with the ground-truth `declared - actual` set. A capability that is used but statically invisible becomes a false `unused` finding.',
    '- **All declaration findings** merges undeclared and unused. `null` rates are shown as `n/a` when the denominator is zero.',
    '',
    '## Per-fixture results',
    '',
    '| Fixture | Category | Declared | Ground-truth actual | Detected | Tool findings | Detection TP/FP/FN | Declaration TP/FP/FN | Verdict |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  )

  for (const fixture of results.fixtures) {
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
    '`Verdict: match` means the fixture produced no false positives or false negatives in either view. It does **not** mean the tool emitted no findings: expected true positives (for example `04-child-process`) still show `match`.',
    '',
    '## False positives',
    '',
  )

  if (results.falsePositives.length === 0) {
    push('None in this corpus.')
  } else {
    const detection = results.falsePositives.filter((item) => item.layer === 'detection')
    const declaration = results.falsePositives.filter((item) => item.layer === 'declaration')
    if (detection.length > 0) {
      push('### Detection', '')
      for (const item of detection) {
        const evidence = item.evidence
          ? ` evidence: \`${item.evidence.evidence}\`${item.evidence.specifier ? ` (specifier \`${item.evidence.specifier}\`)` : ''} at ${item.evidence.file ?? '?'}:${item.evidence.line ?? '?'}`
          : ''
        push(`- \`${item.fixture}\`: reported \`${item.capability}\` — ${item.detail}.${evidence}`)
      }
      push('')
    }
    if (declaration.length > 0) {
      push('### Declaration findings', '')
      for (const item of declaration) {
        push(
          `- \`${item.fixture}\`: \`${item.kind}:${item.capability}\` — ${item.detail}${item.file ? ` (${item.file}${item.line ? `:${item.line}` : ''})` : ''}`,
        )
      }
      push('')
    }
  }

  push('## False negatives', '')
  if (results.falseNegatives.length === 0) {
    push('None in this corpus.')
  } else {
    const detection = results.falseNegatives.filter((item) => item.layer === 'detection')
    const declaration = results.falseNegatives.filter((item) => item.layer === 'declaration')
    if (detection.length > 0) {
      push('### Detection', '')
      for (const item of detection) {
        push(`- \`${item.fixture}\`: missed \`${item.capability}\` — ${item.detail}`)
      }
      push('')
    }
    if (declaration.length > 0) {
      push('### Declaration findings', '')
      for (const item of declaration) {
        push(`- \`${item.fixture}\`: missed \`${item.kind}:${item.capability}\` — ${item.detail}`)
      }
      push('')
    }
  }

  push(
    '## Interpretation and limits',
    '',
    '- The corpus is **17 hand-written synthetic plugin samples**, not a random sample of real plugins. Rates describe this corpus only.',
    '- The scanner is regex-based and static. It does not execute plugin code and cannot observe runtime capability, transitive dependencies, minified bundles, TypeScript sources, or native addons.',
    '- Four fixtures intentionally fail and exist to quantify limits: `08-obfuscated-concat` and `09-obfuscated-eval` (computed constructs), `13-fp-unmapped-builtin` (unmapped imports become `unknown`), and `17-global-fetch` (global `fetch` is not scanned).',
    '- In-scope recall of 100% does **not** mean the tool is complete: look at capability detection recall and at the fixture categories that are outside regex reach.',
    '- A clean fixture is not a safety claim. It only means no statically visible capability was found by this scanner in that sample.',
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
