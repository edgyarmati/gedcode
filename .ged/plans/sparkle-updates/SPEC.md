# Sparkle updates on macOS

Status: **implemented, 2026-10-11** (branch `sparkle-updates`). Carried forward from v0.4 as a
must-keep capability. Operator documentation: [`docs/ged/sparkle-updates.md`](../../../docs/ged/sparkle-updates.md).

## As built

The plan below held, at a much lower upstream cost than estimated. Actual edits to upstream files:

| File                                             | Lines  | Why                                                                    |
| ------------------------------------------------ | ------ | ---------------------------------------------------------------------- |
| `apps/desktop/src/main.ts`                       | 2      | Selects `ElectronSparkleUpdater.layerAuto`                             |
| `apps/desktop/src/updates/updatesTestHarness.ts` | +20/−9 | Optional `updaterLayer` / `appUpdateYml` so tests drive Sparkle        |
| `apps/desktop/package.json`                      | 1      | `electron-sparkle-updater` dependency                                  |
| `scripts/package.json`                           | 1      | Same dependency, for the after-pack hook                               |
| `scripts/lib/desktop-external-packages.ts`       | 1      | Ships the package in the staged app                                    |
| `scripts/build-desktop-artifact.ts`              | 17     | Applies the Sparkle config and stages the framework (added lines only) |
| `packages/shared/package.json`                   | 4      | `./sparkleUpdate` subpath export                                       |
| `pnpm-workspace.yaml`                            | 2      | `allowBuilds: false` for the package                                   |

No patch file (0.5.3 bundles a patched Sparkle 2.9.4 and its tools), no `release.yml` edit (our
pipeline is the new `.github/workflows/ged-release.yml`), and `createBuildConfig` and its upstream
tests are untouched — the Sparkle fragment is applied at the call site.

Found while rehearsing the real build, and fixed: the package's builder fragment has a top-level
`zip` key electron-builder 26 rejects; electron-builder resolves `afterPack` from its own working
directory, so the hook path is absolute; and the fragment omits `SURequireSignedFeed` and friends,
without which `generate_appcast` emits an **unsigned** feed that every v0.4 install would reject.
The policy keys are now set explicitly and tested.

Verified locally on an arm64 build: framework packaged, addon smart-unpacked and linked against
Sparkle 2.9.4, ad-hoc seal intact, key and feed URL embedded; feed generation end to end with a
throwaway key; and the packaged app checking the live `sparkle-feed` appcast — "up to date" at
0.5.0, and offered 0.4.8 when relabelled 0.4.0. That the repo secret derives the embedded key is
only checkable in CI; the release workflow fails closed if it does not.

**Open before the first v0.5 release:** the app still builds as `T3 Code (Alpha)` /
`com.t3tools.t3code`, while v0.4 installs are `GedCode` / `com.t3tools.gedcode`. Sparkle would
replace a v0.4 install with an app of a different identity, losing its settings and permissions.
The rebrand has to land first; the release workflow now refuses any build whose bundle
identifier is not `com.t3tools.gedcode`, so this cannot ship by accident.

Independent review (2026-10-11) found that a background poll while Sparkle held an offered or
downloaded update left the app stuck in "checking": Sparkle defers a check made during an open
session and never answers it. The adapter now answers such a check from the session itself.

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
