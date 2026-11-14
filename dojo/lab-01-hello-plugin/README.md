# Lab 1 — Hello Plugin

Minimal starter for a DeepSeek Harness plugin that registers a `greet` tool.

```sh
npm test
```

Files:

| File | Purpose |
|---|---|
| `package.json` | Bundle metadata; points DSH at `cordis.patch.yml`. |
| `cordis.patch.yml` | Inserts the plugin row `hello` into a profile. |
| `index.js` | Cordis plugin: `name`, `inject = ['tools']`, `apply(ctx)`, and the `greet` tool. |
| `test/check.mjs` | Fake-ctx test for registration, schema, execute, and render. |

Try the extension in the instructor manual: add an `output.render` that returns
Markdown, or make the greeting configurable via `apply(ctx, config)`.

No third-party dependencies. The test uses only `node:test` and
`node:assert/strict`.
