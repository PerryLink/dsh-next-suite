#!/usr/bin/env node
/**
 * dsh-supply-watch benchmark runner.
 *
 * Loads four curated datasets (known names, lookalike variants, the original
 * legitimate-name baseline, and 30 real legitimate npm names), calls the
 * package core (typosquatScore, watch, severityOf), and writes results.json +
 * RESULTS.md. The lookalike variants stay synthetic; the real group exists to
 * measure false positives on names taken from this workspace and DSH docs.
 *
 * The corpus is deliberately small and curated. These are sample metrics for
 * this corpus, not population estimates and not a claim that any package is
 * safe or malicious.
 *
 * Usage:
 *   node benchmarks/supply-watch/run.mjs
 */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DISCLAIMER,
  severityOf,
  typosquatScore,
  watch,
} from '../../packages/dsh-supply-watch/src/core.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = join(HERE, 'data')
const PACKAGE_JSON = join(HERE, '..', '..', 'packages', 'dsh-supply-watch', 'package.json')
const OUT_JSON = join(HERE, 'results.json')
const OUT_MD = join(HERE, 'RESULTS.md')

const EXPECTED_KNOWN = 20
const EXPECTED_VARIANTS = 30
const EXPECTED_LEGIT_BASELINE = 20
const EXPECTED_LEGIT_REAL = 30
const EXPECTED_LEGIT = EXPECTED_LEGIT_BASELINE + EXPECTED_LEGIT_REAL
const LEGIT_GROUPS = ['baseline', 'real']
const CATEGORIES = ['typo', 'separator', 'prefix']

const THRESHOLDS = [
  {
    id: 'any',
    label: 'Any finding (score > 0)',
    minScore: 1,
    meaning: 'any typo/version finding emitted by the core',
  },
  {
    id: 'medium',
    label: 'Medium or high (score >= 50)',
    minScore: 50,
    meaning: 'findings the core labels medium or high severity',
  },
  {
    id: 'high',
    label: 'High only (score >= 80)',
    minScore: 80,
    meaning: 'findings the core labels high severity',
  },
]

/**
 * @param {number} tp
 * @param {number} fp
 * @param {number} fn
 * @param {number} tn
 */
function confusion(tp, fp, fn, tn) {
  const precision = tp + fp === 0 ? null : tp / (tp + fp)
  const recall = tp + fn === 0 ? null : tp / (tp + fn)
  const f1 =
    precision === null || recall === null
      ? null
      : precision + recall === 0
        ? 0
        : (2 * precision * recall) / (precision + recall)
  const falsePositiveRate = fp + tn === 0 ? null : fp / (fp + tn)
  return {
    tp,
    fp,
    fn,
    tn,
    precision: precision === null ? null : Number(precision.toFixed(6)),
    recall: recall === null ? null : Number(recall.toFixed(6)),
    f1: f1 === null ? null : Number(f1.toFixed(6)),
    falsePositiveRate:
      falsePositiveRate === null ? null : Number(falsePositiveRate.toFixed(6)),
    accuracy:
      tp + fp + fn + tn === 0
        ? null
        : Number(((tp + tn) / (tp + fp + fn + tn)).toFixed(6)),
  }
}

/**
 * @param {number | null} value
 */
const pct = (value) => (value === null ? 'n/a' : `${(value * 100).toFixed(2)}%`)

/**
 * @param {unknown} value
 */
const cell = (value) => String(value ?? '').replace(/\|/g, '\\|')

/**
 * @param {string} file
 */
async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

/**
 * Reject duplicate / disjointness violations before measuring.
 *
 * @param {string[]} names
 * @param {string} label
 */
function assertUnique(names, label) {
  const seen = new Set()
  for (const name of names) {
    const key = name.toLowerCase()
    if (seen.has(key)) throw new Error(`${label}: duplicate name "${name}"`)
    seen.add(key)
  }
}

