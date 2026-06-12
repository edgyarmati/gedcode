# SPEC

## Goal

Move the Grok provider out of the implementation backlog and backport the accepted source-control edge-case fixes from upstream commit `49c1b646`.

## Scope

- Categorize Grok provider support as "Not Doing For Now" in `docs/upstream-decisions.md`.
- Port source-control improvements for:
  - self-hosted GitLab remote detection and clone URL handling,
  - GitHub CLI auth status with multiple accounts/hosts,
  - Azure DevOps repository web URLs,
  - provider registry/discovery behavior around detected remotes.
- Add or adapt focused tests from upstream where they map to local code.
- Update changelog and upstream decision bookkeeping.

## Non-Goals

- Do not add the Grok provider.
- Do not change UI polish, package-manager, or release migration behavior.
- Do not rewrite source-control architecture outside the upstream edge-case fixes.

## Acceptance Criteria

- `docs/upstream-decisions.md` no longer lists Grok under "Want To Implement".
- Source-control providers handle the upstream edge cases covered by focused tests.
- Completed upstream source-control item is removed from the "Want To Implement" list.
- Required repository checks pass.
