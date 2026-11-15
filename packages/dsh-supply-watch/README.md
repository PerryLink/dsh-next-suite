# dsh-supply-watch

## What it is

Offline, zero-dependency heuristics for catching **npm name lookalikes** and
**suspicious version histories** before a package is installed.

> **Unofficial community tool.** Not affiliated with, endorsed by, or
> maintained by DeepSeek. 本项目与 DeepSeek 官方无隶属关系。
>
> **Not a security scanner.** Findings are leads for a human reviewer. This
> tool does not prove that a package is malicious or safe, and it is not a
> substitute for SCA, advisory data, registry ownership checks, or tarball
> inspection.

- Version: `0.2.0` (published on npm)
- License: Apache-2.0
- Runtime: Node `^22.19.0 || >=24.9.0`, pure ESM, no dependencies

## Why

Typo-squatting, namespace lookalikes, and dependency-confusion bait are cheap
to publish and easy to miss during review. A local, deterministic check can
catch the obvious cases without sending package names to a third-party
service or requiring registry credentials.

The tool is deliberately small:

1. compare a candidate name with a **caller-supplied** list of trusted names;
2. inspect a version history for common anomalies;
3. merge both into one severity-sorted finding list.

## Install

Not published yet. From this repository:

```sh
node packages/dsh-supply-watch/src/cli.js --help
node packages/dsh-supply-watch/src/cli.js check dsh-cora --known dsh-core
```

Once published:

```sh
npm install --save-dev dsh-supply-watch
npx dsh-supply-watch --help
```

### Tests

```sh
node --test packages/dsh-supply-watch/test/*.test.js
```

The suite is offline and covers distance, normalization, typo scoring,
multiple candidates, version anomalies, severity mapping, sorting, empty
input, JSON output, and CLI error paths.

## Usage

The CLI follows the suite contract: no arguments, unknown options/commands, and
unreadable files are usage/input errors (`2`), not business findings.

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | `check` or `scan` completed, even when findings exist |
| `1` | Reserved: findings are leads, not a business-negative result |
| `2` | Usage, input, or IO error (no arguments, unknown option, missing file) |

`-h` / `--help` prints usage and exits `0`; `-V` / `--version` prints
`dsh-supply-watch 0.1.0` and exits `0`.

### Check one name

```sh
dsh-supply-watch check dsh-cora --known dsh-core,dsh-cli
```

```text
[HIGH] typosquat "dsh-cora" -> nearest "dsh-core" (distance 1): edit distance 1 from "dsh-core" (score 88)
```

Add a publication history (oldest first) to run version checks too:

```sh
dsh-supply-watch check dsh-core \
  --known dsh-core \
  --versions 0.0.1,1.0.0,1.2.0,99.0.0
```

### Scan a file

```sh
dsh-supply-watch scan names.txt --known dsh-core,dsh-cli --json
```

`names.txt` format:

```text
# comments and blank lines are ignored
dsh-core
dsh-cli 1.0.0,1.0.2,99.0.0
@scope/plugin 2.0.0 2.0.0-beta.1
```

Each line is a package name, optionally followed by whitespace and a
comma-separated version history. An inline comment needs a space before `#`.
Multiple version tokens separated by whitespace are also accepted.

### JSON

`check` and `scan` both accept `--json`. The payload has a stable top-level
shape:

```json
{
  "command": "scan",
  "ok": true,
  "scanned": 2,
  "knownCount": 1,
  "findings": [],
  "disclaimer": "Offline heuristics only. ..."
}
```

Findings are sorted by severity (`high`, `medium`, `low`), then by descending
score, then by name/code.

### Known names

There is **no baked-in official package list** and **no registry lookup**.
That is intentional: a stale or invented list would create false confidence.
Pass the names you trust:

```sh
dsh-supply-watch check dsh-cora --known "$(cat trusted-names.txt | paste -sd, -)"
```

If `--known` is omitted, typo analysis is inactive; version checks still run.
Never add the package you are investigating to `--known`; that intentionally
whitelists it. Offline also means no proof of ownership: a package matching your
known list is only as trustworthy as the list itself.

### Library API

```js
import {
  levenshtein,
  normalizeName,
  typosquatScore,
  versionAnomaly,
  severityOf,
  watch,
} from 'dsh-supply-watch'

typosquatScore('dsh-cora', ['dsh-core'])
// { nearest: 'dsh-core', distance: 1, score: 88, reason: 'edit distance 1 from "dsh-core"' }

versionAnomaly(['2.0.0', '2.0.0-beta.1'])
// [{ kind: 'version', code: 'prerelease-rollback', score: 86, ... }]

watch([{ name: 'dsh-cora', versions: ['1.0.0', '1.2.0'] }], ['dsh-core'])
// severity-sorted findings
```

