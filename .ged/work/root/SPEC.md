# SPEC

## Goal

Backport the Git status polling churn reduction from upstream commit `0baf1986` without pulling unrelated upstream refactors.

## Requirements

- Add a remote-only VCS status path that avoids working-tree status and diff reads when only remote ahead/behind information is needed.
- Update remote status reads to use the remote-only path while preserving branch, upstream, default-branch, ahead/behind, and pull-request lookup behavior.
- Avoid immediately repolling remote status when a stream subscriber can be served from a cached remote snapshot, including cached `null` snapshots.
- Add focused tests for the remote-only VCS path and remote status broadcaster behavior.
- Update `CHANGELOG.md` with a performance/reliability note.
- Update `docs/upstream-decisions.md` to mark `0baf1986` complete while leaving the broader reliability bucket in `Want To Implement`.

## Non-Goals

- Do not implement other reliability-bucket commits in this slice.
- Do not change package manager, test runner, or CI tooling.
- Do not change web-side status UI unless server behavior requires it.
