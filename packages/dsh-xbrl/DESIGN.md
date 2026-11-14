# dsh-xbrl — Design

Status: MVP 0.1.0, unpublished.
License: Apache-2.0.
**Unofficial:** not affiliated with, endorsed by, or sponsored by DeepSeek or any
standards body. See the naming section at the end.

## 1. Goal

Provide a small, deterministic, offline tool that answers two narrow questions
about a financial fact snapshot:

1. Do the supplied totals satisfy common accounting identities?
   - `Assets = Liabilities + Equity`
   - `Revenue - Expenses = Net income`
2. What changed, concept by concept, between two versions of the snapshot?

The tool is deliberately a **calculator**, not an auditor. It does not fetch
filings, interpret accounting standards, express an audit opinion, or decide
whether a restatement is appropriate.

## 2. Non-goals

- Parsing XBRL XML, iXBRL, or taxonomy linkbases.
- Validating a filing against US-GAAP, IFRS, or any regulator's rules.
- Fetching data from SEC EDGAR, CNINFO, or any network service.
- Materiality, disclosure completeness, internal controls, going concern, fraud,
  tax, legal, or investment analysis.
- Currency/unit conversion, consolidation, segment/context selection, or
  multi-period modeling.
- Storing, signing, or publishing financial records.

These are explicit product boundaries, not a roadmap promise.

## 3. Data model

The input is a simplified JSON projection of XBRL facts:

```json
{
  "entity": "Example Co",
  "period": "2024-12-31",
  "facts": [
    { "concept": "Assets", "value": 1250000, "unit": "CNY", "period": "2024-12-31" }
  ]
}
```

- `entity` — required non-empty string.
- `period` — required non-empty string. It labels the snapshot; it is not parsed
  as a date.
- `facts` — required array, may be empty.
- Fact `concept` — required non-empty string.
- Fact `value` — required finite number, or a plain decimal string.
- Fact `unit` — required non-empty string.
- Fact `period` — optional non-empty string, preserved but not used by checks or
  diffs.

Unknown top-level or fact fields are ignored. The parser returns a new document
containing only the normalized fields, so callers do not need to trust the
input object afterwards.

### 3.1 Value coercion

Accepted string form:

```text
[+-]?(digits[.digits] | .digits)([eE][+-]?digits)?
```

Examples accepted: `"1250"`, `"1250.50"`, `"-3.2e4"`, `".5"`.
Examples rejected: `"1,250.50"`, `""`, `"0x10"`, `NaN`, `Infinity`, booleans,
`null`, arrays. The result is stored as a JavaScript `number` (IEEE-754 double).
Large integers beyond 2^53 lose precision; this is a documented limitation of
the 0.1.0 data model, not a hidden conversion.

## 4. Concept normalization and duplicates

For matching only, a concept is canonicalized as follows:

1. trim leading/trailing whitespace;
2. drop a leading namespace prefix matching `[A-Za-z_][A-Za-z0-9._-]*:` (for
   example `us-gaap:` or `ifrs-full:`);
3. lower-case;
4. remove whitespace, `_`, and `-`.

Thus `us-gaap:Assets`, `Assets`, and ` assets ` share the canonical key
`assets`.

**Duplicate policy: reject.** `parseFacts` (and the check/diff entry points that
accept raw facts) reject two facts with the same canonical key via
`ERR_DUPLICATE`. The error names both original concepts and their positions.
The tool never silently lets a later fact overwrite an earlier one. This is a
deliberate choice for a reconciliation tool: an ambiguous snapshot should be
fixed before totals are checked.

Consequences:

- `Assets` plus `us-gaap:Assets` is rejected.
- Two different aliases for the same role (for example `Assets` and
  `TotalAssets`) have different canonical keys, so the file is accepted. Role
  resolution then uses the first alias in the built-in list. This is documented
  in README and is a known heuristic limitation.

Per-fact `period` is never part of duplicate detection or alignment. The unit is
not part of duplicate detection either. A snapshot is treated as one
single-period projection; callers who need multiple periods must run separate
snapshots.

## 5. Role resolution and aliases

Each identity is described by ordered role definitions (exported as
`BALANCE_SHEET_ROLES` and `INCOME_STATEMENT_ROLES`). A role has a stable key,
a human label, and an ordered alias list.

Resolution:

1. Build a map canonical key → fact. Duplicates fail first.
2. For each role, walk aliases in order and use the first canonical key present.
3. Record the role value and the actual (original) concept in `matched`.
4. If no alias matches, add the role key to `missing` in statement order.

