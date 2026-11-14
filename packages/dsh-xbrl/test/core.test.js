import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_TOLERANCE,
  XbrlError,
  checkBalanceSheet,
  checkIncomeStatement,
  diffRestatement,
  formatReport,
  parseFacts,
} from '../src/core.js'

/**
 * @param {Array<object>} facts
 * @param {object} [overrides]
 */
function doc(facts, overrides = {}) {
  return { entity: 'Example Co', period: '2024-12-31', facts, ...overrides }
}

/**
 * @param {string} concept
 * @param {number|string} value
 * @param {string} [unit]
 * @param {object} [extra]
 */
function fact(concept, value, unit = 'CNY', extra = {}) {
  return { concept, value, unit, ...extra }
}

/**
 * @param {() => unknown} fn
 * @param {string} code
 */
function assertErrorCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof XbrlError, `expected XbrlError, got ${error}`)
    assert.equal(error.code, code)
    return true
  })
}

test('parseFacts accepts JSON text, trims strings, and converts decimal values', () => {
  const parsed = parseFacts(
    JSON.stringify({
      entity: '  Example Co  ',
      period: ' 2024-12-31 ',
      facts: [
        {
          concept: ' Assets ',
          value: '1250.50',
          unit: ' CNY ',
          period: ' 2024-12-31 ',
        },
        { concept: 'Liabilities', value: 450, unit: 'CNY' },
      ],
    }),
  )

  assert.equal(parsed.entity, 'Example Co')
  assert.equal(parsed.period, '2024-12-31')
  assert.deepEqual(parsed.facts, [
    { concept: 'Assets', value: 1250.5, unit: 'CNY', period: '2024-12-31' },
    { concept: 'Liabilities', value: 450, unit: 'CNY' },
  ])
})

test('parseFacts rejects missing top-level and fact fields', () => {
  assertErrorCode(() => parseFacts({ period: '2024-12-31', facts: [] }), 'ERR_SCHEMA')
  assertErrorCode(() => parseFacts({ entity: 'Example Co', facts: [] }), 'ERR_SCHEMA')
  assertErrorCode(() => parseFacts({ entity: 'Example Co', period: '2024-12-31' }), 'ERR_SCHEMA')
  assertErrorCode(
    () => parseFacts({ entity: 'Example Co', period: '2024-12-31', facts: {} }),
    'ERR_SCHEMA',
  )
  assertErrorCode(
    () => parseFacts(doc([{ value: 1, unit: 'CNY' }])),
    'ERR_SCHEMA',
  )
  assertErrorCode(
    () => parseFacts(doc([{ concept: 'Assets', unit: 'CNY' }])),
    'ERR_VALUE',
  )
  assertErrorCode(
    () => parseFacts(doc([{ concept: 'Assets', value: 1 }])),
    'ERR_SCHEMA',
  )
  assertErrorCode(
    () => parseFacts(doc([{ concept: 'Assets', value: 1, unit: 'CNY', period: '' }])),
    'ERR_SCHEMA',
  )
  assertErrorCode(() => parseFacts(doc([null])), 'ERR_SCHEMA')
})

test('parseFacts rejects non-numeric values and malformed JSON', () => {
  assertErrorCode(() => parseFacts(doc([fact('Assets', 'not-a-number')])), 'ERR_VALUE')
  assertErrorCode(() => parseFacts(doc([fact('Assets', '1,250.50')])), 'ERR_VALUE')
  assertErrorCode(() => parseFacts(doc([fact('Assets', Number.NaN)])), 'ERR_VALUE')
  assertErrorCode(() => parseFacts(doc([fact('Assets', Infinity)])), 'ERR_VALUE')
  assertErrorCode(() => parseFacts(doc([fact('Assets', true)])), 'ERR_VALUE')
  assertErrorCode(() => parseFacts('{} trailing'), 'ERR_JSON')
  assertErrorCode(() => parseFacts('   '), 'ERR_JSON')
  assertErrorCode(() => parseFacts('[]'), 'ERR_SCHEMA')
})

test('parseFacts rejects duplicate concepts instead of silently overwriting', () => {
  assert.throws(
    () => parseFacts(doc([fact('Assets', 100), fact('Assets', 200)])),
    (error) => {
      assert.ok(error instanceof XbrlError)
      assert.equal(error.code, 'ERR_DUPLICATE')
      assert.match(error.message, /duplicate concept "Assets"/)
      return true
    },
  )

  assertErrorCode(
    () => parseFacts(doc([fact('us-gaap:Assets', 100), fact('Assets', 200)])),
    'ERR_DUPLICATE',
  )
})

test('parseFacts accepts an empty facts array', () => {
  const parsed = parseFacts(doc([]))
  assert.deepEqual(parsed.facts, [])
  assert.equal(parsed.entity, 'Example Co')
})

