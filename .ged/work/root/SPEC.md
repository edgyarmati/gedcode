# SPEC: Fix nightly release and CI failures

## Goal

Fix the failed nightly release path and the prior CI test failure so `main` can pass CI and a nightly release can be dispatched successfully.

## User-Visible Behavior

- Nightly workflow dispatches use the nightly release channel when resolving previous release notes tags.
- Stable releases continue resolving previous stable tags.
- Provider registry tests no longer depend on identical mock timestamps to infer a fresh probe.

## Scope

- Update `.github/workflows/release.yml` release metadata wiring.
- Add focused coverage for previous release tag resolution.
- Stabilize the failing provider registry test identified by CI.
- Document the release automation fix in `CHANGELOG.md`.
- Rerun required verification and dispatch the nightly release again.

## Non-Goals

- Do not redesign the release process.
- Do not change release artifact build targets.
- Do not change provider runtime behavior unless the test failure proves a product bug.

## Acceptance Criteria

- `bun fmt`, `bun lint`, and `bun typecheck` pass.
- Relevant tests pass via `bun run test`, not `bun test`.
- Release workflow preflight can resolve previous tags for nightly versions.
- A new nightly release workflow run starts from the fixed commit.