async function main() {
  const [knownData, variantData, legitData, legitRealData, toolPackage] =
    await Promise.all([
      readJson(join(DATA, 'known.json')),
      readJson(join(DATA, 'variants.json')),
      readJson(join(DATA, 'legit.json')),
      readJson(join(DATA, 'legit-real.json')),
      readJson(PACKAGE_JSON),
    ])

  const knownEntries = knownData.names
  const variantEntries = variantData.variants
  const legitBaselineEntries = legitData.legit.map((entry) => ({
    ...entry,
    group: 'baseline',
  }))
  const legitRealEntries = legitRealData.legit.map((entry) => ({
    ...entry,
    group: 'real',
  }))
  const legitEntries = [...legitBaselineEntries, ...legitRealEntries]

  if (knownEntries.length !== EXPECTED_KNOWN) {
    throw new Error(`expected ${EXPECTED_KNOWN} known names, found ${knownEntries.length}`)
  }
  if (variantEntries.length !== EXPECTED_VARIANTS) {
    throw new Error(
      `expected ${EXPECTED_VARIANTS} variants, found ${variantEntries.length}`,
    )
  }
  if (legitBaselineEntries.length !== EXPECTED_LEGIT_BASELINE) {
    throw new Error(
      `expected ${EXPECTED_LEGIT_BASELINE} baseline legit names, found ${legitBaselineEntries.length}`,
    )
  }
  if (legitRealEntries.length !== EXPECTED_LEGIT_REAL) {
    throw new Error(
      `expected ${EXPECTED_LEGIT_REAL} real legit names, found ${legitRealEntries.length}`,
    )
  }
  if (legitEntries.length !== EXPECTED_LEGIT) {
    throw new Error(`expected ${EXPECTED_LEGIT} legit names, found ${legitEntries.length}`)
  }

  const knownNames = knownEntries.map((entry) => entry.name)
  const variantNames = variantEntries.map((entry) => entry.name)
  const legitNames = legitEntries.map((entry) => entry.name)

  assertUnique(knownNames, 'known.json')
  assertUnique(variantNames, 'variants.json')
  assertUnique(legitNames, 'legit.json')
  assertUnique([...variantNames, ...legitNames], 'variants + legit')

  const knownSet = new Set(knownNames.map((name) => name.toLowerCase()))
  for (const name of [...variantNames, ...legitNames]) {
    if (knownSet.has(name.toLowerCase())) {
      throw new Error(`candidate "${name}" is also in the known list`)
    }
  }
  for (const entry of variantEntries) {
    if (!knownSet.has(entry.target.toLowerCase())) {
      throw new Error(`variant "${entry.name}" targets unknown baseline "${entry.target}"`)
    }
    if (!CATEGORIES.includes(entry.category)) {
      throw new Error(`variant "${entry.name}" has unknown category "${entry.category}"`)
    }
  }

  const evaluate = (entry, kind) => {
    const result = typosquatScore(entry.name, knownNames)
    const severity = severityOf(result)
    return {
      kind,
      name: entry.name,
      ...(kind === 'variant'
        ? {
            category: entry.category,
            target: entry.target,
            rationale: entry.rationale,
          }
        : {
            group: entry.group,
            source: entry.source ?? null,
            rationale: entry.rationale,
          }),
      score: result.score,
      nearest: result.nearest,
      distance: result.distance,
      severity: result.score > 0 ? severity : null,
      reason: result.reason,
      flagged: result.score > 0,
      passes: Object.fromEntries(
        THRESHOLDS.map((threshold) => [threshold.id, result.score >= threshold.minScore]),
      ),
    }
  }

  const variants = variantEntries.map((entry) => evaluate(entry, 'variant'))
  const legit = legitEntries.map((entry) => evaluate(entry, 'legit'))

  const thresholdMetrics = THRESHOLDS.map((threshold) => {
    const variantHits = variants.filter((entry) => entry.score >= threshold.minScore)
    const legitHits = legit.filter((entry) => entry.score >= threshold.minScore)
    const tp = variantHits.length
    const fn = variants.length - tp
    const fp = legitHits.length
    const tn = legit.length - fp
    const metrics = confusion(tp, fp, fn, tn)
    const perCategory = Object.fromEntries(
      CATEGORIES.map((category) => {
        const total = variants.filter((entry) => entry.category === category)
        const detected = total.filter((entry) => entry.score >= threshold.minScore)
        return [
          category,
          {
            total: total.length,
            detected: detected.length,
            recall:
              total.length === 0
                ? null
                : Number((detected.length / total.length).toFixed(6)),
          },
        ]
      }),
    )
    const byGroup = Object.fromEntries(
      LEGIT_GROUPS.map((group) => {
        const total = legit.filter((entry) => entry.group === group)
        const flagged = total.filter((entry) => entry.score >= threshold.minScore)
        return [
          group,
          {
            total: total.length,
            falsePositives: flagged.length,
            falsePositiveRate:
              total.length === 0
                ? null
                : Number((flagged.length / total.length).toFixed(6)),
            flagged: flagged.map((entry) => entry.name),
          },
        ]
      }),
    )
    return {
      id: threshold.id,
      label: threshold.label,
      meaning: threshold.meaning,
      ...metrics,
      perCategory,
      byGroup,
    }
  })

  // Use the canonical `watch()` pipeline as a cross-check on the per-name
  // `typosquatScore()` calls. Both must agree on which candidates are flagged.
  const canonicalFindings = watch([...variantNames, ...legitNames], knownNames)
  const watchFlagged = new Set(
    canonicalFindings
      .filter((finding) => finding.kind === 'typosquat')
      .map((finding) => finding.name),
  )
  const directFlagged = new Set(
    [...variants, ...legit]
      .filter((entry) => typosquatScore(entry.name, knownNames).score > 0)
      .map((entry) => entry.name),
  )
  const consistencyOk =
    watchFlagged.size === directFlagged.size &&
    [...directFlagged].every((name) => watchFlagged.has(name)) &&
    canonicalFindings.every((finding) => finding.kind === 'typosquat')
  if (!consistencyOk) {
    throw new Error(
      `core inconsistency: watch() flagged ${watchFlagged.size} candidates, typosquatScore() flagged ${directFlagged.size}`,
    )
  }

  // Exact known names must never be typosquats of themselves.
  const selfFindings = watch(knownNames, knownNames)
  const knownSelfCheck = {
    count: knownNames.length,
    flagged: selfFindings.length,
    ok: selfFindings.length === 0,
    findings: selfFindings,
  }

  const missed = variants.filter((entry) => entry.score === 0)
  const falsePositives = legit.filter((entry) => entry.score > 0)

  const results = {
    benchmark: 'dsh-supply-watch',
    description:
      'Offline typosquat/lookalike benchmark over a curated known-name baseline, synthetic lookalike variants, 20 baseline legitimate names and 30 real legitimate npm names.',
    tool: {
      packageName: toolPackage.name,
      packageVersion: toolPackage.version,
    },
    generatedAt: new Date().toISOString(),
    node: process.version,
    counts: {
      known: knownEntries.length,
      knownReal: knownEntries.filter((entry) => entry.origin === 'real').length,
      knownSynthetic: knownEntries.filter((entry) => entry.origin === 'synthetic').length,
      variants: variants.length,
      variantsByCategory: Object.fromEntries(
        CATEGORIES.map((category) => [
          category,
          variants.filter((entry) => entry.category === category).length,
        ]),
      ),
      legit: legit.length,
      legitBaseline: legitBaselineEntries.length,
      legitReal: legitRealEntries.length,
      legitByGroup: Object.fromEntries(
        LEGIT_GROUPS.map((group) => [
          group,
          legit.filter((entry) => entry.group === group).length,
        ]),
      ),
    },
    thresholds: thresholdMetrics,
    known: knownEntries,
    variants,
    legit,
    missed,
    falsePositives,
    knownSelfCheck,
    consistency: {
      ok: consistencyOk,
      watchFindings: watchFlagged.size,
      directFindings: directFlagged.size,
    },
    disclaimer: DISCLAIMER,
  }

  await writeFile(OUT_JSON, `${JSON.stringify(results, null, 2)}\n`)
  await writeFile(OUT_MD, renderMarkdown(results))

  console.log(
    `dsh-supply-watch benchmark: ${knownNames.length} known, ${variants.length} variants, ${legit.length} legit (${legitBaselineEntries.length} baseline + ${legitRealEntries.length} real)`,
  )
  for (const metrics of thresholdMetrics) {
    console.log(
      `${metrics.label.padEnd(32)} recall ${pct(metrics.recall)} (${metrics.tp}/${metrics.tp + metrics.fn})  FPR ${pct(metrics.falsePositiveRate)} (${metrics.fp}/${metrics.fp + metrics.tn})  precision ${pct(metrics.precision)}  F1 ${pct(metrics.f1)}`,
    )
    const realGroup = metrics.byGroup.real
    console.log(
      `${''.padEnd(32)} real-name FPR ${pct(realGroup.falsePositiveRate)} (${realGroup.falsePositives}/${realGroup.total})`,
    )
  }
  console.log(`wrote ${OUT_JSON}`)
  console.log(`wrote ${OUT_MD}`)
}

