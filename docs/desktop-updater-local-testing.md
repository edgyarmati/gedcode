# Testing the desktop updater locally (no GitHub release)

This walks through exercising the **real** desktop auto-update flow — check → download →
install/relaunch — against a **local** update feed, without publishing anything to GitHub.
Use it to iterate on updater behavior without spending a full signed-release round-trip on a
build that might be broken.

## How it works

- `build-desktop-artifact --mock-updates` produces a **packaged dev build** whose baked
  `app-update.yml` uses a `generic` provider pointed at `http://localhost:<port>` instead of
  GitHub, and writes the artifacts (plus the `dev-mac.yml` update manifest) to `release-mock/`.
  Dev-versioned builds (`-dev` suffix) automatically skip GitHub publish.
- `scripts/mock-update-server.ts` (`bun start:mock-update-server`) serves `release-mock/` over
  HTTP so the packaged app can fetch the manifest and payload.
- At runtime the app detects the local mock feed (a `generic` provider on a loopback host) and
  switches into **mock update mode**: it follows the build's `dev` channel (`dev-mac.yml`) and
  accepts dev-track candidates, instead of applying the normal stable/nightly channel rules that
  would otherwise reject a `-dev` version. See `resolveMockUpdateMode` in
  `apps/desktop/src/updates/DesktopUpdates.ts`.

Mock dev builds use the **dev app identity** (`com.t3tools.gedcode.dev`) and a separate user-data
directory, so they will not collide with an installed production/nightly GedCode.

## Prerequisites

- macOS on Apple Silicon (the local build targets `arm64`).
- Toolchain installed (`mise install`); see the repo README.

## Steps

1. **Build and install a baseline version.**

   ```sh
   bun dist:desktop:artifact --platform mac --build-version 0.0.1-dev --mock-updates
   ```

   Install the app from `release-mock/GedCode-Dev-0.0.1-dev-arm64.dmg` (drag to `/Applications`),
   then quit it.

2. **Build the "newer" version you want to update to.**

   ```sh
   bun dist:desktop:artifact --platform mac --build-version 0.0.2-dev --mock-updates
   ```

   This regenerates `release-mock/` and its `dev-mac.yml` manifest pointing at `0.0.2-dev`. The
   served version must be **higher** than the installed one for an update to be offered.

3. **Serve the feed.**

   ```sh
   bun start:mock-update-server
   ```

   Defaults to port `3000` and serves the `release-mock/` directory. Override with
   `T3CODE_DESKTOP_MOCK_UPDATE_SERVER_PORT` and `T3CODE_DESKTOP_MOCK_UPDATE_SERVER_ROOT` if needed.
   The port must match the `--mock-update-server-port` used at build time (default `3000`).

4. **Run the installed `0.0.1-dev` app and trigger the update.**

   The UI does not auto-download; use the in-app update button (rocket/update action). The app
   checks the local feed, sees `0.0.2-dev`, downloads it, and then installs and relaunches.

## Notes and gotchas

- **Versions must increase.** electron-updater compares semver, so `0.0.2-dev` > `0.0.1-dev`.
  Re-test a downgrade by serving a lower version; mock mode allows prerelease + downgrade.
- **The manifest is `dev-mac.yml`, not `latest-mac.yml`.** electron-builder derives the `dev`
  channel from the `-dev` version. Mock update mode makes the running app request that channel.
- **Custom port/root.** Set the same port at build (`--mock-update-server-port N`) and serve
  (`T3CODE_DESKTOP_MOCK_UPDATE_SERVER_PORT=N`). Point the server at any directory with
  `T3CODE_DESKTOP_MOCK_UPDATE_SERVER_ROOT`.
- **Code signing (unverified).** These builds are unsigned by default. macOS Squirrel may refuse
  to install an unsigned/improperly-signed update and surface an updater error. If the download
  succeeds but the install/relaunch does not, rebuild with `--signed` (requires signing
  credentials; see [release.md](./release.md)) or use an ad-hoc signing setup. This caveat has not
  been verified end-to-end and is the one step that cannot be exercised headlessly.
