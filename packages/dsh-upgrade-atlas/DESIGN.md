# Design: dsh-upgrade-atlas

Status: MVP, version 0.1.0
License: Apache-2.0
Maintainer: community (`dsh-next-suite`), **not DeepSeek**

This document describes the design of the breakpoint atlas: the data model,
version-window semantics, query order, rendering, evidence policy, and the
tradeoffs behind them.

## 1. Problem

DeepSeek Harness publishes upgrade guides under
`docs/upgrade-guide/v<release>/<topic>/guide.md`. A guide is excellent at
explaining one change, but an operator upgrading across several releases has to
open many directories and mentally merge them. The useful questions are
cross-cutting:

- Which changes land between two versions?
- Which are blockers rather than cleanups?
- Which package does a change belong to?
- What exactly do I do about it?
- Where is the primary source?

The atlas is a thin index over those guides. It is intentionally not a copy of
the guides: `summary` paraphrases, `fix` gives the migration action, and
`evidence` points back to the authoritative text.

## 2. Goals and non-goals

### Goals

1. A small, reviewable JSON corpus of real DSH 0.2.x breakpoints.
2. Strict validation with useful error messages before data is rendered.
3. Version-window queries that understand DSH prereleases.
4. Deterministic Markdown for release notes and migration checklists.
5. A zero-dependency core that runs offline under `node --test`.
6. An append workflow that cannot corrupt an atlas on invalid input.

### Non-goals

- Parsing the user's project or guessing which entries apply.
- Automatic codemods or rewrite suggestions generated from code.
- Mirroring all DSH documentation.
- A signed, auto-updating feed.
- A general-purpose database or query language.
- Deciding whether a version is "compatible"; the atlas records changes, not
  a support matrix.

## 3. Data model

```json
{
  "schemaVersion": 1,
  "title": "DSH Upgrade Atlas",
  "unofficial": true,
  "license": "Apache-2.0",
  "maintainedBy": "dsh-next-suite contributors",
  "source": "https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/upgrade-guide",
  "entries": [
    {
      "id": "node-24-9-minimum",
      "package": "@deepseek-ai/dsh",
      "from": "0.2.1-rc.2",
      "to": "*",
      "kind": "runtime",
      "severity": "P0",
      "summary": "DSH requires Node.js 24.9 or newer.",
      "fix": "Upgrade the Node.js used to start DSH and update CI/container pins.",
      "evidence": [
        "docs/upgrade-guide/v0.2.1-rc.2/node-24/guide.md",
        "https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.1-rc.2/node-24/guide.md"
      ]
    }
  ]
}
```

The top-level metadata is advisory. `createAtlas()` returns
`{ schemaVersion, entries }`; the CLI preserves extra top-level fields when it
loads and rewrites a file.

`createAtlas()` validates a fresh entry array. `addEntry(atlas, entry)` appends
to an existing atlas object or bare array and returns the same container. Both
reject duplicate ids; `addEntry` validates before mutating, so a rejected entry
leaves the atlas unchanged.

### Required fields

| Field | Invariant |
| --- | --- |
| `id` | Non-empty lowercase kebab-case; unique within an atlas. |
| `package` | Non-empty string. The primary affected npm package. |
| `from` | Concrete semver-like DSH version. First release with the breakpoint. |
| `to` | Concrete version or `*`. Inclusive last affected release. |
| `kind` | Lowercase kebab-case category. The eight documented kinds are the bundled set; custom atlases may add categories. |
| `severity` | `P0`, `P1`, `P2`, or `P3`. |
| `summary` | Non-empty, concise explanation. |
| `fix` | Non-empty migration action. |
| `evidence` | Non-empty string or array of non-empty strings. Normalized to an array. |

Validation rejects unknown `severity` values and malformed `kind` values. It deliberately does
not validate package-name syntax beyond non-emptiness, because scoped names and
future package conventions vary.

### Kinds

