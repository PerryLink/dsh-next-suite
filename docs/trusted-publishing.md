# npm Trusted Publishing (OIDC) — status and steps

> **Status (2026-11-20): OIDC verified.** The `v0.2.5` release published all
> eight packages through npm Trusted Publishing; each package has a provenance
> attestation. The release workflow never reads `NPM_TOKEN` or sets
> `registry-url`, and the legacy `NPM_TOKEN` secret has been deleted.

## Why

Trusted Publishing removes the long-lived `NPM_TOKEN` from GitHub secrets. The
release job authenticates with the GitHub Actions OIDC token (`id-token: write`,
already present) and npm verifies the repository + workflow + environment.

## Per-package setup (npmjs.com, manual)

For each package:

1. Open `https://www.npmjs.com/package/<name>/access` → **Trusted Publishing**.
2. Provider: **GitHub Actions**.
3. Repository: `PerryLink/dsh-next-suite`.
4. Workflow file: `release.yml`.
5. Environment: leave empty.
6. Permission: allow **publish**.

Packages:

- `dsh-capdiff`
- `testatum-attest`
- `dsh-supply-watch`
- `cordis-hmr-doctor`
- `cordis-migrate`
- `cordis-testkit`
- `dsh-xbrl`
- `dsh-upgrade-atlas`

## Workflow change (done 2026-11-19)

In `.github/workflows/release.yml` publish job:

- remove `NODE_AUTH_TOKEN` / `secrets.NPM_TOKEN`;
- keep `permissions: id-token: write` (already present);
- keep `npm publish --workspaces --provenance`.

Do this only after all eight packages show the trusted publisher. A release with
one unconfigured package fails after publishing the earlier ones.

## Verify

- Push a `vX.Y.Z` tag and confirm the release workflow publishes with OIDC.
- `npm view <pkg>@X.Y.Z dist.attestations` still contains a provenance entry.
- Delete the `NPM_TOKEN` Actions secret only after a successful OIDC release.
