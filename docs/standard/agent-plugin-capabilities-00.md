# Agent Plugin Capability Manifest (APCM)

## draft-perrylink-agent-plugin-capabilities-00

> **DRAFT — NOT SUBMITTED — NOT A STANDARD.**
> This is a **personal Internet-Draft text** prepared for discussion. It has **not** been submitted to the IETF Datatracker, has **no** IETF consensus, and carries **no** standards status. It must not be cited as an IETF standard or as evidence of vendor support.
> The IETF boilerplate below is the template that would be used **if** the document is ever submitted; its presence here does not imply submission.
> Status: `draft / planned` · Text date: 2026-11-14 · Planned filename: `draft-perrylink-agent-plugin-capabilities-00`.

---

```text
Internet-Draft                                              PerryLink
Intended status: Informational                             Independent
Expires: 14 May 2027                                14 November 2026
```

## Abstract

Agent plugins extend a host application with tools, but they also request access to files, networks, processes, sessions, and secrets. Today these requests are described ad hoc in package metadata, documentation, or not at all; hosts cannot compare declarations across plugins, and there is no common way to revoke a declaration or to express host compatibility. This document defines the **Agent Plugin Capability Manifest (APCM)**: a small JSON document that declares a plugin's identity, the host versions it targets, the capabilities it requests (with optional scopes and constraints), an expiry, and a signature. It also defines a signed revocation list and the rules a host follows when it encounters unknown capabilities, expired manifests, or revoked versions. APCM deliberately does **not** define an enforcement mechanism: a manifest is a declaration to be checked, not a sandbox. This document is an individual draft and is not an IETF standard.

## Status of This Memo

> The boilerplate in this section is reproduced for a future submission. **It is not a claim that this document has been submitted**; the repository banner above controls.

This Internet-Draft is submitted in full conformance with the provisions of BCP 78 and BCP 79.

Internet-Drafts are working documents of the Internet Engineering Task Force (IETF). Note that other groups may also distribute working documents as Internet-Drafts. The list of current Internet-Drafts is at <https://datatracker.ietf.org/drafts/current/>.

Internet-Drafts are draft documents valid for a maximum of six months and may be updated, replaced, or obsoleted by other documents at any time. It is inappropriate to use Internet-Drafts as reference material or to cite them other than as "work in progress."

This Internet-Draft will expire on 14 May 2027.

## Copyright Notice

Copyright (c) 2026 IETF Trust and the persons identified as the document authors. All rights reserved.

This document is subject to the IETF Trust's Legal Provisions Relating to IETF Documents (<https://trustee.ietf.org/license-info>) in effect on the date of publication of this document. Please review these documents carefully, as they describe your rights and restrictions with respect to this document.

> **Repository note:** this copy is a drafting artifact. The copyright/boilerplate above is included only so the text can be submitted without a rewrite; **no submission has occurred**.

---

## Table of Contents

1. Introduction
2. Conventions and Terminology
3. Design Overview
4. Manifest Format
5. Capability Identifiers
6. Lifecycle: Issuance, Distribution, Evaluation, Revocation
7. Compatibility
8. Security Considerations
9. Privacy Considerations
10. IANA Considerations
11. References
Appendix A. Example Manifest
Appendix B. JSON Schema Sketch
Appendix C. Open Issues
Acknowledgments
Author's Address

---

## 1. Introduction

### 1.1. Problem

Agent plugins are third-party packages loaded by a host such as DeepSeek Harness (DSH). A plugin may read files, open network connections, spawn processes, read session data, or call tools on the user's behalf. Some ecosystems encode these requests in a package manifest field (for example, `dsh.capabilities`), some describe them in README prose, and some do not describe them at all.

This creates four practical problems:

1. **No comparable declaration.** A host or reviewer cannot answer "what does this plugin ask for?" in a machine-readable way across plugins.
2. **No separation of declaration and evidence.** A hand-written list is not a test result; readers routinely confuse "declared" with "verified".
3. **No revocation path.** When a plugin version is compromised or a publisher key leaks, there is no standard object that says "stop trusting this version".
4. **No compatibility contract.** A plugin may declare support for a host range, but the syntax and semantics of that range differ by ecosystem.