| Kind | Use |
| --- | --- |
| `runtime` | Node.js, Python, or other host runtime requirements/removals. |
| `package` | Package renames, moved exports, removed root helpers. |
| `api` | Service methods, classes, wire/projection shapes. |
| `config` | `cordis.yml` keys, environment variables, plugin options. |
| `protocol` | Message delivery, persistence payloads, event semantics. |
| `tool` | Tool names, registration, or execution behavior. |
| `agent` | Subagent/Team tooling and identity. |
| `ui` | Labels, docs, screenshots, terminology. |

`kind` is a lowercase slug rather than free text so that `stats()` and
`--kind` prefix queries stay predictable. The bundled corpus uses the eight
recommended kinds below; `stats()` zero-fills those buckets and counts any
custom kind it encounters. Adding a recommended kind is a documentation-level
change.

### Severity

- `P0`: startup, installation, or Session-store compatibility can be blocked.
- `P1`: a core workflow, plugin, or integration breaks.
- `P2`: regression or rename with a mechanical migration.
- `P3`: wording, UI, docs, or low-risk API cleanup.

Severity is about upgrade risk, not about how much text a guide spends on the
change. The Node 24.9 floor is P0 because an unsupported runtime can prevent
DSH from starting at all. A package rename that only affects imports is P2 even
if the guide is long.

## 4. Version semantics

DSH versions are semver-like with prereleases such as `0.2.1-rc.2` and
`0.2.2-alpha.3`. The atlas does not pull in a semver dependency; it implements
the small precedence subset it needs:

1. Compare `major`, `minor`, `patch` numerically.
2. A release has higher precedence than its prereleases:
   `0.2.1-rc.2 < 0.2.1`.
3. Prerelease identifiers are compared left to right. Numeric identifiers
   compare numerically, alphanumeric identifiers compare lexically, and a
   numeric identifier is lower than an alphanumeric one. A longer prerelease
   wins only when all shared identifiers are equal.
4. Build metadata is not accepted.

A leading `v` is accepted and ignored.

### Entry windows

`from` and `to` define an inclusive affected range. `to: "*"` is an open upper
bound meaning "still current in the latest release covered by this atlas".

`from` must be concrete. A partial `from` such as `0.2` is accepted and
expanded to the start of that prefix (`0.2.0-0`). A partial `to` is expanded to
the end of that prefix, exclusive at the next component
(`0.2` -> everything before `0.3.0-0`). Bundled data uses exact versions.

### Query windows

A query may provide `from`, `to`, both, or neither. Missing bounds are open.

- Query `from` without a prerelease starts at `<version>-0`, so `0.2.1` covers
  `0.2.1-rc.*` and `0.2.1`.
- Query `to` without a prerelease ends just before the next patch's first
  prerelease, so `0.2.1` includes `0.2.1` and its prereleases but excludes
  `0.2.2-alpha.1`.
- Query versions with a prerelease are exact.
- Partial versions are prefix windows, useful for "all of 0.2.x".

An entry matches when `[entry.from, entry.to]` intersects the query window. The
implementation compares the entry's upper bound with the query's lower bound
and the entry's lower bound with the query's upper bound; open bounds skip the
corresponding test. An empty window (`from` after `to`) throws
`INVALID_QUERY` instead of silently returning nothing.

Examples:

| Entry range | Query | Match? | Why |
| --- | --- | --- | --- |
| `0.2.1-rc.2`..`*` | from `0.2.1`, to `0.2.1` | yes | `0.2.1-rc.2` is inside the prefix window. |
| `0.2.2-alpha.3`..`*` | to `0.2.1` | no | `0.2.2-alpha.3` starts after `0.2.2-0`, the exclusive end. |
| `0.2.0`..`0.2.1` | from `0.2.1` | yes | entry end equals query start; both inclusive. |
| `0.2.0`..`0.2.1` | from `0.2.1-rc.1` | yes | `0.2.1 > 0.2.1-rc.1`. |
| `0.2.0`..`0.2.1` | from `0.2.2` | no | entry ends before the query starts. |
| any `*` range | from `0.3.0` | yes | an open-ended breakpoint still applies. |

