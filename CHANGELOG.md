# Changelog

## [0.2.1] - 2026-11-15

### Fixed
- `dsh-capdiff`: normalize evidence paths to `/` on Windows; scan output is stable across platforms.
- Windows CI: lease mode assertion skipped where POSIX modes do not apply.

## [0.2.0] - 2026-11-15

### Added
- `dsh-capdiff`: acorn AST analysis with regex fallback; real-code benchmark corpus.
- `testatum-attest`: npm provenance/attestation presence checks (subject/repo/commit), not sigstore verification.
- `cordis-migrate`: 26-rule community pack (10 experimental).
- HCB dataset expanded to 24 rows; upgrade atlas 47/50 target versions.
- CI: real CLI smoke, Windows/macOS matrix, coverage artifact.

## [0.1.3] - 2026-11-14

### Changed
- First release published by the GitHub Actions `release.yml` workflow with npm provenance.
- No functional changes; version alignment only.

## [0.1.2] - 2026-11-14

### Fixed
- CLI `--version` now reports the package version (0.1.2) for all seven CLIs.
- `dsh-upgrade-atlas` data expanded from 17 to 50 curated breakpoints.
- Version assertions read `package.json` instead of hard-coding.

### Added
- CI, release workflow with `--provenance`, smoke/verify scripts.
- SECURITY / CONTRIBUTING / CODE_OF_CONDUCT / issue templates.
- Benchmarks for `dsh-capdiff` and `dsh-supply-watch`.
- Runnable Dojo labs; credentials/standard drafts; ecosystem atlas (64 entities).

All notable changes to `dsh-next-suite` are documented here.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The eight packages are versioned and released in lockstep.

## [Unreleased]

### Added

- Repository hygiene documentation: `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, and GitHub issue forms for bugs and features. Security reports are routed to private GitHub Security Advisories.
- A `Security · Contributing · Changelog` navigation line at the top of the root README.

## [0.1.1] - 2026-11-14

### Changed

- All eight packages moved from `0.1.0` to `0.1.1` and were republished to npm.
- README status lines now read `0.1.1` and “published to npm”; several package install sections were updated to show the published package.
- README contract text is now consistent across the suite: `-h/--help`, `-V/--version`, the `0` / `1` / `2` exit-code contract, the `--json` object envelope (`command`, `ok`), and the seven-section package README structure.
- `AUDIT.md` records the fixes and the release.

### Fixed

- Stale “not published” / “not published to npm” status in the package README headers.
- Version metadata in the published tarballs now matches `0.1.1`.

### Notes

- **No runtime source changes** between `0.1.0` and `0.1.1`; the CLI contract fixes were already present in the `0.1.0` tarballs. `0.1.1` is a documentation, status, and version-metadata release.
- npm published `0.1.0` at 2026-11-14 19:38 (+08) and `0.1.1` at 19:44 (+08). GitHub release: [`v0.1.1`](https://github.com/PerryLink/dsh-next-suite/releases/tag/v0.1.1).
- **Known documentation debt:** some package READMEs still contain pre-publication wording (“Not published yet”, “Once published”) or print `0.1.0` in sample output. These are documentation-only, do not affect the `0.1.1` tarballs, and are left for a follow-up package-docs pass.

### Packages

All eight packages at `0.1.1`: `dsh-capdiff`, `testatum-attest`, `dsh-supply-watch`, `cordis-hmr-doctor`, `cordis-migrate`, `cordis-testkit`, `dsh-xbrl`, `dsh-upgrade-atlas`.

## [0.1.0] - 2026-11-14

### Added

- First public release: eight tools for the DSH / Cordis / agent-plugin ecosystem:
  - [`dsh-capdiff`](packages/dsh-capdiff/) — CLI. Compares declared `dsh.capabilities` with imports and `eval`/`env` use found in plugin code; JSON and SARIF output, plus a suggested manifest.
  - [`testatum-attest`](packages/testatum-attest/) — CLI. Trust cards for plugin artifacts: SHA-256 file manifests, HMAC signature, revocation, and offline verification (MVP).
  - [`dsh-supply-watch`](packages/dsh-supply-watch/) — CLI. Offline typosquat, lookalike, and version-anomaly checks for npm names.
  - [`cordis-hmr-doctor`](packages/cordis-hmr-doctor/) — CLI. Parses Cordis HMR logs (`settled` / `aborted` / `skipped`) and explains likely causes.
  - [`cordis-migrate`](packages/cordis-migrate/) — CLI. Cordis 3 → 4 migration rule engine with scan, dry-run, and explicit `--write`.
  - [`cordis-testkit`](packages/cordis-testkit/) — library. Mock Cordis context plus effect/listener leak assertions.
  - [`dsh-xbrl`](packages/dsh-xbrl/) — CLI. Offline XBRL fact reconciliation and restatement diff.
  - [`dsh-upgrade-atlas`](packages/dsh-upgrade-atlas/) — CLI/data. Curated DSH upgrade breakpoints; validate, query, and render Markdown.
- Seven CLIs and one library; 15 `src/*.js` files pass `node --check`; 242 offline tests (`npm test`).
- Unified CLI contract: `-h/--help`, `-V/--version`, exit codes (`0` success, `1` business-negative where applicable, `2` usage/input/IO), and a `--json` object envelope with at least `command` and `ok` (SARIF output keeps the SARIF 2.1.0 shape).
- Seven semantic sections in every package README: What it is, Why, Install, Usage, Limitations, Naming, Non-official, plus License.
- Apache-2.0 LICENSE full text, `DESIGN.md` per package, and Node engine range `^22.19.0 || >=24.9.0`.
- The `_template` scaffold moved to `templates/_template`, outside the `packages/*` workspace and the root test glob.

### Fixed

Pre-release audit findings, fixed before the `0.1.0` publish:

- `repository`, `homepage`, and `bugs` metadata now point at the real public repository instead of a 404 URL;
- CLI exit codes, version flags, JSON envelopes, and README structure were aligned across all eight packages;
- non-CLI files in the tarballs were set to `0644`; CLI entry points stay `0755`.

### Notes

- Published to npm on 2026-11-14 at 19:38 (+08). The audit's functional evidence: 242/242 tests, 15/15 `node --check`, and 7/7 CLI `--help` smoke checks.
- The three non-code artifacts (`CREDENTIALS.md`, `DOJO.md`, `ECOSYSTEM-ATLAS.md`) shipped with the repository; they are plans and drafts, not published results or an exhaustive directory.