Existing mechanisms cover parts of the problem: package manifests describe dependencies, SBOM formats describe components, OAuth 2.0 Rich Authorization Requests describe fine-grained authorization, and MCP tool annotations describe individual tools. None of them provides a single, small, signable object that combines plugin identity, host compatibility, capability requests, and revocation hints.

### 1.2. Scope

This document specifies:

- a JSON manifest format for plugin capability declarations;
- a capability identifier syntax and an initial set of identifiers;
- a signed revocation list format;
- host-side processing rules for unknown capabilities, expired manifests, and revoked versions;
- the IANA registries needed for interoperability.

### 1.3. Non-goals

This document does **not**:

- define a sandbox, syscall filter, permission system, or runtime enforcement mechanism;
- guarantee that a declared capability is actually used, or that an undeclared capability is absent;
- replace code signing, package provenance, SBOM, or vulnerability databases;
- define liability, certification, or compliance;
- prescribe a single vendor's plugin format.

A manifest is a **statement by a publisher**. A host that treats it as a security boundary without independent enforcement is misusing it.

---

## 2. Conventions and Terminology

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**, **SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **NOT RECOMMENDED**, **MAY**, and **OPTIONAL** in this document are to be interpreted as described in BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all capitals, as shown here.

- **Agent plugin**: a package loaded by a host that can register tools, hooks, or services and can act on behalf of a user.
- **Host**: the application that loads plugins and mediates access to resources.
- **Capability**: a class of authority that a plugin may exercise, identified by a stable string such as `fs.read`.
- **Declaration**: the set of capabilities a publisher claims the plugin needs, with optional scopes and constraints.
- **Grant**: the subset of a declaration that a host actually allows at runtime. A grant is a host decision, not a manifest field.
- **Enforcement point**: the component that mediates the resource access (for example, a filesystem broker or a network proxy).
- **Scope**: a value that narrows where or on what a capability may be used (paths, hostnames, command names).
- **Constraint**: a machine-checkable limit on a scope (maximum bytes, allowed methods, argument prefixes).
- **Manifest digest**: a cryptographic hash of the exact manifest bytes that were signed.
- **Revocation**: a signed statement that a plugin version, digest, or publisher key must no longer be trusted.
- **Evidence level**: one of `declared`, `checked`, or `tested`, as used by HCB; this document only carries declarations and does not define evidence collection.

---

## 3. Design Overview

APCM has three design principles:

1. **Declare, do not enforce.** The manifest is input to a host policy decision. The host MUST enforce the resulting grant through its own mechanisms.
2. **Small and offline-first.** The core object is JSON, has no required network fetch, and can be validated offline. Revocation is the only optional online component.
3. **Fail closed on ambiguity.** Unknown capability identifiers, unknown major versions, expired manifests, and revoked versions MUST NOT be silently treated as allowed.

A deployment typically has four artifacts:

| Artifact | Produced by | Consumed by | Required? |
|---|---|---|---|
| Manifest | Plugin publisher | Host, registry, reviewer | Yes, for APCM-aware hosts |
| Signature | Publisher key | Host trust store | RECOMMENDED; required for high-assurance mode |
| Revocation list | Publisher or ecosystem operator | Host | Optional, but RECOMMENDED |
| Host policy | Host operator | Host | Out of scope; each host defines its own |

---

## 4. Manifest Format

An APCM manifest is a JSON object [RFC8259] with the media type `application/apcm+json`. All field names are case-sensitive. Unknown fields MUST be ignored unless this document says otherwise; unknown fields MUST NOT grant capabilities.

### 4.1. Top-level fields