## 5. Query behavior

```js
query(atlas, { package, from, to, severity, kind })
```

- `package`, `severity`, and `kind` are prefix filters.
  - `@deepseek-ai/dsh-office` matches the entry filed under the old
    `dsh-office-to-pdf` name; the new `dsh-office-kit` name shares the prefix.
  - `P` matches every severity; `P0` matches only P0.
  - `r` matches `runtime`.
- Unknown filter keys throw `INVALID_QUERY`, so typos are not silently ignored.
- Unknown severity prefixes and malformed kind values throw `INVALID_QUERY`.
  An unknown but well-formed kind prefix simply matches nothing.
- Version filters are validated with `INVALID_QUERY` errors.
- Results are sorted by:
  1. severity rank (`P0` first),
  2. package name (code-unit order, stable across locales),
  3. `from` version (semver precedence),
  4. id (code-unit order).

The query does not clone entries. Callers that want to mutate results should
clone first; the CLI serializes them immediately.

## 6. Rendering

`renderMarkdown()` sorts and groups by severity. Each group gets a level-2
heading and a five-column table:

```markdown
| package | from → to | kind | summary | fix |
| --- | --- | --- | --- | --- |
```

Pipes are escaped as `\|` and newlines become `<br>` so one entry cannot break
the table. `evidence` is intentionally not a column: the rendered sheet is for
humans executing a migration, and evidence belongs in the JSON/API output. The
README and the JSON file are the traceability path.

An empty atlas renders a title and `_No entries._` rather than an empty file.
The output always ends with exactly one newline.

## 7. CLI boundaries

`src/cli.js` contains only:

- `node:util.parseArgs` handling,
- file reads/writes,
- JSON serialization,
- stdout/stderr formatting.

All validation, querying, rendering, and counting go through `src/core.js`.
This keeps the core offline-testable and makes future front ends (Web, MCP,
SDK) reuse the same semantics.

Behavioral choices:

- `--help` and `--version` never load the atlas, so they work with a missing
  or broken data file.
- `list` and `query` share the same filters; `list` with no filters is the
  catalog, `query` is the name for filtered use.
- `render` accepts the same filters, so a P0-only sheet is one command.
- `add` validates the candidate entry **before** reading or writing the atlas,
  then validates the merged atlas again through `addEntry`. A failed add leaves
  the file byte-for-byte unchanged.
- The atlas file may be `{ "entries": [...] }` or a bare entries array. The
  added entry may be a bare entry object or a `{ "entry": {...} }` wrapper. The
  entry is read from `--file` or stdin.
- Successful `--json` output is a single JSON value on stdout. Errors go to
  stderr with a non-zero exit status.
- `--out -` writes rendered Markdown to stdout.

## 8. Evidence policy

An entry is only accepted with at least one evidence string. The bundled corpus
uses two forms per entry:

1. A path relative to a DSH source checkout, e.g.
   `docs/upgrade-guide/v0.2.1-rc.2/node-24/guide.md`.
2. The corresponding GitHub URL on `master`.

This makes the data useful both offline (with a DSH checkout) and online.
Evidence may be a string for simple entries; the core normalizes it to an
array.

The `plugin-index-wording` entry is the one non-guide case. It records a UI
label rename from "Custom plugin markets" back to "Custom plugin indexes". Its
evidence is the current user guide plus the commit that changed the label. Its
`from` version `0.2.2-alpha.1` was checked with
`git merge-base --is-ancestor`: the rename commit is in that release and not in
`0.2.1-rc.4`. The README and the entry make that check visible.

The atlas does not copy long guide text. Summaries paraphrase; readers follow
the evidence for exact wording, conditions, and exceptions.

## 9. Failure modes

