# dsh-upgrade-atlas

Community-maintained atlas of DeepSeek Harness (DSH) upgrade breakpoints:
record them once, query the ones that affect your upgrade window, and render a
Markdown migration sheet.

> **Unofficial.** This is a community project, not a DeepSeek product. It is not
> affiliated with, endorsed by, or maintained by DeepSeek. The authoritative
> source is always the DSH repository and its release notes.
>
> **社区维护、非官方项目。与 DeepSeek 无隶属关系。** 以 DSH 上游仓库与 release
> notes 为准。

- **Package:** `dsh-upgrade-atlas`
- **Version:** 0.2.2 (published on npm)
- **License:** Apache-2.0
- **Runtime:** Node.js `^22.19.0 || >=24.9.0`
- **Data:** 50 curated DSH 0.1.7–0.2.2-rc.2 breakpoints in [`data/atlas.json`](data/atlas.json); 49 carry a concrete `to` release, 1 is `*` with `target unknown`
- **Dependencies:** none

## What it is

DSH upgrade notes are spread across `docs/upgrade-guide/v<release>/<topic>/`
directories. That is fine when you already know which release you are reading,
but painful when you need to answer:

- "I am upgrading from 0.2.2 to 0.2.2. What can break?"
- "Does anything in the Office packages affect my profile?"
- "Which P0 changes must I fix before I start the new version?"
- "Give me a one-page migration checklist for the release window."

This package turns those notes into a small, validated index:

```text
data/atlas.json  ->  validateEntry / createAtlas
                 ->  query(atlas, { package, from, to, severity, kind })
                 ->  renderMarkdown(entries)  ->  Markdown grouped by severity
                 ->  stats(atlas)             ->  counts by severity and kind
```

The atlas is deliberately small and hand-curated. It is a map, not an
automatic compatibility oracle.

## Why

Upgrade notes are spread across release directories, and a missed P0 breakpoint
can block startup rather than merely annoy. Recording each breakpoint once, with
a package/version window and evidence, makes the upgrade question answerable
without re-reading every release note. The atlas is hand-curated, so the value is
in traceable evidence and a stable query shape, not in exhaustive coverage.

## Install

The package is published as `dsh-upgrade-atlas@0.2.2`. From npm:

```sh
node packages/dsh-upgrade-atlas/src/cli.js --help
node packages/dsh-upgrade-atlas/src/cli.js list
node packages/dsh-upgrade-atlas/src/cli.js query --severity P0
```

After publishing:

```sh
npm install -g dsh-upgrade-atlas
dsh-upgrade-atlas --help
```

The CLI uses only Node built-ins. No install step, network call, or build is
required.

## Usage

```text
dsh-upgrade-atlas <command> [options]

Commands:
  list      List entries, optionally filtered
  query     Query entries by package, version window, severity, or kind
  render    Render Markdown grouped by severity
  stats     Count entries by severity and kind
  add       Add one entry from JSON (--file or stdin)

Options:
  --data <path>       Atlas JSON (default: bundled data/atlas.json)
  --package <prefix>  Package-name prefix
  --from <version>    Window start (inclusive, prefix-aware)
  --to <version>      Window end (inclusive, prefix-aware)
  --severity <level>  P0, P1, P2, or P3
  --kind <kind>       Entry kind (prefix allowed)
  --file <path>       Entry JSON for add; "-" reads stdin
  --out <path>        Write render output to a file; "-" writes stdout
  --json              Machine-readable output
  -h, --help          Show help
  -V, --version       Show version
```

### Examples

List only the blockers:

```sh
dsh-upgrade-atlas list --severity P0
```

Ask what changes affect a 0.2.2 -> 0.2.2 upgrade:

```sh
dsh-upgrade-atlas query --from 0.2.2 --to 0.2.2
```

Narrow to Office packages and machine-readable output:

```sh
dsh-upgrade-atlas query --package @deepseek-ai/dsh-office --json
```

Render a migration sheet:

```sh
dsh-upgrade-atlas render --out UPGRADE.md
```

Add a newly discovered breakpoint, validating it before writing:

```sh
dsh-upgrade-atlas add --data ./atlas.json --file ./new-breakpoint.json
```

`add` refuses duplicate ids, validates every required field, and writes the
whole atlas only after validation succeeds. If the target `--data` file does
not exist, an empty atlas is created.

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Command completed, including an empty `list`/`query` result |
| `1` | Reserved: this tool has no business-negative result |
| `2` | Usage, input, validation, or IO error (no command, unknown option, bad `--data`, duplicate id) |

`-h` / `--help` exits `0`; `-V` / `--version` prints `dsh-upgrade-atlas 0.1.0`
and exits `0`. With `--json`, every command prints one object with at least
`{ command, ok }`; `list` and `query` put the array in `entries` and add `count`.