Alias matching is intentionally explicit and finite. It does not use fuzzy
matching, edit distance, substring matching, or taxonomy relationships. This
avoids surprising matches (for example, treating `AssetsCurrent` as total
assets). Alias lists are convenience heuristics; a user with different labels
should rename concepts in their own input.

## 6. Identity checks

### 6.1 Balance sheet

```text
lhs = assets
rhs = liabilities + equity
diff = lhs - rhs
ok = all roles present && |diff| <= tolerance
```

### 6.2 Income statement

```text
lhs = revenue - expenses
rhs = netIncome
diff = lhs - rhs
ok = all roles present && |diff| <= tolerance
```

The income check returns the literal formula's left-hand side (computed net
income), not revenue alone. This is stated here because "lhs" is ambiguous in a
three-term identity. The found role values are also returned in `values` for
callers that want the raw components.

### 6.3 Missing roles

If any role is missing:

- `missing` contains the missing keys.
- `lhs`, `rhs`, and `diff` are `null` (not `0`, `NaN`, or a partial sum).
- `ok` is `false`.

No partial identity is reported as passing. This avoids the common spreadsheet
failure mode where a missing row is treated as zero.

### 6.4 Tolerance

- Default: `0.01` (`DEFAULT_TOLERANCE`), absolute, in the facts' unit.
- Must be a finite, non-negative number. Invalid values raise `ERR_TOLERANCE`.
- `0` means exact numeric equality of the computed sides.
- Because values are doubles, `0.1 + 0.2` style representation error can make a
  mathematically balanced statement fail under tolerance `0`. Callers with
  fractional data should choose a tolerance appropriate to their rounding.
- Tolerance applies only to the two identity checks. The restatement diff is
  exact.

## 7. Restatement diff

`diffRestatement(prev, next)`:

1. Parse/validate both snapshots.
2. Index both by canonical concept (duplicates rejected).
3. For each concept in `next`:
   - not in `prev` → add the newer concept name to `added`;
   - in both with exactly equal values → no entry;
   - in both with different values → append a changed entry.
4. For each concept in `prev` not in `next` → add the older concept name to
   `removed`.
5. Sort everything deterministically (UTF-16 code-unit string order for names;
   changed entries by concept name).

Changed entry:

```json
{
  "concept": "Assets",
  "before": 1000000,
  "after": 1010000,
  "delta": 10000,
  "pct": 1
}
```

- `concept` is the concept as written in `next`.
- `delta = after - before` (not rounded).
- `pct = (after - before) / |before| * 100`, rounded to six decimals.
- `pct` is `null` when `before` is `0` or the percentage is not finite.
  `null` means "not defined", not "zero".
- Using `|before|` keeps the sign meaningful for negative baselines: a loss
  moving from `-50` to `-40` yields `pct: 20`, not `-20`.

Not compared: unit, fact period, and concept spelling when the canonical keys
match. A unit-only change, or a namespace-only rename with the same value, does
not appear in the diff. This is a mechanical value diff, not a full revision
analysis.

`hasChanges` is true when any of `added`, `removed`, or `changed` is non-empty.

## 8. Result contracts

### 8.1 Check result

```json
{
  "ok": true,
  "lhs": 1250000,
  "rhs": 1250000,
  "diff": 0,
  "missing": [],
  "tolerance": 0.01,
  "kind": "balance-sheet",
  "identity": "Assets = Liabilities + Equity",
  "lhsLabel": "Assets",
  "rhsLabel": "Liabilities + Equity",
  "matched": {
    "assets": "Assets",
    "liabilities": "Liabilities",
    "equity": "Equity"
  },
  "values": {
    "assets": 1250000,
    "liabilities": 450000,
    "equity": 800000
  }
}
```

The required MVP fields are `ok`, `lhs`, `rhs`, `diff`, and `missing`. The
remaining fields are presentation and transparency fields. `values` contains
only roles that were found.

### 8.2 Restatement result

```json
{
  "added": ["NewLeaseLiability"],
  "removed": ["LegacyFee"],
  "changed": [],
  "hasChanges": true,
  "kind": "restatement"
}
```

### 8.3 Formatting

`formatReport(result, { json })`:

- `json: true` → `JSON.stringify(result, null, 2)`.
- otherwise a deterministic text report without a trailing newline.
- unknown `kind` falls back to pretty JSON.
- non-object input raises `ERR_INPUT`.

Text status:

