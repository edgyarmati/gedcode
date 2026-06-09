# SPEC: Remove macOS x64 release output

## Goal

Release GedCode without Intel Mac artifacts for now. Keep macOS Apple Silicon (`arm64`), Linux x64, and Windows x64 release artifacts.

## Approach

- Remove the `macOS x64` matrix entry from `.github/workflows/release.yml`.
- Remove macOS x64 updater-manifest merge/rename logic that is no longer needed.
- Remove advertised dedicated local Intel DMG script/docs.
- Update release smoke expectations to macOS arm64 only.
- Cancel stale release runs, commit/push, then move `v0.1.0` to the new commit because no release exists yet.

## Non-goals

- Do not remove generic internal x64 support from the desktop build script unless required.