| Field | Type | Required | Description |
|---|---|---|---|
| `specVersion` | string | Yes | `"apcm/1"`. The major version is `1`; a host that does not support the major version MUST reject the manifest. |
| `plugin` | object | Yes | Plugin identity; see Section 4.2. |
| `host` | object | No | Host compatibility; see Section 4.3. If absent, the manifest is host-agnostic and the host MUST apply its default policy. |
| `capabilities` | array | Yes | Capability requests; see Section 4.4. MAY be empty (`[]`), which declares "no capabilities requested". |
| `limits` | object | No | Coarse resource limits; see Section 4.5. |
| `revocation` | object | No | Revocation status hint; see Section 4.6. |
| `issuedAt` | string | Yes | RFC 3339 timestamp [RFC3339]. |
| `expiresAt` | string | No | RFC 3339 timestamp. RECOMMENDED; a manifest without an expiry has a default lifetime chosen by host policy. |
| `signature` | object | No | Signature over the canonical manifest; see Section 4.7. Absence means "unsigned declaration" and MUST be treated as lower assurance. |
| `extensions` | object | No | Vendor extensions; see Section 4.8. |

### 4.2. `plugin` object

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Stable package identifier. RECOMMENDED: a Package URL (PURL) such as `pkg:npm/dsh-auto-review`. |
| `name` | string | Yes | Human-readable package name; MUST match the package manager name. |
| `version` | string | Yes | Exact released version, not a range. |
| `digest` | string | No | Digest of the distributed artifact, e.g. `sha256-<base64url>`. RECOMMENDED for signed manifests. |
| `publisher` | string | No | HTTPS URI identifying the publisher (repository or organization). |
| `homepage` | string | No | HTTPS URI for documentation. |

The tuple (`id`, `version`, `digest`) binds the manifest to one artifact. A manifest for version `1.2.3` MUST NOT be applied to version `1.2.4`.

### 4.3. `host` object

| Field | Type | Required | Description |
|---|---|---|---|
| `product` | string | No | Host product identifier, e.g. `deepseek-harness`. |
| `apiVersion` | string | No | Host API version targeted by the plugin. |
| `compat` | string | No | Version range (SemVer syntax [SEMVER]) of compatible host versions. |
| `features` | array of strings | No | Host feature identifiers the plugin depends on. |

If `compat` is present and the running host version does not satisfy it, the host SHOULD refuse to load the plugin unless an operator explicitly overrides the decision and records the override.

### 4.4. `capabilities` array

Each element is an object:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Capability identifier from Section 5. |
| `scope` | array of strings | No | Narrowing values; semantics depend on the capability. An empty array means "the capability's default scope", not "unrestricted". |
| `constraints` | object | No | Machine-checkable limits; see below. |
| `required` | boolean | No | Default `true`. If `false`, a host MAY run the plugin without granting this capability, but MUST NOT grant it implicitly. |
| `justification` | string | No | Short human-readable reason. Not a security control. |

Constraints are capability-specific. This document defines these common keys:

- `paths`: array of path globs (for filesystem capabilities).
- `hosts`: array of DNS names or IP literals (for network capabilities).
- `ports`: array of integers or ranges.
- `methods`: array of HTTP methods.
- `schemes`: array of URI schemes.
- `argvPrefix`: array of strings that a spawned command's argv must start with.
- `envNames`: array of environment variable names.
- `maxBytes`, `maxRuntimeMs`: non-negative integers.

A host MUST reject a constraint it does not understand for a capability it intends to grant; it MUST NOT ignore an unknown constraint and grant the capability as if the constraint were absent.

Duplicate capability entries with the same `id` MUST be treated as an error, not merged silently; conflicting scopes are a common source of ambiguity.

### 4.5. `limits` object

`limits` is a coarse, host-enforced budget: `maxRuntimeMs`, `maxMemoryBytes`, `maxOutputBytes`, `maxOpenFiles`. These are hints for policy, not a replacement for OS-level limits. A host MAY ignore any limit it cannot enforce; if it does, it MUST NOT claim the limit was enforced.

### 4.6. `revocation` object

| Field | Type | Required | Description |
|---|---|---|---|
| `statusUrl` | string | Yes | HTTPS URL of a signed revocation list (Section 6.4). |
| `listVersion` | integer | No | The list version the publisher used when issuing the manifest. A host uses it to detect a stale cached list. |

`statusUrl` is a **hint**. A host MAY use its own configured revocation source instead, and SHOULD log which source it used.

### 4.7. `signature` object

