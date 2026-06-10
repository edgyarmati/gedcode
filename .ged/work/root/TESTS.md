# TESTS

## Planned

- CI run `27286254222` must complete successfully.
- Stable release workflow must complete successfully.
- GitHub release metadata/assets must be verified after publication.

## Evidence

- Local release wrapper gates passed before dispatch: `bun fmt`, `bun lint`, `bun typecheck`, `bun run test`, and `bun run release:smoke`.
- CI run `27286254222` completed successfully for updater fix validation.
- CI run `27286276586` completed successfully for Ged workflow closeout commit.
- Stable release workflow run `27286586841` completed successfully.
- Release `v0.1.1` verified at `https://github.com/edgyarmati/gedcode/releases/tag/v0.1.1`.
- Release `v0.1.1` is stable, marked `Latest`, and has 14 uploaded assets.
- Previous release `v0.1.1-nightly.20260610.1` remains marked `Pre-release`; previous stable `v0.1.0` is no longer latest.
- Release notes were edited to include a `What's Changed` section, full changelog link, and contributors section.
