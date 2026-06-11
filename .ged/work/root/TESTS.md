# TESTS

## Planned

- `bun fmt`
- `bun lint`
- `bun typecheck`
- `bun run test`
- `bun run release:smoke`
- GitHub Actions release workflow

## Evidence

- 2026-06-11T10:45:00+02:00: `bun fmt && bun lint && bun typecheck && bun run test && bun run release:smoke` passed locally.
- 2026-06-11T10:46:12+02:00: `./release.sh stable patch` dispatched `0.1.2` to `edgyarmati/gedcode` after rerunning local gates successfully.
- 2026-06-11T11:02:12+02:00: GitHub Actions run `27335069341` completed successfully.
- Release workflow jobs passed: Preflight, Build macOS arm64, Build Linux x64, Build Windows x64, Publish GitHub Release, Finalize release.
- macOS release job passed `Verify macOS artifact signature` before upload.
- Published release `v0.1.2` has 14 assets and is marked latest.
- Broken release `v0.1.1` was renamed `GedCode v0.1.1 (superseded)`, marked pre-release, and updated to point users to `v0.1.2`.