### Data model

Each entry has exactly these required fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Stable lowercase kebab-case identifier. Duplicate ids are rejected. |
| `package` | string | Primary affected npm package. |
| `from` | string | First DSH release that contains the breakpoint; must be concrete. |
| `to` | string | Last release bounded by the entry's primary evidence. For a guide-backed entry this is the guide's release directory; `*` means no target release could be established. |
| `kind` | string | Lowercase kebab-case category. Bundled data uses `runtime`, `package`, `api`, `config`, `protocol`, `tool`, `agent`, or `ui`; custom atlases may add categories. |
| `severity` | `P0`..`P3` | Impact level; see below. |
| `summary` | string | What changed, in one or two sentences. |
| `fix` | string | Concrete migration action. |
| `evidence` | string \| string[] | One or more DSH source paths or URLs. The core normalizes this to an array. |

#### Severity

| Level | Meaning |
| --- | --- |
| `P0` | Startup, installation, or Session compatibility can be blocked. Fix before upgrading. |
| `P1` | A core workflow, plugin, or integration breaks. Plan a migration. |
| `P2` | Behavior or configuration degrades, or a package/API rename needs mechanical updates. |
| `P3` | Wording, labels, UI, or low-risk API cleanup only. |

#### Version windows

`from` and `to` form an inclusive affected range. A query's `from`/`to` form a
second window, and an entry matches when the two windows overlap. Missing query
bounds are open.

The comparison is semver-like and prerelease-aware:

- `0.2.2-rc.2 < 0.2.2 < 0.2.2-alpha.1 < 0.2.2`.
- A query version without a prerelease is prefix-aware: `--from 0.2.2`
  starts at `0.2.2-0`, and `--to 0.2.2` ends just before `0.2.2-0`.
- A partial version is a full prefix: `--from 0.2 --to 0.2` covers every
  `0.2.x` release.
- `*` is an open upper bound. In the data, a `to` of `*` means "target unknown:
  no upgrade-guide release directory or release note maps this behavior to a
  release". Every open-ended entry says `still current` and `target unknown` in
  its `summary`.
  A concrete `to` is an evidence bound, not a claim that later releases are
  unaffected: most guide-backed entries use the guide's release directory as
  both `from` and `to`, while an entry that was superseded spans a longer
  window (for example, `plugin-index-wording` from `0.2.2-alpha.4` through
  `0.2.2-rc.5`). Read the summary's `still current` note for applicability
  after `to`.

Because guide-backed entries are pinned to their guide release, a query
returns the breakpoints **targeted in** the window, not every breakpoint that
still applies. For cumulative applicability, widen the query to the earliest
release you care about and read each summary's `still current` note.

`package`, `severity`, and `kind` filters are prefixes. For example,
`--package @deepseek-ai/dsh-office` matches the Office conversion entry filed
under the old `@deepseek-ai/dsh-office-to-pdf` name; a future entry filed under
`@deepseek-ai/dsh-office-kit` would match the same prefix. `--kind r` matches
`runtime`.

Results sort by severity (`P0` first), package, `from` version, and id.

### Library API

```js
import {
  addEntry,
  createAtlas,
  query,
  renderMarkdown,
  stats,
  validateEntry,
} from 'dsh-upgrade-atlas'

const entry = validateEntry({
  id: 'my-breakpoint',
  package: '@example/dsh-plugin',
  from: '0.2.2-rc.2',
  to: '*',
  kind: 'api',
  severity: 'P1',
  summary: 'A service method was removed.',
  fix: 'Use the replacement service.',
  evidence: ['docs/upgrade-guide/v0.2.2-rc.2/example/guide.md'],
})

const atlas = addEntry(createAtlas([]), entry)
const hits = query(atlas, { package: '@example/', from: '0.2.2', to: '0.2.2' })
console.log(renderMarkdown(hits))
console.log(stats(atlas))
```

- `validateEntry(entry)` throws `AtlasError` with code `INVALID_ENTRY` and an
  `issues` array on failure; on success it returns a trimmed, normalized copy.
- `createAtlas(entries)` validates every entry and rejects duplicate ids.
- `addEntry(atlas, entry)` appends in place and returns the same atlas/array;
  invalid or duplicate input leaves it unchanged.
- `query(atlas, filters)` validates filters and returns a sorted array.
- `renderMarkdown(entriesOrAtlas)` returns a Markdown string.
- `stats(atlas)` returns `{ total, bySeverity, byKind }` with zero-filled
  buckets.

### Evidence and maintenance

