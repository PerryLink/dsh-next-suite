# Real corpus: sources, licenses, and transformation rules

`benchmarks/capdiff/fixtures/real/` contains 17 excerpts of real code:

- 15 excerpts from the 14 packages in this workspace (9 from `dsh-next-suite`, 6 from `dsh-os-suite`; `dsh-capdiff` contributes two excerpts).
- 2 excerpts from examples in `deepseek-harness/docs/`.

The synthetic corpus under `benchmarks/capdiff/fixtures/<id>/` is unchanged.

## License map

| Source repository | Revision | License | Copyright / notice | Excerpts |
| --- | --- | --- | --- | ---: |
| `PerryLink/dsh-next-suite` | `main` (workspace snapshot 2026-11-15) | Apache-2.0 | `04-build/dsh-next-suite/LICENSE` (PerryLink) | 9 |
| `PerryLink/dsh-os-suite` | `cb1baa8` | Apache-2.0 | `04-build/dsh-os-suite/LICENSE` (PerryLink) | 6 |
| `deepseek-ai/deepseek-harness` docs | `39163dd30f` | MIT | `deepseek-ai/deepseek-harness/LICENSE` (DeepSeek) | 2 |

Each copied source file starts with a provenance header naming the upstream path, line range, and license. The full Apache-2.0 and MIT texts remain in the source repositories; this benchmark does not relicense the excerpts.

No package outside this workspace was downloaded. No unknown-license code was used. Package names in the supply-watch corpus are identifiers only.

## Extraction rules

1. **Package excerpts** are copied verbatim from `startLine` through `endLine` from the pinned revision. The range always ends at a complete top-level statement/function/class boundary, so the excerpt parses as JavaScript. Only a provenance header is added; the copied code itself is unmodified.
2. **Docs excerpts** were TypeScript fragments; type-only imports, annotations, `private readonly` parameter properties, and `type` import specifiers were stripped so the excerpt can be scanned as `.js`. `real-17` expands the `private readonly endpoint` parameter property into an explicit field. Runtime imports and calls are preserved. The transformation is recorded in each `expected.json`.
3. **Fixture manifests are authored.** None of the 14 upstream packages declares `dsh.capabilities`, so each `package.json` declares the capabilities needed to exercise detection and declaration findings. `expected.json` records the hand-derived ground truth and the declaration set, not the upstream package's runtime truth.
4. **Length cap.** Each excerpt spans at most 160 source lines; package excerpts are 66-154 lines, and the two docs examples are shorter (the task allowed 50-150 lines and these are the natural complete boundaries).

## Fixture index

| Fixture | Repository | Path | Lines | License | Transformation |
| --- | --- | --- | --- | --- | --- |
| `real-01-hmr-doctor-cli` | dsh-next-suite | `packages/cordis-hmr-doctor/src/cli.js` | 1-100 | Apache-2.0 | verbatim + header |
| `real-02-migrate-cli` | dsh-next-suite | `packages/cordis-migrate/src/cli.js` | 1-125 | Apache-2.0 | verbatim + header |
| `real-03-testkit-core` | dsh-next-suite | `packages/cordis-testkit/src/core.js` | 1-146 | Apache-2.0 | verbatim + header |
| `real-04-capdiff-core` | dsh-next-suite | `packages/dsh-capdiff/src/core.js` | 1-95 | Apache-2.0 | verbatim + header |
| `real-05-capdiff-capability` | dsh-next-suite | `packages/dsh-capdiff/src/capability.js` | 1-66 | Apache-2.0 | verbatim + header |
| `real-06-supply-watch-cli` | dsh-next-suite | `packages/dsh-supply-watch/src/cli.js` | 1-133 | Apache-2.0 | verbatim + header |
| `real-07-upgrade-atlas-cli` | dsh-next-suite | `packages/dsh-upgrade-atlas/src/cli.js` | 1-148 | Apache-2.0 | verbatim + header |
| `real-08-xbrl-cli` | dsh-next-suite | `packages/dsh-xbrl/src/cli.js` | 1-96 | Apache-2.0 | verbatim + header |
| `real-09-testatum-cli` | dsh-next-suite | `packages/testatum-attest/src/cli.js` | 1-128 | Apache-2.0 | verbatim + header |
| `real-10-os-catalog-core` | dsh-os-suite | `packages/dsh-os-catalog/src/core.js` | 1-139 | Apache-2.0 | verbatim + header |
| `real-11-os-eval-session` | dsh-os-suite | `packages/dsh-os-eval/src/session.js` | 1-154 | Apache-2.0 | verbatim + header |
| `real-12-os-lease-apply` | dsh-os-suite | `packages/dsh-os-lease/src/apply.js` | 1-126 | Apache-2.0 | verbatim + header |
| `real-13-os-quota-enforce` | dsh-os-suite | `packages/dsh-os-quota/src/enforce.js` | 1-117 | Apache-2.0 | verbatim + header |
| `real-14-os-registry-index` | dsh-os-suite | `packages/dsh-os-registry/src/index.js` | 1-88 | Apache-2.0 | verbatim + header |
| `real-15-os-trace-sign` | dsh-os-suite | `packages/dsh-os-trace/src/sign.js` | 1-148 | Apache-2.0 | verbatim + header |
| `real-16-docs-tool` | deepseek-harness docs | `docs/cookbook/adding-a-tool.md` | 9-37 | MIT | TypeScript stripped to JavaScript |
| `real-17-docs-llm-adapter` | deepseek-harness docs | `docs/user/develop/practice/llm-adapter.md` | 158-189 | MIT | TypeScript stripped to JavaScript; parameter property expanded |

## Source URLs

- `dsh-next-suite` base: <https://github.com/PerryLink/dsh-next-suite/tree/main>
- `dsh-os-suite` base: <https://github.com/PerryLink/dsh-os-suite/tree/cb1baa8>
- `deepseek-harness` docs base: <https://github.com/deepseek-ai/deepseek-harness/tree/39163dd30f/docs>

Per-fixture links are also embedded in each `expected.json` under `source.url`.

`dsh-next-suite` is not a standalone git checkout in this workspace (there is no nested `.git`), so its 9 excerpts cannot be pinned to a commit hash from here. They are the version-0.1.3 working tree as of 2026-11-15, and the links point at the public `main` branch. `dsh-os-suite` is a standalone checkout, so its excerpts are pinned to `cb1baa8`; the three files used by this corpus match that commit (`git diff` is empty for them). `deepseek-harness/docs` is pinned to `39163dd30f`.
