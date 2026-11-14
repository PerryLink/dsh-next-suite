# Security Policy

`dsh-next-suite` is a community project. It is **not** affiliated with, sponsored by, or endorsed by DeepSeek.

## Supported versions

Security fixes are issued for the latest published `0.1.x` release only. The eight packages are released in lockstep, so they share one version.

| Version | Supported |
| --- | --- |
| `0.1.1` (current) | Yes |
| `0.1.0` and earlier | No |

Unsupported versions should be upgraded before reporting. There are no backport branches.

## Reporting a vulnerability

**Please report privately. Do not open a public issue, discussion, or pull request for a vulnerability.**

Use GitHub Security Advisories:

1. Open <https://github.com/PerryLink/dsh-next-suite/security/advisories/new>.
2. Or go to the repository's **Security** tab, then **Advisories**, then **Report a vulnerability**.

Please include:

- the affected package(s) and version;
- your operating system, Node.js version, and DSH/Cordis version;
- a concise description of the issue and its impact;
- reproduction steps or a minimal proof of concept;
- any relevant logs, with tokens, keys, customer data, and other secrets removed.

There is **no security email address**. GitHub Security Advisories is the only supported private channel. If the advisory form is unavailable, contact [@PerryLink](https://github.com/PerryLink) on GitHub and ask for a private channel; do not include vulnerability details in that first message.

## Response expectations

This is a small volunteer project. Reports are handled on a **best-effort** basis.

- **No SLA.** We do not guarantee acknowledgment, a response time, a fix, or a release date.
- We aim to acknowledge a complete report within 7 calendar days, but this is not a commitment.
- We may ask for more information or a smaller reproduction, and we will tell you if we cannot reproduce the issue.
- We will coordinate a fix and an advisory with you. Please allow **90 days** before public disclosure; we can agree on a shorter or longer window where appropriate.
- We will credit you in the advisory unless you ask to remain anonymous.
- There is no bug bounty.

## Scope

### In scope

Security issues in the code and packaging of the eight packages in this repository:

- `dsh-capdiff`, `testatum-attest`, `dsh-supply-watch`, `cordis-hmr-doctor`, `cordis-migrate`, `cordis-testkit`, `dsh-xbrl`, `dsh-upgrade-atlas`;
- their CLI argument handling, file reads and writes, core logic, JSON/SARIF output, and published npm tarballs;
- issues that could cause code execution, data loss, data exposure, path traversal, secret leakage, or a write outside the documented target.

### Out of scope

- **Third-party plugins and tools**, including plugins or package names that `dsh-capdiff`, `testatum-attest`, or `dsh-supply-watch` inspect. Report those to their maintainers. This suite's security scope ends at its own packages.
- DeepSeek Harness (DSH), Cordis, Node.js, npm, and other upstream projects.
- Vulnerabilities in dependencies: report them upstream; we will update when a fixed release is available.
- Issues that require an already-compromised machine, an attacker-controlled profile or `DSH_HOME`, leaked local keys, or physical access.
- Missing hardening or defense-in-depth suggestions without a concrete, reproducible impact.
- Automated scanner output with no demonstrated impact.
- A tool's documented limitations, false positives, or inability to prove safety are not vulnerabilities by themselves.

## Security-adjacent tools: read this before relying on them

`dsh-capdiff`, `testatum-attest`, and `dsh-supply-watch` are security-adjacent developer tools. They are **not** security audits, certifications, or guarantees.

### `dsh-capdiff`

- A **static heuristic** over `.js`, `.mjs`, and `.cjs` files. It does not build an AST and does not execute code.
- `matched`, an empty `undeclared` list, or **zero findings is not proof of safety**. The manifest may be incomplete or untrusted, and a capability may be used dynamically or in a file that was not scanned.
- It does not verify manifest provenance, signatures, or whether a capability is used safely.
- False positives and false negatives are expected.

### `testatum-attest`

- The signature scheme is an **MVP HMAC placeholder**, not sigstore/cosign, not npm provenance, and not a legal signature or notarization.
- A shared secret means anyone who can verify a card can also forge one. It proves “someone holding the key approved this manifest,” not “which identity approved it.”
- There is no OIDC identity binding, certificate chain, transparency log (for example Rekor), timestamp, or SLSA/in-toto attestation. `keyId` is an unauthenticated hint, not a keyring lookup.
- Revocation records are unsigned and have no online freshness check.
- The CLI's `verify` checks the card JSON, not the plugin files on disk. Use the file-verification API if you need to bind a card to actual bytes.

### `dsh-supply-watch`

- **Not a security scanner.** It applies offline name-similarity and version-anomaly heuristics to npm names.
- Findings are **leads for a human reviewer**, not proof that a package is malicious or safe.
- It is not a substitute for software composition analysis, advisory data, registry ownership checks, or tarball inspection.
- False positives are expected, especially for short names and legitimate lookalikes.

The remaining packages (`cordis-hmr-doctor`, `cordis-migrate`, `cordis-testkit`, `dsh-xbrl`, `dsh-upgrade-atlas`) are developer or diagnostic tools, not security controls. `cordis-migrate` is dry-run by default and writes only with `--write`; it is not a sandbox.

No package in this suite is an audit, a compliance certification, or a warranty of safety.

## Safe harbor

We welcome good-faith research. If you follow this policy, test only against your own installation, do not access other people's data, do not run destructive tests against shared infrastructure, and give us a reasonable time to fix the issue, we will not treat your report as abuse.

## Disclosure

We prefer coordinated disclosure. We will publish a GitHub Security Advisory after a fix is available, or after the agreed disclosure date if a fix is not feasible. We will not publish your personal information without permission.