- `PASS` — all roles present and identity holds.
- `FAIL` — all roles present and identity does not hold.
- `INCOMPLETE` — at least one role missing.
- `SKIPPED` — CLI-only; the statement has no recognized concepts at all.
- `CHANGED` / `NO CHANGES` — restatement report.

## 9. CLI contract

```text
dsh-xbrl check <facts.json> [--json]
dsh-xbrl diff <a.json> <b.json> [--json]
dsh-xbrl --help
```

- Only `node:util`'s `parseArgs` and `node:fs/promises` are used by the CLI.
- `check` runs both identities and emits both results. Statements with zero
  matched concepts are marked skipped and excluded from the pass/fail decision.
  If no statement is applicable at all, exit `1` and explain on stderr.
- `diff` exits `0` when both files parse, regardless of differences. This keeps
  the command usable in pipelines; `--json` exposes the structured result.
- `--json` writes only JSON to stdout on success. Errors go to stderr.
- `--help` (and `-h`) exits `0` even when a command is present.
- Unknown commands/options, missing files, and invalid JSON exit `2`.

CLI JSON payload for `check`:

```json
{
  "ok": true,
  "entity": "Example Co",
  "period": "2024-12-31",
  "statements": [ { "kind": "balance-sheet", "...": "..." }, { "kind": "income-statement", "...": "..." } ],
  "skipped": []
}
```

## 10. Errors

| Code | Raised by | Meaning |
| --- | --- | --- |
| `ERR_JSON` | `parseFacts` | Empty or syntactically invalid JSON text |
| `ERR_SCHEMA` | parse/check/diff | Missing/wrong required field or malformed facts doc |
| `ERR_VALUE` | parse/check/diff | Non-finite or non-numeric `value` |
| `ERR_DUPLICATE` | parse/check/diff | Canonical duplicate concept |
| `ERR_TOLERANCE` | check functions | Tolerance is not finite/non-negative |
| `ERR_OPTIONS` | check functions | Options is not an object |
| `ERR_INPUT` | check/diff/format | Unsupported input type or result |
| `ERR_IO` | CLI | File cannot be read |
| `ERR_USAGE` | CLI | Wrong command/argument count |

`XbrlError` carries `name = 'XbrlError'`, a stable `code`, and a human-readable
`message`. Error messages may change between versions; codes are intended as
the stable branch point.

## 11. Security and privacy

- No network calls. The CLI only reads the files passed as arguments.
- No `eval`, `Function`, dynamic import of input, or template execution.
- No merging of input objects into prototypes; values are read field by field.
- No telemetry, logging, or data retention by the package.
- Output can contain the supplied entity name, period, concepts, and values;
  treat generated reports with the same confidentiality as the input.
- This is not a hardened sandbox. Run untrusted files in an appropriate
  environment if your threat model requires isolation.

## 12. Testing

`node --test packages/dsh-xbrl/test/*.test.js` runs 27 tests:

- core: parsing happy path, missing fields, invalid values/JSON, duplicates,
  empty facts, balance pass/fail, tolerance boundary/validation, Chinese and
  namespaced aliases, missing roles, income pass/fail/missing, restatement
  additions/removals/changes, zero baseline, canonical alignment, empty and
  identical snapshots, report formatting;
- CLI: help, missing command, check pass/fail/skipped, diff JSON/text, unknown
  command, unreadable file, exit codes.

Fixtures are local JSON files under `test/fixtures/`; no network or external
services are required.

## 13. Limitations (summary)

- Not an audit opinion or assurance report; arithmetic checks only.
- Input data is entirely user-supplied; no filing retrieval or bundled data.
- Not an XBRL parser or taxonomy validator.
- Alias lists are finite heuristics; first match wins.
- Duplicate canonical concepts fail; alias-equivalent concepts may coexist and
  the first alias wins.
- Units are not converted or reconciled.
- Restatement diff is exact and value-only; units/periods are ignored.
- IEEE-754 precision; use a tolerance for rounded data.
- No multi-period, context, segment, or consolidation handling.

## 14. 命名核验 / Naming and affiliation

- Name: `dsh-xbrl`.
- npm check on **2026-11-14** (Asia/Shanghai): `npm view dsh-xbrl version`
  returned `E404` (unpublished at that time). Registry state must be re-checked
  before publication.
- The `dsh-` prefix denotes this community suite. It does not imply official
  status, and `xbrl` describes the input domain, not conformance to the XBRL
  specification.
- **Unofficial:** not affiliated with, endorsed by, or sponsored by DeepSeek or
  any standards body. Not legal or trademark clearance.
- License: Apache-2.0; see `LICENSE`.
