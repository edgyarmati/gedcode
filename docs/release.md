# Release Checklist

This document describes the current GedCode release workflow in `.github/workflows/release.yml`.

## Current Workflow

- Workflow: `.github/workflows/release.yml`
- Triggers:
  - push a tag matching `v*.*.*`
  - manual `workflow_dispatch` with a required `version` input such as `0.1.0` or `v0.1.0`
- Preflight gates:
  - `bun run fmt:check`
  - `bun run lint`
  - `bun run typecheck`
  - `bun run test`
- Desktop build matrix:
  - macOS `arm64` DMG
  - macOS `x64` DMG
  - Linux `x64` AppImage
  - Windows `x64` NSIS installer
- Published outputs:
  - one GitHub Release named `GedCode vX.Y.Z`
  - desktop installers, macOS zip updater payloads, update manifests, and blockmaps
  - the CLI npm package from `apps/server`, package name `gedcode`

Versions matching plain `X.Y.Z` are stable releases. Versions with a suffix, for example
`X.Y.Z-alpha.1`, are GitHub prereleases and are not marked latest on GitHub.

Important current limitation: the npm publish step always uses npm dist-tag `latest`. Do not use a
prerelease version for a public release unless publishing that CLI build to `latest` is acceptable.

## What Is Not Automated Today

The current workflow does not include:

- scheduled nightly releases
- a separate nightly updater channel
- Vercel or hosted web app deployment

The workflow uses npm Trusted Publishing/OIDC for the CLI publish step. The top-level
`id-token: write` permission is required so GitHub Actions can mint the short-lived OIDC token used
by npm, and the publish command includes `--provenance` for package provenance.

## Required Release Setup

### npm CLI Publish

The `gedcode` npm package must have a Trusted Publisher configured on npmjs.com before the
release workflow can publish without a token. Configure npm Trusted Publishing for:

- Package: `gedcode`
- Provider: GitHub Actions
- Repository: this GitHub repository, currently `edgyarmati/gedcode`
- Workflow filename: `release.yml`
- Environment: leave blank unless `.github/workflows/release.yml` is also updated to use a matching GitHub Actions environment
- Allowed action: `npm publish`

The publish job builds the web package and CLI package before publishing:

```sh
bun --filter=@t3tools/web run build
bun --filter=gedcode run build
node apps/server/scripts/cli.ts publish --tag latest --app-version "$VERSION" --verbose --provenance
```

### macOS Signing And Notarization

Signing is optional. If any required value is missing, macOS artifacts are built unsigned.

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

`APPLE_API_KEY` is stored as raw key text in GitHub Actions secrets. The workflow writes it to a
temporary `AuthKey_<id>.p8` file at runtime.

### Windows Signing

Windows signing is optional. If any required value is missing, Windows artifacts are built unsigned.

- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `AZURE_TRUSTED_SIGNING_ENDPOINT`
- `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
- `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`
- `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`

## Desktop Auto-Update Notes

- Runtime updater: `electron-updater` in `apps/desktop/src/main.ts`.
- Provider: GitHub Releases (`provider: github`) configured at build time.
- The workflow publishes `latest*.yml` updater metadata for stable releases.
- macOS release assets must include both installer DMGs and zip updater payloads.
- The workflow merges per-arch macOS update manifests into one macOS manifest before publishing.
- The desktop UI does not automatically download or install updates. Users start the download from
  the update button, then restart/install after download completes.

Repository slug source:

- `T3CODE_DESKTOP_UPDATE_REPOSITORY` in build/runtime config, if set.
- Otherwise `GITHUB_REPOSITORY` from GitHub Actions.

Temporary private-repo updater auth workaround:

- Set `T3CODE_DESKTOP_UPDATE_GITHUB_TOKEN` or `GH_TOKEN` in the desktop app runtime environment.
- The app forwards it as an `Authorization: Bearer <token>` request header for updater HTTP calls.

## Release Steps

1. Confirm `main` is green in CI.
2. Run the local repo gates:

   ```sh
   bun fmt # if formatting changes are needed
   bun run fmt:check
   bun lint
   bun typecheck
   bun run test
   ```

3. Decide the release version, for example `0.1.0`.
4. Create and push the tag:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

   Alternatively, run the GitHub Actions workflow manually and enter `0.1.0` in the `version`
   input.

5. Watch `.github/workflows/release.yml`:
   - preflight passes
   - all desktop matrix builds pass
   - CLI publish passes
   - GitHub Release is created with expected assets
6. Download and smoke test each desktop artifact.
7. For stable `X.Y.Z` releases, confirm the `Finalize release` job updated version strings on
   `main` when needed.

## Rehearsal Guidance

There is no true dry-run mode in the current workflow. A test tag such as `v0.0.0-test.1` will still
run the CLI publish job with npm dist-tag `latest`.

For a rehearsal, use one of these safer options:

- run the local repo gates before tagging
- test the workflow in a fork or temporary private repository
- temporarily disable the npm publish step on a throwaway branch
- test trusted publishing only in a repository/package configured with a matching npm Trusted Publisher; forks or throwaway repositories need their own npm trusted publisher setup

## Troubleshooting

- Release version rejected:
  - Use `X.Y.Z` or `vX.Y.Z`, optionally with a suffix such as `X.Y.Z-alpha.1`.
- CLI publish fails:
  - Check that npm Trusted Publishing is configured for package `gedcode`, this repository, and workflow filename `release.yml`.
  - Check npm package ownership/access for `gedcode`.
  - Check that the workflow still has `id-token: write` and uses a GitHub-hosted runner.
  - Check the npm CLI version if authentication/provenance errors mention unsupported OIDC.
- macOS build unsigned when signing was expected:
  - Check all Apple signing and notarization secrets are populated.
- Windows build unsigned when signing was expected:
  - Check all Azure Trusted Signing secrets are populated.
- Build fails with signing errors:
  - Retry with signing secrets removed to confirm the unsigned build path still works.
  - Re-check certificate/profile names and tenant/client credentials.
- GitHub Release is missing updater files:
  - Inspect the build artifact upload for `*.zip`, `*.yml`, and `*.blockmap` files before the
    release job downloads artifacts.
