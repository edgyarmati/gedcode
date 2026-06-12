# SPEC

## Goal

Backport upstream commit `a74dfd4f` (`[codex] Avoid shell for Node executable spawns (#2952)`) so the server build helper launches the current Node executable directly instead of wrapping it in a platform shell.

## Requirements

- In `apps/server/scripts/cli.ts`, keep the build spawn based on `process.execPath`.
- Remove Windows shell mode from that direct executable spawn.
- Do not change `npm publish` or other named command spawns that may still rely on platform shims.
- Audit and adjust only the closest local test analogues if they carry the same Node-direct spawn pattern.
- Add an unreleased `CHANGELOG.md` entry for the operator-facing spawn reliability fix.
- Mark `a74dfd4f` as completed in `docs/upstream-decisions.md` and remove it from the remaining Want To Implement list.

## Non-Goals

- Do not backport broader app-server protocol/provider startup sync from `ae7e88b0`.
- Do not generalize this into a sweeping removal of shell usage from provider, package-manager, or release-command spawns.
- Do not change runtime selection semantics beyond using the current executable directly where the command is already `process.execPath`.

## Acceptance Criteria

- The server build helper no longer sets `shell` for the `process.execPath` build spawn.
- Relevant focused tests and build checks pass.
- `bun fmt`, `bun lint`, and `bun typecheck` pass.
- Changelog and upstream decision tracking reflect the completed backport.
