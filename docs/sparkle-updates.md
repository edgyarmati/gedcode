# Sparkle updates on macOS

GedCode uses [Sparkle 2](https://sparkle-project.org/documentation/) for production macOS updates.
This lets an ad-hoc-signed build discover, verify, download, and install a GedCode update without an
Apple Developer Program certificate. It does **not** remove the initial Gatekeeper warning: users
still have to allow the first downloaded app manually. Users of a pre-Sparkle GedCode release must
also install the first Sparkle-enabled DMG manually; releases after that bridge can update in-app.

GedCode checks its selected stable or nightly appcast in the background. Sparkle may download and
prepare an available update automatically, but it always presents its standard install-and-relaunch
confirmation before changing the installed app.

## Release assets and trust boundary

- The repository pins `electron-sparkle-updater` to `0.2.0` and carries a reviewed Bun patch. The
  patch pins Sparkle itself to `2.9.6`, exposes the background-download and feed-switching operations
  GedCode needs, and fixes the packaged-framework runtime search path. Treat an upgrade of either
  component as native-code and release-pipeline work, not a routine dependency bump.
- Stable and nightly builds embed different appcast URLs. Both appcasts are durable assets on the
  fixed `sparkle-feed` GitHub prerelease, while archive URLs point at the immutable version release.
- `SUPublicEDKey` embedded in every production macOS app is:

  ```text
  OEqTyWgHzGWLdI/c38qOQw+fwKdK+npBmpSEum8e4U4=
  ```

- GitHub Actions stores the matching private seed in the `SPARKLE_ED_PRIVATE_KEY` repository secret.
  Release automation refuses to publish when the secret is missing, does not derive the embedded
  public key, or cannot verify the generated appcast and archive signatures with Sparkle's official
  tools.
- Never commit, print, paste into an issue, or send the private seed through chat. The private seed
  is equivalent to the password on the Keychain item named `Private key for signing Sparkle updates`.

## Moving the signing key to another Mac

Use the `generate_keys` binary from the same official Sparkle release on both Macs. The account name
for GedCode is `gedcode-updates`.

1. Connect an encrypted removable drive to the current Mac. Export directly to that drive:

   ```sh
   /path/to/Sparkle/bin/generate_keys \
     --account gedcode-updates \
     -x /Volumes/EncryptedDrive/gedcode-sparkle-private-key
   ```

2. Eject the drive, connect it to the destination Mac, and import the key:

   ```sh
   /path/to/Sparkle/bin/generate_keys \
     --account gedcode-updates \
     -f /Volumes/EncryptedDrive/gedcode-sparkle-private-key
   ```

3. On the destination Mac, verify the public key before deleting any copy:

   ```sh
   /path/to/Sparkle/bin/generate_keys --account gedcode-updates -p
   ```

   The output must exactly match the public key above. Keep one second encrypted offline backup;
   losing both the Keychain item and GitHub secret would require a manual bridge release with a new
   embedded public key.

4. Replace the GitHub Actions copy from the transferred file if needed:

   ```sh
   gh secret set SPARKLE_ED_PRIVATE_KEY --repo edgyarmati/gedcode \
     < /Volumes/EncryptedDrive/gedcode-sparkle-private-key
   ```

5. Securely erase the plaintext transfer file from the removable drive. Only after a release
   rehearsal succeeds with the destination key should the source Mac's Keychain item be deleted:

   ```sh
   security delete-generic-password \
     -s https://sparkle-project.org \
     -a gedcode-updates
   ```

Do not delete the current Mac's Keychain copy merely because the repository secret exists: GitHub
secrets cannot be read back for recovery.

## Local release rehearsal

Build a production-version macOS archive, then use the official Sparkle tools to generate and verify
the feed. Keep the private key in an environment variable only for the lifetime of the command and
avoid shell tracing.

```sh
bun run dist:desktop:artifact -- \
  --platform mac \
  --target dmg \
  --arch arm64 \
  --build-version 0.4.4 \
  --output-dir /absolute/path/to/release-assets

SPARKLE_ED_PRIVATE_KEY="$(security find-generic-password \
  -s https://sparkle-project.org \
  -a gedcode-updates \
  -w)" \
node scripts/generate-sparkle-feed.ts \
  --tag v0.4.4 \
  --channel latest \
  --release-assets-dir /absolute/path/to/release-assets \
  --output-dir /absolute/path/to/appcast-output \
  --sparkle-bin /path/to/Sparkle/bin
```

The release workflow additionally checks the app's complete code-resource seal, packaged
`Sparkle.framework`, native bridge architecture/linkage, embedded public key, and feed URL before it
publishes anything.
