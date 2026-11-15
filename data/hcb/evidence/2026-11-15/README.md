# HCB older-host probe — 2026-11-15

This directory records the requested `0.2.1` / `0.2.2-rc.1` host probe. It
supports the prose section in [`../../README.md`](../../README.md); it does
**not** add rows to `matrix.csv`.

## Toolchain

- Linux x64; Node `24.22.1`; npm/npx `11.19.1`.
- Every host run used a fresh `DSH_HOME` created with `mktemp -d`. The user
  profile and the host checkout were not modified.

## Host `0.2.1` — no release to test

`npx @deepseek-ai/dsh@0.2.1` exited `1`:

- configured registry (`registry.npmmirror.com`): `ETARGET`, "No matching
  version found for @deepseek-ai/dsh@0.2.1";
- official registry (`registry.npmjs.org`): `E404`, no such version.

`npm view @deepseek-ai/dsh versions` contains `0.2.1-alpha.*` and
`0.2.1-rc.*`, but no stable `0.2.1`. With no host bundle, the six tarballs
could not be installed or dumped. The result is `not-tested` for both checks;
that is not a package failure. Raw output: [`host-0.2.1.log`](host-0.2.1.log).

## Host `0.2.2-rc.1` — install rejected by the DSH engine check

`npx @deepseek-ai/dsh@0.2.2-rc.1 --version` printed `0.2.2-rc.1` and exited
`0`. The host declares `engines.node >=24.9.0`, so Node `24.22.1` is supported.

The six published `dsh-os-*@0.2.1` tarballs were then passed to:

```sh
npx --yes @deepseek-ai/dsh@0.2.2-rc.1 plugin --profile web add <six tarballs>
```

pnpm added all six packages, but the DSH plugin manager rejected each one after
installation. Every package declares:

```json
"engines": { "dsh": ">=0.2.2-rc.3 <0.3.0" }
```

The host is `0.2.2-rc.1`, below that floor. The command exited `1` and DSH
restored `package.json`, `pnpm-lock.yaml`, and `node_modules`; no risk
exemption was granted. Thus `install_ok=false`.

A follow-up `--profile web --dump-config` exited `0`, but the 1,243-line output
contains **zero** `dsh-os-*` sections (`dump_config_ok=false`). Raw output:
[`host-0.2.2-rc.1.log`](host-0.2.2-rc.1.log) and
[`host-0.2.2-rc.1.dump-config.txt`](host-0.2.2-rc.1.dump-config.txt).

## Tarballs

The six tarballs were fetched with `npm pack dsh-os-<name>@0.2.1`. Their
sha512 digests match each package's published `dist.integrity`; see
[`tarballs.integrity.txt`](tarballs.integrity.txt) and
[`tarballs.sha512.txt`](tarballs.sha512.txt). The engine rejection above is
therefore a property of the published `0.2.1` artifacts, not of a locally
modified build.

## Files

| File | Contents |
|---|---|
| `host-0.2.1.log` | npx/ETARGET, official-registry E404, toolchain |
| `host-0.2.2-rc.1.log` | version probe, install attempt, engine rejection, dump exit code |
| `host-0.2.2-rc.1.commands.txt` | tarball download commands and listing |
| `host-0.2.2-rc.1.dump-config.txt` | full dump (no `dsh-os-*` section) |
| `tarballs.integrity.txt` | tarball sha512 vs npm `dist.integrity` |
| `tarballs.sha512.txt` | local tarball sha512 sums |
