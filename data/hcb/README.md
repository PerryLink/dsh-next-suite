# HCB v0 — Host Compatibility Baseline (seed)

This is the seed dataset for a citable **Host Compatibility Baseline**: which DSH plugin packages install, load, and pass their tests on which host version.

## Scope

- **Host**: DSH `0.2.2-rc.3` (commit `39163dd`), Linux x64, Node `24.22.1`.
- **Packages**: the six `dsh-os-*` 0.1.1 bundles.
- **Checks**: `dsh plugin --profile web add <tarball>` in an isolated `DSH_HOME`; `dsh --profile web --dump-config` contains the bundle entry; package tests pass.

## Fields

| Field | Meaning |
|---|---|
| `package` / `version` | npm package and version |
| `host` | DSH version tested |
| `node` | Node version used |
| `install_ok` | tarball installed via `dsh plugin add` |
| `dump_config_ok` | bundle entry appears in `--dump-config` |
| `tests_pass` / `tests_total` | package test count |
| `license` / `repo` / `date` | provenance |

## Limits

- One host version, one OS, one Node major. This is **not** a compatibility guarantee.
- No Windows/macOS rows yet; no 0.2.1/0.2.2-alpha rows.
- Expand by adding rows, not by editing old ones (keep the time series append-only).

## Cite

If you use this dataset, cite the repo and commit; a DOI is planned (see `docs/credentials/hcb-doi.md`).
