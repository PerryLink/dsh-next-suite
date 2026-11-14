# DESIGN — dsh-supply-watch

Status: MVP, `0.1.0`, unpublished. License: Apache-2.0.

> Unofficial community project. Not affiliated with DeepSeek.

## 1. Problem and scope

Supply-chain review of an npm dependency often starts with two questions that
can be answered locally:

1. **Does this name look like a trusted package?** (`dsh-core` vs. `dsh-cora`,
   `dsh_core`, `dshcore`, `core`, `node-dsh-core`, ...)
2. **Does its publication history look plausible?** (`0.0.1`, `99.0.0`, a
   giant major jump, a prerelease that goes backwards, missing intermediate
   releases)

`dsh-supply-watch` answers only those questions, with deterministic heuristics
and no network access. It is a lead generator, not an SCA product.

### Goals

- zero dependencies, pure ESM, Node built-ins only;
- offline and deterministic (same input -> same output);
- usable as a CLI and as a small library;
- findings carry a stable code, a numeric score, and a reason;
- conservative about claims: every output says "heuristic", never "malware".

### Non-goals

- registry metadata fetching or package-name reservation checks;
- tarball download, extraction, install-script execution, or code analysis;
- advisory matching (OSV/GHSA), signature/provenance verification;
- dependency-graph or lockfile analysis;
- a comprehensive Unicode confusables table;
- replacing `npm audit`, Socket, Snyk, OSV-Scanner, Dependabot, or human review.

## 2. Architecture

```text
src/core.js   pure heuristics: normalization, Levenshtein, typo scoring,
              version parsing/anomalies, severity, watch-style merge/sort
src/cli.js    parseArgs + file/stdout I/O + JSON; no heuristic logic
test/         node:test, offline; core unit tests + spawned CLI tests
```

`core.js` imports nothing. `cli.js` imports only `node:fs/promises`,
`node:util`, and `core.js`. The CLI never executes a scanned package.

## 3. Name comparison

### 3.1 Normalization

`normalizeName(name)`:

1. trim and lowercase;
2. normalize separators inside an npm scope (`@Scope/Name` -> `@scope/name`);
3. collapse runs of `-`, `_`, `.` into one `-`;
4. trim leading/trailing `-`.

Examples:

| Input | Normalized |
| --- | --- |
| `  DSH__Core.Plugin  ` | `dsh-core-plugin` |
| `dsh--core` | `dsh-core` |
| `@DSH/Foo_Bar` | `@dsh/foo-bar` |

This makes punctuation-only variants comparable while keeping scopes
distinguishable. Scope-hopping itself (`@evil/dsh-core` for `dsh-core`) is not
given a dedicated signal; it is documented as a limitation.

### 3.2 DSH namespace prefix

The prefix heuristic recognizes an optional `node-`, `deepseek-`, or
`official-` qualifier followed by `dsh`, then either a separator or a glued
continuation:

```text
dsh-core      -> core
dshcore       -> core
node-dsh-core -> core
deepseek-dsh-core -> core
official-dsh-core -> core
```

If the stripped cores are equal but the full normalized names differ, the
candidate is flagged with score 74 and one of three reasons:

- candidate adds a `dsh-` prefix (`dsh-core` vs. known `core`);
- candidate omits it (`core` vs. known `dsh-core`);
- candidate uses a different prefix form (`node-dsh-core` vs. `dsh-core`).

The prefix signal intentionally has a moderate score: adding `dsh-` to an
unrelated official name is suspicious, but many legitimate companion packages
share a prefix.

### 3.3 Signal order and scores

For a normalized candidate and one known name, signals are evaluated and the
highest score wins. Ties keep the earlier signal (a deterministic, documented
priority).

| Signal | Score | Notes |
| --- | ---: | --- |
| exact known name | 0 | checked globally first; never flagged |
| separator/punctuation variant (normalized equal) | 90 | `dsh_core`, `dsh--core` |
| same compact form (separators removed) | 88 | `dshcore` |
| Levenshtein distance 1, max length >= 4 | 88 | typical typo |
| Levenshtein distance 2, max length >= 5 | 68 | e.g. transposition |
| prefix add/omit/respell | 74 | see 3.2 |
| Levenshtein distance 3, max length >= 9 | 46 | longer names only |
| extra trailing segment | 44 | `dsh-core-utils` |
| extra glued suffix (3+ chars) | 42 | `dshcoreutils` |
| no signal | 0 | `no close match among N ...` |

