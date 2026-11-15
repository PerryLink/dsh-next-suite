# HCB v0 — Host Compatibility Baseline (seed)

This is the seed dataset for a citable **Host Compatibility Baseline**: which DSH plugin packages install, load, and pass their tests on which host and Node version.

## Scope (2026-11-15)

- **Host**: DSH `0.2.2-rc.3` (commit `39163dd`), Linux x64.
- **Packages**: the six `dsh-os-*` bundles at `0.1.1` and `0.1.2` (source tags `v0.1.1`, `v0.1.2`).
- **Node**: `24.22.1` (supported; install + tests) and `22.19.0` (outside the host's supported Node range; tests only).
- **Rows**: 24 = 6 packages × 2 versions × 2 Node versions.
- **Checks**: `dsh plugin --profile web add <tarball>` in an isolated `DSH_HOME`; `dsh --profile web --dump-config` contains the bundle entry; `node --test` counts from the tagged package. `host_supported` records whether the host's `engines.node` range accepts the row's Node version.

## Fields

| Field | Meaning |
|---|---|
| `package` / `version` | npm package and version |
| `host` | DSH version tested |
| `node` | Node version used |
| `host_supported` | whether the host's declared `engines.node` range accepts that Node: `true` for `24.22.1`, `false` for `22.19.0` (DSH `0.2.2-rc.3` declares `>=24.9.0`) |
| `install_ok` | tarball installed via `dsh plugin add`: `true`, `false`, `not-tested`, or `unsupported` |
| `dump_config_ok` | bundle entry appears in `--dump-config`: `true`, `false`, `not-tested`, or `unsupported` |
| `tests_pass` / `tests_total` | package test count, or `not-tested` |
| `license` / `repo` / `date` | provenance; `date` is the evidence date, not the release date |

`not-tested` means **no evidence was collected** for that check. It is not `false` and must not be read as a failure or a pass.

`unsupported` means the host's declared runtime range excludes that Node version, so the check was **not attempted by design**. It is not `false`, not `not-tested`, and not a package-level incompatibility. Every `unsupported` cell pairs with `host_supported=false`; the validator enforces that pairing and the `0.2.2-rc.3` Node floor.

## Evidence behind the 24 rows

### Node 24.22.1 — install and config dump (both versions)

On 2026-11-15, all six tarballs from each tag were packed with `npm pack` and installed into a throwaway `DSH_HOME` (`mktemp -d`, never the user profile):

```sh
DSH_HOME=<temp> node .../@deepseek-ai/dsh/lib/bin.js plugin --profile web add <six tarballs>
DSH_HOME=<temp> node .../@deepseek-ai/dsh/lib/bin.js --profile web --dump-config
```

- `0.1.1`: six `+ dsh-os-* 0.1.1` lines; dump has six `# == dsh-os-*` sections.
- `0.1.2`: six `+ dsh-os-* 0.1.2` lines; dump has six `# == dsh-os-*` sections.
- Toolchain: Node `24.22.1`, DSH `0.2.2-rc.3`, pnpm `12.16.1`. Peer-dependency warnings were present but did not block install (same warning recorded in `dsh-os-suite/AUDIT.md`).
- The packed tarballs were compared with the published npm artifacts for both versions (`diff -rq` on the extracted trees): all six contents are identical, so the install evidence applies to the npm packages, not only to the git tags.
- The dump was checked for exactly six `# == dsh-os-*` sections; no other `dsh-os-*` layer appeared.

### Tests — Node 24.22.1 and Node 22.19.0

The tagged test files were run per package (`node --test
packages/dsh-os-<name>/test/*.test.js`) against both tags:

| Package | tests_pass / tests_total |
|---|---|
| `dsh-os-trace` | 11 / 11 |
| `dsh-os-lease` | 12 / 12 |
| `dsh-os-quota` | 22 / 22 |
| `dsh-os-eval` | 17 / 17 |
| `dsh-os-catalog` | 12 / 12 |
| `dsh-os-registry` | 16 / 16 |

The Node `22.19.0` column was measured with the official `v22.19.0` Linux x64 binary. This agrees with the GitHub Actions CI matrix for the `v0.1.2` tag (run [43596789668](https://github.com/PerryLink/dsh-os-suite/actions/runs/43596789668), job "Node 22.19.0", **90/90 pass**). The `0.1.1` and `0.1.2` test files are byte-identical (the `0.1.2` tag changes versions and READMEs only), so both versions carry the same 90-test split.

### Node 22.19.0 — install and dump are `unsupported`

DSH `0.2.2-rc.3` declares `"engines": { "node": ">=24.9.0" }` in the host
`package.json` (verified 2026-11-15 against the host checkout), so Node
`22.19.0` is outside the supported host range. The install/profile smoke is
therefore not a meaningful Node 22 test: `install_ok` and `dump_config_ok` are
`unsupported` for all twelve Node 22 rows, and `host_supported` is `false`.
The package-level `node --test` suite still runs under Node 22, so
`tests_pass`/`tests_total` remain counts. Do not infer host installability on
Node 22 from the passing tests.

### Host expansion probe: `0.2.1` and `0.2.2-rc.1` (2026-11-15)

A requested expansion to older hosts produced **no new matrix rows**: neither
host reached a certifiable install + dump. Per the row rule (success → six
rows; failure → recorded reason), `matrix.csv` remains at 24 rows.

| Host | `npx` probe | `install_ok` | `dump_config_ok` | Outcome |
|---|---|---|---|---|
| `0.2.1` | exit 1 | `not-tested` | `not-tested` | `npx @deepseek-ai/dsh@0.2.1` cannot resolve: `ETARGET` on the configured mirror and `E404` on `registry.npmjs.org`. No `0.2.1` release exists, so no host was available for install or dump. |
| `0.2.2-rc.1` | `0.2.2-rc.1` | `false` | `false` | Six `dsh-os-*@0.2.1` tarballs were added to a temporary profile, then the plugin manager rejected each package: `engines.dsh` is `>=0.2.2-rc.3 <0.3.0` and the host is `0.2.2-rc.1`. It restored `package.json`, `pnpm-lock.yaml`, and `node_modules`. A follow-up `--dump-config` exited 0 with **zero** `dsh-os-*` sections. |

Probe details:

- Node `24.22.1`, npm/npx `11.19.1`, Linux x64; `DSH_HOME` was a fresh
  `mktemp -d` directory, never the user profile.
- The six tarballs are the published `dsh-os-*@0.2.1` npm artifacts; their
  sha512 digests match npm `dist.integrity` (see evidence).
- Raw logs, the exact commands, tarball digests, and the 1,243-line dump are in
  [`evidence/2026-11-15/`](evidence/2026-11-15/). The `0.2.1` log includes the
  official-registry `E404` check.
- `not-tested` for `0.2.1` means the check could not be attempted because the
  host release does not exist; it does not mean `npx` was unavailable.

## Limits

- One host version (`0.2.2-rc.3`), one OS (Linux x64), two Node versions. This is **not** a compatibility guarantee.
- Node 22 rows are **test-only**: `tests_pass/tests_total` only, with `host_supported=false` and `install_ok`/`dump_config_ok` = `unsupported`.
- No Windows/macOS rows; no `0.2.1` or `0.2.2-rc.1` rows (see the probe above — `0.2.1` is unpublished and `0.2.2-rc.1` rejects `dsh-os-*@0.2.1` via `engines.dsh`); no `0.1.0` rows.
- `0.1.2` is a version-alignment release: its runtime source and tests match `0.1.1`, so the identical test counts are expected, not independent re-certification of the feature set.
- The date column records when the evidence was collected; `2026-11-14` rows are the original seed, `2026-11-15` rows are this expansion.
- Expand by adding rows, not by editing old ones (keep the time series append-only). If a check was not run, write `not-tested`; if the host's engine range excludes the Node version, write `host_supported=false` and `unsupported` for host-level checks; never turn an untested or unsupported cell into `true`.

## Cite

If you use this dataset, cite the repo and commit; a DOI is planned (see `docs/credentials/hcb-doi.md`).

The failed older-host probe is documented separately in
[`evidence/2026-11-15/`](evidence/2026-11-15/); it contributes no matrix rows
and must not be cited as host compatibility.
