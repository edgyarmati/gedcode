# SPEC

## Goal

Backport or adapt upstream `1916ac6d` (`Rework message metadata, timestamps, and tool work log rows (#3022)`) from `pingdotgg/t3code`.

## Scope

- Update chat timeline message metadata and timestamp rendering.
- Improve tool/work-log row presentation where compatible with this fork's current orchestration event model.
- Add or adapt focused timeline/session tests for the new formatting behavior.
- Update `CHANGELOG.md` and remove the completed upstream commit from `docs/upstream-decisions.md`.

## Non-Goals

- Do not port unrelated UI polish commits from the same decision group in this slice.
- Do not change provider protocol/runtime semantics unless the timeline rendering requires a local type adaptation.
- Do not adopt upstream-only product surfaces that do not exist in this fork.

## Acceptance Criteria

- The chat timeline renders message metadata/timestamps consistently for user, assistant, and work-log rows.
- Existing behavior for pending approvals, user input rows, and tool activity remains covered.
- The upstream decision document records this commit as completed and removes it from the remaining Want To Implement list.
- Required checks pass: `bun fmt`, `bun lint`, and serialized full typecheck. Targeted tests for modified timeline/session logic pass.