| Field | Type | Required | Description |
|---|---|---|---|
| `alg` | string | Yes | `Ed25519` or `ES256`; other algorithms MAY be defined by host policy. |
| `keyId` | string | Yes | Identifier for the publisher key in the host trust store. |
| `value` | string | Yes | Base64url signature over the JCS-canonicalized manifest with the `signature` field removed. |

The signature profile in this document uses JSON Canonicalization Scheme [RFC8785] and JWS-style signing [RFC7515]. A future version may define a COSE profile. A host MUST verify the signature before using any field that grants authority; if verification fails, the manifest MUST be treated as unsigned.

### 4.8. `extensions` object

Vendors MAY add fields under `extensions`. Unknown extension fields MUST be ignored and MUST NOT expand the granted capability set. If an extension changes the meaning of a standard field, it is not an extension; it requires a new `specVersion`.

---

## 5. Capability Identifiers

### 5.1. Syntax

A capability identifier is a lowercase ASCII string:

```text
capability-id = area "." action
area          = 1*32( ALPHA / DIGIT / "-" )
action        = 1*32( ALPHA / DIGIT / "-" )
```

Examples: `fs.read`, `net.egress`, `proc.spawn`, `tool.register`.

Vendor-specific identifiers use the prefix `x-`:

```text
x-acme.custom-scan
```

Wildcards (`*`, `fs.*`) are **not** valid identifiers. A manifest that uses a wildcard MUST be rejected; a host cannot safely expand a wildcard into an unknown set.

### 5.2. Initial capability set

| Identifier | Risk | Typical scope | Meaning |
|---|---|---|---|
| `fs.read` | medium | paths | Read files under the given paths. |
| `fs.write` | high | paths | Create, modify, or delete files under the given paths. |
| `net.egress` | high | hosts, ports, schemes | Initiate outbound connections. |
| `net.listen` | high | addresses, ports | Listen for inbound connections. |
| `proc.spawn` | high | executables, argvPrefix | Spawn child processes. |
| `env.read` | low | envNames | Read environment variables. |
| `secret.read` | high | secret names | Read from the host secret store. |
| `session.read` | medium | session scopes | Read session or conversation data. |
| `session.write` | high | session scopes | Modify or delete session data. |
| `tool.register` | medium | tool names | Register new tools with the host. |
| `tool.invoke` | high | tool names | Invoke tools registered by others. |
| `mcp.connect` | high | server URIs | Connect to an MCP server. |
| `mcp.invoke` | high | tool names | Invoke an MCP tool. |
| `eval.exec` | high | — | Evaluate code or strings at runtime. |
| `crypto.sign` | medium | keyIds | Sign data with a host-managed key. |

Risk classes are **advisory** and are not a substitute for host policy. The registry (Section 10) is the authoritative list; this table is the initial content.

### 5.3. Unknown capabilities

If a host encounters a capability identifier it does not recognize, it:

1. MUST NOT treat the capability as granted;
2. SHOULD treat the plugin as high risk and require explicit review or run it in a restricted mode;
3. MUST record the unknown identifier in its audit log;
4. MAY reject the manifest if its policy requires a closed capability set.

An unknown capability is **not** an unknown field. Ignoring it silently is a security bug.

### 5.4. Vendor extensions

Vendor identifiers (`x-...`) MUST be registered in the IANA registry or documented by the vendor. A host that does not support a vendor capability follows the unknown-capability rule. Vendors SHOULD NOT use `x-` identifiers for capabilities that are broadly applicable; those should be proposed to the registry.

---

## 6. Lifecycle: Issuance, Distribution, Evaluation, Revocation

### 6.1. Issuance

The publisher generates the manifest at release time, binds it to the exact artifact digest, signs it, and publishes it alongside the package (for example, as `apcm.json` in the package root or as a release asset). The manifest SHOULD be included in the package tarball so it is covered by the package digest; if it is distributed separately, the host MUST bind it to the artifact digest.

`issuedAt` MUST be the actual issuance time; `expiresAt`, if present, SHOULD be no more than 180 days after `issuedAt` for plugins that are actively maintained. Short-lived manifests limit the damage of a stolen key.

### 6.2. Distribution

A host obtains the manifest from one of:

- the package artifact itself (preferred, because it is digest-bound);
- a registry API;
- a signed release asset.

If multiple sources disagree, the host SHOULD prefer the digest-bound copy. A manifest fetched over HTTPS is still untrusted until its signature and digest are verified.

### 6.3. Evaluation

A host evaluates a manifest in this order:

1. Parse JSON with a bounded parser (size, depth, array length).
2. Check `specVersion` major.
3. Verify `plugin.version` and `plugin.digest` against the artifact.
4. Verify the signature (if present); otherwise mark the manifest unsigned.
5. Check `issuedAt` / `expiresAt` against the host clock, allowing a small skew.
6. Check `host.compat` against the running host version.
7. Fetch or read the revocation list (Section 6.4); reject revoked versions.
8. Map each declared capability to host policy; produce a grant set.
9. Enforce the grant set at the enforcement point.
10. Log the decision, manifest digest, revocation list version, and policy version.

Steps 1–7 are **admission**; step 8 is **authorization**; step 9 is **enforcement**. A host MUST NOT skip step 9 and call the manifest "enforced".

### 6.4. Revocation

A revocation list is a signed JSON object:

```json
{
  "specVersion": "apcm-revocation/1",
  "listVersion": 42,
  "issuedAt": "2026-11-14T00:00:00Z",
  "expiresAt": "2026-11-21T00:00:00Z",
  "entries": [
    {
      "pluginId": "pkg:npm/example-plugin",
      "versionRange": "<0.2.0",
      "digest": "sha256-...",
      "reason": "key-compromise",
      "effectiveAt": "2026-11-14T00:00:00Z"
    }
  ],
  "signature": {
    "alg": "Ed25519",
    "keyId": "revocation-2026-11",
    "value": "base64url..."
  }
}
```

Rules:

- `listVersion` MUST increase monotonically. A host MUST reject a list whose version is lower than the highest version it has already accepted (replay/downgrade protection).
- The list MUST have `issuedAt` and SHOULD have `expiresAt`.
- An entry may target a plugin version range, a digest, or a publisher key. If `digest` is present, it applies to that exact artifact; if absent, it applies to the version range.
- `reason` values are registered (Section 10.3): `key-compromise`, `malware`, `policy-violation`, `vulnerability`, `superseded`, `author-request`.
- A host SHOULD refresh the list at least every 24 hours when online. When offline, it MAY use a cached list; if the cached list is expired, policy decides whether to fail closed (RECOMMENDED for high-risk capabilities) or warn.
- Revocation of a publisher key is not the same as revocation of a plugin version. A host MUST distinguish them in its audit log.

### 6.5. Offline operation

APCM is designed to work without network access. A host MAY ship a revocation list with the application, accept an operator-provided list, or use a cached list with a bounded age. Offline mode MUST NOT silently disable revocation; it MUST either enforce the cached list or record that revocation was unavailable and apply the configured fallback policy.

---

## 7. Compatibility

### 7.1. Spec version

`specVersion` is `apcm/<major>`. A host that supports `apcm/1`:

- MUST reject `apcm/2` unless it implements that major version;
- MUST ignore unknown fields in a `1.x` manifest;
- MUST NOT infer new authority from an unknown field.

### 7.2. Host API version

`host.apiVersion` and `host.compat` let a plugin state the host versions it targets. The host checks the range with SemVer semantics. A plugin that declares no `host` object is host-agnostic; the host applies its default policy.

### 7.3. Plugin version and digest

The manifest is version-specific. When a plugin is upgraded, the publisher MUST issue a new manifest (or explicitly re-sign the old one for the new artifact, with a new `issuedAt`). A host MUST NOT reuse a manifest across artifact digests.

### 7.4. Forward compatibility

- New capability identifiers: unknown-capability rule (Section 5.3).
- New constraint keys: reject the capability if the constraint is not understood (Section 4.4).
- New top-level fields: ignore, but do not grant authority.
- New signature algorithms: host policy decides; unknown algorithms mean unsigned.

### 7.5. Backward compatibility

