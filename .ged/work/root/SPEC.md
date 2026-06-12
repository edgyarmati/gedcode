# SPEC

## Goal

Backport the accepted model picker performance and UI improvements from upstream commit `31533466`.

## Scope

- Port model picker virtualization and long-list rendering improvements where they fit the local web UI.
- Port related model picker row/sidebar/provider icon polish needed by the upstream slice.
- Add or adapt focused tests if local coverage exists for the changed model picker behavior.
- Update changelog and upstream decision bookkeeping.

## Non-Goals

- Do not port unrelated chat timeline, markdown, composer, or chrome polish commits in this slice.
- Do not change provider runtime/model discovery behavior.
- Do not adopt mobile-only or package-manager lockfile changes.

## Acceptance Criteria

- Long model lists remain responsive and render correctly in the model picker.
- Existing provider/model picker behavior remains intact.
- Required repository checks pass.
- Completed upstream item is removed or narrowed in `docs/upstream-decisions.md`.
