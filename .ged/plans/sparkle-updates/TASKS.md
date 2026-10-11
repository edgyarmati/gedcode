# Tasks — Sparkle updates on macOS

All slices done 2026-10-11 — see the "As built" section of [SPEC.md](./SPEC.md). Slice 2 needed no
patch, slice 7 is a new workflow rather than a `release.yml` edit, and the slice 1 seed check moved
into CI: this Mac's Keychain holds no copy of the key.

Dependency-ordered. Each slice is independently verifiable.

## 1. Decide key custody — **done, 2026-10-11: reuse**

v0.5 reuses v0.4's EdDSA key pair and the `sparkle-feed` prerelease. Verified on the repo:
`SPARKLE_ED_PRIVATE_KEY` is present (added 2026-08-27) and `sparkle-feed` still serves
`appcast-latest.xml` advertising 0.4.8. Minting a new pair would strand every existing install
behind a manual bridge release, which is the failure Sparkle was kept to avoid. The embedded
`SUPublicEDKey` therefore stays `OEqTyWgHzGWLdI/c38qOQw+fwKdK+npBmpSEum8e4U4=` and the keychain
account stays `gedcode-updates`.

Still to confirm before slice 6: that the private seed in the repo secret matches that public key,
by running `generate_keys -p` against the keychain item on this Mac. Never print or paste the seed.

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