test('checkBalanceSheet passes a balanced statement', () => {
  const result = checkBalanceSheet(
    doc([fact('Assets', 1250), fact('Liabilities', 450), fact('Equity', 800)]),
  )

  assert.equal(result.ok, true)
  assert.equal(result.lhs, 1250)
  assert.equal(result.rhs, 1250)
  assert.equal(result.diff, 0)
  assert.deepEqual(result.missing, [])
  assert.equal(result.tolerance, DEFAULT_TOLERANCE)
  assert.deepEqual(result.matched, {
    assets: 'Assets',
    liabilities: 'Liabilities',
    equity: 'Equity',
  })
  assert.deepEqual(result.values, { assets: 1250, liabilities: 450, equity: 800 })
})

test('checkBalanceSheet accepts raw arrays and JSON text', () => {
  const facts = [fact('Assets', 100), fact('Liabilities', 40), fact('Equity', 60)]

  assert.equal(checkBalanceSheet(facts).ok, true)
  assert.equal(checkBalanceSheet(JSON.stringify(doc(facts))).ok, true)
})

test('checkBalanceSheet reports an imbalance with a signed difference', () => {
  const result = checkBalanceSheet(
    doc([fact('Assets', 100), fact('Liabilities', 40), fact('Equity', 50)]),
  )

  assert.equal(result.ok, false)
  assert.equal(result.lhs, 100)
  assert.equal(result.rhs, 90)
  assert.equal(result.diff, 10)
  assert.deepEqual(result.missing, [])
})

test('checkBalanceSheet applies tolerance and validates tolerance input', () => {
  const nearlyBalanced = doc([
    fact('Assets', 1000),
    fact('Liabilities', 400),
    fact('Equity', 599.995),
  ])

  const withDefault = checkBalanceSheet(nearlyBalanced)
  assert.equal(withDefault.ok, true)
  assert.ok(Math.abs(withDefault.diff - 0.005) < 1e-9)

  const strict = checkBalanceSheet(nearlyBalanced, { tolerance: 0.001 })
  assert.equal(strict.ok, false)
  assert.equal(strict.tolerance, 0.001)

  const balanced = doc([fact('Assets', 3), fact('Liabilities', 1), fact('Equity', 2)])
  assert.equal(checkBalanceSheet(balanced, { tolerance: 0 }).ok, true)

  assertErrorCode(() => checkBalanceSheet(nearlyBalanced, { tolerance: -0.01 }), 'ERR_TOLERANCE')
  assertErrorCode(() => checkBalanceSheet(nearlyBalanced, { tolerance: Number.NaN }), 'ERR_TOLERANCE')
  assertErrorCode(() => checkBalanceSheet(nearlyBalanced, { tolerance: Infinity }), 'ERR_TOLERANCE')
  assertErrorCode(() => checkBalanceSheet(nearlyBalanced, []), 'ERR_OPTIONS')
})

test('checkBalanceSheet resolves Chinese and namespace aliases', () => {
  const chinese = checkBalanceSheet(
    doc([fact('资产总计', 1000), fact('负债合计', 400), fact('所有者权益合计', 600)]),
  )
  assert.equal(chinese.ok, true)
  assert.deepEqual(chinese.matched, {
    assets: '资产总计',
    liabilities: '负债合计',
    equity: '所有者权益合计',
  })

  const namespaced = checkBalanceSheet(
    doc([
      fact('us-gaap:Assets', 1000),
      fact('us-gaap:Liabilities', 400),
      fact('us-gaap:StockholdersEquity', 600),
    ]),
  )
  assert.equal(namespaced.ok, true)
  assert.deepEqual(namespaced.matched, {
    assets: 'us-gaap:Assets',
    liabilities: 'us-gaap:Liabilities',
    equity: 'us-gaap:StockholdersEquity',
  })
})

test('checkBalanceSheet reports missing roles and null sides', () => {
  const partial = checkBalanceSheet(doc([fact('Assets', 1000), fact('Liabilities', 400)]))
  assert.equal(partial.ok, false)
  assert.deepEqual(partial.missing, ['equity'])
  assert.equal(partial.lhs, null)
  assert.equal(partial.rhs, null)
  assert.equal(partial.diff, null)
  assert.deepEqual(partial.values, { assets: 1000, liabilities: 400 })

  const empty = checkBalanceSheet(doc([]))
  assert.equal(empty.ok, false)
  assert.deepEqual(empty.missing, ['assets', 'liabilities', 'equity'])
})

test('checkIncomeStatement passes and honors aliases', () => {
  const english = checkIncomeStatement(
    doc([fact('Revenue', 980), fact('Expenses', 860), fact('NetIncome', 120)]),
  )
  assert.equal(english.ok, true)
  assert.equal(english.lhs, 120)
  assert.equal(english.rhs, 120)
  assert.equal(english.diff, 0)
  assert.deepEqual(english.missing, [])

  const chinese = checkIncomeStatement(
    doc([fact('营业收入', 980), fact('费用合计', 860), fact('净利润', 120)]),
  )
  assert.equal(chinese.ok, true)
  assert.deepEqual(chinese.matched, {
    revenue: '营业收入',
    expenses: '费用合计',
    netIncome: '净利润',
  })
})

