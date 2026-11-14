# dsh-xbrl

Offline reconciliation and restatement diff for XBRL-style financial facts.

`dsh-xbrl` reads a small JSON fact snapshot that **you** supply, checks two
accounting identities, and reports concept-level differences between two
snapshots. It never fetches filings, never calls a network service, and has no
third-party dependencies.

> **Unofficial community project.** Not affiliated with, endorsed by, or
> sponsored by DeepSeek or any standards body. "XBRL" here describes the fact
> shape, not a claim of XBRL conformance. Apache-2.0.

## What it is

- **勾稽 (reconciliation):** `Assets = Liabilities + Equity` and
  `Revenue - Expenses = Net income`, with aliases in English and Chinese.
- **重述差异 (restatement diff):** align two fact snapshots by concept and show
  added, removed, and changed values with `delta` and percentage change.
- **离线 (offline):** the CLI reads only the files named on the command line.

### What it is not

- **Not an audit opinion, review, or assurance report.** It performs arithmetic
  checks only. It does not evaluate accounting policy, materiality, disclosures,
  internal controls, going concern, or fraud, and it must not be used as the
  basis of an audit conclusion.
- **Not an XBRL instance-document parser.** It does not read XBRL XML, iXBRL, or
  taxonomy linkbases, and it does not validate filings against a taxonomy.
- **Not a data source.** No filings are bundled or downloaded. **All data must
  be supplied by you** in the JSON format below.
- **Not investment, tax, or legal advice.**

## Why

Financial facts are easy to transcribe and easy to break: one fat-fingered
balance, one silently renamed concept, one restated figure with no visible
delta. A deterministic, offline arithmetic check catches those mechanical
mistakes before a human reviews the filing. The tool deliberately stops at
arithmetic and concept-level diffs; it does not pretend to interpret accounting
policy or assure a filing.

## Install

`dsh-xbrl` 0.1.1 is published on npm:

```sh
npm install dsh-xbrl
npx dsh-xbrl --help
```

Until then, run it from this monorepo:

```sh
node packages/dsh-xbrl/src/cli.js --help
node --test packages/dsh-xbrl/test/*.test.js
```

### Requirements

Node.js `^22.19.0 || >=24.9.0`. Pure ESM JavaScript, no build step, no runtime
dependencies.

## Usage

### Input format

```json
{
  "entity": "Example Manufacturing Co., Ltd.",
  "period": "2024-12-31",
  "facts": [
    { "concept": "Assets", "value": 1250000, "unit": "CNY" },
    { "concept": "Liabilities", "value": 450000, "unit": "CNY" },
    { "concept": "Equity", "value": 800000, "unit": "CNY" },
    { "concept": "Revenue", "value": 980000, "unit": "CNY" },
    { "concept": "Expenses", "value": 860000, "unit": "CNY" },
    { "concept": "NetIncome", "value": 120000, "unit": "CNY" }
  ]
}
```

Rules:

- `entity`, `period`, and `facts` are required. `facts` may be empty.
- Each fact requires `concept`, `value`, and `unit`; `period` is optional and is
  informational only. Values must be finite numbers or plain decimal strings
  (for example `"1250.50"`); thousands separators are rejected.
- **Duplicate concepts are rejected, not overwritten.** Two facts are duplicates
  when their concepts match after trimming, dropping a namespace prefix such as
  `us-gaap:`, lower-casing, and removing whitespace, `_`, and `-`. This catches
  `Assets` versus `us-gaap:Assets`, but also rejects an ambiguous file early.
- Units are not converted. Supply values in one consistent unit.

### CLI

```sh
dsh-xbrl check <facts.json> [--json]
dsh-xbrl diff <a.json> <b.json> [--json]
dsh-xbrl --help
dsh-xbrl --version
```

`check` runs both identities. A statement with **no recognized concepts at all**
is reported as `SKIPPED` and does not fail the command, so a balance-sheet-only
file can be checked without adding income-statement facts. A statement with at
least one recognized concept but missing roles is `INCOMPLETE` and exits `1`.

`diff` aligns two snapshots by concept and prints added/removed concepts and
changed values. It exits `0` when both files parse, even when differences exist;
use `--json` if a script needs to inspect the changes.

