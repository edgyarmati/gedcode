# SPEC

## Goal

Ship macOS release artifacts that remain runnable without an Apple Developer Program membership while preventing malformed bundles that macOS reports as damaged.

## Evidence

- `v0.1.0` used electron-builder `26.8.1`, fell back to ad-hoc signing, produced `Identifier=com.t3tools.gedcode`, and had sealed resources.
- `v0.1.1` used unpinned electron-builder `26.15.2`, skipped macOS application signing under `CSC_IDENTITY_AUTO_DISCOVERY=false`, produced `Identifier=Electron`, and had `Sealed Resources=none`.
- macOS Gatekeeper reports the `v0.1.1` bundle as damaged because the bundle signature/resources are internally inconsistent, not merely because the app is unnotarized.

## Requirements

- Pin the desktop artifact builder to the ad-hoc-signing-compatible electron-builder version used by `v0.1.0`.
- Allow release macOS builds without Apple signing secrets while the project lacks an Apple Developer Program membership.
- Verify every macOS release artifact has a valid code signature, the expected bundle identifier, and sealed resources before upload.
- When Apple signing secrets are present, keep the stricter Developer ID signing/notarization verification path.
- Keep release docs and changelog aligned with the supported unsigned/manual-open release mode.

## Non-Goals

- Do not bypass macOS Gatekeeper entirely for unsigned builds.
- Do not require Apple signing until credentials are available.
- Do not change Windows/Linux release behavior beyond shared builder pinning.