Every bundled entry cites at least one DSH source. Paths are relative to a DSH
source checkout, and the parallel GitHub URL is included for convenience:

```text
docs/upgrade-guide/v0.2.2-rc.2/node-24/guide.md
https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.2-rc.2/node-24/guide.md
```

The `plugin-index-wording` entry cites the upstream user guide and the two
commits that introduced and reverted the label, because that wording change is
not a separate upgrade-guide topic. The label was **Custom plugin markets** from
`0.2.2-alpha.4` through `0.2.2-rc.5` and was presented as **Custom plugin indexes**
again in `0.2.2-alpha.2`; no `0.2.2-alpha.1` release exists. The Session-format and job
entries cite the dated persistence records, and the Windows Markdown-path entry
cites the change commit and the implementation file:

```text
https://github.com/deepseek-ai/deepseek-harness/commit/3de3a977e0cca074b17744f7372644bc57ee63bd
https://github.com/deepseek-ai/deepseek-harness/commit/d10f417f131356a94ebf4ae010930908b6073aec
https://github.com/deepseek-ai/deepseek-harness/commit/c262a09fd0b5491a40ac18bdf0ad9a8252691057
```

The atlas is community-maintained. Corrections are welcome when they cite a
DSH guide, source file, commit, or release note. Do not add an entry from a
single blog post without a primary source. The atlas is reviewed by humans;
it is not generated from upstream release notes.

## Limitations

- **Not exhaustive.** 50 entries cover the 0.1.7–0.2.2-rc.2 breakpoints that were
  documented and verified when this atlas was assembled. New releases add
  new breakpoints; run the upstream upgrade guides for the full text.
- **Hand-curated version mapping.** For guide-backed entries, `from` and (after
  the 2026-11-15 pass) `to` are the guide's release directory: the guide is
  the release-scoped evidence for that breakpoint. Entries without a guide use
  the release tag that first contains the cited persistence record or commit:
  `session-format-v4` starts at `0.1.7-alpha.1`, `job-session-lifecycle` at
  `0.2.2-alpha.3`, and `windows-markdown-path-backslashes` at
  `0.2.2-alpha.2`. Release notes pin two of them: `session-format-v4` to
  `0.1.7-alpha.1` and `windows-markdown-path-backslashes` to `0.2.2-alpha.2`.
  `job-session-lifecycle` keeps `to: "*"` and says `target unknown`, because
  no upgrade-guide topic or release note maps the lifecycle change to a
  release.
  The `plugin-index-wording` boundary was checked with
  `git show <tag>:docs/user/guide/plugin-market.md`: the market label shipped
  in `0.2.2-alpha.4` through `0.2.2-rc.5`, and the index wording returned in
  `0.2.2-alpha.2`. Re-verify these boundaries if you depend on them.
- **`*` means target unknown.** A `to` of `*` means no release bound could be
  established, not that the breakpoint is fixed. The remaining open-ended entry
  still states `still current` in its summary. A concrete `to` is the last
  release covered by the entry's evidence; it does not assert that later
  releases are unaffected.
- **No project inspection.** The CLI does not read your `cordis.yml`, plugin
  manifests, or Session store. It cannot tell you which entries actually hit
  your setup.
- **No codemods.** `fix` is prose. Applying a migration remains a human or
  project-specific task.
- **No network or signatures.** The bundled JSON is plain, local data. It is
  not signed and does not auto-update. Treat third-party edits as untrusted.
- **Markdown is escaped for table cells only.** Pipes become `\|` and newlines
  become `<br>`; other Markdown syntax in `summary` and `fix` is left as-is.
- **Scope.** The package does not try to be a plugin marketplace, a DSH
  documentation mirror, or an upgrade-wizard. It records and queries
  breakpoints.

## Naming

Checked on **2026-11-14** (Asia/Shanghai):

```sh
npm view dsh-upgrade-atlas version --json
# npm error code E404
# npm error 404 Not Found - GET https://registry.npmjs.org/dsh-upgrade-atlas
```

So the unscoped name was unpublished at that moment. This is not a permanent
reservation: npm names can be claimed at any time, and the check must be
repeated before a release. The `bin` name is the same as the package name.

The package does **not** use the `@deepseek-ai/*` scope. That scope belongs to
the upstream project; a community package must not squat it or imply official
status. The repository metadata points at the community monorepo
`PerryLink/dsh-next-suite`.

## Non-official

This project is community-maintained and unofficial. It is not affiliated with,
endorsed by, or maintained by DeepSeek. Upstream DSH quotes and facts remain the
property of their respective authors; the evidence links exist so readers can
check the source.

## License

Apache License 2.0; see [`LICENSE`](LICENSE). Contributions are accepted under the
same license.