Why these thresholds:

- Short names are edit-distance minefields. Below the length thresholds, only
  punctuation/prefix signals are trusted.
- Distance 3 is only used for long names, where three edits are a small
  fraction of the name.
- Extension signals are deliberately low severity: a name that extends a
  trusted package is a plausible lead, not proof of impersonation.
- Exact matches short-circuit across the *whole* known list. If both `core`
  and `dsh-core` are trusted, the candidate `core` is not flagged for omitting
  a prefix from its sibling.

`typosquatScore` returns the best entry by score, then by lowest distance,
then by known-list order. `nearest` is the original known string; `distance`
is computed on normalized names. With no known list (or an empty name), the
result has `nearest: null`, `distance: null`, `score: 0` and a reason.

### 3.4 Levenshtein

`levenshtein(a, b)` is a standard dynamic-programming implementation that
iterates over the shorter string internally. The optional
`{ maxDistance }` (or numeric third argument) enables a banded computation:

- cells outside `|i - j| <= maxDistance` are capped;
- a row whose minimum exceeds the threshold aborts early;
- the return value is `maxDistance + 1` when the true distance exceeds the
  bound, instead of the exact distance.

This convention is documented because callers must not treat the sentinel as
an exact distance. Fuzz tests compare the banded result with the full DP for
random strings and thresholds (see §8).

## 4. Version analysis

### 4.1 Input and parsing

Input is a list of semver-ish strings, expected in **publication order
(oldest first)**. Accepted shape:

```text
v?MAJOR.MINOR.PATCH(-PRERELEASE)?(+BUILD)?
```

Build metadata is ignored. Numeric prerelease identifiers compare numerically;
alphanumeric identifiers compare lexically; a prerelease is lower than its
stable release (SemVer 2.0.0). Invalid entries are ignored rather than guessed
at. Duplicate versions are deduplicated for structural checks.

### 4.2 Structural checks (order-independent)

A copy is filtered to stable versions and sorted ascending.

| Code | Condition | Score |
| --- | --- | ---: |
| `placeholder-version` | `0.0.0` or `0.0.1` | 52 |
| `implausible-major` | major `>= 99` | 92 |
| `major-jump` | consecutive majors differ by `>= 2` (current major < 99) | 85 if jump >= 5, else 70 |
| `missing-intermediate` (minor) | same major, minor gap `>= 2` | 45 |
| `missing-intermediate` (patch) | same major/minor, patch gap `>= 2` | 35 |

`missing-intermediate` findings include `missingCount` and up to five example
versions/lines (`1.1.x`, `1.0.1`) so output stays bounded even for huge gaps.
Major jumps do not also emit missing-minor findings; they are different
signals for the same gap.

### 4.3 Publication-order checks

These iterate the parsed list as supplied, without sorting:

| Code | Condition | Score |
| --- | --- | ---: |
| `prerelease-rollback` | current version has a prerelease and sorts below previous | 86 |
| `version-regression` | any other decrease from previous to current | 82 |

Sorting for structural checks while preserving original order for rollback
checks is a deliberate split: jumps/gaps are properties of the set, while a
rollback is a property of the publish sequence. Passing an unsorted list will
therefore produce noisy rollback findings; callers should sort first or pass
the real npm publication history.

### 4.4 Why 99.x is special

An enormous major version is a classic dependency-confusion bait (it wins
naive "highest version" resolution). The `>= 99` threshold is a heuristic; a
real project could legitimately reach it. When the current major is `>= 99`,
the separate major-jump finding is suppressed to avoid "skips 98 majors"
noise.

## 5. Severity and merging

`severityOf(finding)`:

- returns an explicit valid `severity` if present;
- otherwise maps score `>= 80` -> `high`, `>= 50` -> `medium`, else `low`.

`watch(names, known)` accepts `string` or `{ name, versions }` entries,
attaches the name to version findings, adds `severity`, and sorts:

1. severity rank (`high`, `medium`, `low`);
2. score descending;
3. name ascending;
4. code/kind ascending (stable tie-break).

Typo findings are emitted only when `score > 0`. Version findings with an
empty version list are not emitted. An empty/missing known list disables typo
checks but leaves version checks active. Empty input returns `[]`.

## 6. CLI behavior

```text
dsh-supply-watch check <name> [--known a,b] [--versions x,y] [--json]
dsh-supply-watch scan <names.txt> [--known a,b] [--json]
dsh-supply-watch --help
```

- `check` builds a one-element watch input; `scan` parses lines, ignores
  blanks and `#` comments, and accepts optional comma/space-separated versions
  after the name.
- `--json` writes one JSON object to stdout; warnings go to stderr so stdout
  remains parseable.
- No `--known` -> stderr note; typo analysis is inactive.
- Exit code `0` means the command ran, **not** that the package is safe.
  Usage/IO errors exit `1`. Findings do not fail the process; CI policy is the
  caller's job.
- The CLI intentionally has no built-in trusted list and makes no network
  calls.

## 7. False positives / false negatives

### Expected false positives

- legitimate extension packages (`dsh-core-utils`);
- intentional prefix differences (a non-DSH package named `core`);
- version resets (project rewrite at `2.0.0` after `1.x`);
- yanked versions creating real gaps;
- `0.0.1` prototypes;
- publication lists that are not chronological.

Mitigation: every finding carries a reason and score; consumers should treat
scores as ranking hints and review context. Findings are not verdicts.

### Expected false negatives

- homoglyphs and mixed-script names not covered by Levenshtein (e.g. Cyrillic
  lookalikes);
- impersonation more than three edits away;
- scope-hopping (`@evil/dsh-core`);
- compromised *official* packages, malicious install scripts, vulnerable
  dependency graphs;
- malicious versions that happen to be semver-plausible;
- typos in names shorter than the edit-distance thresholds.

These are inherent to a local heuristic MVP. Closing them requires registry
metadata, tarball analysis, provenance/signature verification, and advisory
data — explicitly out of scope and not faked here.

## 8. Testing

`node --test test/*.test.js` (also runnable from the suite root with the
glob) covers:

- Levenshtein basics, empty strings, and the early-exit sentinel (plus a
  development-time fuzz check against full DP for randomized inputs);
- normalization, including scopes and repeated separators;
- exact/known short-circuit, punctuation variants, glued names, prefix
  omission/difference, extra segments, one-edit typos, multiple candidates;
- empty known list, empty names, unrelated names;
- all version codes, duplicate/invalid versions, forward prerelease history,
  clean history;
- severity mapping, deterministic sorting, tie-breaking by score;
- CLI help, JSON for `check`/`scan`, comments/blanks, missing known list,
  unknown command, missing input, unreadable file, and exit codes.

Tests are offline and use only `%TEMP%`-style temporary directories for scan
fixtures (created with `mkdtemp` and removed afterward).

## 9. Security and performance

- No third-party dependencies and no network calls: nothing to trust beyond
  Node and this source.
- No evaluation of package contents; scanned names/versions are only compared
  and printed. JSON output uses `JSON.stringify`, so quotes/newlines in input
  are escaped.
- O(names × known × name-length²) name comparison; names are short. The
  Levenshtein banded mode is available for callers with large candidate sets.
- Version history is bounded in output examples (`missing` samples capped at
  five) but all versions are parsed; pathological multimegabyte lists are the
  caller's responsibility.

## 10. Future work

Only after the limitations above are addressed explicitly:

- optional registry adapter (opt-in; never required for offline use);
- conservative homoglyph/confusables normalization with a documented table;
- scope-hopping signal with allowlists;
- SARIF/JSON schema for CI ingestion;
- richer package metadata (maintainers, provenance, publish times) via a
  separately audited data source.

None of these are implemented in `0.1.0`; this document is not a claim that
they exist.

## 11. Naming and distribution

- Package name: `dsh-supply-watch`.
- npm availability was checked on 2026-11-14 (`npm view dsh-supply-watch` ->
  `E404 Not Found`); this is a point-in-time observation, not a reservation.
- License: Apache-2.0.
- Unofficial: not affiliated with DeepSeek.
