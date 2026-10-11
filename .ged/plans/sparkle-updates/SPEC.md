# Sparkle updates on macOS

Status: **planned, not started.** Carried forward from v0.4 as a must-keep capability.

## Goal

A shipped macOS GedCode can discover, verify, download, and install its own update **without an
Apple Developer Program certificate**.

## Why this is not optional

Upstream ships `electron-updater`. On macOS `electron-updater` requires a Developer ID signature to
install an update; an ad-hoc-signed build cannot self-update at all. For a project that is not
going to pay for and manage an Apple Developer Program membership, that means every release is a
manual DMG download forever, and users silently stay on old builds.

Sparkle 2 verifies updates with its own EdDSA signature over the archive rather than with the
system code signature, so it works on an ad-hoc-signed app. v0.4 shipped this and it worked.

It does **not** remove the first-run Gatekeeper warning: the first downloaded app still has to be
allowed manually. Only subsequent updates become automatic. That limit is inherent and should be
stated in the release notes rather than engineered around.

## Shape

v0.4 is the reference implementation, not the design: upstream's updater has changed substantially
since v0.4 forked (`DesktopUpdates.ts` is now 1042 lines, `build-desktop-artifact.ts` 4172,
`release.yml` 1398), so the v0.4 diffs will not apply and must not be force-fitted.

The seam that makes this affordable is `apps/desktop/src/electron/ElectronUpdater.ts`: it is an
Effect `Context.Service` whose implementation is selected by exactly one line —
`apps/desktop/src/main.ts:140`, `ElectronUpdater.layer`. Everything above it (`DesktopUpdates`,
channels, the update state machine, the UI) talks to the interface, not to `electron-updater`.

So the port is **a second layer satisfying the same service interface**, chosen on macOS:

```
main.ts         →  process.platform === "darwin" ? ElectronSparkleUpdater.layer : ElectronUpdater.layer
```

Not an edit inside `DesktopUpdates.ts`. If the Sparkle implementation cannot satisfy the existing
interface, that is a finding to report — widening the interface is an upstream edit and has to be
argued for, not assumed.

### Alternatives rejected

- **Pay for an Apple Developer Program membership and keep `electron-updater`.** Simplest by far,
  and it also fixes the Gatekeeper warning. Rejected as a standing requirement because the explicit
  goal is to work without one; revisit if that changes, and this whole plan disappears.
- **Fork `DesktopUpdates.ts` into a Ged copy.** Decouples us from upstream's updater entirely, and
  then we own 1042 lines of someone else's state machine forever. No.
- **Ship no auto-update on macOS.** The status quo. Rejected: it is the capability being kept.

## Upstream cost — the reason this is a plan and not a patch

The additive-only constraint in `STANDARDS.md` holds this project together, and this is the most
expensive thing we will ask it to absorb. Honest accounting of the files that must change:

| File                                | Why                                                                   | Conflict risk                             |
| ----------------------------------- | --------------------------------------------------------------------- | ----------------------------------------- |
| `apps/desktop/src/main.ts`          | One line: select the layer on macOS                                   | Low                                       |
| `apps/desktop/package.json`         | Dependency, and electron-builder `afterPack` + mac config             | Medium                                    |
| `package.json`                      | `patchedDependencies` entry for the pinned Sparkle patch              | Medium                                    |
| `scripts/build-desktop-artifact.ts` | Embed `SUPublicEDKey` and the feed URL; verify the packaged framework | **High** (4172 lines, actively developed) |
| `.github/workflows/release.yml`     | Sign the archive, generate and publish the appcast                    | **High** (1398 lines)                     |

New files (ours, no conflict): `ElectronSparkleUpdater.ts` + test, `scripts/generate-sparkle-feed.ts`

- test, `scripts/sparkle-after-pack.cjs`, `patches/electron-sparkle-updater@<version>.patch`,
  `docs/sparkle-updates.md`.

Three upstream files today; five after this. Two of them are the most actively developed files in
the repo. That is a real, recurring merge tax and it should be paid deliberately, in its own PR,
with the `sync-upstream` cost understood — not folded into unrelated work.

## Security constraints — non-negotiable

- The EdDSA private seed lives in the macOS Keychain and in the `SPARKLE_ED_PRIVATE_KEY` GitHub
  Actions secret. **Never commit it, print it, paste it into an issue, or send it through chat.**
  It is equivalent to the password on the Keychain item `Private key for signing Sparkle updates`.
- Release automation must **refuse to publish** when the secret is missing, when the derived public
  key does not match the embedded one, or when the generated appcast and archive signatures do not
  verify with Sparkle's official tools. Failing open here means shipping an unverifiable update
  channel, which is worse than shipping no update channel.
- `electron-sparkle-updater` and Sparkle itself are pinned through a reviewed patch. Treat a bump
  of either as native-code and release-pipeline work, not a routine dependency update.
- v0.4's key pair and `sparkle-feed` release belong to v0.4's release train. Decide explicitly whether
  v0.5 reuses them or mints a new pair; reuse is fine and cheaper, but it must be a decision, because
  an embedded public key cannot be changed without a manual bridge release.

## Reference

v0.4 at `~/projects/gedcode-v0.4`: PR #83 (`c4f5a09e30`), later `dc69a1d295` (PR #90) and `c0c91fa9ee`.
`docs/sparkle-updates.md` there documents key custody, moving the signing key between Macs, and a
local release rehearsal; that document is worth porting close to verbatim once the code lands.