/**
 * @param {Record<string, any>} results
 */
function renderMarkdown(results) {
  const lines = []
  const push = (...values) => lines.push(...values)
  const anyThreshold = results.thresholds.find((entry) => entry.id === 'any')
  const mediumThreshold = results.thresholds.find((entry) => entry.id === 'medium')
  const highThreshold = results.thresholds.find((entry) => entry.id === 'high')

  push(
    '# dsh-supply-watch benchmark results',
    '',
    `Generated by \`benchmarks/supply-watch/run.mjs\` at ${results.generatedAt} with Node ${results.node}.`,
    '',
    `Tool: \`${results.tool.packageName}\` ${results.tool.packageVersion}. Corpus: ` +
      `${results.counts.known} known names (${results.counts.knownReal} real, ${results.counts.knownSynthetic} synthetic), ` +
      `${results.counts.variants} variants (${results.counts.variantsByCategory.typo} typo / ${results.counts.variantsByCategory.separator} separator / ${results.counts.variantsByCategory.prefix} prefix), ` +
      `${results.counts.legit} legitimate names (${results.counts.legitBaseline} baseline + ${results.counts.legitReal} real npm names).`,
    '',
    `> ${results.disclaimer}`,
    '',
    '## Summary',
    '',
    'A positive is a lookalike variant that the core reports; a negative is a legitimate name. ' +
      'The three rows are decision thresholds over the core\'s own score, not different tools.',
    '',
    '| Decision threshold | TP | FP | FN | TN | Precision | Recall | F1 | False-positive rate | Accuracy |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  )

  for (const metrics of results.thresholds) {
    push(
      `| ${cell(metrics.label)} | ${metrics.tp} | ${metrics.fp} | ${metrics.fn} | ${metrics.tn} | ${pct(metrics.precision)} | ${pct(metrics.recall)} | ${pct(metrics.f1)} | ${pct(metrics.falsePositiveRate)} | ${pct(metrics.accuracy)} |`,
    )
  }

  push(
    '',
    '### False positives by legitimate-name group',
    '',
    'The 30 real names are checked separately so the measured false-positive rate on real packages is visible without dilution by the original 20-name baseline.',
    '',
    '| Group | Names | Any finding FP | FPR (any) | Medium+ FP | High FP |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  )
  for (const group of LEGIT_GROUPS) {
    const any = anyThreshold.byGroup[group]
    const medium = mediumThreshold.byGroup[group]
    const high = highThreshold.byGroup[group]
    push(
      `| ${group === 'real' ? 'real npm names' : 'original baseline'} | ${any.total} | ${any.falsePositives}/${any.total} | ${pct(any.falsePositiveRate)} | ${medium.falsePositives}/${medium.total} | ${high.falsePositives}/${high.total} |`,
    )
  }

  push(
    '',
    '### Recall by variant category',
    '',
    '| Category | Total | Any finding | Medium+ | High |',
    '| --- | ---: | ---: | ---: | ---: |',
  )
  for (const category of ['typo', 'separator', 'prefix']) {
    const any = anyThreshold.perCategory[category]
    const medium = mediumThreshold.perCategory[category]
    const high = highThreshold.perCategory[category]
    push(
      `| ${category} | ${any.total} | ${any.detected}/${any.total} (${pct(any.recall)}) | ${medium.detected}/${medium.total} (${pct(medium.recall)}) | ${high.detected}/${high.total} (${pct(high.recall)}) |`,
    )
  }

  push('', '## Missed variants', '')
  if (results.missed.length === 0) {
    push('None in this corpus.')
  } else {
    push(
      `${results.missed.length} lookalike(s) scored 0 and were not reported. These are retained on purpose to show the boundary of the current heuristics:`,
      '',
    )
    for (const entry of results.missed) {
      push(
        `- \`${entry.name}\` (${entry.category} -> \`${entry.target}\`): ${entry.rationale}. Nearest known name: \`${entry.nearest}\` (distance ${entry.distance}); core reason: \`${entry.reason}\`.`,
      )
    }
  }

  push('', '## False positives', '')
  if (results.falsePositives.length === 0) {
    push('None in this corpus at the any-finding threshold.')
  } else {
    push(
      `${results.falsePositives.length} legitimate name(s) produced a finding. Low-score leads are still findings; the medium/high rows above show the effect of raising the threshold.`,
      '',
    )
    for (const entry of results.falsePositives) {
      push(
        `- \`${entry.name}\` [${entry.group}]: score ${entry.score} (${entry.severity}), nearest \`${entry.nearest}\` at distance ${entry.distance}; reason: \`${entry.reason}\`. Legitimacy: ${entry.rationale}${entry.source ? ` (source: ${entry.source})` : ''}.`,
      )
    }
  }

  push(
    '',
    '## Known-name self-check',
    '',
    `Exact known names passed through \`watch(known, known)\`: ${results.knownSelfCheck.count} names, ${results.knownSelfCheck.flagged} flagged, ${results.knownSelfCheck.ok ? 'pass' : 'FAIL'}.`,
    '',
    '## Full variant table',
    '',
    '| Name | Category | Target | Score | Severity | Nearest | Distance | Reported (any) |',
    '| --- | --- | --- | ---: | --- | --- | ---: | --- |',
  )
  for (const entry of results.variants) {
    push(
      `| \`${entry.name}\` | ${entry.category} | \`${entry.target}\` | ${entry.score} | ${entry.severity ?? '—'} | \`${entry.nearest ?? '—'}\` | ${entry.distance ?? '—'} | ${entry.flagged ? 'yes' : 'no'} |`,
    )
  }

  push(
    '',
    '## Full legitimate-name table',
    '',
    '| Name | Group | Source | Score | Severity | Nearest | Distance | Reported (any) |',
    '| --- | --- | --- | ---: | --- | --- | ---: | --- |',
  )
  for (const entry of results.legit) {
    push(
      `| \`${entry.name}\` | ${entry.group} | ${cell(entry.source ?? 'baseline corpus')} | ${entry.score} | ${entry.severity ?? '—'} | \`${entry.nearest ?? '—'}\` | ${entry.distance ?? '—'} | ${entry.flagged ? 'yes' : 'no'} |`,
    )
  }

  push(
    '',
    '## Interpretation and limits',
    '',
    '- This is a **curated corpus of 20 known names, 30 synthetic variants and 50 legitimate names (20 original baseline + 30 real npm names)**, not a random sample of npm. Rates are sample metrics for this corpus, not estimates for the registry.',
    '- The 30 real legitimate names come from `dsh-os-suite` package/lockfile dependencies, the `dsh-next-suite` runtime dependency (`acorn`), and official DSH package names referenced in `deepseek-harness` docs. They are identifiers only; no package code or tarball was downloaded. The variant set remains synthetic.',
    '- The known list is caller-supplied and hand-curated. A stale, incomplete or over-broad list changes both recall and false positives; `cordis` is deliberately short/generic and causes the one measured low-severity false positive (`cordis-http-client`, which is in the original baseline group, not the real group).',
    '- The tool is offline: there is no registry ownership check, download count, maintainer history, tarball inspection, advisory data, or dependency analysis. A finding is a lead, not proof of malice.',
    '- Scope-wrapped variants (`@deepseek/dsh-xbrl`, `@evil/dsh-capdiff`) and brand-expanded names (`deepseek-harness-capdiff`) are outside the current heuristic coverage and account for the three misses. Homoglyph, pluralization and semantic lookalikes are not exhaustively covered either.',
    '- The any-finding row counts low-severity extra-segment leads as positives. The medium+ and high rows show the precision/recall tradeoff if a reviewer only escalates stronger leads.',
    '- A no-finding result is **not evidence of safety**, and a finding is **not evidence of maliciousness**. This benchmark measures name-similarity heuristics only.',
    '',
    `_Disclaimer: ${results.disclaimer}_`,
    '',
  )

  return `${lines.join('\n')}\n`
}

main().catch((error) => {
  console.error(`dsh-supply-watch benchmark failed: ${error.message}`)
  process.exitCode = 1
})