| Situation | Behavior |
| --- | --- |
| Missing/invalid required field | `AtlasError` `INVALID_ENTRY` with an `issues` array. |
| Duplicate id in `createAtlas`/`addEntry` | `AtlasError` `DUPLICATE_ID`; `add` does not write. |
| Reversed or invalid version range | `INVALID_ENTRY`; `from` must be concrete. |
| Unknown filter key or severity/kind | `INVALID_QUERY`. |
| Empty query window | `INVALID_QUERY`, not an empty result. |
| Missing default atlas | I/O error for read commands; `add` creates an empty atlas. |
| Invalid JSON in `--data` | `INVALID_ATLAS` with the file path. |
| Unknown command | `USAGE` error with a non-zero exit. |
| No command | Help on stderr, non-zero exit. |

No expected failure prints a stack trace; unexpected errors print their message and exit non-zero.

## 10. Security and trust

- The core has no imports and no I/O, so it cannot fetch, execute, or evaluate
  data.
- The CLI reads local JSON and writes local JSON/Markdown. It performs no
  network requests.
- Markdown cells are escaped for table boundaries. This prevents a data-driven
  table break, not all Markdown injection. A rendered sheet from an untrusted
  atlas should still be reviewed.
- `add` validates before writing, but it does not sandbox the target path; it
  writes wherever `--data` points.
- The corpus is not signed. Community edits are reviewable in git history;
  verify evidence before trusting a new entry.

## 11. Testing strategy

`node --test` covers:

- valid and invalid entries,
- missing fields, bad severity values, malformed kinds, reversed ranges,
- evidence normalization,
- duplicate handling in `createAtlas` and `addEntry`,
- package/severity/kind prefix queries,
- version-window overlap, prefix versions, and empty windows,
- deterministic severity ordering,
- Markdown grouping and cell escaping,
- empty atlas rendering and stats,
- the bundled corpus (count, uniqueness, evidence presence),
- CLI help, version, list/query/render/stats JSON, add, duplicate failure,
  stdin add, validation-before-write, and unknown commands.

The suite has no network dependency and uses temporary directories under the
OS temp directory for write tests.

## 12. Alternatives considered

- **Use `semver` from npm.** Rejected: the package must stay dependency-free
  and offline; DSH's version subset is small. The cost is a hand-written
  comparator, paid for with dedicated tests.
- **Store only a release list, not ranges.** Rejected: an open-ended
  breakpoint would need a new row for every release, and a 0.2.1 fix that was
  reverted would be hard to represent.
- **Parse the upgrade guides at runtime.** Rejected: the guides are prose, the
  parse would be brittle, and the package must work without a DSH checkout.
- **Put evidence in the Markdown table.** Rejected for the rendered sheet: the
  table becomes unreadable. Evidence remains in JSON/API output and the source
  file.
- **Use exact versions only for queries.** Rejected: operators say "0.2.1",
  not "0.2.1-rc.2". Prefix-aware windows match how people describe upgrades.
- **Make `stats` return only present buckets.** Rejected: zero-filled buckets
  give a stable shape for dashboards and tests.

## 13. Naming and release（命名核验与发布）

- npm name: `dsh-upgrade-atlas`.
- On 2026-11-14 the npm registry returned `E404` for the name, so it was
  unpublished then. Re-check before publishing; this is not a reservation.
- The package intentionally avoids the `@deepseek-ai/*` scope. That scope
  belongs to the upstream project.
- The `bin` name equals the package name, so global installs do not shadow an
  existing command.
- Version 0.1.0 is an MVP. The data format has `schemaVersion: 1`; breaking
  changes to the format require a new schema version and a documented
  migration.
- The package is Apache-2.0. Upstream DSH facts and quotes remain subject to
  their own licenses; evidence links are provided for verification.

## 14. Future work (not promised)

- A `check` command that reads a profile's `cordis.yml` and reports likely
  impacts.
- Per-entry `tags` for plugin authors, desktop, SDK, and Python.
- A generated index page that keeps the Markdown sheet in sync with JSON.
- More entries for releases after 0.2.2, with the same evidence standard.

These are directions, not commitments. The atlas stays useful only if every
entry remains traceable to a primary DSH source.
