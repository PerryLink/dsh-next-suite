# cordis-hmr-doctor

> **Unofficial community tool.** Not affiliated with, endorsed by, or maintained by the Cordis
> project, `@cordisjs`, or DeepSeek. 本项目为非官方社区工具，与 Cordis / DeepSeek 无隶属关系。
> 日志格式按启发式规则解析，不是 Cordis 官方诊断器。
>
> Status: **0.2.4, published on npm.** Apache-2.0.

Turn a Cordis HMR log into a short, explainable report: what settled, what aborted,
what was skipped, which module each line belongs to, and what the likely cause is.

```text
$ cordis-hmr-doctor hmr.log
Cordis HMR Doctor - heuristic HMR log report (unofficial)
=============================================================
Events: 4 total | settled 1 | aborted 2 | skipped 1
Top reason: host-module

Causes (3 event(s) diagnosed):
  dependency-missing [1] - Dependency or module missing
    - [aborted] src/db.ts - Cannot find module 'pg'
  port-in-use [1] - Port already in use
    - [aborted] src/server.ts - listen EADDRINUSE :::3000
  unknown [1] - Unknown or unmapped reason
    - [skipped] src/main.ts - host-module

Suggestions:
  - Install or restore the missing module: check package.json, ...
  - Free the port (stop the other process) or configure a different port ...
  - 1 skipped change(s) cannot be applied in place; restart the Cordis process ...
```

## What it is

Cordis HMR reports three outcomes from a reconcile pass: `settled`, `aborted`, and
`skipped`. In the default logger these often arrive as terse lines — a warning block
listing skipped paths, `reload plugin at ...`, `failed to dispose plugin at ...` — and
the actual reason is buried in the surrounding log.

## Why

When HMR "doesn't pick up my change",
the important question is usually one of:

- is the package actually installed, or did the import fail?
- is this a dependency cycle that cannot be hot-replaced?
- did a restart fail because the port is still occupied?
- is the plugin config invalid?
- did the watcher/reload time out?
- or is this a new, unmapped failure?

`cordis-hmr-doctor` does not run HMR and does not look at your source tree. It reads the
log you already have, extracts events, classifies reasons with ordered heuristic rules,
and prints suggestions plus a machine-readable JSON report.

## Install

Not published yet. From a checkout of `dsh-next-suite` (Node `^22.19.0 || >=24.9.0`):

```sh
node packages/cordis-hmr-doctor/src/cli.js hmr.log
node packages/cordis-hmr-doctor/src/cli.js hmr.log --json
cat hmr.log | node packages/cordis-hmr-doctor/src/cli.js -
```

To get a `cordis-hmr-doctor` executable locally:

```sh
cd packages/cordis-hmr-doctor
npm link
cordis-hmr-doctor hmr.log
```

There are **no runtime dependencies**.

### Development

```sh
node --test packages/cordis-hmr-doctor/test/*.test.js
node packages/cordis-hmr-doctor/src/cli.js --help
```

The tests are offline and cover parsing of all five status words, ANSI/prefix handling,
the official skip block, mixed logs, empty input, summary counts, every cause category,
unknown fallback, suggestions, JSON formatting, and CLI stdin/help/error paths.

## Usage

```text
cordis-hmr-doctor <log> [--json]
cordis-hmr-doctor - < hmr.log
```

| Argument / option | Meaning |
|---|---|
| `<log>` | Path to a plain-text log. |
| `-` | Read the log from stdin. |
| `--json` | Print a stable JSON report instead of text. |
| `-h`, `--help` | Print usage and exit `0`. |
| `-V`, `--version` | Print `cordis-hmr-doctor 0.1.0` and exit `0`. |

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Report produced, even with aborted/skipped events |
| `1` | Reserved: this diagnostic reader has no business-negative result |
| `2` | Usage, input, or IO error (no argument, unknown option, unreadable log) |

A log full of aborted events still exits `0`; this is a diagnostic reader, not a CI gate.
With `--json`, stdout is one object with at least `{ command: "report", ok: true, ... }`.

### Accepted log shapes

The parser is intentionally permissive. It recognises:

```text
# status words, with optional logger decorations
[2026-11-14T10:00:00Z] [INFO] [hmr] settled src/routes/index.ts
[hmr] aborted src/services/db.ts: Error: Cannot find module 'pg'
[hmr] skipped src/main.ts (host-module)
status=aborted module=src/server.ts reason="listen EADDRINUSE :::3000"

# the warning block emitted by @cordisjs/hmr
skipped changes, which apply after a restart:
- src/main.ts (host-module)
- src/native/addon.node (native-addon)

# logger messages used by Cordis/DSH HMR hosts
reload plugin at src/plugins/logger.ts
failed to reload plugin at src/plugins/broken.ts
failed to dispose plugin at src/plugins/old.ts
config reload at cordis.yml failed
```

Unrelated lines (`watching ...`, `change detected at ...`, prose) are ignored. ANSI colour
codes and common prefixes (ISO timestamps, `INFO`/`WARN`, `[hmr]`) are stripped before
matching. Paths with spaces work when quoted, or in the official skip-block bullet form.

