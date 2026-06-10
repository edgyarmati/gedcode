# SPEC: Nightly release 0.1.1-nightly.20260610.1

## Goal

Run the repository's nightly release process for the next resolved nightly version using the documented wrapper/workflow path.

## User-Visible Behavior

- A GitHub prerelease is dispatched for `0.1.1-nightly.20260610.1`.
- The release uses the existing desktop artifact matrix and nightly updater manifests.
- No stable-version finalize job should run because nightly releases are prereleases.

## Scope

- Confirm release prerequisites from the current repository state.
- Ensure `CHANGELOG.md` contains a dedicated section for the resolved nightly version.
- Run required release verification gates.
- Dispatch `.github/workflows/release.yml` for the resolved nightly version.
- Record Ged workflow state and evidence for the release task.

## Non-Goals

- Do not change product behavior unless required to satisfy release prerequisites.
- Do not publish a stable release.
- Do not alter unrelated release workflow logic.

## Acceptance Criteria

- `CHANGELOG.md` contains `## 0.1.1-nightly.20260610.1` before dispatch.
- `bun fmt`, `bun lint`, `bun typecheck`, `bun run test`, and `bun run release:smoke` pass.
- `gh workflow run release.yml --ref main -f version=0.1.1-nightly.20260610.1` is dispatched successfully.
