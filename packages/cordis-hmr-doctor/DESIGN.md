# DESIGN — cordis-hmr-doctor

> Unofficial community tool. Apache-2.0. Not affiliated with Cordis, `@cordisjs`, or
> DeepSeek. See the name check and disclaimer in [README.md](README.md).

## 1. Problem

Cordis HMR (the `settled` / `aborted` / `skipped` result, and the logger messages around
it) tells a developer that a change did not apply, but the reason is spread across terse
lines:

```text
skipped changes, which apply after a restart:
- src/main.ts (host-module)
reload plugin at src/plugins/logger.ts
failed to reload plugin at src/plugins/broken.ts
aborted src/db.ts: Cannot find module 'pg'
```

Answering "why didn't HMR pick this up?" currently means scrolling, matching paths by eye,
and knowing which errors are configuration problems versus missing packages. There is no
official line-oriented log grammar and no official diagnostic command, so a small local
tool can still save time if it is explicit about being heuristic.

## 2. Goals

1. Parse a pasted or saved log into stable event objects with line numbers and raw text.
2. Recognise the three HMR result statuses and the two common logger lifecycle words.
3. Classify reasons into a small, documented cause set and attach actionable suggestions.
4. Support both text and JSON output without dependencies or a build step.
5. Make the heuristic nature, coverage, and non-official status impossible to miss.

## 3. Non-goals

- Running HMR, importing the host application, or reading the source tree.
- Reconstructing events or stack frames that are absent from the log.
- Replacing the HMR implementation's own error reporting or a debugger.
- Parsing arbitrary structured-log schemas (JSON logs, OTLP, etc.).
- Auto-fixing dependencies, ports, cycles, or configuration.
- Being an official Cordis/DSH package or claiming their endorsement.

## 4. Architecture

```text
text
  │
  ├─ parseHmrLog(text) ──► HmrEvent[]        (pure, line-oriented, heuristic)
  │                              │
  │                 ┌────────────┴────────────┐
  │                 ▼                         ▼
  │          summarize(events)          diagnose(events)
  │           {total, statuses,          {counts, causes,
  │            topReason}                 suggestions}
  │                 └────────────┬────────────┘
  │                              ▼
  └────────────────────► buildReport(text)
                                 │
                                 ▼
                        formatReport(report, {json})
```

`src/core.js` contains all logic and imports nothing. `src/cli.js` only parses arguments,
reads stdin/a file, and calls `buildReport` + `formatReport`. Tests exercise both layers.

## 5. Event model

```js
{
  status: 'settled' | 'aborted' | 'skipped' | 'reload' | 'dispose',
  module: string | null,   // path, file URL, or plugin path
  reason: string | null,   // inline error / skip reason
  line: number,            // 1-based
  raw: string,             // original line, ANSI included
  failed?: true            // "failed to reload/dispose"
}
```

`reload` and `dispose` are included because Cordis/DSH HMR hosts log those lifecycle
actions around the three result statuses. They are statuses of a log *line*, not a claim
that a fiber settled.

## 6. Parser algorithm

1. **Split and number.** Split on `\r?\n`; keep the 1-based line number. Strip a UTF-8 BOM.
   Empty input yields `[]`. Blank lines are ignored but do not end a skip block.
2. **Normalise decorations.** Strip ANSI CSI/OSC sequences. Repeatedly remove:
   - bracketed prefixes (`[2026-…]`, `[INFO]`, `[hmr]`); a bracketed status word such as
     `[aborted]` is unwrapped instead of discarded;
   - ISO timestamps and `HH:MM:SS` timestamps;
   - log levels (`INFO`, `WARN`, …);
   - product/logger prefixes (`cordis`, `hmr`, `@cordisjs/hmr`, `@deepseek-ai/dsh-hmr`,
     `plugin-hmr`) and `|`/`>` markers.