`-h` / `--help` prints usage and exits `0`; `-V` / `--version` prints
`dsh-xbrl 0.1.0` and exits `0`. With `--json`, stdout is one object with at least
`{ command, ok, ... }` (`check` or `diff`); a failed check still exits `1`.

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Check passed, or diff completed |
| `1` | Check failed or was incomplete |
| `2` | Usage, I/O, or input error |

### Example

```console
$ dsh-xbrl check facts.json
Balance sheet [PASS]
  identity: Assets = Liabilities + Equity
  Assets (lhs): 1250000
  Liabilities + Equity (rhs): 1250000
  difference: 0 (tolerance 0.01)
  matched: assets=Assets, liabilities=Liabilities, equity=Equity

Income statement [PASS]
  identity: Revenue - Expenses = Net income
  Revenue - Expenses (lhs): 120000
  Net income (rhs): 120000
  difference: 0 (tolerance 0.01)
  matched: revenue=Revenue, expenses=Expenses, netIncome=NetIncome
```

```console
$ dsh-xbrl diff original.json restated.json
Restatement diff [CHANGED]
  added: 1
    + NewLeaseLiability
  removed: 1
    - LegacyFee
  changed: 1
    ~ Assets: 1000000 -> 1010000 (delta +10000, pct +1%)
```

### Identity checks

### Balance sheet

`Assets = Liabilities + Equity`

- `lhs` is Assets.
- `rhs` is Liabilities + Equity.
- `diff` is `lhs - rhs`.
- `ok` is true when all three roles are present and `|diff| <= tolerance`.

### Income statement

`Revenue - Expenses = Net income`

- `lhs` is `Revenue - Expenses`.
- `rhs` is Net income.
- `diff` is `lhs - rhs`.
- `ok` is true when all three roles are present and `|diff| <= tolerance`.

The default tolerance is the absolute value `0.01`, in the unit of the facts.
Pass `{ tolerance: 0 }` for an exact comparison, or a larger value for rounded
data. Because JavaScript numbers are binary floating point, tiny representation
errors are possible; the tolerance absorbs them in normal use. Library callers
choose the tolerance; the CLI uses the default.

When a role is missing:

- `missing` lists the missing role keys in statement order.
- `lhs`, `rhs`, and `diff` are `null`.
- `ok` is `false`.

### Aliases

Alias matching is case-insensitive after dropping a namespace prefix and
removing whitespace, `_`, and `-`. The first alias present in the fact file
wins. These lists are convenience heuristics, not an authoritative taxonomy
mapping and not a substitute for reviewing the source filing.

| Role | Aliases |
| --- | --- |
| `assets` | `Assets`, `TotalAssets`, `AssetsTotal`, `资产总计`, `资产合计`, `资产总额`, `总资产` |
| `liabilities` | `Liabilities`, `TotalLiabilities`, `LiabilitiesTotal`, `负债总计`, `负债合计`, `负债总额`, `总负债` |
| `equity` | `Equity`, `TotalEquity`, `EquityTotal`, `StockholdersEquity`, `TotalStockholdersEquity`, `ShareholdersEquity`, `TotalShareholdersEquity`, `OwnersEquity`, `所有者权益合计`, `所有者权益总计`, `所有者权益`, `股东权益合计`, `股东权益总计`, `股东权益`, `净资产` |
| `revenue` | `Revenue`, `Revenues`, `TotalRevenue`, `RevenueTotal`, `OperatingRevenue`, `SalesRevenue`, `NetRevenue`, `营业收入`, `营业总收入`, `收入合计`, `总收入`, `营收` |
| `expenses` | `Expenses`, `TotalExpenses`, `ExpensesTotal`, `OperatingExpenses`, `TotalOperatingExpenses`, `CostsAndExpenses`, `费用合计`, `成本费用合计`, `成本费用`, `营业总成本`, `营业成本及费用`, `总费用` |
| `netIncome` | `NetIncome`, `NetIncomeLoss`, `NetProfit`, `ProfitForThePeriod`, `NetEarnings`, `净利润`, `净利润合计`, `净收益`, `净利` |

If your source uses different labels, rename the concepts in your input file.
Custom alias maps are not part of the 0.1.0 API.

### Restatement diff

`diffRestatement(prev, next)` aligns concepts using the same normalization as
`parseFacts`.

