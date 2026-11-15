# HCB 0.2.4 refresh (2026-11-15)

This directory records the 0.2.4 rows added to `data/hcb/matrix.csv`. It is a
host-service seed refresh for the six `dsh-os-*` packages, not the canonical
HCB DOI dataset (that is `PerryLink/dsh-hcb`).

## Toolchain

- Node `24.22.1` (tests), Node `22.19.0` (tests only; install/dump unsupported).
- DSH `0.2.2-rc.3` (`npx --yes @deepseek-ai/dsh@0.2.2-rc.3`).
- pnpm `12.16.1`.
- Linux x64; fresh `DSH_HOME` under the temporary directory, never a real profile.

## Install + config dump

```sh
for d in packages/dsh-os-*; do (cd "$d" && npm pack --pack-destination "$TARBALLS"); done
DSH_HOME="$HOME_TMP" npx --yes @deepseek-ai/dsh@0.2.2-rc.3 plugin --profile web add "$TARBALLS"/*.tgz
DSH_HOME="$HOME_TMP" npx --yes @deepseek-ai/dsh@0.2.2-rc.3 --profile web --dump-config
```

Result: six `+ dsh-os-* 0.2.4` lines; `--dump-config` contains six
`# == dsh-os-*` sections. Peer-dependency warnings were present but did not
block install.

Raw output (paths sanitized): [`plugin-add.log`](plugin-add.log) and
[`dump-config-dsh-os.yml`](dump-config-dsh-os.yml).

## Tests

Per package, `node --test packages/dsh-os-<name>/test/*.test.js` on both Node
versions:

| Package | tests_pass / tests_total |
|---|---:|
| `dsh-os-trace` | 53 / 53 |
| `dsh-os-lease` | 63 / 63 |
| `dsh-os-quota` | 73 / 73 |
| `dsh-os-eval` | 59 / 59 |
| `dsh-os-catalog` | 12 / 12 |
| `dsh-os-registry` | 16 / 16 |
| **total** | **276 / 276** |

Node `22.19.0` install/dump cells are `unsupported` because DSH `0.2.2-rc.3`
declares `engines.node >=24.9.0`; the tests still run under Node 22 and report
the same counts.
