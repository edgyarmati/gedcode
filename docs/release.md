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

Versions matching plain `X.Y.Z` are stable releases. Versions with a suffix, for example
`X.Y.Z-alpha.1`, are GitHub prereleases and are not marked latest on GitHub.

## What Is Not Automated Today

The current workflow does not include:

- scheduled nightly releases
- a separate nightly updater channel
- Vercel or hosted web app deployment

## Required Release Setup

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
  the update button (rocket/update action), then restart/install after download completes.

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
   - GitHub Release is created with expected assets
6. Download and smoke test each desktop artifact.
7. For stable `X.Y.Z` releases, confirm the `Finalize release` job updated version strings on
   `main` when needed.

## Rehearsal Guidance

There is no true dry-run mode in the current workflow. For a rehearsal, use one of these safer options:

- run the local repo gates before tagging
- test the workflow in a fork or temporary private repository
- temporarily disable GitHub Release publishing on a throwaway branch

## Troubleshooting

- Release version rejected:
  - Use `X.Y.Z` or `vX.Y.Z`, optionally with a suffix such as `X.Y.Z-alpha.1`.
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