- `added`: concept names that occur only in `next`, sorted.
- `removed`: concept names that occur only in `prev`, sorted.
- `changed`: concepts in both whose numeric values differ, sorted by concept.
  Each item is `{ concept, before, after, delta, pct }`, where
  `delta = after - before` and
  `pct = (after - before) / |before| * 100`, rounded to six decimals. `pct` is
  `null` when `before` is `0` or the percentage is not finite.
- `hasChanges`: true when any array is non-empty.

The diff compares values exactly; there is no tolerance. Units, per-fact
periods, and labels are not compared, and a concept whose value is unchanged is
not reported even if its unit changed. A concept rename that only changes the
namespace/case/spacing is not a restatement under this alignment.

### Library API

```js
import { readFile } from 'node:fs/promises'
import {
  parseFacts,
  checkBalanceSheet,
  checkIncomeStatement,
  diffRestatement,
  formatReport,
} from 'dsh-xbrl'

const doc = parseFacts(await readFile('facts.json', 'utf8'))
const balance = checkBalanceSheet(doc, { tolerance: 0.01 })
const income = checkIncomeStatement(doc)
const diff = diffRestatement(prevDoc, nextDoc)

console.log(formatReport(balance))
console.log(formatReport(diff, { json: true }))
```

Exports:

- `parseFacts(input)` → `{ entity, period, facts }`.
- `checkBalanceSheet(input, { tolerance })` → check result.
- `checkIncomeStatement(input, { tolerance })` → check result.
- `diffRestatement(prev, next)` → `{ added, removed, changed, hasChanges }`.
- `formatReport(result, { json })` → text or pretty JSON.
- `BALANCE_SHEET_ROLES`, `INCOME_STATEMENT_ROLES`, `DEFAULT_TOLERANCE`,
  `XbrlError`.

`input` for the check functions may be a parsed document, a facts array, or JSON
text. Errors use `XbrlError` with a `code` such as `ERR_JSON`, `ERR_SCHEMA`,
`ERR_VALUE`, `ERR_DUPLICATE`, `ERR_TOLERANCE`, or `ERR_INPUT`. See `DESIGN.md`
for the full result and error contracts.

### Tests

```sh
node --test packages/dsh-xbrl/test/*.test.js
```

The suite covers parsing (including invalid and duplicate facts), empty input,
balanced/imbalanced identities, tolerance boundaries, English/Chinese/namespaced
aliases, missing roles, restatement additions/removals/changes, zero baselines,
and CLI `check`/`diff`/`--help` behavior.

## Limitations

- **No audit or assurance.** Arithmetic consistency is not evidence that the
  numbers are correct, complete, or compliant with any standard.
- **Data is self-supplied.** No filing retrieval, no EDGAR/CNINFO access, no
  bundled datasets, no network calls.
- **Not an XBRL processor.** No XML, iXBRL, contexts, dimensions, decimals, or
  taxonomy validation. The input is a simplified JSON projection.
- **Alias heuristics.** The built-in aliases can be wrong for a particular
  filing. "Expenses" in particular may need to be assembled by the user; a real
  income statement rarely has one universal total-expense line.
- **No unit or currency conversion,** no consolidation/segment context
  selection, and no multi-period alignment. Compare one prepared snapshot to one
  other prepared snapshot.
- **Strict duplicates.** Alias-equivalent facts with different labels can both
  exist; the first alias in the built-in list is used. Duplicate canonical
  concepts are rejected to avoid silent overwrites.
- **Floating point.** Values are IEEE-754 doubles. Use an appropriate tolerance
  for rounded data and do not treat this as a ledger or a filing system.
- **Restatement diff is mechanical.** It reports value changes, not whether a
  restatement is appropriate, material, disclosed, or explained.

## Naming

Checked on **2026-11-14** (Asia/Shanghai):

```sh
npm view dsh-xbrl version
# npm error code E404 — Not Found
```

At that time the unscoped name `dsh-xbrl` was not published on the public npm
registry. Re-check immediately before publishing; registry state can change.
The `dsh-` prefix identifies this community suite and does **not** indicate
affiliation with DeepSeek. This is not trademark or legal clearance.

## Non-official

This package is an independent community project by PerryLink. It is **not**
an official DeepSeek package, is not affiliated with or endorsed by DeepSeek,
and is not endorsed by any accounting standards body. Use at your own risk.

## License

Apache-2.0. See [LICENSE](./LICENSE).
