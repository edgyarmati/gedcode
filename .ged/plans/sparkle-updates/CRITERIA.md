# Acceptance criteria — Sparkle updates on macOS

Written to be ruled `met` / `not_met` / `unverifiable` from the diff and from command output, by a
verifier who did not write the code.

## 1. Key custody

- The chosen key pair is recorded in `SPEC.md` with its public key verbatim, and
  `gh secret list --repo edgyarmati/gedcode` shows `SPARKLE_ED_PRIVATE_KEY`.
- No private seed appears anywhere in the diff. `git log -p` for the branch contains no base64 blob
  outside the documented public key.

## 2. Dependency pin

- `package.json` names an exact `electron-sparkle-updater` version — no `^`, no `~`.
- The patch under `patches/` pins the Sparkle framework version, and that version is named in
  `SPEC.md`.

## 3. `ElectronSparkleUpdater`

- The module exports a `layer` typed as `Layer<ElectronUpdater>`; `tsc --noEmit` for
  `@t3tools/desktop` passes, which is what proves the interface is satisfied exactly.
- `apps/desktop/src/updates/DesktopUpdates.ts` is unchanged — `git diff` shows no hunk in it.
- A named test covers each of `checkForUpdates`, `downloadUpdate`, and `quitAndInstall` succeeding
  and failing, with failures surfacing the existing `ElectronUpdater*Error` tagged errors.

## 4. Platform selection

- `apps/desktop/src/main.ts` differs from upstream by at most the layer-selection hunk.
- A named test asserts the non-darwin branch resolves to `ElectronUpdater.layer`.

## 5. Packaging

- A built macOS app contains `Contents/Frameworks/Sparkle.framework`.
- `codesign --verify --deep --strict` on the built app exits 0 — i.e. the after-pack step did not
  break the code resource seal.
- `defaults read <app>/Contents/Info SUPublicEDKey` prints the key recorded in `SPEC.md`, and
  `SUFeedURL` matches the channel built.

## 6. Feed generation

- Running the script against a built artifact emits an appcast whose signature verifies with
  Sparkle's official `sign_update -v`.
- With `SPARKLE_ED_PRIVATE_KEY` unset the script exits non-zero and writes no output file. A named
  test asserts this.
- Stable and nightly runs produce different `SUFeedURL` values and different appcast filenames,
  asserted by a named test.

## 7. Release pipeline

- A dry run on a throwaway tag publishes an appcast and archive whose signatures verify.
- The workflow fails, with no asset published, when the secret is absent, when the derived public
  key differs from the embedded one, or when signature verification fails. Each is a separate
  guarded step with a non-zero exit, identifiable in the diff.

## 8. Documentation

- `docs/sparkle-updates.md` exists and covers: the trust boundary, the embedded public key, where
  the private seed lives, moving the key between Macs, and a local rehearsal command.
- It states explicitly that the first install still requires the user to allow the app manually.

## Whole-change criteria

- `STANDARDS.md`'s modified-upstream-file table lists every upstream file this change touches, with
  no entry missing and none left over. Compare the table against `git diff --name-only upstream/main...HEAD`.
- No fallback or degraded update path is added. If Sparkle cannot be used, the build fails or the
  feature is absent — it does not silently revert to a non-functional `electron-updater` on macOS.