Capability identifiers are stable. If a capability's semantics change in an incompatible way, a new identifier is required; the old identifier SHOULD be deprecated in the registry with a migration note. This document does not define the deprecation timeline; the registry does.

---

## 8. Security Considerations

**Declaration is not enforcement.** The central risk is that a host or user treats a manifest as proof of safety. A malicious plugin can declare a narrow scope and then attempt broader access; only the enforcement point can stop it. Hosts MUST enforce grants independently and MUST NOT expose "manifest verified" as "plugin safe".

**TOCTOU and artifact substitution.** The manifest must be bound to the exact artifact digest. If the host verifies a manifest for version `1.2.3` but executes a different tarball, the declaration is meaningless. Verify signature → verify digest → execute, in that order.

**Over-declaration and under-declaration.** Over-declaration causes warning fatigue and encourages blanket approval; under-declaration hides authority. Hosts SHOULD compare declarations with observed behavior where feasible (for example, static import checks or runtime audit logs) and SHOULD flag discrepancies, but MUST NOT treat a static match as proof.

**Revocation freshness and availability.** A revocation list that is never refreshed provides false assurance. Hosts SHOULD bound cache age, reject decreasing `listVersion`, and log the list version used. An attacker who can block revocation updates may keep a revoked plugin alive; high-assurance deployments SHOULD use a pinned or out-of-band list.

**Key compromise.** Publisher keys are high-value targets. RECOMMENDED: hardware-backed keys, rotation, a published key history, and a revocation path for keys. A manifest signed by a revoked key MUST be treated as unsigned.

**Malicious manifests.** Parsers must bound input size, nesting depth, array lengths, and string lengths. Duplicate capability IDs, conflicting constraints, Unicode confusables in identifiers, and path traversal in scope values are all parser/policy hazards. Hosts MUST reject duplicates and MUST normalize identifiers before comparison.

**Confused deputy.** A plugin's declared scope MUST NOT be used to authorize another plugin's request. Each plugin's grant is independent; a host that shares a grant across plugins creates a confused deputy.

**Unknown capabilities.** Treating an unknown capability as "probably harmless" is a fail-open design. The default MUST be deny or restricted mode.

**Logging and audit.** Log the manifest digest, signature key ID, decision, revocation list version, policy version, and the enforcement point's decision. Without this, incident response cannot reconstruct why a plugin was allowed.

**Supply chain.** APCM complements, but does not replace, package signatures, provenance (for example, SLSA/in-toto), SBOM, and vulnerability scanning. A manifest is one input to a decision, not a trust root.

**Algorithm agility.** The signature profile is intentionally narrow (Ed25519/ES256). A future version may add COSE or post-quantum algorithms; hosts SHOULD make the algorithm allow-list configurable and SHOULD NOT accept `alg: none`.

---

## 9. Privacy Considerations

`scope` values can leak sensitive information: internal hostnames, filesystem paths, user identifiers, tenant names, or secret names. Publishers SHOULD use the coarsest scope that still allows enforcement, and SHOULD avoid embedding secrets, tokens, or personal data in `scope` or `justification`.

