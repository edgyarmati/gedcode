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
  - `bun run release:versions:check`
  - `bun run release:smoke`
  - `bun run release:audit`
  - the web browser suites
- Desktop build matrix:
  - macOS `arm64` DMG
  - Linux `x64` AppImage
  - Windows `x64` NSIS installer
- Published outputs:
  - one GitHub Release named `GedCode vX.Y.Z`
  - desktop installers, macOS zip updater payloads, update manifests, and blockmaps

Versions matching plain `X.Y.Z` are stable releases. Versions with a suffix, for example
`X.Y.Z-alpha.1`, are GitHub prereleases and are not marked latest on GitHub.

Nightly versions use `X.Y.0-nightly.YYYYMMDD.N`. The nightly base version should be the next minor
line after the current stable package version. For example, after stable `1.1.0`, nightly builds
target `1.2.0-nightly.YYYYMMDD.N`.

## What Is Not Automated Today

The current workflow does not include:

- scheduled nightly releases
- Vercel or hosted web app deployment

When a hosted web deployment is added, configure the hosted pairing origin explicitly so generated
pairing links use the GedCode-owned router:

- `VITE_HOSTED_APP_URL`, for example `https://app.gedcode.example`
- `HOSTED_WEB_ROUTER_HOST`, for example `app.gedcode.example`
- `HOSTED_WEB_LATEST_ORIGIN`, for example `https://latest.gedcode.example`
- `HOSTED_WEB_NIGHTLY_ORIGIN`, for example `https://nightly.gedcode.example`
- `HOSTED_WEB_CHANNEL_COOKIE`, optional channel-selection cookie name

## Required Release Setup

### macOS Signing And Notarization

Signing and notarization are supported but not required while the project does not have an Apple
Developer Program membership. If any required value is missing, macOS artifacts are built with a
validated ad-hoc signature; users must manually allow the app in macOS Gatekeeper.

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

- Runtime updaters: Sparkle 2 on production macOS; `electron-updater` on Windows, Linux, and local
  mock-update builds. See [sparkle-updates.md](./sparkle-updates.md) for signing-key custody,
  transfer, feed publication, and the one-time manual bridge from pre-Sparkle releases.
- Provider: GitHub Releases (`provider: github`) configured at build time.
- The workflow publishes `latest*.yml` updater metadata for stable releases and copies those
  manifests to `nightly*.yml` so nightly subscribers can move onto stable releases.
- Nightly prereleases publish `nightly*.yml` updater metadata.
- Stable subscribers only accept stable update candidates. Nightly subscribers accept nightly and
  stable update candidates.
- macOS release assets must include both installer DMGs and zip updater payloads.
- The current release only publishes Apple Silicon (`arm64`) macOS artifacts.
- Sparkle checks and downloads macOS updates in the background, then requires the user to confirm
  install and relaunch. Other platforms keep the explicit download and install actions.
- To exercise the full updater flow locally against a non-GitHub feed, see
  [desktop-updater-local-testing.md](./desktop-updater-local-testing.md).

Repository slug source:

- `T3CODE_DESKTOP_UPDATE_REPOSITORY` in build/runtime config, if set.
- Otherwise `GITHUB_REPOSITORY` from GitHub Actions.

GedCode's updater feed is the public GedCode GitHub repository. Private-repository updater tokens
are neither needed nor forwarded by the desktop runtime.

## Dependency Audit Policy

`bun run release:audit` blocks a release on every unresolved high or critical advisory reachable
from the production dependency graph. Moderate and low advisories remain visible in the command
output but do not block publication. A high or critical advisory may be classified as build-only
only by an exact package-and-advisory entry in `scripts/audit-production-dependencies.ts`, with a
code comment explaining why the affected module cannot ship in a GedCode artifact. New advisories
for the same package remain blocking by default.

The current residual advisories are a low-severity `esbuild` development-server file-read issue on
Windows and a high-severity `path-to-regexp` issue in the dev-only `@vercel/config` tree. GedCode
does not ship either development server/tooling path. Production Express/router uses the fixed
`path-to-regexp` 8.x line.

## Release Steps

1. Confirm `main` is green in CI.
2. Update `CHANGELOG.md` with a section for the release version.
3. Run the local repo gates:

   ```sh
   bun fmt # if formatting changes are needed
   bun run fmt:check
   bun lint
   bun typecheck
   bun run test
   bun run release:versions:check
   bun run release:smoke
   bun run release:audit
   ```

   Alternatively, use the release wrapper, which checks the clean worktree, changelog section, local
   gates, and dispatches the GitHub Actions release workflow:

   ```sh
   ./release.sh stable patch
   ./release.sh nightly minor
   ./release.sh stable patch --dry-run
   ```

4. Decide the release version, for example `0.1.0`.
5. Create and push the tag:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

   Alternatively, run the GitHub Actions workflow manually and enter `0.1.0` in the `version`
   input.

6. Watch `.github/workflows/release.yml`:
   - preflight passes
   - all desktop matrix builds pass
   - GitHub Release is created with expected assets
7. Download and smoke test each desktop artifact.
8. For stable `X.Y.Z` releases, confirm the `Finalize release` job updated version strings and Bun
   lockfile workspace metadata on `main` when needed. The job retries from the latest `main` after a
   concurrent push and never moves or rebuilds the already-published tag SHA.

## Local Build Wrapper

Use `./build.sh` for local desktop artifacts. It defaults to a dev patch build:

```sh
./build.sh
./build.sh dev patch -- --platform mac --target dmg --arch arm64
./build.sh nightly minor -- --platform mac --target dmg --arch arm64
./build.sh stable patch -- --platform mac --target dmg --arch arm64
```

## Rehearsal Guidance

`./release.sh ... --dry-run` runs the same local, non-writing gates and confirms the reviewed local
SHA exactly matches remote `main`, but stops before dispatching GitHub Actions. It does not format or
otherwise rewrite tracked files.

For a full GitHub Actions rehearsal, use one of these options:

- run the local repo gates before tagging
- test the workflow in a fork or temporary private repository
- temporarily disable GitHub Release publishing on a throwaway branch

## Troubleshooting

- Release version rejected:
  - Use `X.Y.Z` or `vX.Y.Z`, optionally with a suffix such as `X.Y.Z-alpha.1`.
- macOS build unsigned when signing was expected:
  - Check all Apple signing and notarization secrets are populated.
- macOS says the app is damaged:
  - Check the release build log for the `Verify macOS artifact signature` step.
- Windows build unsigned when signing was expected:
  - Check all Azure Trusted Signing secrets are populated.
- Build fails with signing errors:
  - Re-check that all Apple or Windows signing secrets are populated for release builds.
  - Re-check certificate/profile names and tenant/client credentials.
- GitHub Release is missing updater files:
  - Inspect the build artifact upload for `*.zip`, `*.yml`, and `*.blockmap` files before the
    release job downloads artifacts.