3. **Skip block mode.** A line matching `^skipped changes\b` enters block mode. Each
   following `- …` / `* …` / `• …` bullet becomes a `skipped` event. The whole prefix
   before a trailing `(reason)` is the module, so unquoted paths with spaces work. The
   block ends at the first non-bullet, non-blank line.
4. **Status detection.** After decoration removal, try in order:
   - `reload|dispose|skip plugin at …` (with an optional `failed to`);
   - `config reload at … [failed]`;
   - a line that starts with a status word;
   - `status=…` / `result=…` / `event=…`.
   `skip` is normalised to `skipped`. A `failed` substring also sets `failed: true`.
5. **Module extraction.** Remove `at`, `module=`, `file=` labels, then take:
   - a quoted token (`"…"`, `'…'`, `` `…` ``) or `[…]` / `<…>`, which may contain spaces;
   - otherwise the first whitespace-delimited token, with trailing `,`, `;`, `:` trimmed.
6. **Reason extraction.** In priority order:
   - `reason=`, `error=`, or `cause=` payloads;
   - a lone parenthetical (`(host-module)`);
   - the whole remainder for `aborted`/`skipped`/failed lines;
   - `because …`, a trailing parenthetical, or failure-like text for other lines.
   A failed line with no other detail gets `failed to reload` / `failed to dispose`.
7. **Ignore everything else.** `watching …`, `change detected at …`, prose, and unknown
   decorations produce no event. Matching is deliberately conservative rather than
   treating every occurrence of a status word as an event.

### Why not a strict grammar?

There is no official documented line format for `settled`/`aborted`/`skipped`. In
`@cordisjs/hmr` these are fields of the returned result object; the bundled logger mostly
prints skip blocks and `reload plugin at` messages, while hosts and instrumented builds may
print status lines differently. A strict parser would reject most real logs; an
over-permissive one would invent events from prose. The chosen middle ground is a small
set of documented shapes plus decoration stripping, with raw lines preserved for auditing.

## 7. Diagnosis

### Candidate filter

`diagnose()` classifies only actionable events:

- every `aborted` and `skipped` event;
- `reload`/`dispose` marked `failed`;
- a status line whose reason contains a failure word (`fail`, `error`, `invalid`,
  `cannot`, `timeout`, `EADDRINUSE`, `ECONNREFUSED`).

A clean `settled` event is a success, not a cause, and is excluded. `counts.total` is the
number of diagnosed events, not the log's total event count; `summarize().total` is the
latter. This avoids reporting "unknown" for every successful reload.

### Cause rules

Rules are evaluated in order; the first match wins:

| Priority | Cause | Representative patterns |
|---|---|---|
| 1 | `circular` | `circular`, `cyclic`, `cycle`, `module_recursion`, `循环依赖` |
| 2 | `port-in-use` | `EADDRINUSE`, `address already in use`, `port … in use`, `端口占用` |
| 3 | `timeout` | `timed out`, `timeout`, `ETIMEDOUT`, `deadline exceeded`, `超时` |
| 4 | `config-error` | invalid config/options/plugin/schema, unknown option, invalid plugin export, config reload failed, `配置错误` |
| 5 | `dependency-missing` | `cannot find module/package`, `ERR_MODULE_NOT_FOUND`, failed resolve, `ENOENT`, missing export, `找不到模块` |
| 6 | `unknown` | no match, including official skip reasons (`host-module`, `native-addon`, `ambiguous-import`, `ambiguous-export`) |

Port is checked before timeout because some socket errors mention both. Config is checked
before the broader dependency rule so "invalid config" is not swallowed by "cannot find".
Official skip reasons are intentionally *not* errors in a seventh category: the public
result set has six causes, so they fall to `unknown` while the suggestion layer adds the
correct restart advice for skipped changes.

### Output

