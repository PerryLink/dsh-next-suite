# dsh-next-suite

Eight small, composable tools for the DeepSeek Harness / Cordis / agent-plugin ecosystem — plus three non-code artifacts (credentials, a dojo, an atlas).

> **Community project. Not affiliated with, sponsored by, or endorsed by DeepSeek.**
> Apache-2.0. No SLA, no warranty. Early MVP (0.1.0), not published yet.

This suite is deliberately **not** another set of governance packages. It targets the gaps left after [`dsh-os-suite`](../dsh-os-suite/): plugin trust, Cordis developer experience, and a domain-data check.

## Packages

| Package | Type | One-liner |
|---|---|---|
| [`dsh-capdiff`](packages/dsh-capdiff/) | CLI | Declared `dsh.capabilities` vs actual imports in plugin code; SARIF + suggested manifest. |
| [`testatum-attest`](packages/testatum-attest/) | CLI | Trust card for plugin artifacts: content hashes, HMAC signature, revocation, offline verify. |
| [`dsh-supply-watch`](packages/dsh-supply-watch/) | CLI | Offline typosquat / lookalike / version-anomaly checks for npm names. |
| [`cordis-hmr-doctor`](packages/cordis-hmr-doctor/) | CLI | Parse Cordis HMR logs (`settled` / `aborted` / `skipped`) and explain what happened. |
| [`cordis-migrate`](packages/cordis-migrate/) | CLI | Cordis 3→4 migration rule engine: scan, dry-run, explicit `--write`. |
| [`cordis-testkit`](packages/cordis-testkit/) | library | Mock Cordis context plus effect/listener leak assertions. |
| [`dsh-xbrl`](packages/dsh-xbrl/) | CLI | Offline XBRL fact reconciliation and restatement diff. |
| [`dsh-upgrade-atlas`](packages/dsh-upgrade-atlas/) | CLI/data | Curated DSH upgrade breakpoints: query and render Markdown. |

## Non-code artifacts

- [`CREDENTIALS.md`](CREDENTIALS.md) — 90-day credential plan (DOI, OpenSSF badge, FSE'27, IETF/W3C, 职称). No fabricated results.
- [`DOJO.md`](DOJO.md) — two hands-on labs: Hello Plugin and Governance Lab, with acceptance criteria.
- [`ECOSYSTEM-ATLAS.md`](ECOSYSTEM-ATLAS.md) — seed entity atlas (12 entries), not an exhaustive directory.

## Status (2026-11-14)

- **242/242 tests** across the eight packages (`npm test`; template is outside `packages/`).
- **15 `src/*.js` files** pass `node --check`.
- **8/8 names** are free on npm (`npm view` → E404) and no exact GitHub repo name exists.
- **Pre-release audit**: [`AUDIT.md`](AUDIT.md); contract fixes tracked in `CONTRACT-FIX.md`.
- **Not published**. Next: contract fixes → isolated smoke → npm publish.

## Quick start

```sh
npm test

node packages/dsh-capdiff/src/cli.js --help
node packages/dsh-xbrl/src/cli.js check facts.json
```

## Design rules

- Pure ESM JavaScript + JSDoc, no build; Node `^22.19.0 || >=24.9.0`.
- `src/core.js` imports no third-party packages; tests run offline.
- CLIs are thin: parse args, call core, print. `--json` returns an object envelope.
- No network, no secrets, no destructive writes by default (`cordis-migrate` defaults to dry-run).
- Each README states what the tool is **not**.

## License

Apache-2.0.
