# Tasks — Sparkle updates on macOS

Dependency-ordered. Each slice is independently verifiable.

## 1. Decide key custody

Not code. Decide whether v1 reuses v0's EdDSA key pair and `sparkle-feed` release or mints its own,
and confirm the `SPARKLE_ED_PRIVATE_KEY` secret exists on `edgyarmati/gedcode` for whichever is
chosen. Blocks everything downstream: the public key is compiled into the app.

## 2. Pin the dependency

Add `electron-sparkle-updater` with a reviewed patch pinning the Sparkle framework version. Review
the patch line by line — it carries native code into the bundle. Record the pinned versions in the
spec.

## 3. `ElectronSparkleUpdater`

New file in `apps/desktop/src/electron/`, implementing `ElectronUpdater["Service"]` exactly, with
unit tests driving it through the same shapes `updatesTestHarness.ts` uses for the electron-updater
layer. No change to `DesktopUpdates.ts`. If the interface does not fit, stop and report.

## 4. Select it on macOS

One line in `apps/desktop/src/main.ts`. Non-macOS behaviour must be byte-identical to today —
prove it, do not assert it.

## 5. Packaging

`scripts/sparkle-after-pack.cjs` plus the electron-builder config that invokes it, so
`Sparkle.framework` is packaged, the feed URL and `SUPublicEDKey` are embedded, and the code
resource seal stays intact.

## 6. Feed generation

`scripts/generate-sparkle-feed.ts` + test: sign the archive, emit the appcast, verify both with
Sparkle's official tools before emitting anything. Stable and nightly produce distinct feeds.

## 7. Release pipeline

Wire generation and publication into `.github/workflows/release.yml`, with the refuse-to-publish
checks from the spec. Rehearse locally first; a broken release workflow is discovered at the worst
possible moment.

## 8. Document

Port `docs/sparkle-updates.md`: trust boundary, key custody, moving the key between Macs, local
rehearsal. State plainly that the first install still shows a Gatekeeper warning.
