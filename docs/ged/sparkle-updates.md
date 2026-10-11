# Sparkle updates on macOS

GedCode's macOS build updates itself through [Sparkle 2](https://sparkle-project.org/documentation/)
instead of `electron-updater`. Sparkle verifies an update with its own EdDSA signature rather than the
system code signature, so an ad-hoc-signed build can discover, verify, download, and install an
update without an Apple Developer Program certificate. Linux and Windows keep `electron-updater`.

It does **not** remove the first-run Gatekeeper warning: the first downloaded app still has to be
allowed manually. Every update after that installs in-app.

## How it fits

- `apps/desktop/src/electron/ElectronSparkleUpdater.ts` is a second implementation of upstream's
  `ElectronUpdater` service. `main.ts` selects it on macOS through `ElectronSparkleUpdater.layerAuto`;
  `DesktopUpdates`, channels, and the update UI are upstream's, unchanged. Checks only run when
  DesktopUpdates asks, and the user still confirms the download and the install.
- `scripts/sparkle/` holds the build side: `buildConfig.ts` merges the Sparkle electron-builder
  fragment and Info.plist policy into the macOS config, `stage.ts` extracts `Sparkle.framework` and
  compiles the bridge addon in the staged app, `afterPack.cjs` re-signs the app ad hoc once the
  framework is in place, and `generate-feed.ts` produces and verifies the appcast.
- `@t3tools/shared/sparkleUpdate` holds the embedded public key and the feed URLs.

## Release assets and trust boundary

- `electron-sparkle-updater` is pinned to `0.5.3`, which bundles a universal Sparkle `2.9.4`
  framework (carrying a delta-chain patch) and Sparkle's official tools. Treat a bump as native-code
  and release-pipeline work, not a routine dependency update.
- Stable and nightly builds embed different appcast URLs, chosen from the version: a
  `-nightly.YYYYMMDD.N` version reads `appcast-nightly.xml`, everything else `appcast-latest.xml`.
  Both are durable assets on the fixed `sparkle-feed` GitHub prerelease; archive URLs point at the
  immutable version release. Preview versions (`-pr.`, `-preview.`) get no feed.
- Every build sets `SURequireSignedFeed` and `SUVerifyUpdateBeforeExtraction`. Installed copies reject
  an unsigned feed, so these must never be dropped.
- The `SUPublicEDKey` embedded in every macOS build is the same key v0.4 used, so v0.4 installs can
  update to v0.5 in-app:

  ```text
  OEqTyWgHzGWLdI/c38qOQw+fwKdK+npBmpSEum8e4U4=
  ```

  Changing it strands every existing install behind a manual bridge release.

- GitHub Actions stores the matching private seed in the `SPARKLE_ED_PRIVATE_KEY` repository secret.
  `.github/workflows/ged-release.yml` refuses to publish when the secret is missing, when it does not
  derive the embedded public key, or when Sparkle's `sign_update` cannot verify the generated appcast
  and archive signatures.
- Never commit, print, paste into an issue, or send the private seed through chat. The private seed
  is equivalent to the password on the Keychain item named `Private key for signing Sparkle updates`
  (service `https://sparkle-project.org`, account `gedcode-updates`).

## Releasing

Push a tag `vX.Y.Z`, or `vX.Y.Z-nightly.YYYYMMDD.N` for a nightly (or run **Ged Release** from the
Actions tab with a version). Any other version is refused, since it would land in the stable feed.
The workflow builds the Apple Silicon DMG and zip, checks that the app can update itself and still
carries GedCode's bundle identity, generates and verifies the feed, publishes the version release,
and only then replaces the feed on `sparkle-feed`. A failed run can be rerun; it reuses the release.

Only Apple Silicon is built. The feed carries exactly one archive, so an Intel build would need its
own feed or a universal build.

## Moving the signing key to another Mac

Use the `generate_keys` binary from the same Sparkle release on both Macs. After a dependency install,
the tools live in `apps/desktop/node_modules/electron-sparkle-updater/native/vendor/bin` (run
`native/scripts/fetch-sparkle.sh` in that package once to extract them).

1. Connect an encrypted removable drive to the current Mac. Export directly to that drive:

   ```sh
   generate_keys --account gedcode-updates -x /Volumes/EncryptedDrive/gedcode-sparkle-private-key
   ```

2. Eject the drive, connect it to the destination Mac, and import the key:

   ```sh
   generate_keys --account gedcode-updates -f /Volumes/EncryptedDrive/gedcode-sparkle-private-key
   ```

3. On the destination Mac, verify the public key before deleting any copy:

   ```sh
   generate_keys --account gedcode-updates -p
   ```

   The output must exactly match the public key above. Keep one second encrypted offline backup;
   losing both the Keychain item and the GitHub secret requires a manual bridge release with a new
   embedded public key.

4. Replace the GitHub Actions copy from the transferred file if needed:

   ```sh
   gh secret set SPARKLE_ED_PRIVATE_KEY --repo edgyarmati/gedcode \
     < /Volumes/EncryptedDrive/gedcode-sparkle-private-key
   ```

5. Securely erase the plaintext transfer file. Only after a release succeeds with the destination key
   should the source Mac's Keychain item be deleted:

   ```sh
   security delete-generic-password -s https://sparkle-project.org -a gedcode-updates
   ```

Do not delete a Keychain copy merely because the repository secret exists: GitHub secrets cannot be
read back for recovery.

## Local release rehearsal

The resource monitor sidecar needs a recent Rust (`sysinfo` requires rustc 1.95 or newer). Keep the
private key in an environment variable only for the lifetime of the command, and avoid shell tracing.

```sh
GITHUB_REPOSITORY=edgyarmati/gedcode node scripts/build-desktop-artifact.ts \
  --platform mac --target dmg --arch arm64 \
  --build-version 0.5.1 --output-dir /absolute/path/to/release-assets

SPARKLE_ED_PRIVATE_KEY="$(security find-generic-password \
  -s https://sparkle-project.org -a gedcode-updates -w)" \
node scripts/sparkle/generate-feed.ts \
  --tag v0.5.1 \
  --release-assets-dir /absolute/path/to/release-assets \
  --output-dir /absolute/path/to/appcast-output \
  --sparkle-bin apps/desktop/node_modules/electron-sparkle-updater/native/vendor/bin
```

Without `GITHUB_REPOSITORY` (or `T3CODE_DESKTOP_UPDATE_REPOSITORY`) the build ships no
`app-update.yml`, and DesktopUpdates switches itself off. `T3CODE_DESKTOP_MOCK_UPDATES` drives
upstream's electron-updater mock server and tells you nothing about the Sparkle path.