`levenshtein(a, b, { maxDistance: 2 })` uses a banded early-exit
implementation and returns `maxDistance + 1` when the threshold is exceeded.

### Heuristics at a glance

### Name signals

Normalization lowercases and collapses `-`, `_`, and `.` into `-`, then
trims edge separators. Scopes are preserved and normalized.

| Signal | Score | Example |
| --- | ---: | --- |
| separator / punctuation variant | 90 | `dsh_core` vs `dsh-core` |
| same characters, different separator placement | 88 | `dshcore` vs `dsh-core` |
| edit distance 1 (name length >= 4) | 88 | `dsh-cora` vs `dsh-core` |
| edit distance 2 (name length >= 5) | 68 | `dsh-cxra` vs `dsh-core` |
| `dsh-` prefix added, omitted, or respelled | 74 | `core`, `node-dsh-core` vs `dsh-core` |
| edit distance 3 (name length >= 9) | 46 | longer names |
| extra trailing segment | 44 | `dsh-core-utils` vs `dsh-core` |
| extra glued suffix | 42 | `dshcoreutils` vs `dsh-core` |
| exact known name | 0 | `dsh-core` vs `dsh-core` |

Recognized DSH prefix forms include `dsh-core`, `dshcore`, `node-dsh-core`,
`deepseek-dsh-core`, and `official-dsh-core`.

### Version findings

| Code | Score | What it means |
| --- | ---: | --- |
| `implausible-major` | 92 | major version `>= 99` |
| `prerelease-rollback` | 86 | a prerelease sorts below the previous publish |
| `major-jump` | 85 / 70 | skips `>= 5` / `>= 2` major versions |
| `version-regression` | 82 | a stable version decreases in publication order |
| `placeholder-version` | 52 | `0.0.0` or `0.0.1` |
| `missing-intermediate` | 45 / 35 | minor-line / patch gap in a version list |

Structural checks (jumps and gaps) sort a copy of the list. Rollback checks
use the order given, so **pass versions oldest-to-newest**.

Severity mapping: score `>= 80` = high, `>= 50` = medium, otherwise low. An
explicit `severity` field wins over the score.

## Limitations

**False positives are expected.** Common causes:

- a legitimate companion package such as `dsh-core-utils`;
- a package that intentionally omits or adds a `dsh-` prefix;
- a real release reset (a new major line after a rewrite);
- yanked/unpublished versions that look like "missing" versions;
- `0.0.1` used deliberately for an early prototype;
- version arrays that are not in publication order (the rollback check will
  produce noise).

**False negatives are expected too.** The tool does not:

- query npm, OSV, GitHub, or any advisory feed;
- inspect tarballs, install scripts, dependency graphs, or source code;
- verify package ownership, maintainers, provenance, or signatures;
- catch Unicode homoglyphs, mixed-script lookalikes, or sophisticated
  brand-impersonation names that are more than a few edits away;
- know whether a package is actually malicious.

**This is not a replacement for SCA.** Use it alongside tools such as
`npm audit`, Socket, Snyk, OSV-Scanner, Dependabot, and a lockfile review
process. A clean `dsh-supply-watch` run means "these specific heuristics found
nothing", not "safe to install".

Other limits:

- npm names are short and sometimes share prefixes; edit-distance thresholds
  are a tradeoff, not a proof. Names shorter than 4 characters are only
  compared by punctuation/prefix signals.
- Scoped names are normalized and preserved, but scope-hopping
  (`@evil/dsh-core`) is not independently detected.
- Invalid/non-semver versions are ignored rather than guessed at.
- The CLI exits `0` when a check completes, even if findings exist. Findings
  do not fail CI by default; wire the JSON output into your own policy.

## Naming

The package name `dsh-supply-watch` was checked against the public npm
registry on **2026-11-14**:

```sh
npm view dsh-supply-watch name version
# npm error code E404
# npm error 404 Not Found - GET https://registry.npmjs.org/dsh-supply-watch - Not found
```

At that moment the public registry returned a 404, which is consistent with the
name being unclaimed. That is a point-in-time observation, not a reservation or
proof of ownership; re-check immediately before publishing:

```sh
npm view dsh-supply-watch
```

## Non-official

**Unofficial community tool.** Not affiliated with, endorsed by, or maintained
by DeepSeek or any standards body. 本项目与 DeepSeek 官方无隶属关系。
"dsh-" only identifies this community suite; it does not imply official status.

## License

Apache-2.0. See [LICENSE](LICENSE).