test('checkIncomeStatement reports imbalance and missing roles', () => {
  const imbalanced = checkIncomeStatement(
    doc([fact('Revenue', 100), fact('Expenses', 60), fact('NetIncome', 50)]),
  )
  assert.equal(imbalanced.ok, false)
  assert.equal(imbalanced.lhs, 40)
  assert.equal(imbalanced.rhs, 50)
  assert.equal(imbalanced.diff, -10)

  const partial = checkIncomeStatement(
    doc([fact('Revenue', 100), fact('Expenses', 60)]),
  )
  assert.equal(partial.ok, false)
  assert.deepEqual(partial.missing, ['netIncome'])
  assert.equal(partial.lhs, null)
  assert.equal(partial.rhs, null)
  assert.equal(partial.diff, null)
})

test('diffRestatement reports added, removed, and changed concepts', () => {
  const prev = doc([
    fact('Assets', 100),
    fact('OldLine', 5),
    fact('ZeroLine', 0),
    fact('NegativeLine', -50),
  ])
  const next = doc([
    fact('Assets', 110),
    fact('NewLine', 7),
    fact('ZeroLine', 5),
    fact('NegativeLine', -40),
  ])

  const result = diffRestatement(prev, next)

  assert.deepEqual(result.added, ['NewLine'])
  assert.deepEqual(result.removed, ['OldLine'])
  assert.deepEqual(result.changed, [
    { concept: 'Assets', before: 100, after: 110, delta: 10, pct: 10 },
    { concept: 'NegativeLine', before: -50, after: -40, delta: 10, pct: 20 },
    { concept: 'ZeroLine', before: 0, after: 5, delta: 5, pct: null },
  ])
  assert.equal(result.hasChanges, true)
  assert.equal(result.kind, 'restatement')
})

test('diffRestatement aligns namespaced concepts and treats exact values as unchanged', () => {
  const result = diffRestatement(
    doc([fact('US-GAAP:Assets', 100)]),
    doc([fact('Assets', 100)]),
  )
  assert.deepEqual(result.added, [])
  assert.deepEqual(result.removed, [])
  assert.deepEqual(result.changed, [])
  assert.equal(result.hasChanges, false)
})

test('diffRestatement handles empty and identical snapshots', () => {
  const empty = diffRestatement(doc([]), doc([]))
  assert.deepEqual(empty.added, [])
  assert.deepEqual(empty.removed, [])
  assert.deepEqual(empty.changed, [])
  assert.equal(empty.hasChanges, false)

  const same = doc([fact('Assets', 100), fact('Liabilities', 40), fact('Equity', 60)])
  const identical = diffRestatement(same, same)
  assert.equal(identical.hasChanges, false)
})

test('formatReport renders JSON and check text', () => {
  const result = checkBalanceSheet(
    doc([fact('Assets', 1000), fact('Liabilities', 400), fact('Equity', 600)]),
  )

  const json = formatReport(result, { json: true })
  assert.deepEqual(JSON.parse(json), result)

  const text = formatReport(result)
  assert.match(text, /Balance sheet \[PASS\]/)
  assert.match(text, /identity: Assets = Liabilities \+ Equity/)
  assert.match(text, /difference: 0 \(tolerance 0\.01\)/)
  assert.match(text, /matched: assets=Assets, liabilities=Liabilities, equity=Equity/)
})

test('formatReport renders missing roles and restatement diffs', () => {
  const missing = checkBalanceSheet(doc([fact('Assets', 100)]))
  const missingText = formatReport(missing)
  assert.match(missingText, /Balance sheet \[INCOMPLETE\]/)
  assert.match(missingText, /missing: liabilities, equity/)

  const diff = diffRestatement(
    doc([fact('Assets', 100), fact('OldLine', 1)]),
    doc([fact('Assets', 110), fact('NewLine', 2)]),
  )
  const diffText = formatReport(diff)
  assert.match(diffText, /Restatement diff \[CHANGED\]/)
  assert.match(diffText, /added: 1/)
  assert.match(diffText, /\+ NewLine/)
  assert.match(diffText, /removed: 1/)
  assert.match(diffText, /- OldLine/)
  assert.match(diffText, /changed: 1/)
  assert.match(diffText, /~ Assets: 100 -> 110/)
  assert.match(diffText, /pct \+10%/)

  const noChanges = formatReport(diffRestatement(doc([]), doc([])))
  assert.match(noChanges, /Restatement diff \[NO CHANGES\]/)
})

test('formatReport rejects a non-object result', () => {
  assertErrorCode(() => formatReport(null), 'ERR_INPUT')
  assertErrorCode(() => formatReport('not a result'), 'ERR_INPUT')
})