`causes` contains only non-zero groups, sorted by descending count and then by the fixed
cause order. Each group carries its code, label, count, unique modules, statuses, and up
to five examples. `suggestions` contains one static suggestion per present cause, then
counted restart advice for skipped events and retry advice for aborted events.

Example:

```json
{
  "counts": { "total": 2, "dependency-missing": 1, "circular": 0, "port-in-use": 1, "config-error": 0, "timeout": 0, "unknown": 0 },
  "causes": [
    { "cause": "dependency-missing", "label": "Dependency or module missing", "count": 1, "modules": ["src/db.ts"], "statuses": ["aborted"], "examples": [] }
  ],
  "suggestions": ["Install or restore the missing module: …", "1 aborted change(s) are retried …"]
}
```

## 8. Summary and formatting

`summarize()` counts total events and the three result statuses. `topReason` is the most
frequent **raw reason string** (not a cause code); ties keep the first reason encountered.
This keeps summary and diagnosis independent: one is descriptive, the other interpretive.

`formatReport()` accepts an event array, a `diagnose()` result, a `buildReport()` result,
or `{summary, diagnosis}`. JSON mode emits:

```json
{
  "summary": { "total": 1, "settled": 0, "aborted": 1, "skipped": 0, "topReason": "Cannot find module 'pg'" },
  "counts": { "total": 1, "dependency-missing": 1, "...": 0 },
  "causes": [],
  "suggestions": [],
  "events": []
}
```

Text mode adds a header, summary line, cause groups, suggestions, and the explicit
"Heuristic; not an official Cordis diagnostic tool" footer. Empty logs get a distinct
message instead of an empty table. Invalid input shapes throw `TypeError`.

## 9. CLI contract

```text
cordis-hmr-doctor <log> [--json]
cordis-hmr-doctor - [--json] < hmr.log
```

- `--help` wins over everything and exits `0`.
- No positional argument: usage on stderr, exit `1`.
- Unknown option or more than one positional: exit `2`.
- `-` consumes the stdin stream as UTF-8 (`fs.readFile(0)` is not portable across the
  supported Node versions, so the stream is consumed with `for await`).
- Unreadable file: one-line error on stderr, exit `2`.
- A produced report always exits `0`, whether or not findings exist. CI gating is
  intentionally left to the caller, who can inspect `summary.aborted` / exit themselves.

## 10. Testing

`node --test packages/cordis-hmr-doctor/test/*.test.js` runs 34 offline tests:

- parsing of `settled`, `aborted`, `skipped`, `reload`, `dispose`, key/value lines,
  reason-without-module lines, ANSI/prefix decorations, the official skip block, paths
  with spaces, and mixed logs;
- unrelated-line rejection, line numbers, and raw preservation;
- summary counts, top reason, empty input;
- all six cause categories, unknown fallback, clean-settled exclusion, restart/retry
  suggestions, empty diagnosis;
- text/JSON formatting, summary/event passthrough, empty-report text, invalid input;
- CLI `--help`, missing argument, stdin JSON, file input, unreadable file, unknown option,
  and empty stdin.

No test uses the network, the host application, or a real HMR run.

## 11. Future work (not in 0.1.0)

- Optional JSON-log mode (`{"msg": "...", "status": "..."}`) behind an explicit flag.
- Associating indented continuation lines (stack traces) with the preceding event.
- Reason normalisation for i18n and custom error codes, with a user-supplied rules file.
- A `--fail-on aborted|unknown` CI flag.
- Timestamp awareness and de-duplication of repeated logger lines.
- Optional `--sarif` or editor-friendly output.

These are deliberately out of scope for the MVP: each adds a format assumption that would
need the same level of documentation and testing as the current heuristic.

## 12. Compatibility and license

- Pure ESM JavaScript + JSDoc, no build step, no runtime dependencies.
- Node `^22.19.0 || >=24.9.0`.
- Apache-2.0. See [LICENSE](LICENSE).
- Unofficial; see README for the name check and the full disclaimer.
