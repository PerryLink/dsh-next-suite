import test from 'node:test'
import assert from 'node:assert/strict'
import {
  levenshtein,
  normalizeName,
  severityOf,
  typosquatScore,
  versionAnomaly,
  watch,
} from '../src/core.js'

test('levenshtein returns 0 for identical strings', () => {
  assert.equal(levenshtein('dsh-core', 'dsh-core'), 0)
})

test('levenshtein handles insertions, deletions, and substitutions', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3)
  assert.equal(levenshtein('', 'abc'), 3)
  assert.equal(levenshtein('abc', ''), 3)
  assert.equal(levenshtein('abc', 'axc'), 1)
})

test('levenshtein early exit caps the returned distance', () => {
  assert.equal(levenshtein('kitten', 'sitting', { maxDistance: 1 }), 2)
  assert.equal(levenshtein('kitten', 'sitting', { maxDistance: 5 }), 3)
  assert.equal(levenshtein('kitten', 'sitting', 1), 2)
  assert.equal(levenshtein('', 'abcdef', { maxDistance: 2 }), 3)
})

test('levenshtein early exit matches full DP for random strings', () => {
  let seed = 0x5eed1234
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0x100000000
  }
  const alphabet = 'abc-_'
  const make = (length) => {
    let value = ''
    for (let i = 0; i < length; i += 1) {
      value += alphabet[Math.floor(random() * alphabet.length)]
    }
    return value
  }

  for (let iteration = 0; iteration < 200; iteration += 1) {
    const left = make(Math.floor(random() * 12))
    const right = make(Math.floor(random() * 12))
    const exact = levenshtein(left, right)
    for (let maxDistance = 0; maxDistance <= 4; maxDistance += 1) {
      const expected = exact > maxDistance ? maxDistance + 1 : exact
      assert.equal(levenshtein(left, right, { maxDistance }), expected)
    }
  }
})

test('normalizeName lowercases and collapses -/_/. separators', () => {
  assert.equal(normalizeName('  DSH__Core.Plugin  '), 'dsh-core-plugin')
  assert.equal(normalizeName('dsh--core'), 'dsh-core')
  assert.equal(normalizeName('dsh.core_'), 'dsh-core')
  assert.equal(normalizeName(''), '')
})

test('normalizeName keeps and normalizes npm scopes', () => {
  assert.equal(normalizeName('@DSH/Foo_Bar'), '@dsh/foo-bar')
})

test('typosquatScore treats an exact known name as official', () => {
  const result = typosquatScore('dsh-core', ['dsh-core', 'left-pad'])
  assert.equal(result.score, 0)
  assert.equal(result.distance, 0)
  assert.equal(result.nearest, 'dsh-core')
})

test('typosquatScore flags separator and punctuation variants', () => {
  const result = typosquatScore('dsh_core', ['dsh-core'])
  assert.equal(result.nearest, 'dsh-core')
  assert.ok(result.score >= 80)
  assert.match(result.reason, /separator|punctuation/)
})

test('typosquatScore recognizes the glued dsh prefix', () => {
  const result = typosquatScore('dshcore', ['dsh-core'])
  assert.equal(result.nearest, 'dsh-core')
  assert.ok(result.score >= 80)
  assert.match(result.reason, /separator placement/)
})

test('typosquatScore flags an omitted dsh- prefix', () => {
  const result = typosquatScore('core', ['dsh-core'])
  assert.equal(result.nearest, 'dsh-core')
  assert.equal(result.score, 74)
  assert.match(result.reason, /omits the dsh- namespace prefix/)
})

test('typosquatScore flags a different dsh- prefix form', () => {
  const result = typosquatScore('node-dsh-core', ['dsh-core'])
  assert.equal(result.score, 74)
  assert.match(result.reason, /different dsh- namespace prefix/)
})

test('typosquatScore flags an extra trailing segment', () => {
  const result = typosquatScore('dsh-core-utils', ['dsh-core'])
  assert.equal(result.score, 44)
  assert.match(result.reason, /extra segment/)
})

test('typosquatScore flags a one-edit typo', () => {
  const result = typosquatScore('dsh-cora', ['dsh-core'])
  assert.equal(result.nearest, 'dsh-core')
  assert.equal(result.distance, 1)
  assert.equal(result.score, 88)
  assert.match(result.reason, /edit distance 1/)
})

test('typosquatScore picks the closest of several known names', () => {
  const result = typosquatScore('dsh-cla', ['left-pad', 'dsh-core', 'dsh-cli'])
  assert.equal(result.nearest, 'dsh-cli')
  assert.equal(result.distance, 1)
  assert.equal(result.score, 88)
})

test('typosquatScore returns no finding when the known list is empty', () => {
  const result = typosquatScore('dsh-cora', [])
  assert.deepEqual(result, {
    nearest: null,
    distance: null,
    score: 0,
    reason: 'no known package names supplied',
  })
})

test('typosquatScore handles an empty candidate name', () => {
  const result = typosquatScore('   ', ['dsh-core'])
  assert.equal(result.score, 0)
  assert.equal(result.reason, 'empty package name')
})

test('typosquatScore does not flag an unrelated name', () => {
  const result = typosquatScore('unrelated-package', ['dsh-core'])
  assert.equal(result.score, 0)
  assert.match(result.reason, /no close match/)
})

test('versionAnomaly detects placeholder 0.0.1 releases', () => {
  const findings = versionAnomaly(['0.0.1'])
  assert.equal(findings.length, 1)
  assert.equal(findings[0].code, 'placeholder-version')
  assert.equal(severityOf(findings[0]), 'medium')
})

