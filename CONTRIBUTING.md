# Contributing to dsh-next-suite

Thanks for helping. This is an unofficial community project, **not** affiliated with, sponsored by, or endorsed by DeepSeek. By contributing, you agree that your contribution is licensed under Apache-2.0.

Please read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and [SECURITY.md](SECURITY.md) before you start. Do not report security vulnerabilities in a public issue or pull request.

## Where the source lives: `04-build` and GitHub

- The public repository is <https://github.com/PerryLink/dsh-next-suite>. It is the collaboration surface, the public Git history, and the home of release tags.
- The maintainer workspace keeps the release staging tree at `04-build/dsh-next-suite` in the `deepseek-community-hub` workspace. This staging directory is **not** a standalone Git checkout; its public history lives on GitHub. Release candidates are built, tested, packed, and reviewed there.
- **Tracked files must not diverge.** Maintainers sync the staging tree → GitHub before tagging and publishing, and port an accepted pull request back into staging after merging. Never make a long-lived GitHub-only edit.
- External contributors do **not** need access to `04-build`. Open a pull request on GitHub; maintainers will apply the accepted change to the staging tree and re-sync.
- `node_modules/`, `*.tgz`, and `*.log` are ignored. Do not commit them.


## Branch protection

`main` is protected: changes land through a pull request, the test matrix, `Packed CLI smoke` and CodeQL must pass, and the branch must be up to date before merge. Force pushes and branch deletion are blocked. Create release tags on the merge commit after CI is green.

## Development environment

- **Node.js** `^22.19.0 || >=24.9.0` (the `engines.node` range). The 0.1.1 audit ran on Node 24.22.1 and on 22.19.0.
- **npm** with workspace support. Run commands from the repository root.
- There are no runtime dependencies and no build step. `npm test` works from a clean checkout; `npm install` is only needed if you want workspace links.

```sh
npm test
```

The suite currently reports 242 passing tests across the eight packages. The number may grow; the gate is **zero failures**, not a fixed count.

Check every source file for syntax errors:

```sh
# POSIX
for f in packages/*/src/*.js; do node --check "$f"; done
```

```powershell
# PowerShell
Get-ChildItem packages -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }
```

Useful narrower commands:

```sh
node packages/dsh-capdiff/src/cli.js --help
node packages/dsh-xbrl/src/cli.js --version
node --test packages/cordis-migrate/test/*.test.js
cd packages/cordis-migrate && npm pack --dry-run
```

Core logic and tests are offline: no network, no real `DSH_HOME`, and no credentials. Tests must not write outside a temporary directory.

## CLI contract

All seven CLIs follow the same contract. Add a regression test when you change it.

| Exit code | Meaning |
| --- | --- |
| `0` | Success. Findings, matches, or an empty result are still success unless the tool has a documented business-negative state. |
| `1` | Business-negative result only where documented (`dsh-xbrl check` fails; `testatum-attest verify` fails, refuses, or is revoked). Otherwise reserved and unused. |
| `2` | Usage, input, missing file, bad JSON, or IO error. |

- `-h` / `--help` prints usage and exits `0`.
- `-V` / `--version` prints `<package> <version>` and exits `0`. `-v` is not the version flag.
- `--json` success output is an object with at least `command` and `ok`. Use `items` / `entries` for arrays. `dsh-capdiff --sarif` is the deliberate exception: it emits SARIF 2.1.0, not the suite envelope.
- No arguments, unknown commands, unknown options, and unreadable files are exit `2`.

## Naming and description rules

Package names and descriptions are part of the public contract. Propose the name in an issue **before** opening a package PR.

- **DSH tools** use `dsh-<topic>`. **Cordis tools** use `cordis-<topic>`. Names are lower-case kebab-case and unscoped. `testatum-attest` is an existing product name and an accepted exception; new packages should follow the prefixes.
- The CLI `bin` name should equal the package name, with one bin per package. `src/cli.js` starts with a shebang and is executable (`0755`); other files are `0644`.
- Tool names in output and machine-readable fields are stable; do not rename them without a compatibility note.
- The `description` is one sentence, present tense. Say what the tool does **and** what it is not. Do not use “official”, “certified”, “guaranteed”, “secure”, or “scanner” where the implementation is a heuristic. `dsh-supply-watch` is explicitly “not a security scanner”.
- Required metadata: `license: "Apache-2.0"`, `engines.node`, `repository` / `homepage` / `bugs`, `files` (at least `src`, `README.md`, `DESIGN.md`, `LICENSE`), `exports`, and `bin` for a CLI package.
- A package README has seven semantic sections in this order: `## What it is`, `## Why`, `## Install`, `## Usage`, `## Limitations`, `## Naming`, `## Non-official`, plus `## License`. The Naming section records the name check; the Limitations section states false positives, mocks, and non-goals.
- Before opening the PR, verify the name is free:
  - `npm view <name> version` returns `E404`;
  - GitHub repository search for the exact name returns no repository.
  Paste that evidence in the PR.
- Start a new package from `templates/_template`. The template lives outside `packages/*` on purpose; do not move it back into the workspace.

## Pull requests

- **One logical change per PR.** A bug fix, a feature, a rename, a formatting sweep, and a dependency bump are separate PRs. Do not bundle an unrelated README or CONTRIBUTING edit into a code PR. A release PR (version bump + changelog) is its own PR.
- **Tests are required** for behavior changes. Add or update a `test/*.test.js` case, run `npm test`, and paste the pass/fail summary. Docs-only PRs may skip new tests but must still pass `npm test` and `node --check`.
- **Update the docs.** Add a `CHANGELOG.md` entry under `[Unreleased]` and update the package README for user-visible behavior, CLI flags, exit codes, JSON shapes, or limitations.
- **Preserve the non-official statement.** Every package README must state that it is an unofficial community project, not affiliated with, sponsored by, or endorsed by DeepSeek. Cordis tools must also disclaim the Cordis project. Do not use DeepSeek or Cordis logos or wordmarks, or wording that implies endorsement.
- **Call out contract changes.** Package names, CLI/bin names, exit codes, JSON envelopes, and SARIF output are compatibility surfaces. Explain the break and why it is necessary.
- **No secrets or customer data.** Do not commit tokens, keys, HMAC test secrets, real `.env` files, customer logs, or personal data. Redact evidence.
- **Keep the diff reviewable.** No generated files, no unrelated reformatting, no `node_modules/`, no tarballs.
- In the PR description, include: what changed and why; affected packages; the test commands and results; any migration or compatibility note; and the linked issue.

Security issues go through [SECURITY.md](SECURITY.md), never a public PR or issue.

## Release checklist (maintainers)

1. Sync the staging tree and GitHub so tracked files match.
2. Bump all eight packages together; this suite is released in lockstep.
3. Update `CHANGELOG.md` and the root README status.
4. Run `npm test`, run `node --check` over every `src/*.js`, and smoke-test `--help` / `--version` for all seven CLIs.
5. Inspect `npm pack --dry-run` for each package and confirm the file modes.
6. Publish from a clean tree, tag `v<version>` on GitHub, and create the GitHub release.
7. Record the result in `AUDIT.md` and `CONTRACT-FIX.md` when the contract changes.

Questions about a change are welcome in a bug or feature issue. Use the templates in `.github/ISSUE_TEMPLATE/`.