A `statusUrl` fetch reveals that a particular plugin is being evaluated (and possibly the host's IP and timing). Hosts SHOULD cache revocation lists, avoid per-plugin fetches where possible, and consider a privacy-preserving proxy. Revocation lists SHOULD NOT contain personal data beyond what is necessary to identify the artifact.

Audit logs that record scopes can themselves become sensitive. Hosts SHOULD apply retention limits and access controls, and SHOULD redact paths or hostnames where full fidelity is not required.

---

## 10. IANA Considerations

> No IANA action has been taken. The following is a **request** that would be made if this document were published as an RFC. An individual draft cannot create registries.

### 10.1. Media type `application/apcm+json`

| Item | Value |
|---|---|
| Type name | application |
| Subtype name | apcm+json |
| Required parameters | none |
| Optional parameters | none |
| Encoding considerations | binary (UTF-8 JSON) |
| Security considerations | See Section 8 |
| Interoperability considerations | JSON parsers must bound size/depth; unknown fields ignored |
| Published specification | This document (if published) |
| Applications | Agent plugin hosts, registries, review tools |
| Fragment identifier considerations | none |
| Restrictions on usage | none |
| Author/Change controller | The author of this document |
| Provisional registration | No; request standards-tree registration only if this document becomes an RFC |

### 10.2. Capability identifier registry

Name: **Agent Plugin Capability Identifiers (APCM Capabilities)**

Registration policy: **Specification Required**.

Fields:

- Identifier (string, stable, lowercase)
- Description (string)
- Risk class (`low`, `medium`, `high`; advisory)
- Scope semantics (string)
- Reference (URI)
- Status (`active`, `deprecated`)

Initial entries: the table in Section 5.2.

### 10.3. Revocation reason registry

Name: **APCM Revocation Reasons**

Registration policy: **First Come First Served** for unambiguous, non-duplicative values; **Specification Required** for values that change host behavior.

Initial entries: `key-compromise`, `malware`, `policy-violation`, `vulnerability`, `superseded`, `author-request`.

### 10.4. Well-known URI

If a standard discovery mechanism is desired, a future version may request a well-known URI such as `/.well-known/apcm`. This document does not request one; `revocation.statusUrl` is an explicit URL, not a discovery convention.

---

## 11. References

### 11.1. Normative References

- [RFC2119] Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels", BCP 14, RFC 2119, DOI 10.17487/RFC2119, March 1997.
- [RFC8174] Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words", BCP 14, RFC 8174, DOI 10.17487/RFC8174, May 2017.
- [RFC8259] Bray, T., Ed., "The JavaScript Object Notation (JSON) Data Interchange Format", STD 90, RFC 8259, DOI 10.17487/RFC8259, December 2017.
- [RFC3339] Klyne, G. and C. Newman, "Date and Time on the Internet: Timestamps", RFC 3339, DOI 10.17487/RFC3339, July 2002.
- [RFC7515] Jones, M., Bradley, J., and N. Sakimura, "JSON Web Signature (JWS)", RFC 7515, DOI 10.17487/RFC7515, May 2015.
- [RFC8785] Rundgren, A., Jordan, B., and S. Erdtman, "JSON Canonicalization Scheme (JCS)", RFC 8785, DOI 10.17487/RFC8785, June 2020.

### 11.2. Informative References

- [SEMVER] Preston-Werner, T., "Semantic Versioning 2.0.0", <https://semver.org/>.
- [PURL] Package URL specification, <https://github.com/package-url/purl-spec>.
- [SLSA] OpenSSF, "Supply-chain Levels for Software Artifacts", <https://slsa.dev/>.
- [IN-TOTO] in-toto attestation framework, <https://in-toto.io/>.
- [MCP] Model Context Protocol specification, <https://modelcontextprotocol.io/>.
- [HCB] PerryLink, "HCB: Host Compatibility Baseline for DeepSeek Harness plugins", <https://github.com/PerryLink/dsh-hcb>.
- [DSH] DeepSeek Harness, <https://github.com/deepseek-ai/deepseek-harness>.
- [OSSF] OpenSSF Best Practices Badge, <https://www.bestpractices.dev/>.

---

## Appendix A. Example Manifest

> All identifiers and URLs are examples; `example.com` is reserved for documentation.

```json
{
  "specVersion": "apcm/1",
  "plugin": {
    "id": "pkg:npm/example-plugin",
    "name": "example-plugin",
    "version": "1.2.3",
    "digest": "sha256-47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU",
    "publisher": "https://github.com/example",
    "homepage": "https://example.com/plugin"
  },
  "host": {
    "product": "example-host",
    "apiVersion": "0.2",
    "compat": ">=0.2.2-rc.3 <0.3.0",
    "features": ["tools.register"]
  },
  "capabilities": [
    {
      "id": "fs.read",
      "scope": ["${workspace}"],
      "constraints": {"paths": ["./src/**"]},
      "required": true,
      "justification": "Reads source files for static analysis."
    },
    {
      "id": "net.egress",
      "scope": ["api.example.com"],
      "constraints": {"schemes": ["https"], "methods": ["GET"], "ports": [443]},
      "required": false
    },
    {
      "id": "proc.spawn",
      "scope": ["git"],
      "constraints": {"argvPrefix": ["git", "status"]},
      "required": true
    }
  ],
  "limits": {
    "maxRuntimeMs": 30000,
    "maxOutputBytes": 1048576
  },
  "revocation": {
    "statusUrl": "https://example.com/apcm/revocations.json",
    "listVersion": 42
  },
  "issuedAt": "2026-11-14T00:00:00Z",
  "expiresAt": "2027-05-13T00:00:00Z",
  "signature": {
    "alg": "Ed25519",
    "keyId": "pub-2026-11",
    "value": "base64url-signature"
  }
}
```

## Appendix B. JSON Schema Sketch

> This is a non-normative sketch, not a complete schema. A real schema must bound lengths, reject duplicate capability IDs, and encode the conditional signature rules.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.com/apcm/1/schema.json",
  "type": "object",
  "required": ["specVersion", "plugin", "capabilities", "issuedAt"],
  "properties": {
    "specVersion": {"const": "apcm/1"},
    "plugin": {
      "type": "object",
      "required": ["id", "name", "version"],
      "properties": {
        "id": {"type": "string", "minLength": 1, "maxLength": 256},
        "name": {"type": "string", "minLength": 1, "maxLength": 214},
        "version": {"type": "string", "minLength": 1, "maxLength": 64},
        "digest": {"type": "string", "pattern": "^sha256-[A-Za-z0-9_-]+$"},
        "publisher": {"type": "string", "format": "uri"},
        "homepage": {"type": "string", "format": "uri"}
      }
    },
    "capabilities": {
      "type": "array",
      "maxItems": 256,
      "items": {
        "type": "object",
        "required": ["id"],
        "properties": {
          "id": {"type": "string", "pattern": "^(x-[a-z0-9-]+\\.)?[a-z0-9-]+\\.[a-z0-9-]+$"},
          "scope": {"type": "array", "items": {"type": "string", "maxLength": 512}, "maxItems": 256},
          "constraints": {"type": "object"},
          "required": {"type": "boolean"},
          "justification": {"type": "string", "maxLength": 512}
        }
      }
    },
    "issuedAt": {"type": "string", "format": "date-time"},
    "expiresAt": {"type": "string", "format": "date-time"},
    "signature": {
      "type": "object",
      "required": ["alg", "keyId", "value"],
      "properties": {
        "alg": {"enum": ["Ed25519", "ES256"]},
        "keyId": {"type": "string", "minLength": 1, "maxLength": 128},
        "value": {"type": "string", "minLength": 1, "maxLength": 4096}
      }
    }
  }
}
```

## Appendix C. Open Issues

1. **Taxonomy granularity.** Is `fs.read` enough, or do hosts need `fs.read.user-home`, `fs.read.workspace` as separate identifiers? Current draft keeps one identifier plus scope.
2. **Signature profile.** JWS + JCS is simple but has canonicalization pitfalls. COSE or a detached signature over the tarball digest may be safer; needs implementation feedback.
3. **Revocation distribution.** Status URL + signed list is easy, but caching, privacy, and availability are unsolved. A status-list mechanism (for example, a bitstring) may scale better.
4. **Host policy language.** This document deliberately leaves policy out. A companion document may be needed to make grants comparable.
5. **Relationship to MCP.** MCP tool annotations describe tools, not plugin-level authority. A mapping (or non-mapping) should be documented.
6. **Evidence levels.** APCM only carries declarations. Should it carry `checked`/`tested` evidence, or should that remain a separate dataset (as in HCB)?
7. **Naming.** `dsh.capabilities` is one existing field; APCM is host-neutral. Adoption may require a compatibility mapping rather than a new field.

## Acknowledgments

This draft grew out of the HCB compatibility dataset and the `dsh-capdiff` tool. Thanks to the DSH community for public package metadata; no endorsement by DeepSeek or any plugin author is implied.

## Author's Address

```text
PerryLink
Independent
Email: <to be confirmed before submission>
URI:   https://github.com/PerryLink
```

> **Final status:** personal draft, not submitted, not an IETF standard. The filename, expiry date, and IANA sections are placeholders for a possible `-00` submission; do not represent them as an approved document.