### Important caveat

The default Cordis HMR logger does **not** normally print one `settled` line per fiber:
`settled`/`aborted`/`skipped` are fields of the `ctx.hmr.reconcile()` result. A host,
wrapper, or debug build may log those statuses line by line; this tool handles such lines
when they exist. It also understands the real `@cordisjs/hmr` skip warning block and the
legacy `reload plugin at` / `failed to ... plugin at` messages. It cannot reconstruct
events that were never written to the log.

### Library API

The package is pure ESM with JSDoc types and no build step.

```js
import {
  parseHmrLog,
  diagnose,
  summarize,
  buildReport,
  formatReport,
} from 'cordis-hmr-doctor'

const events = parseHmrLog(await readFile('hmr.log', 'utf8'))
// [{ status, module, reason, line, raw }, ...]

summarize(events)
// { total, settled, aborted, skipped, topReason }

diagnose(events)
// { counts, causes, suggestions }

buildReport(await readFile('hmr.log', 'utf8'))
// { events, summary, counts, causes, suggestions }

formatReport(report)            // text
formatReport(report, { json: true }) // pretty JSON string
```

`formatReport` also accepts a raw event array or a `diagnose()` result.

### Event shape

| Field | Type | Notes |
|---|---|---|
| `status` | `settled \| aborted \| skipped \| reload \| dispose` | Lower-case status. |
| `module` | `string \| null` | Path/URL/plugin path extracted from the line. |
| `reason` | `string \| null` | Inline error text or skip reason. |
| `line` | `number` | 1-based line number in the input. |
| `raw` | `string` | Original line, including any ANSI codes. |
| `failed` | `boolean?` | Present and `true` for `failed to reload/dispose`. |

### Causes

| Cause code | Typical reason text | Suggestion |
|---|---|---|
| `dependency-missing` | `Cannot find module`, `ERR_MODULE_NOT_FOUND`, `ENOENT`, failed resolve | Install/restore the module, check `package.json` and the specifier. |
| `circular` | `Circular dependency`, `cycle`, `循环依赖` | Break the cycle or use a lazy import. |
| `port-in-use` | `EADDRINUSE`, `address already in use`, `端口占用` | Stop the other listener or change the port. |
| `config-error` | `Invalid config`, schema/option errors, invalid plugin export | Fix the config/plugin against its schema, then restart. |
| `timeout` | `timed out`, `ETIMEDOUT`, `超时` | Raise the timeout/debounce or shrink the graph; check hangs. |
| `unknown` | anything else, including official skip reasons | Inspect the raw lines; the parser could not map it. |

`diagnose()` only classifies actionable events: `aborted`, `skipped`, failed
`reload`/`dispose`, or a status line with a failure-like reason. Clean `settled` events
count in `summarize()` but not in diagnosis counts. `counts.total` is therefore the
number of diagnosed events, not the total number of log events.

`summarize()` reports the most frequent **raw** reason string; ties keep the first one
seen. It does not normalise reasons to cause codes.

## Limitations

- **Heuristic, not an official parser.** There is no published line-by-line HMR log grammar.
  Status words are matched by shape; new log formats need new patterns. See
  [DESIGN.md](DESIGN.md).
- **Line-oriented.** A multi-line stack trace is not attached to the status line above it.
  The tool reports the reason present on that line; inspect neighbouring raw lines for the
  full error.
- **No reconstruction.** It never invents events for missing log lines (for example, a
  default Cordis logger that only prints `reload plugin at` will not yield `settled`).
- **No deduplication.** Re-logged lines are counted again; timestamps are not interpreted.
- **Reason matching is linguistic.** English and a few Chinese phrases are recognised.
  A translated or highly custom error message may fall into `unknown`.
- **No source/package inspection, no network, no auto-fix.** It cannot tell whether a
  module is installed or why Node failed beyond the reason text.
- **Suggestions are general.** They are checklists, not a diagnosis of your specific app.
- **Not a replacement for the dev server.** Keep the original runnable log and the stack
  trace; this tool summarises them.

## Naming

Checked on **2026-11-14**:

- `GET https://registry.npmjs.org/cordis-hmr-doctor` returned `{"error":"Not found"}`, so
  no public npm package with this exact name was returned at that time. This is not a
  reservation; re-check before publishing.
- A GitHub repository search for `cordis-hmr-doctor` in the repository name returned 0
  results.
- Related, separately maintained HMR packages include `@cordisjs/hmr` (Cordis) and
  `@deepseek-ai/dsh-hmr` (DeepSeek Harness). They have different names and scopes; this
  package is not one of them and is not published by either project.
- The name is descriptive and unscoped. It uses "cordis" only to say what log format it
  reads; it does not claim official status or trademark rights.

## Non-official

This is an independent community project. It is not affiliated with, sponsored by, or
endorsed by the Cordis project, `@cordisjs`, DeepSeek, or DeepSeek Harness. Product names
are used descriptively to explain compatibility. The software is provided under the
Apache License 2.0, without warranty; see [LICENSE](LICENSE).

## License

Apache-2.0. See [LICENSE](LICENSE).
