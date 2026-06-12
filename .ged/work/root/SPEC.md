# SPEC

## Goal

Backport the accepted Linux AppImage icon packaging behavior from upstream commit `f0116e44`.

## Scope

- Generate standard Linux desktop icon PNG sizes during desktop artifact staging.
- Point electron-builder Linux config at the generated icon directory.
- Ensure Linux release CI installs or verifies ImageMagick availability.
- Update changelog and upstream decision bookkeeping.

## Non-Goals

- Do not change macOS or Windows icon staging behavior.
- Do not change signing, artifact naming, or package-manager behavior.
- Do not build full desktop artifacts locally unless required by checks.

## Acceptance Criteria

- Linux desktop staging creates `icons/<size>x<size>.png` resources from the source PNG.
- Linux build config uses the icon directory.
- Required repository checks pass.
- Completed upstream item is removed from the desktop/SSH/source-control backlog entry.