test('versionAnomaly detects implausible 99.x majors', () => {
  const findings = versionAnomaly(['99.0.0'])
  assert.equal(findings.length, 1)
  assert.equal(findings[0].code, 'implausible-major')
  assert.equal(severityOf(findings[0]), 'high')
})

test('versionAnomaly detects a major version jump', () => {
  const findings = versionAnomaly(['1.0.0', '9.0.0'])
  const jump = findings.find((finding) => finding.code === 'major-jump')
  assert.ok(jump)
  assert.equal(severityOf(jump), 'high')
  assert.match(jump.reason, /skips 7 major version/)
})

test('versionAnomaly detects a prerelease rollback', () => {
  const findings = versionAnomaly(['2.0.0', '2.0.0-beta.1'])
  assert.equal(findings.length, 1)
  assert.equal(findings[0].code, 'prerelease-rollback')
  assert.equal(severityOf(findings[0]), 'high')
})

test('versionAnomaly detects a lower prerelease after a higher prerelease', () => {
  const findings = versionAnomaly(['2.0.0-beta.2', '2.0.0-beta.1'])
  assert.equal(findings[0].code, 'prerelease-rollback')
})

test('versionAnomaly detects a stable version regression', () => {
  const findings = versionAnomaly(['1.2.0', '1.1.0'])
  assert.equal(findings.length, 1)
  assert.equal(findings[0].code, 'version-regression')
  assert.equal(severityOf(findings[0]), 'high')
})

test('versionAnomaly detects a missing minor version line', () => {
  const findings = versionAnomaly(['1.0.0', '1.2.0'])
  assert.equal(findings.length, 1)
  assert.equal(findings[0].code, 'missing-intermediate')
  assert.deepEqual(findings[0].missing, ['1.1.x'])
  assert.equal(severityOf(findings[0]), 'low')
})

test('versionAnomaly detects a missing patch version', () => {
  const findings = versionAnomaly(['1.0.0', '1.0.2'])
  assert.equal(findings.length, 1)
  assert.equal(findings[0].code, 'missing-intermediate')
  assert.deepEqual(findings[0].missing, ['1.0.1'])
})

test('versionAnomaly returns no findings for a clean history', () => {
  assert.deepEqual(versionAnomaly(['1.2.0', '1.2.1', '1.3.0', '2.0.0']), [])
})

test('versionAnomaly handles empty and invalid input', () => {
  assert.deepEqual(versionAnomaly([]), [])
  assert.deepEqual(versionAnomaly(['not-a-version', 'v']), [])
  assert.deepEqual(versionAnomaly(undefined), [])
})

test('versionAnomaly ignores duplicate versions and normalizes v-prefixes', () => {
  assert.deepEqual(versionAnomaly(['1.0.0', '1.0.0', 'v1.0.0']), [])
})

test('versionAnomaly keeps forward prerelease histories clean', () => {
  assert.deepEqual(versionAnomaly(['1.0.0-beta.1', '1.0.0-beta.2', '1.0.0']), [])
})

test('severityOf maps scores and honors explicit severity', () => {
  assert.equal(severityOf({ score: 80 }), 'high')
  assert.equal(severityOf({ score: 79 }), 'medium')
  assert.equal(severityOf({ score: 50 }), 'medium')
  assert.equal(severityOf({ score: 49 }), 'low')
  assert.equal(severityOf({ score: 0 }), 'low')
  assert.equal(severityOf({ score: 99, severity: 'low' }), 'low')
  assert.equal(severityOf('high'), 'high')
})

test('watch merges typo and version findings and sorts by severity', () => {
  const findings = watch(
    [
      { name: 'dsh-cora', versions: ['1.0.0', '1.2.0'] },
      { name: 'placeholder', versions: ['0.0.1'] },
      { name: 'other', versions: ['99.0.0'] },
    ],
    ['dsh-core'],
  )

  assert.equal(findings.length, 4)
  assert.deepEqual(
    findings.map((finding) => finding.severity),
    ['high', 'high', 'medium', 'low'],
  )
  assert.equal(findings[0].code, 'implausible-major')
  assert.equal(findings[1].kind, 'typosquat')
  assert.equal(findings[1].name, 'dsh-cora')
  assert.equal(findings[2].code, 'placeholder-version')
  assert.equal(findings[3].code, 'missing-intermediate')
})

test('watch accepts plain strings and does nothing without known names', () => {
  assert.deepEqual(watch(['dsh-cora'], []), [])
  assert.deepEqual(watch([], ['dsh-core']), [])
  assert.deepEqual(watch([], []), [])
  assert.deepEqual(watch([{ name: '   ' }], ['dsh-core']), [])
})

test('watch accepts comma-separated version strings on an entry', () => {
  const findings = watch([{ name: 'dsh-core', versions: '0.0.1,1.0.0' }], ['dsh-core'])
  assert.equal(findings.length, 1)
  assert.equal(findings[0].code, 'placeholder-version')
})

test('watch sorts equal severities by descending score', () => {
  const findings = watch(
    [
      { name: 'minor-gap', versions: ['1.0.0', '1.2.0'] },
      { name: 'patch-gap', versions: ['2.0.0', '2.0.2'] },
    ],
    [],
  )
  assert.equal(findings.length, 2)
  assert.equal(findings[0].score, 45)
  assert.equal(findings[1].score, 35)
})
